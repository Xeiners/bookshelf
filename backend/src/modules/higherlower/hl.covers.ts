import { prisma } from '../../db.js'
import { normalizeText } from '../../services/catalog.service.js'
import { mangadexGet, type MdCollection, type MdManga } from '../manga/mangadex.client.js'
import { normalizeManga } from '../manga/normalize.js'
import { HL_WORKS, type HlWork } from './hl.data.js'

/*
 * Couvertures des œuvres du Higher or Lower (relayées par `/api/covers/`).
 *  1. le catalogue MangaDex en cache : la fiche dont un titre (principal ou
 *     alternatif) est EXACTEMENT l'un des titres de l'œuvre ; la plus suivie d'abord ;
 *  2. sinon une recherche MangaDex par titre (le catalogue ne garde qu'une sélection :
 *     Naruto, Death Note, Berserk… n'y sont pas), même règle du titre exact.
 * Chargées en tâche de fond (démarrage, puis toutes les 6 h, 30 min s'il en manque) :
 * aucune partie n'attend MangaDex. Une œuvre encore sans couverture s'affiche avec
 * ses initiales (front).
 */

const FULL_TTL_MS = 6 * 60 * 60 * 1000
const PARTIAL_TTL_MS = 30 * 60 * 1000

let covers = new Map<string, string>()
let loadedAt = 0
let complete = false
let loading: Promise<void> | null = null

const titlesOf = (manga: MdManga): Set<string> =>
  new Set(
    [...Object.values(manga.attributes.title), ...manga.attributes.altTitles.flatMap((title) => Object.values(title))]
      .filter((title): title is string => typeof title === 'string')
      .map(normalizeText),
  )

const wantedOf = (work: HlWork) => new Set([work.name, ...(work.titles ?? [])].map(normalizeText).filter(Boolean))

/** Première fiche dont un titre est exactement l'un de ceux voulus, et qui a une couverture. */
function pick(mangas: readonly MdManga[], wanted: Set<string>): string | null {
  for (const manga of mangas) {
    if (!manga?.attributes) continue
    const titles = titlesOf(manga)
    if (![...wanted].some((title) => titles.has(title))) continue
    const cover = normalizeManga(manga, null, 'en').cover
    if (cover) return cover
  }
  return null
}

async function fromCatalog(wanted: Set<string>): Promise<string | null> {
  const rows = await prisma.catalogWork.findMany({
    where: { OR: [...wanted].map((title) => ({ searchText: { contains: title } })) },
    orderBy: { popularity: 'desc' },
    take: 20,
    select: { mangadex: true },
  })
  const mangas = rows.flatMap((row) => {
    try {
      return [JSON.parse(row.mangadex) as MdManga]
    } catch {
      return []
    }
  })
  return pick(mangas, wanted)
}

async function fromMangadex(work: HlWork, wanted: Set<string>): Promise<string | null> {
  for (const title of [work.name, ...(work.titles ?? [])]) {
    const payload = await mangadexGet<MdCollection<MdManga>>('/manga', {
      title,
      'includes': ['cover_art'],
      'contentRating': ['safe', 'suggestive', 'erotica'],
      'order[relevance]': 'desc',
      'limit': 10,
    })
    const cover = pick(payload.data, wanted)
    if (cover) return cover
  }
  return null
}

async function load(): Promise<void> {
  const next = new Map<string, string>()
  for (const work of HL_WORKS) {
    const wanted = wantedOf(work)
    const cover =
      (await fromCatalog(wanted).catch(() => null)) ??
      // Déjà trouvée au chargement précédent : on la garde si MangaDex ne répond pas.
      (await fromMangadex(work, wanted).catch(() => null)) ??
      covers.get(work.id) ??
      null
    if (cover) next.set(work.id, cover)
  }
  const missing = HL_WORKS.filter((work) => !next.has(work.id)).map((work) => work.name)
  console.log(`[higher-lower] couvertures : ${next.size}/${HL_WORKS.length}${missing.length > 0 ? ` — sans image : ${missing.join(', ')}` : ''}`)
  covers = next
  complete = missing.length === 0
  loadedAt = Date.now()
}

/** Lance (ou relance, une fois périmées) les couvertures en tâche de fond. */
export function refreshWorkCovers(): Promise<void> {
  const ttl = complete ? FULL_TTL_MS : PARTIAL_TTL_MS
  if (!loading && Date.now() - loadedAt > ttl) {
    loading = load()
      .catch((error: unknown) => console.warn('[higher-lower] couvertures indisponibles :', error))
      .finally(() => {
        loading = null
      })
  }
  return loading ?? Promise.resolve()
}

/** Couverture d'une œuvre si elle est déjà connue ; sinon `null`, et le chargement part en fond. */
export function workCover(id: string): string | null {
  void refreshWorkCovers()
  return covers.get(id) ?? null
}

/** Tests : le catalogue change entre deux scénarios. */
export function forgetWorkCovers(): void {
  covers = new Map()
  loadedAt = 0
  complete = false
}
