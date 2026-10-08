import { config } from '../../config.js'
import { prisma } from '../../db.js'
import { serial } from '../dle/dle.jikan.js'
import { SET_SIZE, type Rarity } from './boosters.logic.js'

/*
 * Série 3 — « Personnages » : les 1 200 personnages d'anime et de manga les plus aimés,
 * tous univers confondus, d'après le classement des favoris de MyAnimeList (API publique
 * Jikan ; AniList en secours si Jikan refuse le classement). Le rang fait la rareté : les
 * 40 premiers sont Mythiques, puis Légendaires…
 *
 * La liste se charge en arrière-plan (48 pages, une par seconde : Jikan limite le débit) ;
 * la série n'ouvre qu'une fois complète. L'œuvre de chaque personnage (son anime
 * principal) arrive ensuite, une fiche par seconde, sans bloquer personne.
 */

const JIKAN = 'https://api.jikan.moe/v4'
const ANILIST = 'https://graphql.anilist.co'
const MAL_HOST = 'cdn.myanimelist.net'

/** D'où vient le classement : MyAnimeList (Jikan), ou AniList en secours. */
export type CharacterSource = 'mal' | 'anilist'

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

/** Une carte de personnage n'a pas d'œuvre MangaDex : clé unique propre, selon la source. */
export const characterKey = (source: CharacterSource, id: number): string => `${source}-character-${id}`
export const series3CardId = (source: CharacterSource, id: number): string => (source === 'mal' ? `s3_${id}` : `s3a_${id}`)
/** Portrait relayé (agrandi, en WebP) : jamais l'adresse d'origine côté navigateur. */
export const characterArtPath = (cardId: string): string => `/api/cards/art/${cardId}`
/** Hôtes des portraits relayés. */
export const ART_HOSTS = new Set(['cdn.myanimelist.net', 's4.anilist.co'])

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

/**
 * Un appel Jikan, réessayé sur 429 / 5xx avec une attente qui double (Jikan sature souvent,
 * surtout au démarrage quand le BookshelfDLE charge aussi ses portraits). `null` : rien
 * après six essais (environ une minute).
 */
/** Dernière réponse ratée de Jikan (code HTTP ou erreur réseau) : pour les journaux. */
let lastFailure = ''

async function jikan<T>(path: string, attempts = 6): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await pause(Math.min(30_000, 2000 * 2 ** (attempt - 1)))
    try {
      const response = await serial(() => fetch(`${JIKAN}${path}`, { signal: AbortSignal.timeout(15_000) }))
      if (response.ok) return (await response.json()) as T
      lastFailure = `HTTP ${response.status} sur ${path}`
      if (response.status < 500 && response.status !== 429) return null
    } catch (error) {
      // Réseau : nouvel essai.
      lastFailure = `${error instanceof Error ? error.message : 'erreur réseau'} sur ${path}`
    }
  }
  return null
}

const portraitOf = (images: JikanImages | undefined) => {
  const url = images?.jpg?.image_url ?? images?.webp?.image_url
  return url && !url.includes('questionmark') && new URL(url).hostname === MAL_HOST ? url : null
}

/** Un personnage classé, quelle que soit la source. */
export interface RankedCharacter {
  source: CharacterSource
  id: number
  name: string
  art: string
  /** Œuvre principale, quand la source la donne d'emblée (AniList). */
  work: string | null
}

/** Pages déjà lues, par source : une tentative interrompue reprend où elle s'est arrêtée. */
const fetchedPages = new Map<string, { characters: RankedCharacter[]; hasNext: boolean }>()

/**
 * Une page du classement MyAnimeList : le « top » des personnages, ou, s'il est refusé,
 * la recherche triée par favoris (même ordre). `null` : Jikan n'a rien donné.
 */
async function malPage(page: number): Promise<{ characters: RankedCharacter[]; hasNext: boolean } | null> {
  for (const path of [`/top/characters?page=${page}&limit=25`, `/characters?order_by=favorites&sort=desc&page=${page}&limit=25`]) {
    const body = await jikan<TopPage>(path, 3)
    if (!body?.data) continue
    const characters = body.data.flatMap((character) => {
      const art = portraitOf(character.images)
      return art && character.name ? [{ source: 'mal' as const, id: character.mal_id, name: displayName(character.name), art, work: null }] : []
    })
    return { characters, hasNext: body.pagination?.has_next_page !== false }
  }
  return null
}

interface AniListPage {
  data?: {
    Page?: {
      pageInfo?: { hasNextPage?: boolean }
      characters?: { id: number; name?: { full?: string }; image?: { large?: string }; media?: { nodes?: { title?: { english?: string | null; romaji?: string | null } }[] } }[]
    }
  }
}

const ANILIST_QUERY = `query ($page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
  characters(sort: FAVOURITES_DESC) { id name { full } image { large }
    media(sort: POPULARITY_DESC, perPage: 1) { nodes { title { english romaji } } } } } }`

/** Une page du classement AniList (50 personnages, avec leur œuvre). `null` : rien après trois essais. */
async function aniListPage(page: number): Promise<{ characters: RankedCharacter[]; hasNext: boolean } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await pause(3000 * attempt)
    try {
      const response = await fetch(ANILIST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { page } }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        lastFailure = `HTTP ${response.status} sur AniList (page ${page})`
        if (response.status < 500 && response.status !== 429) return null
        continue
      }
      const body = (await response.json()) as AniListPage
      const characters = (body.data?.Page?.characters ?? []).flatMap((character) => {
        const art = character.image?.large
        const name = character.name?.full
        if (!art || !name || art.includes('/default.') || !ART_HOSTS.has(new URL(art).hostname)) return []
        const title = character.media?.nodes?.[0]?.title
        return [{ source: 'anilist' as const, id: character.id, name, art, work: title?.english || title?.romaji || null }]
      })
      return { characters, hasNext: body.data?.Page?.pageInfo?.hasNextPage !== false }
    } catch (error) {
      lastFailure = `${error instanceof Error ? error.message : 'erreur réseau'} sur AniList (page ${page})`
    }
  }
  return null
}

/** Lit le classement d'une source jusqu'à `count` personnages ; jette si une page manque (progression gardée). */
async function readRanking(source: CharacterSource, count: number, pageDelayMs: number): Promise<RankedCharacter[]> {
  const found = new Map<number, RankedCharacter>()
  const perPage = source === 'mal' ? 25 : 50
  const lastPage = Math.ceil(count / perPage) + 6
  for (let page = 1; found.size < count && page <= lastPage; page += 1) {
    const cacheKey = `${source}:${page}`
    let body = fetchedPages.get(cacheKey)
    if (!body) {
      if (page > 1) await pause(pageDelayMs)
      const fetched = source === 'mal' ? await malPage(page) : await aniListPage(page)
      if (!fetched) throw new Error(`${source === 'mal' ? 'Jikan' : 'AniList'} n’a pas répondu (page ${page}, ${found.size}/${count} déjà lus) — ${lastFailure || 'aucune réponse'}.`)
      fetchedPages.set(cacheKey, fetched)
      body = fetched
      if (page % 10 === 0) console.log(`[cartes] Série 3 : classement ${source === 'mal' ? 'MyAnimeList' : 'AniList'} lu jusqu’à la page ${page}.`)
    }
    for (const character of body.characters) if (!found.has(character.id)) found.set(character.id, character)
    if (!body.hasNext) break
  }
  if (found.size < count) throw new Error(`Classement incomplet : ${found.size}/${count} personnages illustrés.`)
  return [...found.values()].slice(0, count)
}

/**
 * Les `count` personnages les plus aimés : MyAnimeList d'abord ; si Jikan refuse dès la
 * première page, AniList (même idée : classement par favoris). Une source entamée est
 * gardée jusqu'au bout, pour ne jamais mélanger deux classements.
 */
export async function topCharacters(count: number, pageDelayMs = 1100): Promise<RankedCharacter[]> {
  const started = [...fetchedPages.keys()].find((key) => key.endsWith(':1'))?.split(':')[0] as CharacterSource | undefined
  if (started) return readRanking(started, count, pageDelayMs)
  try {
    return await readRanking('mal', count, pageDelayMs)
  } catch (error) {
    // Jikan refuse le classement dès le début : AniList prend le relais.
    if (fetchedPages.has('mal:1')) throw error
    console.warn(`[cartes] Série 3 : MyAnimeList indisponible (${lastFailure}), classement AniList à la place.`)
    return readRanking('anilist', count, Math.max(pageDelayMs, 800))
  }
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
    const name = character.name
    const id = series3CardId(character.source, character.id)
    return {
      id,
      number: SERIES_3_START_NUMBER + rank,
      series: SERIES_3,
      name,
      // MyAnimeList : l'œuvre arrive ensuite (cf. `enrichSeries3`) ; AniList la donne d'emblée.
      mangaTitle: character.work ?? '',
      title: name,
      characterName: name,
      description: '',
      // Au sein d'une rareté, les plus aimés pèsent un peu plus.
      power: POWER_BASE[rarity] + Math.max(0, 9 - Math.floor((rank / SERIES_3_SIZE) * 10)),
      imageUrl: characterArtPath(id),
      artUrl: character.art,
      rarity,
      mangaId: characterKey(character.source, character.id),
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
    where: { series: SERIES_3, mangaTitle: '', mangaId: { startsWith: 'mal-character-' } },
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
/** Dernier passage terminé (réussi ou non). */
let lastRun = 0
/** Série encore incomplète : nouvel essai deux minutes après un échec. */
const RETRY_INCOMPLETE_MS = 2 * 60 * 1000
/** Série complète : les œuvres manquantes sont reprises toutes les dix minutes. */
const RETRY_MS = 10 * 60 * 1000
let complete = false

/**
 * Lance (sans l'attendre) la création de la série puis l'ajout des œuvres, si besoin.
 * Lancée au démarrage du serveur, puis à chaque booster : un échec (Jikan saturé) est
 * retenté deux minutes plus tard ; les œuvres encore manquantes, toutes les dix minutes.
 */
export function ensureSeries3(now = Date.now()): void {
  // Tests : jamais d'appel réseau en arrière-plan (la série se crée à la main, cf. `series3.test.ts`).
  if (config.env === 'test' || running || now - lastRun < (complete ? RETRY_MS : RETRY_INCOMPLETE_MS)) return
  running = (async () => {
    const result = await seedSeries3()
    complete = result.total >= SERIES_3_SIZE
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
  fetchedPages.clear()
}
