/**
 * Pont Tachiyomi (Suwayomi simulé) : client GraphQL, normalisation, recherche
 * par titre, isolation des sites lents ou en panne, installation des
 * extensions, puis de bout en bout à travers la vraie API (liste fusionnée,
 * badges par site, pages relayées depuis le pont).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { SourceAggregatorService } from '../src/extensions/aggregator.js'
import { encodeChapterKey } from '../src/extensions/chapterKey.js'
import { SourceRegistry } from '../src/extensions/registry.js'
import { createSuwayomiClient, graphqlErrorMessage } from '../src/extensions/providers/suwayomi.client.js'
import {
  bridgeChapterNumber,
  bridgeChapterTitle,
  createTachiyomiBridgeProvider,
  normalizeBridgeChapter,
  type ActiveSource,
} from '../src/extensions/providers/tachiyomiBridge.provider.js'
import { ensureExtensions, extensionsForLanguages, matchesPackage } from '../src/extensions/providers/tachiyomiExtensions.js'
import type { NormalizedChapter, SourceProvider } from '../src/extensions/types.js'
import type { MdChapter } from '../src/modules/chapters/chapters.client.js'
import { BILINGUAL, ENGLISH_ONLY, NO_TRANSLATION } from './fixtures.js'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('tachiyomi')
process.env.TACHIYOMI_BRIDGE_ENABLED = 'true'
// Nom sans point, comme sur le réseau Docker : le relais générique le refuserait, `fetchImage` non.
process.env.TACHIYOMI_BRIDGE_URL = 'http://suwayomi:4567'
installMangadexMock()
mockedHosts.add('suwayomi')

/* ---- Suwayomi simulé ---------------------------------------------------------------------- */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const gql = (data: unknown) => json({ data })

interface FakeChapter {
  id: number
  name: string
  chapterNumber: number
  scanlator?: string | null
  uploadDate?: string
  pageCount?: number
}

const SOURCES = [
  { id: '1001', name: 'Asura Scans', lang: 'en', displayName: 'Asura Scans (EN)', isNsfw: false },
  { id: '2002', name: 'Scantrad', lang: 'fr', displayName: 'Scantrad (FR)', isNsfw: false },
  { id: '3003', name: 'Flame Comics', lang: 'en', displayName: 'Flame Comics (EN)', isNsfw: false },
  { id: '4004', name: 'Adult Scans', lang: 'en', displayName: 'Adult Scans (EN)', isNsfw: true },
  { id: '5005', name: 'Deutsche Scans', lang: 'de', displayName: 'Deutsche Scans (DE)', isNsfw: false },
]

/** Œuvre du pont par site, selon la recherche : une suite au titre proche AVANT la bonne œuvre. */
function searchResults(source: string, query: string): { id: number; title: string }[] {
  if (!/Blade|Katana/.test(query)) return []
  if (source === '1001') return [{ id: 12, title: 'The Blade Road 2' }, { id: 11, title: 'The Blade Road' }]
  if (source === '2002') return [{ id: 21, title: 'La Voie du Sabre' }]
  if (source === '3003') return [{ id: 31, title: 'Blade Road, The' }, { id: 32, title: 'The Blade Road' }]
  return [{ id: 99, title: 'The Blade Road' }]
}

const CHAPTERS: Record<number, FakeChapter[]> = {
  11: [
    { id: 501, name: 'Chapter 1', chapterNumber: 1, uploadDate: '1704067200000', pageCount: -1 },
    { id: 503, name: 'Chapter 3 - The Duel', chapterNumber: 3, uploadDate: '1704153600000', pageCount: -1 },
  ],
  21: [
    { id: 601, name: 'Chapitre 1', chapterNumber: 1, scanlator: 'Team Sabre', pageCount: 2 },
    { id: 603, name: 'Chapitre 3', chapterNumber: 3, scanlator: 'Team Sabre', pageCount: 2 },
  ],
  32: [{ id: 703, name: 'Ch. 3', chapterNumber: 3, pageCount: 2 }],
}

interface FakeState {
  /** Sites qui ne répondent jamais (délai dépassé). */
  hanging: Set<string>
  /** Sites en panne (erreur GraphQL). */
  failing: Set<string>
  calls: string[]
  installed: Set<string>
  bodies: string[]
  /** En-tête `Authorization` de chaque appel GraphQL. */
  auth: (string | null)[]
}

const newState = (): FakeState => ({ hanging: new Set(), failing: new Set(), calls: [], installed: new Set(['eu.kanade.tachiyomi.extension.en.flamecomics']), bodies: [], auth: [] })

const CATALOG = [
  { pkgName: 'eu.kanade.tachiyomi.extension.en.asurascans', name: 'Asura Scans', lang: 'en' },
  { pkgName: 'eu.kanade.tachiyomi.extension.en.flamecomics', name: 'Flame Comics', lang: 'en' },
  { pkgName: 'eu.kanade.tachiyomi.extension.fr.mangascantrad', name: 'Scantrad', lang: 'fr' },
  { pkgName: 'eu.kanade.tachiyomi.extension.all.comick', name: 'Comick', lang: 'all' },
  { pkgName: 'eu.kanade.tachiyomi.extension.de.foo', name: 'Foo', lang: 'de' },
]

const catalogOf = (state: FakeState) =>
  CATALOG.map((extension) => ({
    ...extension,
    versionName: '1.4.1',
    isInstalled: state.installed.has(extension.pkgName),
    hasUpdate: extension.pkgName.endsWith('flamecomics'),
    isObsolete: false,
    isNsfw: false,
  }))

type Reply = Response | 'hang' | undefined

function fakeSuwayomi(state: FakeState, url: URL, init?: RequestInit): Reply {
  if (url.pathname.startsWith('/api/v1/manga/')) {
    state.calls.push(`image ${url.pathname}`)
    return new Response(new Uint8Array([137, 80, 78, 71, url.pathname.length]), { status: 200, headers: { 'Content-Type': 'image/png' } })
  }
  if (url.pathname !== '/api/graphql' || init?.method !== 'POST') return new Response('{}', { status: 404 })
  const query = (JSON.parse(String(init.body)) as { query: string }).query
  state.bodies.push(query)
  state.auth.push(new Headers(init.headers).get('Authorization'))

  if (query.includes('fetchSourceManga')) {
    const source = /source: "(-?\d+)"/.exec(query)?.[1] ?? ''
    const text = JSON.parse(/query: ("(?:[^"\\]|\\.)*")/.exec(query)?.[1] ?? '""') as string
    state.calls.push(`search ${source} ${text}`)
    if (state.hanging.has(source)) return 'hang'
    if (state.failing.has(source) || text.includes('Mushoku')) return json({ data: null, errors: [{ message: 'HTTP error 503' }] })
    return gql({ fetchSourceManga: { mangas: searchResults(source, text) } })
  }
  if (query.includes('fetchChapterPages')) {
    const chapterId = Number(/chapterId: (\d+)/.exec(query)?.[1])
    state.calls.push(`pages ${chapterId}`)
    const pages = [0, 1].map((index) => `/api/v1/manga/9/chapter/${chapterId}/page/${index}`)
    return gql({ fetchChapterPages: { pages } })
  }
  if (query.includes('fetchChapters')) {
    const mangaId = Number(/mangaId: (\d+)/.exec(query)?.[1])
    state.calls.push(`chapters ${mangaId}`)
    const chapters = (CHAPTERS[mangaId] ?? []).map((chapter) => ({ scanlator: null, uploadDate: '0', ...chapter, sourceOrder: 0 }))
    return gql({ fetchChapters: { chapters } })
  }
  if (query.includes('updateExtension')) {
    const pkgName = /id: "([^"]+)"/.exec(query)?.[1] ?? ''
    state.calls.push(`${query.includes('install: true') ? 'install' : 'update'} ${pkgName}`)
    if (pkgName.endsWith('mangascantrad')) return json({ data: null, errors: [{ message: 'Failed to download APK' }] })
    state.installed.add(pkgName)
    return gql({ updateExtension: { extension: catalogOf(state).find((extension) => extension.pkgName === pkgName) } })
  }
  if (query.includes('fetchExtensions')) return gql({ fetchExtensions: { extensions: catalogOf(state) } })
  if (query.includes('sources')) return gql({ sources: { nodes: SOURCES } })
  return json({ data: null, errors: [{ message: 'unknown query' }] })
}

/** Remplace `fetch` pour l'hôte `bridge.test` le temps d'un test. */
async function withBridge<T>(state: FakeState, run: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname !== 'bridge.test') return previous(input, init)
    const reply = fakeSuwayomi(state, url, init)
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
    }
    return reply ?? new Response('{}', { status: 404 })
  }
  try {
    return await run()
  } finally {
    globalThis.fetch = previous
  }
}

const BRIDGE = 'http://bridge.test:4567'
const ALIASES = ['The Blade Road', 'Katana no Michi', 'La Voie du sabre']

function bridge(options: { timeoutMs?: number; sources?: string[]; maxSources?: number; logs?: string[]; user?: string; password?: string } = {}) {
  const log = (message: string) => options.logs?.push(message)
  const client = createSuwayomiClient({
    baseUrl: BRIDGE,
    userAgent: 'Bookshelf-test',
    timeoutMs: options.timeoutMs ?? 3_000,
    log,
    ...(options.user && { user: options.user, password: options.password }),
  })
  const provider = createTachiyomiBridgeProvider({
    client,
    userAgent: 'Bookshelf-test',
    timeoutMs: options.timeoutMs ?? 3_000,
    languages: ['fr', 'en'],
    maxSources: options.maxSources ?? 10,
    sources: options.sources ?? [],
    log,
  })
  return { client, provider }
}

/* ---- Normalisation ---------------------------------------------------------------------------- */

const ASURA: ActiveSource = { id: '1001', name: 'Asura Scans', lang: 'en', displayName: 'Asura Scans (EN)', isNsfw: false }

describe('pont Tachiyomi — normalisation des chapitres', () => {
  it('numéro : Float Kotlin arrondi, inconnu (-1) → déduit du nom', () => {
    assert.equal(bridgeChapterNumber(12, 'x'), '12')
    assert.equal(bridgeChapterNumber(10.100000381469727, 'x'), '10.1')
    assert.equal(bridgeChapterNumber(12.5, 'x'), '12.5')
    assert.equal(bridgeChapterNumber(-1, 'Chapter 7.5'), '7.5')
    assert.equal(bridgeChapterNumber(-1, 'Prologue'), null)
  })

  it('titre : la numérotation en tête est retirée, un nom qui n’est que numérotation vaut null', () => {
    assert.equal(bridgeChapterTitle('Chapter 3 - The Duel'), 'The Duel')
    assert.equal(bridgeChapterTitle('Vol.2 Ch.14 : Retour'), 'Retour')
    assert.equal(bridgeChapterTitle('Chapitre 12.5'), null)
    assert.equal(bridgeChapterTitle('Ch. 3'), null)
    assert.equal(bridgeChapterTitle('Prologue'), 'Prologue')
  })

  it('pages inconnues (-1) → 0, date en millisecondes, équipe créditée, sous-source déclarée', () => {
    const normalized = normalizeBridgeChapter(
      { id: 501, name: 'Vol. 2 Chapter 14', chapterNumber: 14, scanlator: ' Team X ', uploadDate: '1704067200000', sourceOrder: 0, pageCount: -1 },
      ASURA,
    )
    assert.deepEqual(normalized, {
      id: '501',
      number: '14',
      volume: '2',
      title: null,
      language: 'en',
      pages: 0,
      groups: [{ id: 'team x', name: 'Team X' }],
      publishedAt: '2024-01-01T00:00:00.000Z',
      origin: { id: '1001', name: 'Asura Scans' },
    })
  })

  it('date absente ou nulle : époque Unix, jamais une date invalide', () => {
    const normalized = normalizeBridgeChapter({ id: 1, name: 'Ch 1', chapterNumber: 1, uploadDate: '0' }, ASURA)
    assert.equal(normalized.publishedAt, new Date(0).toISOString())
  })
})

/* ---- Client GraphQL ---------------------------------------------------------------------------- */

describe('pont Tachiyomi — client GraphQL', () => {
  it('valeurs échappées dans la requête (pas d’injection GraphQL), authentification Basic transmise', async () => {
    const state = newState()
    await withBridge(state, () => bridge({ user: 'reader', password: 's3cret' }).client.searchManga('1001', 'Blade "} } mutation { x'))
    assert.ok(state.bodies[0]?.includes('query: "Blade \\"} } mutation { x"'))
    assert.equal(state.auth[0], `Basic ${Buffer.from('reader:s3cret').toString('base64')}`)
  })

  it('identifiants invalides refusés sans appel réseau', async () => {
    const state = newState()
    await withBridge(state, async () => {
      const { client } = bridge()
      await assert.rejects(client.searchManga('1001", x: "', 'a'), { status: 502 })
      await assert.rejects(client.fetchChapters(-1), { status: 502 })
      await assert.rejects(client.installExtension('evil" } }'), { status: 502 })
    })
    assert.equal(state.bodies.length, 0)
  })

  it('erreur GraphQL et format inattendu : erreur explicite, journalisée', async () => {
    const logs: string[] = []
    const previous = globalThis.fetch
    globalThis.fetch = async () => json({ data: { sources: { nodes: [{ id: 1, lang: 'en' }] } } })
    try {
      await assert.rejects(bridge({ logs }).client.listSources(), /format de réponse inattendu/)
      globalThis.fetch = async () => json({ data: null, errors: [{ message: 'Source not found' }] })
      await assert.rejects(bridge({ logs }).client.listSources(), /Source not found/)
      globalThis.fetch = async () => new Response('nope', { status: 404 })
      await assert.rejects(bridge({ logs }).client.listSources(), /introuvable/)
    } finally {
      globalThis.fetch = previous
    }
    assert.ok(logs.some((line) => line.includes('sources : format de réponse inattendu')))
    assert.ok(logs.some((line) => line.includes('erreur GraphQL (Source not found)')))
  })

  it('message d’erreur : première ligne sans préfixe ni pile Java ; Cloudflare → piste FlareSolverr', () => {
    const cloudflare = [
      'Exception while fetching data (/fetchSourceManga) : Cloudflare bypass currently disabled',
      '   at eu.kanade.tachiyomi.b.a.k.a(Unknown Source)',
      '   at eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.intercept(CloudflareInterceptor.kt:52)',
    ].join('\n')
    assert.equal(graphqlErrorMessage(cloudflare), 'Cloudflare bypass currently disabled — site protégé par Cloudflare : activer FlareSolverr (docs/BACKEND.md)')
    assert.equal(graphqlErrorMessage('Exception while fetching data (/fetchChapters) : HTTP error 503'), 'HTTP error 503')
    assert.equal(graphqlErrorMessage('\n'), 'erreur inconnue')
  })

  it('pages : URL absolues sur l’origine du pont', async () => {
    await withBridge(newState(), async () => {
      const pages = await bridge().client.fetchChapterPages(703)
      assert.deepEqual(pages, [`${BRIDGE}/api/v1/manga/9/chapter/703/page/0`, `${BRIDGE}/api/v1/manga/9/chapter/703/page/1`])
    })
  })
})

/* ---- Fournisseur ---------------------------------------------------------------------------------- */

describe('pont Tachiyomi — fournisseur', () => {
  it('interroge les sites fr / en non adultes, retient l’œuvre exacte (pas la suite), une sous-source par site', async () => {
    const state = newState()
    const logs: string[] = []
    const chapters = await withBridge(state, () => bridge({ logs }).provider.fetchChapterList('manga-blade', ALIASES))

    const searched = new Set(state.calls.filter((call) => call.startsWith('search')).map((call) => call.split(' ')[1]))
    assert.deepEqual([...searched].sort(), ['1001', '2002', '3003'])
    // Asura : « The Blade Road 2 » (suite) écarté au profit de l'œuvre ; Flame : l'exact avant le proche.
    assert.deepEqual(state.calls.filter((call) => call.startsWith('chapters')).sort(), ['chapters 11', 'chapters 21', 'chapters 32'])
    assert.deepEqual(
      chapters.map((chapter) => [chapter.origin?.name, chapter.number, chapter.language]),
      [
        ['Asura Scans', '1', 'en'],
        ['Asura Scans', '3', 'en'],
        ['Flame Comics', '3', 'en'],
        ['Scantrad', '1', 'fr'],
        ['Scantrad', '3', 'fr'],
      ],
    )
    assert.ok(logs.some((line) => /Asura Scans : « The Blade Road » retenu \(100 %\)/.test(line)))
  })

  it('un site qui ne répond pas est abandonné à son délai ; les autres sont servis', async () => {
    const state = newState()
    state.hanging.add('1001')
    const logs: string[] = []
    const started = Date.now()
    const chapters = await withBridge(state, () => bridge({ timeoutMs: 150, logs }).provider.fetchChapterList('manga-slow', ALIASES))
    assert.ok(Date.now() - started < 1_500, 'le délai d’un appel borne l’attente')
    assert.deepEqual([...new Set(chapters.map((chapter) => chapter.origin?.name))].sort(), ['Flame Comics', 'Scantrad'])
    assert.ok(logs.some((line) => line.startsWith('search : délai dépassé')))
    assert.ok(logs.some((line) => line.startsWith('Asura Scans : Le pont Tachiyomi est injoignable')))
  })

  it('un échec n’est pas retenu comme une absence : le site est réinterrogé à la requête suivante', async () => {
    const state = newState()
    state.failing.add('2002')
    const { provider } = bridge()
    await withBridge(state, () => provider.fetchChapterList('manga-retry', ALIASES))
    state.failing.clear()
    state.calls.length = 0
    const chapters = await withBridge(state, () => provider.fetchChapterList('manga-retry', ALIASES))
    // Scantrad recherché de nouveau ; les correspondances trouvées, elles, sont gardées en cache.
    assert.deepEqual(state.calls.filter((call) => call.startsWith('search')).map((call) => call.split(' ')[1]), ['2002', '2002'])
    assert.ok(chapters.some((chapter) => chapter.origin?.name === 'Scantrad'))
  })

  it('tous les sites en échec : le fournisseur échoue (l’agrégateur le marque « failed »)', async () => {
    const state = newState()
    for (const source of ['1001', '2002', '3003']) state.failing.add(source)
    await withBridge(state, async () => {
      await assert.rejects(bridge().provider.fetchChapterList('manga-down', ALIASES), /Aucune extension Tachiyomi ne répond/)
    })
  })

  it('pont injoignable : erreur rapide, jamais d’attente au-delà du délai', async () => {
    const previous = globalThis.fetch
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    try {
      await assert.rejects(bridge().provider.fetchChapterList('manga-x', ALIASES), /injoignable \(sources\)/)
    } finally {
      globalThis.fetch = previous
    }
  })

  it('sites restreints (TACHIYOMI_SOURCES) et plafond (TACHIYOMI_BRIDGE_MAX_SOURCES)', async () => {
    const state = newState()
    await withBridge(state, async () => {
      const restricted = await bridge({ sources: ['scantrad', '3003'] }).provider.activeSources()
      assert.deepEqual(restricted.map((source) => source.name), ['Flame Comics', 'Scantrad'])
      const capped = await bridge({ maxSources: 1 }).provider.activeSources()
      assert.deepEqual(capped.map((source) => source.name), ['Asura Scans'])
    })
  })

  it('sans titre connu : aucune recherche', async () => {
    const state = newState()
    const chapters = await withBridge(state, () => bridge().provider.fetchChapterList('manga-untitled', []))
    assert.deepEqual(chapters, [])
    assert.equal(state.calls.length, 0)
  })

  it('images : téléchargées depuis le pont seulement, jamais depuis une autre origine', async () => {
    const state = newState()
    await withBridge(state, async () => {
      const { provider } = bridge()
      const [page] = await provider.fetchPageUrls('703', { quality: 'data' })
      assert.ok(page)
      const ok = await provider.fetchImage!(page)
      assert.equal(ok.image?.contentType, 'image/png')
      const refused = await provider.fetchImage!({ index: 0, url: 'https://evil.example.test/x.png' })
      assert.equal(refused.image, null)
      assert.match(refused.reason ?? '', /origine https:\/\/evil\.example\.test refusée/)
      await assert.rejects(provider.fetchPageUrls('../../admin', { quality: 'data' }), { status: 404 })
    })
  })
})

/* ---- Agrégateur : sous-sources ------------------------------------------------------------------- */

const chapter = (id: string, number: string, extra: Partial<NormalizedChapter> = {}): NormalizedChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'en',
  pages: 10,
  groups: [],
  publishedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
})

function fakeProvider(id: string, priority: number, chapters: NormalizedChapter[]): SourceProvider {
  return {
    id,
    name: id.toUpperCase(),
    baseUrl: `https://${id}.example.test`,
    supportedLanguages: ['fr', 'en'],
    priority,
    // Le registre réserve « mangadex » à une source qui relaie ses propres pages.
    selfRelayed: id === 'mangadex',
    fetchChapterList: async () => chapters,
    fetchPageUrls: async () => [],
  }
}

describe('agrégateur — sous-sources (origin)', () => {
  const aggregatorOf = (...providers: SourceProvider[]) => {
    const registry = new SourceRegistry()
    for (const provider of providers) registry.register(provider)
    return new SourceAggregatorService(registry, { relayUrl: (key, index) => `/relay/${key}/${index}` })
  }

  it('chaque site devient une source distincte ; il hérite de la priorité de son fournisseur', async () => {
    const aggregator = aggregatorOf(
      fakeProvider('mangadex', 100, [chapter('c0000000-0000-4000-8000-000000000001', '1')]),
      fakeProvider('tachiyomi', 20, [
        chapter('501', '1', { origin: { id: '1001', name: 'Asura Scans' } }),
        chapter('701', '1', { origin: { id: '3003', name: 'Flame Comics' } }),
        chapter('703', '2', { origin: { id: '3003', name: 'Flame Comics' } }),
        chapter('503', '2', { origin: { id: '1001', name: 'Asura Scans' }, pages: 0 }),
      ]),
    )
    const { chapters, sources } = await aggregator.fetchChapterList('m')
    assert.deepEqual(sources.map((source) => source.id), ['mangadex', 'tachiyomi'])

    const [first, second] = chapters
    assert.equal(first?.source.id, 'mangadex')
    assert.deepEqual(first?.alternates.map((alt) => alt.source), [
      { id: 'tachiyomi:1001', name: 'Asura Scans' },
      { id: 'tachiyomi:3003', name: 'Flame Comics' },
    ])
    // Chapitre 2 : même priorité, la version aux pages connues l'emporte ; l'autre site en repli.
    assert.deepEqual(second?.source, { id: 'tachiyomi:3003', name: 'Flame Comics' })
    assert.equal(second?.id, encodeChapterKey('tachiyomi', '703'))
    assert.deepEqual(second?.alternates.map((alt) => alt.source.id), ['tachiyomi:1001'])
    assert.equal(JSON.stringify(chapters).includes('"origin"'), false)
  })

  it('origine invalide : provenance du fournisseur ; jamais d’usurpation d’une autre source', async () => {
    const aggregator = aggregatorOf(
      fakeProvider('tachiyomi', 20, [
        chapter('1', '1', { origin: { id: 'a b', name: 'Espace' } }),
        chapter('2', '2', { origin: { id: '42', name: '   ' } }),
        chapter('3', '3', { origin: { id: 'mangadex', name: 'MangaDex' } }),
      ]),
    )
    const { chapters } = await aggregator.fetchChapterList('m')
    assert.deepEqual(chapters.map((item) => item.source.id), ['tachiyomi', 'tachiyomi', 'tachiyomi:mangadex'])
  })
})

/* ---- Extensions ------------------------------------------------------------------------------------ */

describe('pont Tachiyomi — extensions', () => {
  it('nom court ou complet', () => {
    assert.equal(matchesPackage('eu.kanade.tachiyomi.extension.en.asurascans', 'en.asurascans'), true)
    assert.equal(matchesPackage('eu.kanade.tachiyomi.extension.en.asurascans', 'eu.kanade.tachiyomi.extension.en.asurascans'), true)
    assert.equal(matchesPackage('eu.kanade.tachiyomi.extension.en.asurascans', 'asurascans'), false)
  })

  it('catalogue par langue : fr / en et multilingues, jamais les autres', async () => {
    const catalog = catalogOf(newState())
    assert.deepEqual(extensionsForLanguages(catalog, ['fr']).map((extension) => extension.name), ['Comick', 'Scantrad'])
    assert.equal(extensionsForLanguages(catalog, ['fr', 'en']).some((extension) => extension.lang === 'de'), false)
  })

  it('installe les absentes, met à jour, signale les inconnues et les échecs, une à une', async () => {
    const state = newState()
    const logs: string[] = []
    const report = await withBridge(state, () =>
      ensureExtensions(bridge().client, ['en.asurascans', 'en.flamecomics', 'fr.mangascantrad', 'en.inconnue'], (line) => logs.push(line)),
    )
    assert.deepEqual(report.installed, ['eu.kanade.tachiyomi.extension.en.asurascans'])
    assert.deepEqual(report.updated, ['eu.kanade.tachiyomi.extension.en.flamecomics'])
    assert.deepEqual(report.missing, ['en.inconnue'])
    assert.equal(report.failed[0]?.pkgName, 'eu.kanade.tachiyomi.extension.fr.mangascantrad')
    assert.match(report.failed[0]?.error ?? '', /Failed to download APK/)
    assert.deepEqual(state.calls, [
      'install eu.kanade.tachiyomi.extension.en.asurascans',
      'update eu.kanade.tachiyomi.extension.en.flamecomics',
      'install eu.kanade.tachiyomi.extension.fr.mangascantrad',
    ])
    assert.match(logs.at(-1) ?? '', /absentes du catalogue : en\.inconnue/)
  })
})

/* ---- De bout en bout : vraie API ---------------------------------------------------------------- */

const e2e = newState()
const CH = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const mdChapter = (id: string, number: string, language: string): MdChapter => ({
  id,
  attributes: { volume: null, chapter: number, title: null, translatedLanguage: language, externalUrl: null, pages: 2, publishAt: '2024-01-01T00:00:00+00:00' },
  relationships: [],
})
const FEEDS: Record<string, MdChapter[]> = {
  [BILINGUAL.id]: [mdChapter(CH(1), '1', 'fr'), mdChapter(CH(20), '1', 'en')],
  [ENGLISH_ONLY.id]: [mdChapter(CH(30), '1', 'en')],
  [NO_TRANSLATION.id]: [mdChapter(CH(40), '1', 'fr')],
}

extraMocks.push((url, init) => {
  if (url.hostname === 'api.mangadex.org') {
    const feed = url.pathname.match(/^\/manga\/([\w-]+)\/feed$/)
    if (feed) {
      const data = FEEDS[feed[1]!] ?? []
      return json({ result: 'ok', data, total: data.length })
    }
    return undefined
  }
  if (url.hostname === 'suwayomi') {
    const reply = fakeSuwayomi(e2e, url, init)
    return reply === 'hang' ? new Response('{}', { status: 504 }) : reply
  }
  return undefined
})

const { client, close, base } = await startServer()
after(close)

const T = (raw: string) => encodeChapterKey('tachiyomi', raw)

describe('GET /api/manga/:id/chapters — extensions Tachiyomi', () => {
  it('délai d’un appel au pont : 3 s par défaut', async () => {
    const { config } = await import('../src/config.js')
    assert.equal(config.sources.tachiyomi.timeoutMs, 3_000)
    assert.equal(config.sources.tachiyomi.baseUrl, 'http://suwayomi:4567')
  })

  it('fusionne MangaDex et les sites des extensions, chacun avec son badge', async () => {
    const fr = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=fr`)
    assert.equal(fr.status, 200)
    assert.deepEqual(
      fr.body.sources.map((source: { id: string; status: string }) => [source.id, source.status]),
      [['mangadex', 'ok'], ['tachiyomi', 'ok']],
    )
    const [first, third] = fr.body.chapters
    assert.equal(first.id, CH(1))
    assert.deepEqual(first.alternates.map((alt: { id: string; source: unknown }) => [alt.id, alt.source]), [[T('601'), { id: 'tachiyomi:2002', name: 'Scantrad' }]])
    assert.equal(third.id, T('603'))
    assert.deepEqual(third.source, { id: 'tachiyomi:2002', name: 'Scantrad' })
    assert.deepEqual(third.groups, [{ id: 'team sabre', name: 'Team Sabre' }])

    const en = await client().request('GET', `/manga/${BILINGUAL.id}/chapters?lang=en`)
    assert.deepEqual(
      en.body.chapters.map((item: { number: string; source: { name: string }; alternates: { source: { name: string } }[] }) => [
        item.number,
        item.source.name,
        item.alternates.map((alt) => alt.source.name),
      ]),
      [
        ['1', 'MangaDex', ['Asura Scans']],
        ['3', 'Flame Comics', ['Asura Scans']],
      ],
    )
  })

  it('pages relayées par /api/proxy, téléchargées depuis le pont (adresse interne jamais exposée)', async () => {
    const res = await client().request('GET', `/chapters/${T('703')}/pages?alt=${T('503')}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.source, { id: 'tachiyomi', name: 'Tachiyomi' })
    assert.equal(JSON.stringify(res.body).includes('suwayomi'), false)
    const first = new URL(res.body.pages[0].url, 'http://x')
    assert.equal(first.pathname, `/api/proxy/page/${T('703')}/0`)

    e2e.calls.length = 0
    const image = await fetch(`${base}/proxy/page/${T('703')}/1?n=2`)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.deepEqual(e2e.calls, ['image /api/v1/manga/9/chapter/703/page/1'])
  })

  it('œuvre absente des sites : liste MangaDex, pont « ok » à 0 chapitre', async () => {
    const res = await client().request('GET', `/manga/${ENGLISH_ONLY.id}/chapters?lang=en`)
    assert.deepEqual(res.body.chapters.map((item: { id: string }) => item.id), [CH(30)])
    assert.deepEqual(res.body.sources.find((source: { id: string }) => source.id === 'tachiyomi'), {
      id: 'tachiyomi',
      name: 'Tachiyomi',
      status: 'ok',
      chapters: 0,
      durationMs: res.body.sources[1].durationMs,
    })
  })

  it('toutes les extensions en panne : le catalogue MangaDex est servi, le pont signalé en échec', async () => {
    const res = await client().request('GET', `/manga/${NO_TRANSLATION.id}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.chapters.map((item: { id: string }) => item.id), [CH(40)])
    const status = res.body.sources.find((source: { id: string }) => source.id === 'tachiyomi')
    assert.equal(status.status, 'failed')
    assert.match(status.error, /Aucune extension Tachiyomi ne répond/)
  })
})
