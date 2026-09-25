import type { Language } from '../../lib/language.js'
import { pick, seededRandom, shuffle } from '../../lib/seeded.js'
import { getPool, loadDocuments, toBook, type CatalogItem } from '../../services/catalog.service.js'
import type { Book } from '../books/book.schema.js'
import { localize, topRated } from '../manga/manga.service.js'
import { MOODS, PACES, matchesCatalogPace, matchesMood, matchesPace, type Mood, type Pace } from './decks.js'

/** Titres renvoyés : le front écarte ceux déjà dans la bibliothèque et garde les 3 premiers. */
const PICKS = 8
/** En dessous, la contrainte de longueur est relâchée plutôt que de rendre un tirage vide. */
const MIN_MATCHES = 3

/** Catalogue : note moyenne minimale d'une « pépite » (sur 100). */
const GEM_MIN_SCORE = 72
/** Catalogue : sous ce nombre de candidats, la contrainte de rythme est relâchée. */
const MIN_CATALOG_MATCHES = 6
/** Sous cette taille, le catalogue n'est pas prêt : repli sur MangaDex. */
const MIN_CATALOG = 40

/**
 * Répartition des origines de la Pépite, parmi celles disponibles pour
 * l'ambiance et le rythme tirés : au fil des jours, manga, manhwa ET manhua.
 */
const ORIGIN_WEIGHTS: Record<string, number> = { JP: 0.5, KR: 0.3, CN: 0.2, TW: 0.2 }

export interface OracleDraw {
  mood: string
  pace: string
  /** `true` si trop peu d'œuvres respectaient la longueur : seule l'ambiance a filtré. */
  relaxed: boolean
  /** Classées : la première est la Pépite, les suivantes des lectures dans la même veine. */
  picks: Book[]
}

/**
 * Poids d'une œuvre dans le tirage : la qualité compte au carré, et les titres
 * moins connus sont légèrement favorisés — de vraies découvertes, pas toujours
 * les mêmes dix classiques.
 */
export function drawWeight(item: Pick<CatalogItem, 'features' | 'popularity'>): number {
  const quality = Math.max(0, ((item.features.meanScore ?? 0) - 65) / 35)
  const fame = Math.min(1, Math.log10(item.popularity + 1) / 5.5)
  return quality * quality * (0.55 + 0.45 * (1 - fame))
}

/** Tirage pondéré sans remise (Efraimidis-Spirakis) : clé = r^(1/w), les plus grandes gagnent. */
function weightedOrder<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T[] {
  return items
    .map((item) => ({ item, key: Math.pow(random(), 1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item)
}

function pickOrigin(available: Set<string>, random: () => number): string | null {
  const origins = [...available].sort()
  const total = origins.reduce((sum, origin) => sum + (ORIGIN_WEIGHTS[origin] ?? 0.1), 0)
  let roll = random() * total
  for (const origin of origins) {
    roll -= ORIGIN_WEIGHTS[origin] ?? 0.1
    if (roll <= 0) return origin
  }
  return origins.at(-1) ?? null
}

/**
 * Tirage sur le catalogue agrégé (≈ 3 000 œuvres, manga / manhwa / manhua).
 * `null` si le catalogue n'est pas prêt ou trop pauvre pour cette ambiance.
 */
async function catalogDraw(
  mood: Mood,
  pace: Pace,
  random: () => number,
  language: Language,
): Promise<{ relaxed: boolean; picks: Book[] } | null> {
  const { items } = await getPool()
  if (items.length < MIN_CATALOG) return null

  const gems = items.filter(
    (item) => (item.features.meanScore ?? 0) >= GEM_MIN_SCORE && matchesMood(mood, item.features),
  )
  const paced = gems.filter((item) => matchesCatalogPace(pace, item))
  const relaxed = paced.length < MIN_CATALOG_MATCHES
  const pool = relaxed ? gems : paced
  if (pool.length < MIN_MATCHES) return null

  // La Pépite : une origine tirée au sort, puis un titre pondéré dans cette origine.
  const origin = pickOrigin(new Set(pool.map((item) => item.country)), random)
  const ordered = weightedOrder(pool, drawWeight, random)
  const pepite = ordered.find((item) => item.country === origin) ?? ordered[0]!

  // Les suivantes : d'autres origines d'abord quand il y en a (« dans la même veine », mais variée).
  const rest = ordered.filter((item) => item !== pepite)
  const companion = rest.find((item) => item.country !== pepite.country)
  const chosen = [pepite, ...(companion ? [companion] : []), ...rest.filter((item) => item !== companion)].slice(0, PICKS)

  const documents = await loadDocuments(chosen)
  return { relaxed, picks: chosen.map((item) => toBook(item, language, documents.get(item.anilistId))) }
}

/** Repli historique : les 100 mieux notés de MangaDex pour l'ambiance. */
async function mangadexDraw(
  mood: Mood,
  pace: Pace,
  random: () => number,
  language: Language,
): Promise<{ relaxed: boolean; picks: Book[] }> {
  const ranked = await topRated(mood.tags, pace.status)
  const matching = ranked.filter((manga) => matchesPace(pace, manga.attributes.lastChapter))
  const relaxed = matching.length < MIN_MATCHES
  const pool = (relaxed ? ranked : matching).slice(0, 24)
  const chosen = shuffle(pool, random).slice(0, PICKS)
  return { relaxed, picks: await localize(chosen, language) }
}

/**
 * Tirage du jour pour une graine (`<utilisateur ou appareil>:<jour>`).
 * Déterministe : même graine → même ambiance, même rythme, mêmes titres
 * (tant que le catalogue ne change pas — il est réindexé une fois par jour).
 */
export async function drawForSeed(seed: string, language: Language): Promise<OracleDraw> {
  const random = seededRandom(seed)
  const mood = pick(MOODS, random)
  const pace = pick(PACES, random)

  const draw = (await catalogDraw(mood, pace, random, language)) ?? (await mangadexDraw(mood, pace, random, language))
  return { mood: mood.id, pace: pace.id, ...draw }
}
