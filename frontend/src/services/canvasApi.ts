import { api } from './api'

/** Toile partagée (cf. `backend/src/modules/canvas/`). Le temps réel passe par `lib/canvas/net.ts`. */
export interface CanvasHome {
  season: { id: string; key: string; startedAt: string | null }
  online: number
  me: { canDraw: boolean; reason: 'young' | 'banned' | null; waitMs: number; admin: boolean; brushes: string[]; likesReceived: number }
  brushes: { id: string; price: number; likes: number }[]
}

export interface CanvasUser {
  id: string
  name: string | null
  avatar: string | null
}

export interface GalleryFrame {
  id: string
  title: string
  likes: number
  liked: boolean
  mine: boolean
  owner: { id: string; name: string | null }
  x: number
  y: number
  w: number
  h: number
}

export interface SeasonStats {
  objects: number
  artists: number
  frames: number
  likes: number
  podium: { frameId: string; title: string; ownerId: string; likes: number }[]
}

export interface CanvasSeason {
  id: string
  key: string
  startedAt: string
  endedAt: string | null
  current: boolean
  hasArchive: boolean
  stats: SeasonStats | null
}

export interface BrushView {
  id: string
  price: number
  likes: number
  owned: boolean
  byLikes: boolean
}

export interface BrushShop {
  brushes: BrushView[]
  balance: number
  likesReceived: number
}

export interface ObjectInfo {
  id: string
  type: string
  likes: number
  createdAt: string
  owner: CanvasUser
  liked: boolean
  reported: boolean
  mine: boolean
}

export type ReportReason = 'inappropriate' | 'spam' | 'hate' | 'other'

export interface TimelapseItem {
  id: string
  o: string
  t: number
  d: unknown
}

export interface QueueItem {
  id: string
  type: string
  data: unknown
  owner: { id: string; name: string | null }
  hidden: boolean
  reports: number
  reasons: Record<string, number>
  likes: number
  createdAt: string
  box: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface CanvasAdminOverview {
  online: number
  objects: number
  frames: number
  artists: number
  pending: number
  hidden: number
  banned: number
  queue: QueueItem[]
}

export interface FrameSummary {
  id: string
  title: string
  owner: string
  likes: number
  x: number
  y: number
  w: number
  h: number
}

export const canvasApi = {
  home: () => api<CanvasHome>('/canvas'),
  users: (ids: string[]) => api<{ users: CanvasUser[] }>(`/canvas/users?ids=${encodeURIComponent(ids.join(','))}`),
  frames: () => api<{ frames: FrameSummary[] }>('/canvas/frames'),
  gallery: (season?: string) => api<{ frames: GalleryFrame[] }>(`/canvas/gallery${season ? `?season=${encodeURIComponent(season)}` : ''}`),
  seasons: () => api<{ seasons: CanvasSeason[] }>('/canvas/seasons'),
  timelapse: (season: string, after?: string) => api<{ items: TimelapseItem[]; next: string | null }>(`/canvas/seasons/${season}/timelapse${after ? `?after=${after}` : ''}`),
  like: (id: string) => api<{ likes: number; liked: true; rewarded: boolean }>(`/canvas/objects/${id}/like`, { method: 'POST' }),
  report: (id: string, reason: ReportReason) => api<{ hidden: boolean }>(`/canvas/objects/${id}/report`, { method: 'POST', body: { reason } }),
  object: (id: string) => api<ObjectInfo>(`/canvas/objects/${id}`),
  brushes: () => api<BrushShop>('/canvas/brushes'),
  buyBrush: (id: string) => api<BrushShop>(`/canvas/brushes/${id}/buy`, { method: 'POST' }),
}
