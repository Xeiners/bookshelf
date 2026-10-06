import { TtlCache } from '../../lib/cache.js'
import { notFound } from '../../lib/errors.js'
import { characterOf } from '../dle/dle.games.js'
import { searchPortrait, serial, type PortraitCharacter } from '../dle/dle.jikan.js'
import type { CachedImage } from '../manga/manga.routes.js'

/*
 * Portraits des auteurs des répliques de fin de partie (cf. `frontend/src/lib/bombQuotes.ts`) :
 * ceux du BookshelfDLE quand l'univers y est, sinon la photo MyAnimeList (recherche Jikan),
 * relayée et gardée en cache une journée. `mal` : un mot court pour la recherche (Jikan
 * cherche mal les noms complets), le nom entier servant à reconnaître le bon personnage.
 */

const MAL_HOST = 'cdn.myanimelist.net'
const DAY = 24 * 60 * 60 * 1000

type QuoteAuthor = { dle: { category: 'naruto' | 'onepiece' | 'jojo' | 'jjk'; id: string } } | { mal: PortraitCharacter }

export const QUOTE_AUTHORS: Record<string, QuoteAuthor> = {
  naruto: { dle: { category: 'naruto', id: 'naruto' } },
  rockLee: { dle: { category: 'naruto', id: 'rock-lee' } },
  jiraiya: { dle: { category: 'naruto', id: 'jiraiya' } },
  kakashi: { dle: { category: 'naruto', id: 'kakashi' } },
  luffy: { dle: { category: 'onepiece', id: 'luffy' } },
  zoro: { dle: { category: 'onepiece', id: 'zoro' } },
  whitebeard: { dle: { category: 'onepiece', id: 'whitebeard' } },
  giorno: { dle: { category: 'jojo', id: 'giorno' } },
  jotaro: { dle: { category: 'jojo', id: 'jotaro' } },
  gojo: { dle: { category: 'jjk', id: 'gojo' } },
  todo: { dle: { category: 'jjk', id: 'todo' } },
  allMight: { mal: { id: 'allMight', name: 'Toshinori Yagi', mal: ['Toshinori'], aliases: ['All Might'] } },
  rengoku: { mal: { id: 'rengoku', name: 'Kyoujurou Rengoku', mal: ['Rengoku'], aliases: ['Kyojuro Rengoku'] } },
  edward: { mal: { id: 'edward', name: 'Edward Elric', mal: ['Elric'] } },
  eren: { mal: { id: 'eren', name: 'Eren Yeager', mal: ['Eren'], aliases: ['Eren Jaeger'] } },
  saitama: { mal: { id: 'saitama', name: 'Saitama' } },
  kamina: { mal: { id: 'kamina', name: 'Kamina' } },
  kageyama: { mal: { id: 'kageyama', name: 'Tobio Kageyama', mal: ['Tobio'] } },
  escanor: { mal: { id: 'escanor', name: 'Escanor' } },
  asta: { mal: { id: 'asta', name: 'Asta' } },
  erwin: { mal: { id: 'erwin', name: 'Erwin Smith', mal: ['Erwin'] } },
  jinwoo: { mal: { id: 'jinwoo', name: 'Jinwoo Sung', mal: ['Jinwoo'], aliases: ['Jin-Woo Sung', 'Sung Jin-Woo', 'Sung Jinwoo'] } },
}

const images = new TtlCache<CachedImage>({ maxEntries: 40, ttlMs: DAY })
/** Un échec (Jikan en panne, personnage introuvable) n'est retenté qu'au bout de 10 minutes. */
const failures = new Map<string, number>()
const RETRY_MS = 10 * 60 * 1000

async function malPortrait(character: PortraitCharacter): Promise<CachedImage> {
  const found = await serial(() => searchPortrait(character))
  if (!found || new URL(found.url).hostname !== MAL_HOST) throw notFound('Portrait indisponible.')
  const response = await fetch(found.url, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!response?.ok) throw notFound('Portrait indisponible.')
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/jpeg' }
}

export async function quotePortrait(id: string): Promise<CachedImage> {
  const author = Object.hasOwn(QUOTE_AUTHORS, id) ? QUOTE_AUTHORS[id] : undefined
  if (!author) throw notFound('Réplique inconnue.')
  if ('dle' in author) {
    const found = characterOf(author.dle.category, author.dle.id)
    if (!found) throw notFound('Portrait indisponible.')
    return found.image()
  }
  if ((failures.get(id) ?? 0) > Date.now()) throw notFound('Portrait indisponible.')
  try {
    return await images.getOrLoad(id, () => malPortrait(author.mal))
  } catch (error) {
    failures.set(id, Date.now() + RETRY_MS)
    throw error
  }
}

/** Pour les tests. */
export function resetQuotePortraits(): void {
  images.clear()
  failures.clear()
}
