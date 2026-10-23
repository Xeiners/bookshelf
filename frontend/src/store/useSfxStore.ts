import { create } from 'zustand'
import { getSfxVolume, setSfxVolume } from '../lib/sfx'

interface SfxState {
  /** Volume des bruitages de tous les jeux (0-100). */
  volume: number
  setVolume: (volume: number) => void
}

/** Le volume des bruitages, partagé par tous les jeux (et gardé sur l'appareil par `sfx.ts`). */
export const useSfxStore = create<SfxState>((set) => ({
  volume: getSfxVolume(),
  setVolume: (volume) => {
    setSfxVolume(volume)
    set({ volume: getSfxVolume() })
  },
}))
