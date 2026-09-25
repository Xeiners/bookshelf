import type { Language } from '../i18n/languages'
import type { Book, LibraryEntry, ReadingStatus } from '../types/book'
import { api } from './api'
import type { OracleStreak } from './oracleApi'

export interface AuthUser {
  id: string
  email: string
  displayName: string | null
  /** Langue du compte : suit l'utilisateur d'un appareil à l'autre. */
  preferredLanguage: Language
  /** Série de tirages de l'Oracle, portée par le compte. */
  oracle: OracleStreak
  createdAt: number
}

/** Bibliothèque telle que l'API l'échange (entrées en tableau). */
export interface LibraryPayload {
  entries: LibraryEntry[]
  skipped: string[]
}

export interface Credentials {
  email: string
  password: string
}

interface SessionResponse {
  user: AuthUser
  library: LibraryPayload
}

/** Inscription en attente de son code (aucun compte n'existe encore). */
export interface PendingRegistration {
  email: string
  /** Fin de validité du code (ms). */
  expiresAt: number
  /** Premier renvoi possible (ms). */
  resendAt: number
}

/* ---- Auth -------------------------------------------------------------- */

export const authApi = {
  me: () => api<{ user: AuthUser }>('/auth/me'),

  /** Étape 1 : envoie un code par e-mail. AUCUN compte n'est créé ici. */
  register: (input: Credentials & { displayName?: string; preferredLanguage: Language }) =>
    api<PendingRegistration>('/auth/register', { method: 'POST', body: input }),

  /** Étape 2 : le bon code crée le compte. `initialData` = état invité, fusionné par l'API. */
  verifyRegistration: (input: { email: string; code: string; initialData: LibraryPayload }) =>
    api<SessionResponse>('/auth/register/verify', { method: 'POST', body: input }),

  resendCode: (email: string) =>
    api<PendingRegistration>('/auth/register/resend', { method: 'POST', body: { email } }),

  login: (input: Credentials & { initialData: LibraryPayload }) =>
    api<SessionResponse>('/auth/login', { method: 'POST', body: input }),

  logout: () => api<void>('/auth/logout', { method: 'POST' }),

  updateMe: (input: { displayName?: string | null; preferredLanguage?: Language }) =>
    api<{ user: AuthUser }>('/auth/me', { method: 'PATCH', body: input }),
}

/* ---- Bibliothèque ------------------------------------------------------ */

export type SwipeAction = ReadingStatus | 'skipped'

export const libraryApi = {
  fetch: () => api<LibraryPayload>('/library'),

  swipe: (input: { mangaId: string; action: SwipeAction; book?: Book; at: number }) =>
    api<{ entry: LibraryEntry | null }>('/library/swipe', { method: 'POST', body: input }),

  patch: (
    id: string,
    input: { status: ReadingStatus; progress: number; favorite?: boolean; userRating?: number | null; at: number },
  ) =>
    api<{ entry: LibraryEntry }>(`/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: input }),

  remove: (id: string) => api<void>(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reset: () => api<void>('/library', { method: 'DELETE' }),
}
