import type { LevelPlan } from '../lib/gravity/generator'
import type { GravityLevel, ThemeId } from '../lib/gravity/types'
import { api } from './api'

/** Gravity Ninja (cf. `backend/src/modules/gravity/`) : pour l'instant réservé aux administrateurs. */
export interface GravityLevelSummary {
  id: string
  name: string
  theme: ThemeId
  difficulty: number
  builtin: boolean
  length: number
  checkpoints: number
  scrolls: number
}

export interface GravityProgress {
  bestPercent: number
  completed: boolean
  bestTimeMs: number | null
  fewestDeaths: number | null
  scrolls: number
  attempts: number
}

/** IA qui peuvent écrire le plan d'un niveau (une clé chacune sur le serveur). */
export type AiProvider = 'gemini' | 'claude'

export interface GravityOverview {
  levels: GravityLevelSummary[]
  progress: Record<string, GravityProgress>
  /** IA branchées sur le serveur, dans l'ordre de préférence ; vide : génération par IA indisponible. */
  ai: AiProvider[]
}

export interface GravityRunReport {
  percent: number
  completed: boolean
  timeMs: number
  deaths: number
  scrolls: number
}

export interface PlanRequest {
  prompt: string
  difficulty?: number
  theme?: ThemeId
  length?: 'short' | 'medium' | 'long'
  /** L'IA à interroger ; par défaut, la première branchée. */
  provider?: AiProvider
}

export const gravityApi = {
  overview: (signal?: AbortSignal) => api<GravityOverview>('/gravity', { signal }),
  level: (id: string) => api<{ level: GravityLevel }>(`/gravity/levels/${encodeURIComponent(id)}`),
  run: (id: string, report: GravityRunReport) => api<{ progress: GravityProgress }>(`/gravity/levels/${encodeURIComponent(id)}/runs`, { method: 'POST', body: report }),
  save: (level: GravityLevel) => api<{ level: GravityLevelSummary }>('/gravity/levels', { method: 'POST', body: { level } }),
  remove: (id: string) => api<void>(`/gravity/levels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Le plan d'un niveau, écrit par une IA (Gemini ou Claude). 503 `gravity_ai_unavailable` sans clé sur le serveur. */
  plan: (request: PlanRequest) => api<{ plan: LevelPlan }>('/gravity/ai/plan', { method: 'POST', body: request }),
  /** Le texte de la demande, pour un autre assistant. */
  prompt: (request: PlanRequest) => api<{ prompt: string }>('/gravity/ai/prompt', { method: 'POST', body: request }),
}
