import { prisma } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import { TtlCache } from '../../lib/cache.js'
import { isRarity } from '../cards/boosters.logic.js'
import { normalizeText } from '../../services/catalog.service.js'
import { TAG_FR } from '../manga/tags.js'
import { FAMOUS_WORKS, MIN_FAMOUS } from './dle.famous.js'
import type { DleWork } from './dle.logic.js'

/*
 * Œuvres jouables au BookshelfDLE : les cartes du set dont le catalogue connaît
 * les attributs, et seulement les plus connues (cf. `dle.famous.ts`) — à deviner
 * comme à proposer. Lues une fois toutes les dix minutes (le set ne bouge presque jamais).
 */

const FAMOUS = FAMOUS_WORKS.map(normalizeText)

/** Une carte de la sélection : même nom, ou nom qui la prolonge (« Solo Leveling: Ragnarok »). */
export function isFamous(name: string): boolean {
  const normalized = normalizeText(name)
  return FAMOUS.some((famous) => normalized === famous || normalized.startsWith(`${famous} `))
}

/**
 * Les œuvres connues du set ; si la sélection y est trop maigre (set différent),
 * complétée par les plus suivies sur MangaDex.
 */
export function famousOnly<W extends { name: string; popularity: number }>(works: readonly W[]): W[] {
  const famous = works.filter((work) => isFamous(work.name))
  if (famous.length >= MIN_FAMOUS) return famous
  const chosen = new Set(famous)
  for (const work of [...works].sort((a, b) => b.popularity - a.popularity)) {
    if (chosen.size >= MIN_FAMOUS * 2) break
    chosen.add(work)
  }
  return works.filter((work) => chosen.has(work))
}

export interface DleWorks {
  list: DleWork[]
  byId: Map<string, DleWork>
  /** Texte de recherche de chaque œuvre (titres dans toutes les langues), pour la saisie. */
  search: Map<string, string>
}

/** Au-delà, les titres alternatifs n'aident plus à trouver l'œuvre et alourdissent la liste. */
const SEARCH_TEXT_LIMIT = 200

const cache = new TtlCache<DleWorks>({ maxEntries: 1, ttlMs: 10 * 60 * 1000 })

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const parseGenres = (json: string): string[] => {
  const value = parseJson(json)
  return Array.isArray(value) ? value.filter((genre): genre is string => typeof genre === 'string') : []
}

/** Thèmes MangaDex (`{ name, rank }[]`) de la liste blanche traduite : jamais de tag sensible ni de format. */
export const parseThemes = (json: string): string[] => {
  const value = parseJson(json)
  if (!Array.isArray(value)) return []
  const names = value.map((tag: unknown) => (tag && typeof tag === 'object' && 'name' in tag && typeof tag.name === 'string' ? tag.name : null))
  return [...new Set(names.filter((name): name is string => name !== null && TAG_FR[name] !== undefined))]
}

const DEMOGRAPHICS = new Set(['shounen', 'shoujo', 'seinen', 'josei'])

/** Public visé (`publicationDemographic` de la fiche MangaDex brute) ; `null` : non renseigné. */
export function parseDemographic(json: string): string | null {
  const manga = parseJson(json)
  if (!manga || typeof manga !== 'object' || !('attributes' in manga)) return null
  const { attributes } = manga
  const value = attributes && typeof attributes === 'object' && 'publicationDemographic' in attributes ? attributes.publicationDemographic : null
  return typeof value === 'string' && DEMOGRAPHICS.has(value) ? value : null
}

async function load(): Promise<DleWorks> {
  const cards = await prisma.card.findMany({
    orderBy: { number: 'asc' },
    select: { id: true, number: true, name: true, title: true, imageUrl: true, rarity: true, series: true, mangaId: true },
  })
  const works = await prisma.catalogWork.findMany({
    where: { mangadexId: { in: cards.map((card) => card.mangaId) } },
    select: { mangadexId: true, country: true, genres: true, tags: true, mangadex: true, status: true, year: true, popularity: true, searchText: true },
  })
  const catalog = new Map(works.map((work) => [work.mangadexId, work]))
  const all: DleWork[] = []
  const search = new Map<string, string>()
  for (const card of cards) {
    const work = catalog.get(card.mangaId)
    if (!work || !isRarity(card.rarity)) continue
    const name = card.name || card.title
    all.push({
      id: card.id,
      number: card.number,
      name,
      imageUrl: card.imageUrl,
      rarity: card.rarity,
      series: card.series,
      country: work.country,
      genres: parseGenres(work.genres),
      themes: parseThemes(work.tags),
      demographic: parseDemographic(work.mangadex),
      status: work.status,
      year: work.year,
      popularity: work.popularity,
    })
    // Le titre affiché est cherché à part par le client : ici, les autres titres et les auteurs.
    search.set(card.id, work.searchText.slice(0, SEARCH_TEXT_LIMIT))
  }
  const list = famousOnly(all)
  return { list, byId: new Map(list.map((work) => [work.id, work])), search }
}

/** Le set n'est pas encore généré (catalogue en cours d'indexation) : rien à deviner. */
export const dleNotReady = () => new HttpError(503, 'collection_not_ready', 'La collection se prépare, réessaie dans quelques minutes.')

export async function dleWorks(): Promise<DleWorks> {
  const works = await cache.getOrLoad('works', load, (value) => (value.list.length > 0 ? 10 * 60 * 1000 : 30 * 1000))
  if (works.list.length < 2) throw dleNotReady()
  return works
}

/** Tests : le set change entre deux scénarios. */
export const forgetDleWorks = () => cache.clear()
