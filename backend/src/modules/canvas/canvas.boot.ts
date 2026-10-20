import type { Server } from 'node:http'
import { attachCanvasSocket } from './realtime/canvas.hub.js'
import { finalizeStaleSeasons, rolloverIfNeeded } from './canvas.seasons.js'
import { watchInvitations } from './canvas.social.js'
import { loadOccupancy, watchWorld } from './realtime/canvas.tiles.js'
import { world } from './realtime/canvas.world.js'

/*
 * Démarrage de la toile : la saison du mois, la table d'occupation des tuiles, les abonnements
 * aux changements (tuiles, invitations) et l'horloge qui change de saison au changement de mois.
 * Idempotent : appelé à la première connexion ou à la première requête, jamais deux fois.
 */

let booting: Promise<void> | null = null
const stops: (() => void)[] = []
let clock: ReturnType<typeof setInterval> | null = null

export function ensureCanvas(): Promise<void> {
  booting ??= (async () => {
    await world.open()
    await loadOccupancy(world.seasonId)
    stops.push(watchWorld(), watchInvitations())
    await finalizeStaleSeasons()
    clock = setInterval(() => void rolloverIfNeeded().catch((error) => console.error('[canvas] saison', error)), 60_000)
    clock.unref?.()
  })().catch((error) => {
    booting = null
    throw error
  })
  return booting
}

/** Branche le WebSocket de la toile sur le serveur HTTP. */
export function attachCanvas(server: Server): () => void {
  return attachCanvasSocket(server, ensureCanvas)
}

/** Arrêt propre : ce qui n'est pas encore écrit l'est. */
export async function shutdownCanvas(): Promise<void> {
  if (clock) clearInterval(clock)
  clock = null
  for (const stop of stops.splice(0)) stop()
  booting = null
  await world.close()
}
