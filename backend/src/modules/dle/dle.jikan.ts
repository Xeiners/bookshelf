import { TtlCache } from '../../lib/cache.js'
import { notFound } from '../../lib/errors.js'
import type { CachedImage } from '../manga/manga.routes.js'

/*
 * Portraits des personnages (Naruto, One Piece, JoJo, Jujutsu Kaisen) : la photo
 * officielle de MyAnimeList, via l'API publique Jikan ; à défaut (Jikan tombe
 * souvent en panne quand MyAnimeList le refuse), celle de Kitsu (mêmes portraits,
 * sur fond), puis l'image de la fiche du personnage sur le wiki Fandom de l'univers
 * (souvent un détourage sur fond transparent). Lu une fois par jour, chaque image relayée et gardée en
 * cache : les joueurs ne voient jamais l'adresse d'origine (le format Portrait
 * ne doit pas trahir le nom).
 */

const JIKAN = 'https://api.jikan.moe/v4'
const MAL_HOST = 'cdn.myanimelist.net'
const KITSU = 'https://kitsu.app/api/edge'
const KITSU_HOST = 'media.kitsu.app'
const FANDOM_HOST = 'static.wikia.nocookie.net'
/** Les images des wikis Fandom ne se servent qu'à un navigateur venu du wiki. */
const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Ce qu'il faut d'un personnage pour lui trouver un portrait. */
export interface PortraitCharacter {
  id: string
  name: string
  /** Autres noms (saisie, recherche). */
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît, en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
}

interface JikanCharacters {
  data?: { character?: { mal_id?: number; name?: string; images?: JikanImages } }[]
}

interface JikanSearch {
  data?: { mal_id?: number; name?: string; images?: JikanImages }[]
}

interface JikanPictures {
  data?: JikanImages[]
}

interface JikanImages {
  jpg?: { image_url?: string }
  webp?: { image_url?: string }
}

/**
 * Nom comparable, quelle que soit la romanisation ou l'ordre : « Hyuuga, Neji »,
 * « Neji Hyuga » et « Neji Hyūga » donnent la même clé.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Jikan limite à quelques requêtes par seconde : les chargements de tous les univers passent l'un après l'autre. */
let jikanQueue: Promise<unknown> = Promise.resolve()
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = jikanQueue.then(task, task)
  jikanQueue = run.catch(() => undefined)
  return run
}

const portraitOf = (images: JikanImages | undefined) => {
  const url = images?.jpg?.image_url ?? images?.webp?.image_url
  return url && !url.includes('questionmark') ? url : null
}

const namesOf = (character: PortraitCharacter) => [...(character.mal ?? []), character.name, ...(character.aliases ?? [])]

/** Personnages d'une série ; Jikan répond parfois 504 sur ces longues listes : deux essais. */
async function animeCharacters(animeId: number): Promise<JikanCharacters | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await pause(1500)
    try {
      const response = await fetch(`${JIKAN}/anime/${animeId}/characters`, { signal: AbortSignal.timeout(15_000) })
      if (response.ok) return (await response.json()) as JikanCharacters
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`)
      console.warn(`[dle] Jikan a répondu ${response.status} (anime ${animeId}), nouvel essai…`)
    } catch (error) {
      console.warn(`[dle] portraits indisponibles (anime ${animeId}) :`, error instanceof Error ? error.message : error)
    }
  }
  return null
}

/** Recherche d'un personnage par nom : le plus aimé de ceux dont le nom correspond. `undefined` : Jikan n'a pas répondu. */
export async function searchPortrait(character: PortraitCharacter): Promise<{ url: string; malId: number | null } | null | undefined> {
  const keys = new Set(namesOf(character).map(nameKey))
  try {
    const response = await fetch(`${JIKAN}/characters?q=${encodeURIComponent(character.mal?.[0] ?? character.name)}&limit=10&order_by=favorites&sort=desc`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as JikanSearch
    const hit = (body.data ?? []).find((entry) => entry.name && keys.has(nameKey(entry.name)) && portraitOf(entry.images))
    const url = hit ? portraitOf(hit.images) : null
    return url ? { url, malId: hit?.mal_id ?? null } : null
  } catch {
    return undefined
  }
}

interface KitsuCharacters {
  included?: { type?: string; attributes?: { canonicalName?: string; names?: Record<string, string>; image?: { original?: string } | null } }[]
  links?: { next?: string }
}

/** Personnages d'un anime sur Kitsu (nom → portrait), page après page. `undefined` : Kitsu n'a pas répondu. */
async function kitsuCharacters(animeId: number): Promise<Map<string, string> | undefined> {
  const found = new Map<string, string>()
  let url: string | undefined = `${KITSU}/anime/${animeId}/characters?include=character&page[limit]=20`
  for (let page = 0; url && page < 30; page += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) return page === 0 ? undefined : found
      const body = (await response.json()) as KitsuCharacters
      for (const entry of body.included ?? []) {
        const image = entry.attributes?.image?.original
        if (!image || new URL(image).hostname !== KITSU_HOST) continue
        for (const name of [entry.attributes?.canonicalName, ...Object.values(entry.attributes?.names ?? {})]) {
          if (name && !found.has(nameKey(name))) found.set(nameKey(name), image)
        }
      }
      url = body.links?.next
    } catch {
      return page === 0 ? undefined : found
    }
  }
  return found
}

interface WikiPages {
  query?: {
    normalized?: { from: string; to: string }[]
    redirects?: { from: string; to: string }[]
    pages?: Record<string, { title?: string; thumbnail?: { source?: string } }>
  }
}

/**
 * Images des fiches du wiki Fandom (API MediaWiki, 50 titres par requête), en
 * suivant les redirections (« Will A. Zeppeli » → « Will Anthonio Zeppeli »).
 * `undefined` : le wiki n'a pas répondu.
 */
async function wikiPortraits(wikiHost: string, characters: readonly PortraitCharacter[]): Promise<Map<string, string> | undefined> {
  const found = new Map<string, string>()
  for (let start = 0; start < characters.length; start += 50) {
    const batch = characters.slice(start, start + 50)
    const titles = batch.map((character) => character.wiki ?? character.name)
    const params = new URLSearchParams({ action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', redirects: '1', format: 'json', titles: titles.join('|') })
    try {
      const response = await fetch(`https://${wikiHost}/api.php?${params.toString()}`, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': BROWSER_AGENT } })
      if (!response.ok) return undefined
      const { query } = (await response.json()) as WikiPages
      const follow = (title: string) => {
        let current = query?.normalized?.find((entry) => entry.from === title)?.to ?? title
        current = query?.redirects?.find((entry) => entry.from === current)?.to ?? current
        return current
      }
      const images = new Map(Object.values(query?.pages ?? {}).flatMap((page) => (page.title && page.thumbnail?.source ? [[page.title, page.thumbnail.source] as const] : [])))
      batch.forEach((character, index) => {
        const url = images.get(follow(titles[index] as string))
        if (url && new URL(url).hostname === FANDOM_HOST) found.set(character.id, url)
      })
    } catch {
      return undefined
    }
  }
  return found
}

/** Autres images d'un personnage (galerie MyAnimeList) ; `undefined` : Jikan n'a pas répondu. */
async function jikanPictures(malId: number): Promise<string[] | undefined> {
  try {
    const response = await fetch(`${JIKAN}/characters/${malId}/pictures`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return response.status === 404 ? [] : undefined
    const body = (await response.json()) as JikanPictures
    return (body.data ?? []).map(portraitOf).filter((url): url is string => url !== null)
  } catch {
    return undefined
  }
}

/** Même image, quelle que soit la taille demandée à MyAnimeList (`…/131317.jpg`, `…/131317l.jpg`). */
const imageKey = (url: string) => url.replace(/^https?:\/\/[^/]+/, '').replace(/[lt]?\.(jpe?g|webp|png)(\?.*)?$/i, '')

interface PortraitList {
  /** Id du personnage → adresse du portrait. */
  portraits: Map<string, string>
  /** Id du personnage → son id MyAnimeList (galerie d'autres images). */
  malIds: Map<string, number>
  /** Tout a répondu : sinon la liste est réessayée dix minutes plus tard. */
  complete: boolean
}

/** Au-dessous, trop peu de personnages ont une image d'énigme distincte : on garde les portraits. */
export const MIN_PUZZLE_CHARACTERS = 10
/** Images d'énigme gardées par personnage. */
const MAX_ALTERNATES = 6

export interface PortraitSource {
  /** Personnages dont on a un portrait : vignettes de la saisie et du plateau. */
  charactersWithPortrait: () => Promise<Set<string>>
  /**
   * Personnages jouables dans les formats à image : ceux qui ont une image d'énigme
   * DIFFÉRENTE de leur vignette (sinon, comparer les vignettes donnerait la réponse).
   * Tant que ces images ne sont pas chargées, ou s'il y en a trop peu : ceux qui ont un portrait.
   */
  charactersWithPuzzleImage: () => Promise<Set<string>>
  /** Octets du portrait (relayés et en cache). 404 si le personnage n'en a pas. */
  portraitImage: (character: PortraitCharacter) => Promise<CachedImage>
  /**
   * Image d'énigme : l'une de ses autres images, choisie par `seed` (la même pour tous
   * les joueurs d'une énigme), sinon son portrait.
   */
  puzzleImage: (character: PortraitCharacter, seed: string) => Promise<CachedImage>
  /** Tests : repartir d'un cache vide. */
  forget: () => void
}

/** Petit hachage stable (FNV-1a) : le même `seed` choisit toujours la même image. */
export function seedIndex(seed: string, length: number): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % Math.max(1, length)
}

/**
 * Portraits d'un univers : d'abord les listes de personnages de ses séries ; pour
 * ceux qui n'y sont pas (liste trop longue, 504), une recherche par nom, espacée.
 * La liste est servie même périmée pendant qu'une nouvelle se charge en arrière-plan :
 * un joueur n'attend jamais Jikan, sauf au tout premier chargement.
 */
export function portraitSource(
  label: string,
  animeIds: readonly number[],
  kitsuIds: readonly number[],
  wikiHost: string,
  characters: readonly PortraitCharacter[],
): PortraitSource {
  let list: PortraitList | null = null
  let expires = 0
  let loading: Promise<PortraitList> | null = null
  const images = new TtlCache<CachedImage>({ maxEntries: 150, ttlMs: 24 * 60 * 60 * 1000 })
  const puzzleBytes = new TtlCache<CachedImage>({ maxEntries: 60, ttlMs: 24 * 60 * 60 * 1000 })
  /** Id du personnage → ses images d'énigme (jamais sa vignette). */
  let alternates: Map<string, string[]> | null = null
  let alternatesExpire = 0
  let alternatesLoading: Promise<void> | null = null

  const load = async (): Promise<PortraitList> => {
    const byName = new Map<string, string>()
    const malByName = new Map<string, number>()
    const malIds = new Map<string, number>()
    let complete = true
    for (const [index, animeId] of animeIds.entries()) {
      if (index > 0) await pause(500)
      const body = await animeCharacters(animeId)
      if (!body) {
        complete = false
        continue
      }
      for (const entry of body.data ?? []) {
        const name = entry.character?.name
        const url = portraitOf(entry.character?.images)
        if (name && url && !byName.has(nameKey(name))) byName.set(nameKey(name), url)
        if (name && entry.character?.mal_id && !malByName.has(nameKey(name))) malByName.set(nameKey(name), entry.character.mal_id)
      }
    }
    const portraits = new Map<string, string>()
    for (const character of characters) {
      const key = namesOf(character)
        .map(nameKey)
        .find((name) => byName.has(name))
      if (key) portraits.set(character.id, byName.get(key) as string)
      const malKey = namesOf(character)
        .map(nameKey)
        .find((name) => malByName.has(name))
      if (malKey) malIds.set(character.id, malByName.get(malKey) as number)
    }
    // Pas sur MyAnimeList (ou Jikan en panne) : Kitsu, mêmes portraits sur fond.
    const kitsu = new Map<string, string>()
    for (const kitsuId of kitsuIds) {
      if (characters.every((entry) => portraits.has(entry.id))) break
      const found = await kitsuCharacters(kitsuId)
      if (!found) complete = false
      for (const [key, url] of found ?? []) if (!kitsu.has(key)) kitsu.set(key, url)
    }
    for (const character of characters) {
      if (portraits.has(character.id)) continue
      const url = namesOf(character)
        .map((name) => kitsu.get(nameKey(name)))
        .find(Boolean)
      if (url) portraits.set(character.id, url)
    }
    // Ni l'un ni l'autre : la fiche du wiki Fandom, en une ou deux requêtes.
    const missing = characters.filter((entry) => !portraits.has(entry.id))
    if (missing.length > 0) {
      const wiki = await wikiPortraits(wikiHost, missing)
      if (!wiki) complete = false
      for (const [id, url] of wiki ?? []) portraits.set(id, url)
    }
    for (const character of characters.filter((entry) => !portraits.has(entry.id))) {
      await pause(450)
      const found = await searchPortrait(character)
      if (found === undefined) complete = false
      else if (found) {
        portraits.set(character.id, found.url)
        if (found.malId) malIds.set(character.id, found.malId)
      }
    }
    console.log(`[dle] portraits ${label} : ${portraits.size}/${characters.length}${complete ? '' : ' (incomplet, nouvel essai dans 10 min)'}`)
    return { portraits, malIds, complete }
  }

  /**
   * Images d'énigme, chargées en tâche de fond APRÈS les portraits (une requête Jikan par
   * personnage, espacées) : l'image de sa fiche sur le wiki Fandom, et sa galerie
   * MyAnimeList — jamais la vignette de la saisie.
   */
  const loadAlternates = async (from: PortraitList): Promise<void> => {
    const found = new Map<string, string[]>()
    const add = (id: string, url: string) => {
      const main = from.portraits.get(id)
      if (main && imageKey(main) === imageKey(url)) return
      const current = found.get(id) ?? []
      if (current.length < MAX_ALTERNATES && !current.some((known) => imageKey(known) === imageKey(url))) found.set(id, [...current, url])
    }
    let complete = true
    const wiki = await wikiPortraits(wikiHost, characters)
    if (!wiki) complete = false
    for (const [id, url] of wiki ?? []) add(id, url)
    for (const character of characters) {
      const malId = from.malIds.get(character.id)
      if (!malId) continue
      await pause(450)
      const pictures = await serial(() => jikanPictures(malId))
      if (pictures === undefined) complete = false
      for (const url of pictures ?? []) add(character.id, url)
    }
    // Un chargement raté ne remplace jamais une liste plus fournie.
    if (!alternates || complete || found.size >= alternates.size) alternates = found
    alternatesExpire = Date.now() + (complete ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000)
    console.log(`[dle] images d'énigme ${label} : ${found.size}/${characters.length}${complete ? '' : ' (incomplet, nouvel essai dans 15 min)'}`)
  }

  const refreshAlternates = (from: PortraitList) => {
    if (alternatesLoading || (alternates && Date.now() < alternatesExpire)) return
    alternatesLoading = loadAlternates(from)
      .catch((error: unknown) => console.warn(`[dle] images d'énigme ${label} indisponibles :`, error))
      .finally(() => (alternatesLoading = null))
  }

  const portraits = async (): Promise<Map<string, string>> => {
    const refresh = () =>
      (loading ??= serial(load)
        .then((fresh) => {
          // Une liste incomplète ne remplace jamais une liste plus fournie.
          if (!list || fresh.complete || fresh.portraits.size >= list.portraits.size) list = fresh
          expires = Date.now() + (fresh.complete ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000)
          refreshAlternates(list)
          return list
        })
        .finally(() => (loading = null)))
    if (!list) return (await refresh()).portraits
    if (Date.now() >= expires) void refresh().catch(() => undefined)
    else refreshAlternates(list)
    return list.portraits
  }

  /** Les octets d'une image relayée (hôtes connus seulement : jamais un relais ouvert). */
  const fetchImage = async (url: string): Promise<CachedImage> => {
    const host = new URL(url).hostname
    if (host !== MAL_HOST && host !== KITSU_HOST && host !== FANDOM_HOST) throw notFound('Portrait indisponible.')
    // Fandom : l'image ne se sert qu'avec un navigateur venu du wiki.
    const headers: Record<string, string> = host === FANDOM_HOST ? { 'User-Agent': BROWSER_AGENT, Referer: `https://${wikiHost}/` } : {}
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers }).catch(() => null)
    if (!response?.ok) throw notFound('Portrait indisponible.')
    return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/jpeg' }
  }

  const portraitImage = async (character: PortraitCharacter): Promise<CachedImage> => {
    const url = (await portraits()).get(character.id)
    if (!url) throw notFound('Portrait indisponible.')
    return images.getOrLoad(character.id, () => fetchImage(url))
  }

  return {
    charactersWithPortrait: async () => new Set((await portraits()).keys()),
    charactersWithPuzzleImage: async () => {
      const withPortrait = new Set((await portraits()).keys())
      const ready = [...(alternates?.keys() ?? [])].filter((id) => withPortrait.has(id))
      return ready.length >= MIN_PUZZLE_CHARACTERS ? new Set(ready) : withPortrait
    },
    portraitImage,
    puzzleImage: async (character, seed) => {
      await portraits()
      const choices = alternates?.get(character.id) ?? []
      if (choices.length === 0) return portraitImage(character)
      const url = choices[seedIndex(seed, choices.length)] as string
      try {
        return await puzzleBytes.getOrLoad(url, () => fetchImage(url))
      } catch {
        // Image d'énigme disparue : le portrait, plutôt qu'une énigme sans image.
        return portraitImage(character)
      }
    },
    forget: () => {
      list = null
      expires = 0
      alternates = null
      alternatesExpire = 0
      images.clear()
      puzzleBytes.clear()
    },
  }
}
