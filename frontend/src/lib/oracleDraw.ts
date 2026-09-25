import { isNetworkError } from '../services/api'
import { oracleApi } from '../services/oracleApi'
import { seedBooks } from '../services/seedBooks'
import { MOOD_SKINS, PACE_SKINS } from '../components/tarot/decks'
import type { Language } from '../i18n/languages'
import { useAuthStore } from '../store/useAuthStore'
import { knownIds, useLibraryStore } from '../store/useLibraryStore'
import { useOracleStore } from '../store/useOracleStore'
import type { Book } from '../types/book'
import { localDay, seededRandom, shuffle } from './oracle'
import { outbox } from './syncOutbox'

/** Le mélange dure au moins ce temps : le rituel a besoin de son suspense. */
const MIN_SHUFFLE_MS = 1100

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tirage hors-ligne : même graine, même hasard que le serveur, puisé dans le
 * jeu de secours local. L'app reste jouable sans réseau.
 */
function offlineDraw(seed: string, language: Language) {
  const random = seededRandom(seed)
  const moods = Object.keys(MOOD_SKINS)
  const paces = Object.keys(PACE_SKINS)
  return {
    mood: moods[Math.floor(random() * moods.length)],
    pace: paces[Math.floor(random() * paces.length)],
    relaxed: true,
    picks: shuffle(seedBooks(language), random),
  }
}

/**
 * Distribue le tirage du jour :
 *  1. graine = compte (même tirage sur tous les appareils) ou appareil, + jour ;
 *  2. titres déjà dans la bibliothèque (ou écartés) relégués en fin de liste ;
 *  3. série mise à jour localement, puis envoyée au compte si connecté.
 */
export async function performDraw(language: Language): Promise<void> {
  const day = localDay()
  const user = useAuthStore.getState().user
  const oracle = useOracleStore.getState()
  // Chaque relance du jour décale la graine : nouveau tirage, toujours reproductible.
  const rerolls = oracle.rerolls?.day === day ? oracle.rerolls.count : 0
  const seed = `${user?.id ?? oracle.deviceId}:${day}${rerolls > 0 ? `:r${rerolls}` : ''}`

  const [draw, offline] = await Promise.all([
    oracleApi
      .draw(seed, language)
      .then((result) => [result, false] as const)
      .catch(() => [offlineDraw(seed, language), true] as const),
    wait(MIN_SHUFFLE_MS),
  ]).then(([result]) => result)

  const { entries, skipped } = useLibraryStore.getState()
  const known = knownIds(entries, skipped)
  const fresh = draw.picks.filter((book) => !known.has(book.id))
  const ordered: Book[] = fresh.length > 0 ? [...fresh, ...draw.picks.filter((book) => known.has(book.id))] : draw.picks

  const [pepite, ...rest] = ordered
  if (!pepite) throw new Error('empty draw')

  useOracleStore.getState().startDraw({
    day,
    mood: draw.mood,
    pace: draw.pace,
    relaxed: draw.relaxed,
    offline,
    pepite,
    companions: rest.slice(0, 2),
  })

  if (!user) return
  const { streak } = useOracleStore.getState()
  try {
    const { oracle: server } = await oracleApi.checkin(day, streak)
    useOracleStore.getState().reconcile(server)
  } catch (error) {
    // Hors-ligne : la file d'envoi s'en chargera au retour du réseau.
    if (isNetworkError(error)) outbox.push({ type: 'oracle', day, streak, at: Date.now() })
  }
}
