import type { Language } from '../i18n/languages'
import type { Book } from '../types/book'
import { api } from './api'

/** Tirage du jour renvoyé par l'API (déterministe pour une graine). */
export interface OracleDraw {
  mood: string
  pace: string
  /** Trop peu de titres de ce format : seule l'ambiance a filtré. */
  relaxed: boolean
  /** Classés : la Pépite d'abord, puis des lectures dans la même veine. */
  picks: Book[]
}

export interface OracleStreak {
  lastDay: string | null
  streak: number
  best: number
}

export const oracleApi = {
  draw: (seed: string, language: Language, signal?: AbortSignal) =>
    api<OracleDraw>(`/oracle/draw?${new URLSearchParams({ seed, lang: language }).toString()}`, { signal }),

  /** Enregistre le tirage du jour ; `streak` = série connue localement (invité, hors-ligne). */
  checkin: (day: string, streak: number) =>
    api<{ oracle: OracleStreak }>('/oracle/checkin', { method: 'POST', body: { day, streak } }),
}
