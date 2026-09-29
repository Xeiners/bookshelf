import { api } from '../../services/api'
import { useAmbientStore, type RemotePlaylist } from '../../store/useAmbientStore'

/*
 * Playlists d'ambiance ↔ compte : créées sur le téléphone, retrouvées sur
 * l'ordinateur. Chaque synchronisation envoie tout l'état de l'appareil
 * (suppressions comprises), puis fusionne la réponse (cf. `mergeRemote`) :
 * playlist par playlist, la version la plus récente gagne. Hors-ligne, rien
 * ne se perd : l'état reste sur l'appareil et part au retour du réseau.
 */

/** Regroupe les modifications rapprochées (renommer, ajouter trois morceaux…) en un seul envoi. */
const DEBOUNCE_MS = 1200

let timer: ReturnType<typeof setTimeout> | undefined
let inflight = false
/** Une modification est arrivée pendant l'envoi : on renvoie juste après. */
let again = false
/** La réponse du compte s'applique : ce n'est pas une modification à renvoyer. */
let applying = false

/** État de l'appareil, au format de l'API. */
function outgoing(): RemotePlaylist[] {
  const { playlists, deletedPlaylists } = useAmbientStore.getState()
  return [
    ...playlists.map((playlist) => ({ ...playlist, deleted: false })),
    ...deletedPlaylists.map((entry) => ({ id: entry.id, name: '…', tracks: [], createdAt: entry.createdAt, updatedAt: entry.deletedAt, deleted: true })),
  ]
}

/** Synchronise maintenant (compte connecté seulement : l'appelant le vérifie). */
export async function syncPlaylistsNow(): Promise<void> {
  clearTimeout(timer)
  if (inflight) {
    again = true
    return
  }
  inflight = true
  try {
    const { playlists } = await api<{ playlists: RemotePlaylist[] }>('/music/playlists/sync', {
      method: 'POST',
      body: { playlists: outgoing() },
    })
    applying = true
    useAmbientStore.getState().applyRemote(playlists)
  } catch {
    // Hors-ligne ou session expirée : l'état reste sur l'appareil, renvoyé plus tard.
  } finally {
    applying = false
    inflight = false
    if (again) {
      again = false
      schedulePlaylistSync()
    }
  }
}

/** Synchronisation différée, après une modification locale. */
export function schedulePlaylistSync(delay = DEBOUNCE_MS): void {
  clearTimeout(timer)
  timer = setTimeout(() => void syncPlaylistsNow(), delay)
}

/** Vrai pendant l'application d'une réponse du compte (à ne pas renvoyer). */
export const isApplyingRemote = () => applying

/** Déconnexion : plus rien à envoyer. */
export function cancelPlaylistSync(): void {
  clearTimeout(timer)
  again = false
}
