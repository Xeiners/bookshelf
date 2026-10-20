import path from 'node:path'
import { unzipSync } from 'fflate'

/**
 * Lecture des métadonnées embarquées d'un EPUB — pure, testée
 * (`backend/test/books.test.ts`).
 *
 * Un EPUB est un ZIP : `META-INF/container.xml` désigne le paquet OPF, qui
 * porte titre, auteurs, langue, résumé, éditeur, date et la liste des
 * ressources (dont la couverture). Seules ces quelques entrées sont
 * décompressées, chacune plafonnée : un fichier piégé (bombe ZIP) ne peut pas
 * saturer la mémoire du serveur.
 *
 * Pas d'analyseur XML complet : l'OPF est un format simple et régulier, lu par
 * expressions tolérantes (préfixes d'espace de noms quelconques, guillemets
 * simples ou doubles, CDATA, entités).
 */

export class InvalidEpubError extends Error {}

export interface EpubCover {
  data: Uint8Array
  /** Type reconnu à la signature des octets, pas à la déclaration du fichier. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  extension: 'jpg' | 'png' | 'gif' | 'webp'
}

export interface EpubMetadata {
  title: string | null
  /** Auteurs principaux, séparés par des virgules (trois au plus). */
  author: string | null
  /** Code ISO 639-1 (« fr », « en »), quand le fichier le déclare. */
  language: string | null
  /** Résumé en texte brut (le HTML éventuel est retiré). */
  description: string
  publisher: string | null
  year: number | null
  /** ISBN-10 ou -13 sans tirets, s'il figure parmi les identifiants. */
  isbn: string | null
  cover: EpubCover | null
}

/** Plafond d'une entrée texte (container.xml, OPF, page de couverture). */
const MAX_TEXT_BYTES = 2 * 1024 * 1024
/** Plafond de l'image de couverture. */
const MAX_COVER_BYTES = 10 * 1024 * 1024

const EPUB_MIMETYPE = 'application/epub+zip'

/* ---- Archive ------------------------------------------------------------------ */

interface EntryInfo {
  name: string
  size: number
}

/** Liste des entrées (sans rien décompresser), indexée en minuscules. */
function listEntries(zip: Uint8Array): Map<string, EntryInfo> {
  const entries = new Map<string, EntryInfo>()
  try {
    unzipSync(zip, {
      filter: (file) => {
        entries.set(file.name.toLowerCase(), { name: file.name, size: file.originalSize })
        return false
      },
    })
  } catch {
    throw new InvalidEpubError('Archive ZIP illisible.')
  }
  return entries
}

/** Une entrée décompressée, ou `null` si elle manque ou dépasse `maxBytes`. */
function readEntry(zip: Uint8Array, entries: Map<string, EntryInfo>, name: string, maxBytes: number): Uint8Array | null {
  const entry = entries.get(name.toLowerCase())
  if (!entry || entry.size > maxBytes) return null
  try {
    return unzipSync(zip, { filter: (file) => file.name === entry.name })[entry.name] ?? null
  } catch {
    return null
  }
}

const utf8 = new TextDecoder('utf-8')

function readText(zip: Uint8Array, entries: Map<string, EntryInfo>, name: string): string | null {
  const data = readEntry(zip, entries, name, MAX_TEXT_BYTES)
  return data ? utf8.decode(data) : null
}

/* ---- XML tolérant --------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

const stripCdata = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

/** Texte d'un élément : CDATA déballé, entités décodées, espaces resserrés. */
const textOf = (raw: string) => decodeEntities(stripCdata(raw)).replace(/\s+/g, ' ').trim()

interface XmlElement {
  attributes: string
  content: string
}

/** Éléments `<prefixe:nom …>` (ou sans préfixe), auto-fermants compris. */
function elements(xml: string, localName: string): XmlElement[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${localName}(?=[\\s/>])([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}\\s*>)`,
    'gi',
  )
  return [...xml.matchAll(pattern)].map((match) => ({ attributes: match[1] ?? '', content: match[2] ?? '' }))
}

/** Valeur d'un attribut (préfixe d'espace de noms accepté : `opf:role`). */
function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? null : decodeEntities(value).trim()
}

/**
 * Résumé en texte brut. Les éditeurs y mettent souvent du HTML, parfois
 * échappé (`&lt;p&gt;`) : on retire les balises, on décode, et on recommence
 * une fois si le décodage en a fait apparaître. Les paragraphes sont gardés.
 */
export function plainText(raw: string, maxLength = 10_000): string {
  const strip = (value: string) =>
    value
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  let text = decodeEntities(strip(stripCdata(raw)))
  if (/<\/?[a-z][^>]*>/i.test(text)) text = decodeEntities(strip(text))
  return text
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

/* ---- Champs --------------------------------------------------------------------- */

const LANGUAGE_ALIASES: Record<string, string> = { fre: 'fr', fra: 'fr', eng: 'en', ger: 'de', deu: 'de', spa: 'es', ita: 'it' }

/** « fr-FR » → « fr », « fre » → « fr ». `null` si ce n'est pas un code de langue. */
export function languageCode(value: string | null | undefined): string | null {
  const base = value?.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  if (!/^[a-z]{2,3}$/.test(base)) return null
  return LANGUAGE_ALIASES[base] ?? (base.length === 2 ? base : null)
}

/** ISBN-10 / -13 sans tirets ni préfixe (`urn:isbn:`), sinon `null`. */
export function isbnOf(value: string): string | null {
  const compact = value.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '').toUpperCase()
  return /^(97[89]\d{10}|\d{9}[\dX])$/.test(compact) ? compact : null
}

function yearOf(value: string): number | null {
  const match = /\b(1\d{3}|20\d{2})\b/.exec(value)
  return match ? Number(match[1]) : null
}

/**
 * Auteurs : les créateurs de rôle « aut » (EPUB 2 : `opf:role` ; EPUB 3 :
 * `<meta refines="#id" property="role">`), sinon tous les créateurs.
 */
function authorsOf(metadata: string): string | null {
  const roles = new Map<string, string>()
  for (const meta of elements(metadata, 'meta')) {
    const refines = attribute(meta.attributes, 'refines')
    if (refines && attribute(meta.attributes, 'property') === 'role') roles.set(refines.replace(/^#/, ''), textOf(meta.content))
  }
  const creators = elements(metadata, 'creator').map((creator) => {
    const id = attribute(creator.attributes, 'id')
    const role = attribute(creator.attributes, 'role') ?? (id ? roles.get(id) : undefined) ?? null
    return { name: textOf(creator.content), role }
  })
  const named = creators.filter((creator) => creator.name)
  const authors = named.filter((creator) => creator.role === null || creator.role === 'aut')
  const chosen = (authors.length > 0 ? authors : named).map((creator) => creator.name)
  return chosen.length > 0 ? [...new Set(chosen)].slice(0, 3).join(', ') : null
}

/* ---- Couverture ---------------------------------------------------------------- */

interface ManifestItem {
  id: string | null
  href: string
  mediaType: string
  properties: string
}

function manifestOf(opf: string): ManifestItem[] {
  return elements(opf, 'item').flatMap((item) => {
    const href = attribute(item.attributes, 'href')
    if (!href) return []
    return [
      {
        id: attribute(item.attributes, 'id'),
        href,
        mediaType: (attribute(item.attributes, 'media-type') ?? '').toLowerCase(),
        properties: attribute(item.attributes, 'properties') ?? '',
      },
    ]
  })
}

/** Chemin d'une ressource dans l'archive, depuis un `href` relatif au fichier qui le cite. */
function resolveHref(fromFile: string, href: string): string {
  let target = href.split('#')[0] ?? ''
  try {
    target = decodeURIComponent(target)
  } catch {
    // `href` mal encodé : on le garde tel quel.
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target)).replace(/^(\.\.\/)+/, '')
}

/** Type d'image d'après ses premiers octets. */
export function sniffImage(data: Uint8Array): Pick<EpubCover, 'mediaType' | 'extension'> | null {
  const at = (offset: number, bytes: number[]) => bytes.every((byte, index) => data[offset + index] === byte)
  if (at(0, [0xff, 0xd8, 0xff])) return { mediaType: 'image/jpeg', extension: 'jpg' }
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return { mediaType: 'image/png', extension: 'png' }
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return { mediaType: 'image/gif', extension: 'gif' }
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return { mediaType: 'image/webp', extension: 'webp' }
  return null
}

const isImage = (item: ManifestItem) => item.mediaType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(item.href)

/**
 * Chemins candidats pour la couverture, du plus sûr au plus deviné :
 * EPUB 3 (`properties="cover-image"`), EPUB 2 (`<meta name="cover">`), page de
 * couverture du guide (première image citée), puis une image nommée « cover ».
 */
function coverCandidates(zip: Uint8Array, entries: Map<string, EntryInfo>, opfPath: string, opf: string): string[] {
  const manifest = manifestOf(opf)
  const candidates: string[] = []
  const add = (item: ManifestItem | undefined) => {
    if (item && isImage(item)) candidates.push(resolveHref(opfPath, item.href))
  }

  add(manifest.find((item) => item.properties.split(/\s+/).includes('cover-image')))

  const coverMeta = elements(opf, 'meta').find((meta) => attribute(meta.attributes, 'name')?.toLowerCase() === 'cover')
  const coverRef = coverMeta ? attribute(coverMeta.attributes, 'content') : null
  if (coverRef) add(manifest.find((item) => item.id === coverRef) ?? manifest.find((item) => item.href === coverRef))

  const guideCover = elements(opf, 'reference').find((reference) => attribute(reference.attributes, 'type')?.toLowerCase() === 'cover')
  const guideHref = guideCover ? attribute(guideCover.attributes, 'href') : null
  if (guideHref) {
    const pagePath = resolveHref(opfPath, guideHref)
    const page = readText(zip, entries, pagePath)
    const image = page ? /<(?:img|image)\b[^>]*?\s(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']/i.exec(page)?.[1] : undefined
    if (image) candidates.push(resolveHref(pagePath, image))
  }

  add(manifest.find((item) => isImage(item) && /cover/i.test(`${item.id ?? ''} ${item.href}`)))
  return [...new Set(candidates)]
}

function readCover(zip: Uint8Array, entries: Map<string, EntryInfo>, opfPath: string, opf: string): EpubCover | null {
  for (const candidate of coverCandidates(zip, entries, opfPath, opf)) {
    const data = readEntry(zip, entries, candidate, MAX_COVER_BYTES)
    const type = data ? sniffImage(data) : null
    if (data && type) return { data, ...type }
  }
  return null
}

/* ---- Point d'entrée ------------------------------------------------------------- */

/** `true` si les premiers octets sont ceux d'une archive ZIP. */
export const looksLikeZip = (head: Uint8Array) => head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04

/**
 * Métadonnées d'un EPUB. `InvalidEpubError` si ce n'est pas un EPUB lisible
 * (pas un ZIP, `mimetype` étranger, paquet OPF introuvable).
 */
export function parseEpub(zip: Uint8Array): EpubMetadata {
  if (!looksLikeZip(zip)) throw new InvalidEpubError('Ce fichier n’est pas une archive EPUB.')
  const entries = listEntries(zip)

  // `mimetype` est obligatoire, mais des outils l'omettent : absent, on tolère ; étranger, on refuse.
  const mimetype = readText(zip, entries, 'mimetype')
  if (mimetype !== null && mimetype.trim() !== EPUB_MIMETYPE) throw new InvalidEpubError('Archive ZIP qui n’est pas un EPUB.')

  const container = readText(zip, entries, 'META-INF/container.xml')
  const rootfile = container ? elements(container, 'rootfile').map((element) => attribute(element.attributes, 'full-path')).find(Boolean) : null
  // Sans container.xml valable, un seul `.opf` à la racine d'un dossier suffit à s'y retrouver.
  const opfPath = rootfile ?? [...entries.values()].find((entry) => entry.name.toLowerCase().endsWith('.opf'))?.name
  const opf = opfPath ? readText(zip, entries, opfPath) : null
  if (!opfPath || !opf) throw new InvalidEpubError('Paquet OPF introuvable : EPUB incomplet.')

  const metadata = /<(?:[\w.-]+:)?metadata\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?metadata\s*>/i.exec(opf)?.[1] ?? opf
  const first = (name: string) => elements(metadata, name).map((element) => textOf(element.content)).find(Boolean) ?? null

  const dates = elements(metadata, 'date')
  const publication = dates.find((date) => attribute(date.attributes, 'event') === 'publication') ?? dates[0]

  return {
    title: first('title'),
    author: authorsOf(metadata),
    language: languageCode(first('language')),
    description: plainText(elements(metadata, 'description')[0]?.content ?? ''),
    publisher: first('publisher'),
    year: publication ? yearOf(textOf(publication.content)) : null,
    isbn: elements(metadata, 'identifier').map((identifier) => isbnOf(textOf(identifier.content))).find(Boolean) ?? null,
    cover: readCover(zip, entries, opfPath, opf),
  }
}
