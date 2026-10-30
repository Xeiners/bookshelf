import type { BoosterStatus } from '../lib/boosters'
import { API_BASE, api } from './api'
import type { TradeCard } from './tradesApi'

/** Administration (cf. `backend/src/modules/admin/`). Comptes de `ADMIN_EMAILS` seulement. */

export interface AdminOverview {
  users: number
  newThisWeek: number
  activeThisWeek: number
  suspended: number
  openOffers: number
  tradesThisWeek: number
  boostersOpened: number
}

export type AdminUserFilter = 'all' | 'active' | 'suspended'

export interface AdminUserRow {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  lastSeenAt: string | null
  suspended: boolean
  isAdmin: boolean
  /** Contrôleur d'images : accès à la seule revue des images d'énigme. */
  imageReviewer: boolean
  cards: number
  library: number
  boostersOpened: number
}

export type AdminActionType = 'gift_boosters' | 'gift_card' | 'suspend' | 'unsuspend' | 'moderate' | 'promotion' | 'promotion_end' | 'canvas_remove' | 'canvas_restore' | 'canvas_purge' | 'canvas_ban' | 'canvas_unban' | 'dle_image_ban' | 'dle_image_restore' | 'reviewer_grant' | 'reviewer_revoke' | 'theme' | 'event' | 'event_end'

/** Revue des images d'énigme du BookshelfDLE. */
export interface DleUniverse {
  category: string
  label: string
  characters: number
  /** Les images candidates sont chargées côté serveur. */
  ready: boolean
  images: number
  remaining: number
  approved: number
  banned: number
}

export interface DleReviewItem {
  characterId: string
  name: string
  key: string
}

export type DleDecision = 'approve' | 'ban' | 'clear'

export interface AdminAuditEntry {
  id: string
  adminEmail: string
  targetUserId: string | null
  targetLabel: string | null
  action: AdminActionType
  details: Record<string, unknown>
  createdAt: string
}

export interface AdminProfileStats {
  collection: { total: number; owned: number; copies: number }
  reading: { wishlist: number; reading: number; read: number; chaptersRead: number; novels: number; novelsFinished: number }
  gacha: { boostersOpened: number }
}

export interface AdminUserDetail extends AdminUserRow {
  bio: string | null
  avatarUrl: string | null
  hasPhoto: boolean
  isProfilePublic: boolean
  preferredLanguage: string
  emailVerified: boolean
  suspendedAt: string | null
  suspendedReason: string | null
  boosters: BoosterStatus & { gifted: number }
  stats: AdminProfileStats
  openOffers: number
  tradesCompleted: number
  audit: AdminAuditEntry[]
}

export interface Moderation {
  displayName?: boolean
  bio?: boolean
  avatar?: boolean
  makePrivate?: boolean
  cancelOffers?: boolean
}

const userPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`

export const adminApi = {
  overview: () => api<AdminOverview>('/admin/overview'),
  canvas: () => api<import('./canvasApi').CanvasAdminOverview>('/admin/canvas'),
  canvasRemove: (id: string) => api<{ ok: true }>(`/admin/canvas/objects/${id}/remove`, { method: 'POST' }),
  canvasRestore: (id: string) => api<{ ok: true }>(`/admin/canvas/objects/${id}/restore`, { method: 'POST' }),
  canvasPurge: (userId: string) => api<{ removed: number }>(`/admin/canvas/users/${userId}/purge`, { method: 'POST' }),
  canvasBan: (userId: string, reason: string | null) => api<{ ok: true }>(`/admin/canvas/users/${userId}/ban`, { method: 'POST', body: { reason } }),
  canvasUnban: (userId: string) => api<{ ok: true }>(`/admin/canvas/users/${userId}/unban`, { method: 'POST' }),
  users: (query: { q: string; filter: AdminUserFilter; cursor?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: query.q, filter: query.filter })
    if (query.cursor) params.set('cursor', query.cursor)
    return api<{ users: AdminUserRow[]; next: string | null }>(`/admin/users?${params}`, { signal })
  },
  user: (id: string, signal?: AbortSignal) => api<{ user: AdminUserDetail }>(userPath(id), { signal }),
  /** Photo personnelle du compte (route réservée à l'administration). */
  photoUrl: (id: string) => `${API_BASE}${userPath(id)}/avatar-image`,
  giftBoosters: (id: string, count: number, message: string) =>
    api<{ boosters: BoosterStatus }>(`${userPath(id)}/boosters`, { method: 'POST', body: { count, message } }),
  giftCard: (id: string, cardId: string, count: number, message: string) =>
    api<{ card: TradeCard; count: number }>(`${userPath(id)}/cards`, { method: 'POST', body: { cardId, count, message } }),
  setReviewer: (id: string, enabled: boolean) => api<{ user: AdminUserDetail }>(`${userPath(id)}/reviewer`, { method: 'POST', body: { enabled } }),
  suspend: (id: string, reason: string) => api<{ user: AdminUserDetail }>(`${userPath(id)}/suspend`, { method: 'POST', body: { reason } }),
  unsuspend: (id: string) => api<{ user: AdminUserDetail }>(`${userPath(id)}/unsuspend`, { method: 'POST', body: {} }),
  moderate: (id: string, moderation: Moderation) => api<{ user: AdminUserDetail }>(`${userPath(id)}/moderate`, { method: 'POST', body: moderation }),
  cards: (q: string, signal?: AbortSignal) => api<{ cards: TradeCard[] }>(`/admin/cards?q=${encodeURIComponent(q)}`, { signal }),
  dleUniverses: () => api<{ universes: DleUniverse[] }>('/admin/dle-images'),
  dleQueue: (category: string, limit = 10, signal?: AbortSignal) => api<{ ready: boolean; remaining: number; items: DleReviewItem[] }>(`/admin/dle-images/${category}/queue?limit=${limit}`, { signal }),
  dleDecide: (category: string, item: DleReviewItem, decision: DleDecision) => api<{ remaining: number }>(`/admin/dle-images/${category}/review`, { method: 'POST', body: { characterId: item.characterId, key: item.key, decision } }),
  /** L'image candidate et le portrait du personnage (routes réservées à l'administration, relayées par le serveur). */
  dleImageUrl: (category: string, item: DleReviewItem) => `${API_BASE}/admin/dle-images/${category}/image?character=${encodeURIComponent(item.characterId)}&key=${encodeURIComponent(item.key)}`,
  dlePortraitUrl: (category: string, characterId: string) => `${API_BASE}/admin/dle-images/${category}/portrait?character=${encodeURIComponent(characterId)}`,
  audit: (query: { userId?: string; cursor?: string } = {}) => {
    const params = new URLSearchParams()
    if (query.userId) params.set('userId', query.userId)
    if (query.cursor) params.set('cursor', query.cursor)
    return api<{ entries: AdminAuditEntry[]; next: string | null }>(`/admin/audit${params.size ? `?${params}` : ''}`)
  },
}
