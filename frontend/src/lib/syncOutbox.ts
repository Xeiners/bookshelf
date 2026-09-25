/**
 * Boîte d'envoi de la synchronisation « API Sync ».
 *
 * Le store local reste la source de vérité de l'UI (réponse instantanée, même
 * hors-ligne) ; chaque mutation d'un utilisateur connecté est empilée ici puis
 * rejouée dans l'ordre vers l'API. La file est persistée : un swipe fait dans le
 * métro part au retour du réseau, même après fermeture de l'app.
 *
 * Aucune dépendance vers les stores : le store bibliothèque y pousse, le store
 * d'authentification l'active et reçoit les sessions expirées via un callback.
 */
import type { Language } from '../i18n/languages'
import type { Book, ReadingStatus } from '../types/book'
import { ApiError } from '../services/api'
import { authApi, libraryApi, type SwipeAction } from '../services/accountApi'
import { oracleApi } from '../services/oracleApi'

export type SyncOp =
  | { type: 'swipe'; id: string; action: SwipeAction; book?: Book; at: number }
  | {
      type: 'patch'
      id: string
      status: ReadingStatus
      progress: number
      favorite?: boolean
      userRating?: number | null
      at: number
    }
  | { type: 'remove'; id: string; at: number }
  | { type: 'reset'; at: number }
  /** Préférences du compte (langue). */
  | { type: 'prefs'; language: Language; at: number }
  /** Tirage de l'Oracle fait sans pouvoir joindre l'API. */
  | { type: 'oracle'; day: string; streak: number; at: number }

const STORAGE_KEY = 'bookshelf:outbox:v1'
const FLUSH_DELAY_MS = 350
const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000

function load(): SyncOp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SyncOp[]) : []
  } catch {
    return []
  }
}

let queue: SyncOp[] = load()
let enabled = false
let flushing: Promise<boolean> | null = null
let timer: number | undefined
let retryDelay = RETRY_MIN_MS
let onUnauthorized: () => void = () => {}
const listeners = new Set<() => void>()

function persist() {
  try {
    if (queue.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Stockage plein ou bloqué : la file reste en mémoire pour cette session.
  }
  for (const listener of listeners) listener()
}

function schedule(delay: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void flush(), delay)
}

function send(op: SyncOp): Promise<unknown> {
  switch (op.type) {
    case 'swipe':
      return libraryApi.swipe({ mangaId: op.id, action: op.action, book: op.book, at: op.at })
    case 'patch':
      return libraryApi.patch(op.id, {
        status: op.status,
        progress: op.progress,
        favorite: op.favorite,
        userRating: op.userRating,
        at: op.at,
      })
    case 'remove':
      return libraryApi.remove(op.id)
    case 'reset':
      return libraryApi.reset()
    case 'prefs':
      return authApi.updateMe({ preferredLanguage: op.language })
    case 'oracle':
      return oracleApi.checkin(op.day, op.streak)
  }
}

/**
 * Rejoue la file dans l'ordre. Renvoie `true` si elle est vide à la fin.
 * - réseau / 5xx : on s'arrête et on retente plus tard (backoff exponentiel) ;
 * - 401 : session expirée, on prévient le store d'authentification ;
 * - autre 4xx : l'opération ne passera jamais, on l'abandonne et on continue.
 */
async function flush(): Promise<boolean> {
  if (!enabled) return queue.length === 0
  if (flushing) return flushing

  flushing = (async () => {
    while (enabled && queue.length > 0) {
      const op = queue[0]
      try {
        await send(op)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0
        if (status === 401) {
          onUnauthorized()
          return false
        }
        if (status === 0 || status >= 500 || status === 429) {
          schedule(retryDelay)
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
          return false
        }
        console.warn('[sync] opération rejetée par l’API, abandonnée :', op, error)
      }
      // `queue[0]` peut avoir été remplacée par une fusion pendant l'envoi.
      if (queue[0] === op) queue.shift()
      persist()
    }
    retryDelay = RETRY_MIN_MS
    return queue.length === 0
  })().finally(() => {
    flushing = null
  })

  return flushing
}

/** Fusionne les opérations redondantes pour limiter les requêtes. */
function enqueue(op: SyncOp) {
  if (op.type === 'prefs' || op.type === 'oracle') {
    // Seul le dernier état compte ; il ne dépend d'aucune opération de bibliothèque.
    queue = queue.filter((pending) => pending.type !== op.type)
    queue.push(op)
    return
  }

  if (op.type === 'reset') {
    // Tout ce qui précède un reset est sans objet… sauf les préférences, qui
    // ne font pas partie de la bibliothèque.
    queue = [...queue.filter((pending) => pending.type === 'prefs' || pending.type === 'oracle'), op]
    return
  }

  if (op.type === 'remove') {
    queue = queue.filter((pending) => !('id' in pending) || pending.id !== op.id)
    queue.push(op)
    return
  }

  // Un curseur de progression émet une rafale de patchs : seul le dernier compte.
  // Uniquement s'il est en fin de file, sinon on réordonnerait les opérations.
  const last = queue[queue.length - 1]
  if (op.type === 'patch' && last?.type === 'patch' && last.id === op.id && !flushing) {
    queue[queue.length - 1] = op
    return
  }

  queue.push(op)
}

export const outbox = {
  push(op: SyncOp) {
    if (!enabled) return
    enqueue(op)
    persist()
    schedule(FLUSH_DELAY_MS)
  },

  flush,

  enable() {
    enabled = true
    if (queue.length > 0) schedule(0)
  },

  disable() {
    enabled = false
    window.clearTimeout(timer)
  },

  clear() {
    queue = []
    persist()
  },

  size: () => queue.length,

  /** Un changement de langue attend-il d'être envoyé ? (il prime alors sur celle du compte) */
  hasPendingPrefs: () => queue.some((op) => op.type === 'prefs'),

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  setUnauthorizedHandler(handler: () => void) {
    onUnauthorized = handler
  },
}

// Retour du réseau : on vide la file sans attendre le prochain essai programmé.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    retryDelay = RETRY_MIN_MS
    if (enabled && queue.length > 0) schedule(0)
  })
}
