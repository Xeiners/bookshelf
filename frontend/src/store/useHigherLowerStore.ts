import { create } from 'zustand'
import { higherLowerApi, type HlCard, type HlChoice, type HlGuessResult, type HlMetric, type HlOverview, type HlResult, type HlRun } from '../services/higherLowerApi'
import { useDleStore } from './useDleStore'

/*
 * Higher or Lower : accueil (records, classements), partie en cours, bilan.
 * La partie vit sur le serveur ; l'écran de jeu orchestre les animations et
 * n'applique une réponse (`advance`, `finish`) qu'une fois la révélation jouée.
 */

export type HlScreen = 'home' | 'play' | 'over'

/** Bruitages coupés : gardé sur l'appareil (confort, jamais indispensable). */
const MUTED_KEY = 'bookshelf.hl.muted'

function savedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

interface HigherLowerState {
  screen: HlScreen
  overview: HlOverview | null
  overviewStatus: 'idle' | 'loading' | 'ready' | 'error'
  run: HlRun | null
  /** Bilan de la dernière partie (écran « Fin de série »). */
  result: HlResult | null
  /** Le duel perdu (les deux valeurs connues), rappelé sur le bilan. `null` : partie arrêtée. */
  lastDuel: { current: HlCard; next: HlCard } | null
  /** Une partie démarre (bouton d'une catégorie qui tourne). */
  starting: HlMetric | null
  muted: boolean

  toggleMuted: () => void

  loadOverview: () => Promise<void>
  start: (metric: HlMetric) => Promise<void>
  /** Envoie la réponse ; l'état ne change qu'avec `advance` ou `finish`. */
  guess: (choice: HlChoice) => Promise<HlGuessResult>
  /** Réponse jouée et partie qui continue (juste, ou chance perdue) : la carte devinée devient la référence. */
  advance: (answer: HlGuessResult) => void
  /** Partie finie (erreur ou arrêt) : records et solde à jour, écran de bilan. */
  finish: (result: HlResult, duel?: { current: HlCard; next: HlCard }) => void
  /** Arrêter en cours de route ; sans série, retour direct à l'accueil. */
  quit: () => Promise<void>
  openHome: () => void
  reset: () => void
}

export const useHigherLowerStore = create<HigherLowerState>((set, get) => ({
  screen: 'home',
  overview: null,
  overviewStatus: 'idle',
  run: null,
  result: null,
  lastDuel: null,
  starting: null,
  muted: savedMuted(),

  toggleMuted: () => {
    const muted = !get().muted
    try {
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
    } catch {
      // Stockage indisponible : le réglage vaut pour la visite.
    }
    set({ muted })
  },

  loadOverview: async () => {
    if (get().overview === null) set({ overviewStatus: 'loading' })
    try {
      set({ overview: await higherLowerApi.overview(), overviewStatus: 'ready' })
    } catch {
      set((state) => ({ overviewStatus: state.overview ? 'ready' : 'error' }))
    }
  },

  start: async (metric) => {
    if (get().starting) return
    set({ starting: metric })
    try {
      const run = await higherLowerApi.start(metric)
      set({ run, result: null, screen: 'play' })
    } finally {
      set({ starting: null })
    }
  },

  guess: (choice) => {
    const run = get().run
    if (!run) return Promise.reject(new Error('no_run'))
    return higherLowerApi.guess(run.id, choice)
  },

  advance: (answer) =>
    set((state) => {
      if (!state.run || !answer.next) return state
      return {
        run: { ...state.run, streak: answer.streak, lives: answer.lives, current: { ...state.run.next, value: answer.value }, next: answer.next },
      }
    }),

  finish: (result, duel) => {
    useDleStore.getState().setStardust(result.balance)
    set((state) => ({
      run: null,
      result,
      lastDuel: duel ?? null,
      screen: 'over',
      overview: state.overview
        ? {
            ...state.overview,
            me: {
              ...state.overview.me,
              best: result.best,
              bestMetric: result.record ? result.metric : state.overview.me.bestMetric,
              todayBest: result.todayBest,
              earnedToday: result.earnedToday,
              games: state.overview.me.games + 1,
            },
          }
        : state.overview,
    }))
  },

  quit: async () => {
    const run = get().run
    if (!run) return get().openHome()
    const result = await higherLowerApi.end(run.id).catch(() => null)
    if (result && run.streak > 0) get().finish(result)
    else {
      if (result) useDleStore.getState().setStardust(result.balance)
      get().openHome()
    }
  },

  openHome: () => {
    set({ screen: 'home', run: null })
    void get().loadOverview()
  },

  reset: () => set({ screen: 'home', overview: null, overviewStatus: 'idle', run: null, result: null, lastDuel: null, starting: null }),
}))

/** Joue un bruitage du jeu, sauf s'ils sont coupés. */
export function hlSound(play: () => void): void {
  if (!useHigherLowerStore.getState().muted) play()
}
