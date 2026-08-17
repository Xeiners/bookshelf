/**
 * Permet de figer le décor animé pendant les gestes.
 *
 * Un élément en `backdrop-filter` est recomposé dès que quelque chose bouge
 * derrière lui. Des halos animés en continu font donc travailler le compositeur
 * en permanence, au détriment du swipe.
 */

type Listener = (paused: boolean) => void

const listeners = new Set<Listener>()
let paused = false

export function onAmbientPauseChange(listener: Listener): () => void {
  listeners.add(listener)
  listener(paused)
  return () => {
    listeners.delete(listener)
  }
}

export function setAmbientPaused(next: boolean): void {
  if (paused === next) return
  paused = next
  for (const listener of listeners) listener(next)
}
