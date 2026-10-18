import { TtlCache } from '../../lib/cache.js'
import { notFound } from '../../lib/errors.js'
import type { CachedImage } from '../manga/manga.routes.js'

/*
 * Affiches d'anime de Page Stack : les œuvres les plus suivies de MyAnimeList (API publique
 * Jikan, sans contenu pour adultes), relayées par `/api/stack/covers/:id` — redimensionnées et
 * gardées en cache, l'adresse d'origine ne sort jamais du serveur. La liste est lue une fois,
 * puis toutes les 6 h (15 min si Jikan est en panne). Sans liste, le jeu garde ses pages dessinées.
 */

const JIKAN_TOP = 'https://api.jikan.moe/v4/top/anime'
const MAL_HOST = 'cdn.myanimelist.net'
const FULL_TTL_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 15 * 60 * 1000
/** Affiches gardées au plus (deux pages de 25 sur Jikan). */
const MAX_COVERS = 48
/** Largeur servie : une page du jeu fait au plus ~260 px, ×2 pour les écrans Retina. */
const COVER_WIDTH = 440

export interface StackCover {
  id: number
  title: string
}

interface JikanTop {
  data?: {
    mal_id?: number
    title?: string
    type?: string | null
    rating?: string | null
    images?: { jpg?: { large_image_url?: string | null; image_url?: string | null } }
  }[]
}

const urls = new Map<number, string>()
let covers: StackCover[] = []
let loadedAt = 0
let ok = false
let loading: Promise<void> | null = null

const images = new TtlCache<CachedImage>({ maxEntries: 120, ttlMs: 24 * 60 * 60 * 1000 })

/** Affiches retenues d'une page Jikan : séries et films, tout public, avec une image de MyAnimeList. */
export function pickCovers(page: JikanTop): { cover: StackCover; url: string }[] {
  const picked: { cover: StackCover; url: string }[] = []
  for (const item of page.data ?? []) {
    const id = item.mal_id
    const url = item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !item.title || !url) continue
    if (item.type !== 'TV' && item.type !== 'Movie') continue
    if (item.rating?.startsWith('Rx')) continue
    try {
      if (new URL(url).hostname !== MAL_HOST) continue
    } catch {
      continue
    }
    picked.push({ cover: { id, title: item.title }, url })
  }
  return picked
}

async function fetchPage(page: number): Promise<JikanTop | null> {
  const response = await fetch(`${JIKAN_TOP}?filter=bypopularity&sfw=true&limit=25&page=${page}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!response?.ok) return null
  return (await response.json().catch(() => null)) as JikanTop | null
}

async function load(): Promise<void> {
  const found: { cover: StackCover; url: string }[] = []
  for (const page of [1, 2]) {
    const data = await fetchPage(page)
    // Le classement bouge entre deux pages : une œuvre peut revenir.
    if (data) for (const entry of pickCovers(data)) if (!found.some((other) => other.cover.id === entry.cover.id)) found.push(entry)
    // Jikan limite le débit : un court répit entre deux pages.
    if (page === 1) await new Promise((resolve) => setTimeout(resolve, 400))
  }
  loadedAt = Date.now()
  ok = found.length > 0
  if (!ok) return
  covers = found.slice(0, MAX_COVERS).map((entry) => entry.cover)
  urls.clear()
  for (const entry of found.slice(0, MAX_COVERS)) urls.set(entry.cover.id, entry.url)
}

/** Liste des affiches ; chargée au premier besoin, rafraîchie en tâche de fond. */
export async function stackCovers(): Promise<StackCover[]> {
  const stale = Date.now() - loadedAt > (ok ? FULL_TTL_MS : RETRY_MS)
  if (stale) {
    loading ??= load().finally(() => (loading = null))
    // Premier chargement : on l'attend ; ensuite la liste du moment sert pendant qu'on la rafraîchit.
    if (covers.length === 0) await loading
  }
  return covers
}

type Sharp = typeof import('sharp')['default']
let sharpModule: Promise<Sharp | null> | null = null
const loadSharp = () => (sharpModule ??= import('sharp').then((module) => module.default, () => null))

/** Une affiche, réduite et réencodée en WebP (l'original tel quel si sharp manque). */
export async function stackCoverImage(id: number): Promise<CachedImage> {
  await stackCovers()
  const url = urls.get(id)
  if (!url) throw notFound('Affiche indisponible.')
  return images.getOrLoad(String(id), async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (!response?.ok) throw notFound('Affiche indisponible.')
    const original: CachedImage = { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/jpeg' }
    const sharp = await loadSharp()
    if (!sharp) return original
    try {
      const body = await sharp(original.body, { failOn: 'error' }).resize({ width: COVER_WIDTH, withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer()
      return { body, contentType: 'image/webp' }
    } catch {
      return original
    }
  })
}

/** Pour les tests : repart de zéro. */
export function resetStackCovers(): void {
  urls.clear()
  covers = []
  loadedAt = 0
  ok = false
  loading = null
}
