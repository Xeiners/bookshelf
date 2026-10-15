import { api } from './api'

/** Promotions (cf. `backend/src/modules/promotions/`) : prix réduit d'un booster ou d'une boîte mystère. */
export type PromotionTarget = 'booster' | 'box'

export interface Promotion {
  id: string
  target: PromotionTarget
  price: number
  regular: number
  message: string | null
  startsAt: string
  endsAt: string
  endedAt: string | null
  active: boolean
}

export const promotionsApi = {
  active: (signal?: AbortSignal) => api<{ promotions: Promotion[] }>('/promotions', { signal }).then((response) => response.promotions),
  /** Administration. */
  list: () => api<{ promotions: Promotion[] }>('/admin/promotions').then((response) => response.promotions),
  create: (input: { target: PromotionTarget; price: number; hours: number; message: string | null }) =>
    api<{ promotion: Promotion; notified: number }>('/admin/promotions', { method: 'POST', body: input }),
  end: (id: string) => api<{ promotion: Promotion }>(`/admin/promotions/${encodeURIComponent(id)}/end`, { method: 'POST', body: {} }),
}
