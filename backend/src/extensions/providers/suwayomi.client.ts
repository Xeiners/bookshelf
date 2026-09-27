import { z } from 'zod'
import { upstreamError } from '../../lib/errors.js'
import { getJson, type ProviderLog } from './http.js'

/**
 * Client GraphQL de Suwayomi-Server (ex-Tachidesk), le pont qui exécute les
 * extensions Tachiyomi / Mihon (APK Kotlin, dans une JVM) et les expose par
 * une API propre. Bookshelf ne charge jamais une extension lui-même : il ne
 * parle qu'à ce service, sur le réseau interne de la pile Docker.
 *
 * Écrit d'après le code de Suwayomi-Server v2.3 (`graphql/mutations/*`,
 * `graphql/types/*`). Chaque réponse est validée par zod : un changement de
 * schéma met la source en échec au lieu de propager des `undefined`.
 *
 * Les valeurs sont écrites dans la requête et non passées en variables : les
 * `Long` Kotlin (identifiants de source, dates) sont un scalaire propre à
 * Suwayomi (`LongString`) dont le nom n'est pas un contrat stable. Chaînes via
 * `JSON.stringify` (littéral GraphQL valide), entiers vérifiés : pas d'injection.
 */

/** `Long` Kotlin : sérialisé en chaîne (`LongString`), parfois en nombre. */
const Long = z.union([z.string(), z.number()]).transform(String)

const SourceSchema = z.object({
  id: Long,
  name: z.string(),
  lang: z.string(),
  displayName: z.string().nullish(),
  isNsfw: z.boolean().nullish(),
})

const MangaSchema = z.object({ id: z.number().int(), title: z.string() })

const ChapterSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  chapterNumber: z.number(),
  scanlator: z.string().nullish(),
  uploadDate: Long.nullish(),
  sourceOrder: z.number().int().nullish(),
  pageCount: z.number().int().nullish(),
})

const ExtensionSchema = z.object({
  pkgName: z.string(),
  name: z.string(),
  lang: z.string(),
  versionName: z.string().nullish(),
  isInstalled: z.boolean(),
  hasUpdate: z.boolean().nullish(),
  isObsolete: z.boolean().nullish(),
  isNsfw: z.boolean().nullish(),
})

export type BridgeSource = z.infer<typeof SourceSchema>
export type BridgeManga = z.infer<typeof MangaSchema>
export type BridgeChapter = z.infer<typeof ChapterSchema>
export type BridgeExtension = z.infer<typeof ExtensionSchema>

const EXTENSION_FIELDS = 'pkgName name lang versionName isInstalled hasUpdate isObsolete isNsfw'

const Envelope = z.object({
  data: z.unknown().nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
})

const SOURCE_ID = /^-?\d{1,20}$/
/** Nom de paquet Android : `eu.kanade.tachiyomi.extension.en.asurascans`. */
export const PACKAGE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/

export interface SuwayomiClientOptions {
  baseUrl: string
  userAgent: string
  /** Délai d'un appel de lecture (recherche, chapitres, pages), en ms. */
  timeoutMs: number
  /** Compte Suwayomi (`AUTH_MODE=basic_auth`) ; aucun par défaut, le service reste sur le réseau interne. */
  user?: string
  password?: string
  log?: ProviderLog
}

export interface SuwayomiClient {
  readonly baseUrl: string
  authHeaders(): Record<string, string>
  listSources(): Promise<BridgeSource[]>
  searchManga(sourceId: string, query: string): Promise<BridgeManga[]>
  fetchChapters(mangaId: number): Promise<BridgeChapter[]>
  /** URL absolues des pages, servies par Suwayomi lui-même (`/api/v1/manga/…/page/n`). */
  fetchChapterPages(chapterId: number): Promise<string[]>
  listExtensions(): Promise<BridgeExtension[]>
  /** Relit les dépôts d'extensions configurés (`EXTENSION_STORES`), puis renvoie le catalogue. */
  refreshExtensions(): Promise<BridgeExtension[]>
  installExtension(pkgName: string): Promise<BridgeExtension | null>
  updateExtension(pkgName: string): Promise<BridgeExtension | null>
}

/** Installer un APK le télécharge puis le convertit (dex2jar) : bien plus long qu'une lecture. */
const INSTALL_TIMEOUT_MS = 120_000
const REFRESH_TIMEOUT_MS = 30_000

/**
 * Message d'erreur GraphQL lisible : Suwayomi y colle la pile Java entière et
 * un préfixe technique. On garde la première ligne, sans le préfixe, et on dit
 * quoi faire quand c'est Cloudflare qui bloque.
 */
export function graphqlErrorMessage(raw: string): string {
  const line = (raw.split('\n', 1)[0] ?? '').replace(/^Exception while fetching data \([^)]*\)\s*:\s*/, '').trim().slice(0, 200)
  if (/cloudflare/i.test(line)) return `${line} — site protégé par Cloudflare : activer FlareSolverr (docs/BACKEND.md)`
  return line || 'erreur inconnue'
}

const assertInt =(value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw upstreamError(`Pont Tachiyomi : ${what} invalide.`)
  return value
}

export function createSuwayomiClient(options: SuwayomiClientOptions): SuwayomiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const endpoint = `${baseUrl}/api/graphql`
  const auth: Record<string, string> =
    options.user && options.password
      ? { Authorization: `Basic ${Buffer.from(`${options.user}:${options.password}`).toString('base64')}` }
      : {}

  async function graphql<S extends z.ZodType>(name: string, query: string, schema: S, timeoutMs = options.timeoutMs): Promise<z.infer<S>> {
    const envelope = await getJson(endpoint, Envelope, {
      userAgent: options.userAgent,
      label: 'Le pont Tachiyomi',
      endpoint: name,
      log: options.log,
      timeoutMs,
      headers: auth,
      method: 'POST',
      body: { query },
      authHint: 'TACHIYOMI_BRIDGE_USER / TACHIYOMI_BRIDGE_PASSWORD',
    })
    if (!envelope) throw upstreamError('Pont Tachiyomi : /api/graphql introuvable (Suwayomi trop ancien ?).')
    const firstError = envelope.errors?.[0]?.message ? graphqlErrorMessage(envelope.errors[0].message) : null
    if (firstError) {
      options.log?.(`${name} : erreur GraphQL (${firstError})`)
      throw upstreamError(`Pont Tachiyomi : ${firstError}`)
    }
    const parsed = schema.safeParse(envelope.data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = `${issue?.path.join('.') || 'racine'} : ${issue?.message ?? '?'}`
      options.log?.(`${name} : format de réponse inattendu (${where})`)
      throw upstreamError(`Pont Tachiyomi : format de réponse inattendu (${where}).`)
    }
    return parsed.data
  }

  const extensionPatch = async (pkgName: string, patch: 'install' | 'update') => {
    if (!PACKAGE_NAME.test(pkgName)) throw upstreamError(`Pont Tachiyomi : paquet « ${pkgName} » invalide.`)
    const data = await graphql(
      patch,
      `mutation { updateExtension(input: { id: ${JSON.stringify(pkgName)}, patch: { ${patch}: true } }) { extension { ${EXTENSION_FIELDS} } } }`,
      z.object({ updateExtension: z.object({ extension: ExtensionSchema.nullish() }) }),
      INSTALL_TIMEOUT_MS,
    )
    return data.updateExtension.extension ?? null
  }

  return {
    baseUrl,
    authHeaders: () => auth,

    async listSources() {
      const data = await graphql(
        'sources',
        '{ sources { nodes { id name lang displayName isNsfw } } }',
        z.object({ sources: z.object({ nodes: z.array(SourceSchema) }) }),
      )
      return data.sources.nodes
    },

    async searchManga(sourceId, query) {
      if (!SOURCE_ID.test(sourceId)) throw upstreamError(`Pont Tachiyomi : source « ${sourceId} » invalide.`)
      const data = await graphql(
        'search',
        `mutation { fetchSourceManga(input: { source: ${JSON.stringify(sourceId)}, type: SEARCH, page: 1, query: ${JSON.stringify(query)} }) { mangas { id title } } }`,
        z.object({ fetchSourceManga: z.object({ mangas: z.array(MangaSchema) }) }),
      )
      return data.fetchSourceManga.mangas
    },

    async fetchChapters(mangaId) {
      const data = await graphql(
        'chapters',
        `mutation { fetchChapters(input: { mangaId: ${assertInt(mangaId, 'œuvre')} }) { chapters { id name chapterNumber scanlator uploadDate sourceOrder pageCount } } }`,
        z.object({ fetchChapters: z.object({ chapters: z.array(ChapterSchema) }) }),
      )
      return data.fetchChapters.chapters
    },

    async fetchChapterPages(chapterId) {
      const data = await graphql(
        'pages',
        `mutation { fetchChapterPages(input: { chapterId: ${assertInt(chapterId, 'chapitre')} }) { pages } }`,
        z.object({ fetchChapterPages: z.object({ pages: z.array(z.string()) }) }),
      )
      // Chemins relatifs à Suwayomi : jamais une autre origine (cf. `originImageFetcher`).
      return data.fetchChapterPages.pages.map((page) => new URL(page, `${baseUrl}/`).href)
    },

    async listExtensions() {
      const data = await graphql(
        'extensions',
        `{ extensions { nodes { ${EXTENSION_FIELDS} } } }`,
        z.object({ extensions: z.object({ nodes: z.array(ExtensionSchema) }) }),
        REFRESH_TIMEOUT_MS,
      )
      return data.extensions.nodes
    },

    async refreshExtensions() {
      const data = await graphql(
        'fetchExtensions',
        `mutation { fetchExtensions(input: {}) { extensions { ${EXTENSION_FIELDS} } } }`,
        z.object({ fetchExtensions: z.object({ extensions: z.array(ExtensionSchema) }) }),
        REFRESH_TIMEOUT_MS,
      )
      return data.fetchExtensions.extensions
    },

    installExtension: (pkgName) => extensionPatch(pkgName, 'install'),
    updateExtension: (pkgName) => extensionPatch(pkgName, 'update'),
  }
}
