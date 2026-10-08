import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { serial } from '../dle/dle.jikan.js'
import { SET_SIZE, type Rarity } from './boosters.logic.js'

/*
 * Série 3 — « Personnages » : les 1 200 personnages d'anime et de manga les plus aimés,
 * tous univers confondus, d'après le classement des favoris de MyAnimeList (API publique
 * Jikan). Le rang fait la rareté : les 40 premiers sont Mythiques, puis Légendaires…
 *
 * La liste se charge en arrière-plan (48 pages, une par seconde : Jikan limite le débit) ;
 * la série n'ouvre qu'une fois complète. L'œuvre de chaque personnage (son anime
 * principal) arrive ensuite, une fiche par seconde, sans bloquer personne.
 */

const JIKAN = 'https://api.jikan.moe/v4'
const MAL_HOST = 'cdn.myanimelist.net'

export const SERIES_3 = 3
export const SERIES_3_LAYOUT: Record<Rarity, number> = {
  MYTHIC: 40,
  LEGENDARY: 80,
  EPIC: 200,
  RARE: 320,
  COMMON: 560,
}
export const SERIES_3_SIZE = Object.values(SERIES_3_LAYOUT).reduce((sum, count) => sum + count, 0)
/** Après les deux séries d'œuvres (1 → 600). */
export const SERIES_3_START_NUMBER = SET_SIZE * 2 + 1

const POWER_BASE: Record<Rarity, number> = { COMMON: 20, RARE: 40, EPIC: 60, LEGENDARY: 80, MYTHIC: 100 }
const RAREST_FIRST: Rarity[] = ['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE', 'COMMON']

export const series3CardId = (malId: number): string => `s3_${malId}`
/** Une carte de personnage n'a pas d'œuvre MangaDex : clé unique propre. */
export const characterKey = (malId: number): string => `mal-character-${malId}`
/** Portrait relayé (agrandi, en WebP) : jamais l'adresse d'origine côté navigateur. */
export const characterArtPath = (malId: number): string => `/api/cards/art/${malId}`

/** Rareté du personnage classé `rank` (0 = le plus aimé). */
export function rarityForRank(rank: number, layout: Record<Rarity, number> = SERIES_3_LAYOUT): Rarity {
  let ceiling = 0
  for (const rarity of RAREST_FIRST) {
    ceiling += layout[rarity]
    if (rank < ceiling) return rarity
  }
  return 'COMMON'
}

/** MyAnimeList écrit « Nom, Prénom » : on remet le prénom devant (« Lelouch Lamperouge »). */
export function displayName(name: string): string {
  const parts = name.split(', ')
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name
}

interface JikanImages {
  jpg?: { image_url?: string }
  webp?: { image_url?: string }
}

export interface TopCharacter {
  mal_id: number
  name: string
  favorites?: number
  images?: JikanImages
}

interface TopPage {
  data?: TopCharacter[]
  pagination?: { has_next_page?: boolean }
}

interface CharacterFull {
  data?: {
    anime?: { role?: string; anime?: { title?: string } }[]
    manga?: { role?: string; manga?: { title?: string } }[]
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Un appel Jikan, réessayé sur 429 / 5xx (Jikan sature souvent). `null` : rien après trois essais. */
async function jikan<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await pause(2000 * attempt)
    try {
      const response = await serial(() => fetch(`${JIKAN}${path}`, { signal: AbortSignal.timeout(15_000) }))
      if (response.ok) return (await response.json()) as T
      if (response.status < 500 && response.status !== 429) return null
    } catch {
      // Réseau : nouvel essai.
    }
  }
  return null
}

const portraitOf = (images: JikanImages | undefined) => {
  const url = images?.jpg?.image_url ?? images?.webp?.image_url
  return url && !url.includes('questionmark') && new URL(url).hostname === MAL_HOST ? url : null
}

/**
 * Les `count` personnages les plus mis en favoris, avec un portrait (une petite marge
 * remplace ceux qui n'en ont pas). Jette si Jikan ne répond pas : la série attendra.
 */
export async function topCharacters(count: number, pageDelayMs = 1100): Promise<(TopCharacter & { art: string })[]> {
  const found = new Map<number, TopCharacter & { art: string }>()
  for (let page = 1; found.size < count && page <= Math.ceil(count / 25) + 6; page += 1) {
    if (page > 1) await pause(pageDelayMs)
    const body = await jikan<TopPage>(`/top/characters?page=${page}&limit=25`)
    if (!body?.data) throw new Error(`Jikan n’a pas répondu (page ${page} du classement des personnages).`)
    for (const character of body.data) {
      const art = portraitOf(character.images)
      if (art && character.name && !found.has(character.mal_id)) found.set(character.mal_id, { ...character, art })
    }
    if (body.pagination?.has_next_page === false) break
  }
  if (found.size < count) throw new Error(`Classement incomplet : ${found.size}/${count} personnages illustrés.`)
  return [...found.values()].slice(0, count)
}

export interface Series3SeedResult {
  inserted: number
  total: number
}

/**
 * Crée les cartes manquantes de la Série 3, dans l'ordre du classement. Une carte
 * déjà publiée garde son id, son numéro et sa rareté (les possessions restent valides).
 */
export async function seedSeries3(options: { pageDelayMs?: number } = {}): Promise<Series3SeedResult> {
  const existing = await prisma.card.count({ where: { series: SERIES_3 } })
  if (existing >= SERIES_3_SIZE) return { inserted: 0, total: existing }
  const ranked = await topCharacters(SERIES_3_SIZE, options.pageDelayMs)
  const rows = ranked.map((character, rank) => {
    const rarity = rarityForRank(rank)
    const name = displayName(character.name)
    return {
      id: series3CardId(character.mal_id),
      number: SERIES_3_START_NUMBER + rank,
      series: SERIES_3,
      name,
      // L'œuvre arrive ensuite (cf. `enrichSeries3`).
      mangaTitle: '',
      title: name,
      characterName: name,
      description: '',
      // Au sein d'une rareté, les plus aimés pèsent un peu plus.
      power: POWER_BASE[rarity] + Math.max(0, 9 - Math.floor((rank / SERIES_3_SIZE) * 10)),
      imageUrl: characterArtPath(character.mal_id),
      artUrl: character.art,
      rarity,
      mangaId: characterKey(character.mal_id),
    }
  })
  const taken = new Set((await prisma.card.findMany({ where: { series: SERIES_3 }, select: { mangaId: true } })).map((card) => card.mangaId))
  const fresh = rows.filter((row) => !taken.has(row.mangaId))
  // Par lots : une transaction de 1 200 écritures est lourde pour SQLite.
  for (let start = 0; start < fresh.length; start += 200) {
    await prisma.$transaction(fresh.slice(start, start + 200).map((row) => prisma.card.create({ data: row })))
  }
  const total = await prisma.card.count({ where: { series: SERIES_3 } })
  return { inserted: fresh.length, total }
}

/** L'œuvre principale d'un personnage : un anime où il est principal, sinon le premier, sinon un manga. */
export function mainWork(full: CharacterFull['data']): string | null {
  const anime = full?.anime ?? []
  const manga = full?.manga ?? []
  const main = anime.find((entry) => entry.role === 'Main') ?? anime[0]
  return main?.anime?.title ?? (manga.find((entry) => entry.role === 'Main') ?? manga[0])?.manga?.title ?? null
}

/** Complète l'œuvre des cartes qui n'en ont pas encore, une fiche à la fois. */
export async function enrichSeries3(options: { delayMs?: number; limit?: number } = {}): Promise<number> {
  const pending = await prisma.card.findMany({
    where: { series: SERIES_3, mangaTitle: '' },
    select: { id: true, mangaId: true },
    orderBy: { number: 'asc' },
    take: options.limit ?? SERIES_3_SIZE,
  })
  let done = 0
  for (const card of pending) {
    const malId = Number(card.mangaId.replace('mal-character-', ''))
    if (!Number.isInteger(malId)) continue
    if (done > 0) await pause(options.delayMs ?? 1100)
    const full = await jikan<CharacterFull>(`/characters/${malId}/full`)
    if (!full) continue
    const work = mainWork(full.data)
    if (!work) continue
    await prisma.card.update({ where: { id: card.id }, data: { mangaTitle: work } })
    done += 1
  }
  return done
}

/* ---- Lancement en arrière-plan ---------------------------------------------------- */

let running: Promise<void> | null = null
/** Dernier passage terminé (réussi ou non) : au plus un passage toutes les dix minutes. */
let lastRun = 0
const RETRY_MS = 10 * 60 * 1000

/**
 * Lance (sans l'attendre) la création de la série puis l'ajout des œuvres, si besoin.
 * Au plus un passage toutes les dix minutes : un échec (Jikan en panne) ou des œuvres
 * encore manquantes sont repris au prochain booster après ce délai.
 */
export function ensureSeries3(now = Date.now()): void {
  // Tests : jamais d'appel réseau en arrière-plan (la série se crée à la main, cf. `series3.test.ts`).
  if (config.env === 'test' || running || now - lastRun < RETRY_MS) return
  running = (async () => {
    const result = await seedSeries3()
    if (result.inserted > 0) console.log(`[cartes] Série 3 : ${result.inserted} personnages ajoutés (${result.total}/${SERIES_3_SIZE}).`)
    const enriched = await enrichSeries3()
    if (enriched > 0) console.log(`[cartes] Série 3 : œuvre ajoutée à ${enriched} personnages.`)
  })()
    .catch((error: unknown) => {
      console.warn('[cartes] Série 3 en attente :', error instanceof Error ? error.message : error)
    })
    .finally(() => {
      lastRun = Date.now()
      running = null
    })
}

/** Pour les tests : attendre la tâche en cours, ou relancer sans délai. */
export const series3Task = () => running
export const resetSeries3Schedule = () => {
  lastRun = 0
}
