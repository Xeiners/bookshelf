import { api } from './api'
import type { BoosterStatus } from '../lib/boosters'

/** Événement de l'équipe (cf. `backend/src/modules/events/`) : un mot et des cadeaux, à récupérer une fois. */
export interface TeamEvent {
  id: string
  title: string
  message: string
  boosters: number
  legendaryPacks: number
  stardust: number
  startsAt: string
  endsAt: string
  endedAt: string | null
  active: boolean
}

export interface AdminTeamEvent extends TeamEvent {
  /** Comptes qui ont récupéré leurs cadeaux. */
  claims: number
}

export interface TeamEventInput {
  title: string
  message: string
  boosters: number
  legendaryPacks: number
  stardust: number
  hours: number
}

/** Bornes des cadeaux (cf. `EVENT_MAX` côté serveur, qui fait foi). */
export const EVENT_MAX = { boosters: 10, legendaryPacks: 5, stardust: 10_000 } as const
export const EVENT_TITLE_MAX = 60
export const EVENT_MESSAGE_MAX = 400

export const eventsApi = {
  pending: () => api<{ events: TeamEvent[] }>('/events/pending').then((response) => response.events),
  /** Récupère les cadeaux : nouvelle réserve de boosters, et solde de Poussières s'il en offrait. */
  claim: (id: string) => api<{ boosters: BoosterStatus; stardust: number | null }>(`/events/${encodeURIComponent(id)}/claim`, { method: 'POST' }),

  /* Administration. */
  list: () => api<{ events: AdminTeamEvent[] }>('/admin/events').then((response) => response.events),
  create: (input: TeamEventInput) => api<{ event: AdminTeamEvent }>('/admin/events', { method: 'POST', body: input }).then((response) => response.event),
  end: (id: string) => api<{ event: AdminTeamEvent }>(`/admin/events/${encodeURIComponent(id)}/end`, { method: 'POST' }).then((response) => response.event),
}
