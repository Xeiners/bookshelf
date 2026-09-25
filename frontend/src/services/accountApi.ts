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

/* ---- Auth -------------------------------------------------------------- */

export const authApi = {
  me: () => api<{ user: AuthUser }>('/auth/me'),

  /** `initialData` = état invité local, fusionné dans le compte par l'API. */
  register: (
    input: Credentials & { displayName?: string; preferredLanguage: Language; initialData: LibraryPayload },
  ) =>
    api<SessionResponse>('/auth/register', { method: 'POST', body: input }),

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
