import { useAmbientStore } from '../../store/useAmbientStore'
import { isAmbientPresetId, resolveAmbientSource } from './ambientPresets'
import { ambientPlayer, youTubeUrl, type AmbientSource } from './youtubePlayer'

const PLAYLIST_PREFIX = 'playlist:'

/** Clé d'écoute d'une playlist enregistrée. */
export const playlistKey = (id: string) => `${PLAYLIST_PREFIX}${id}`

/** Identifiant de la playlist enregistrée derrière une clé, sinon `null`. */
export const playlistIdOf = (key: string | null): string | null =>
  key?.startsWith(PLAYLIST_PREFIX) ? key.slice(PLAYLIST_PREFIX.length) : null

/** Un lien collé (ni ambiance, ni playlist enregistrée) : le choix de l'utilisateur prime. */
export const isCustomKey = (key: string | null): key is string =>
  key !== null && !isAmbientPresetId(key) && playlistIdOf(key) === null

/**
 * Lance une écoute : ambiance (`lofi`…), playlist enregistrée
 * (`playlist:<id>`, à partir du morceau `index`) ou lien YouTube collé.
 * Retenue comme dernière écoute sauf `remember: false`. `false` si rien n'a
 * pu être lancé (lien invalide, playlist vide ou supprimée).
 */
export function playAmbient(key: string, options: { index?: number; remember?: boolean } = {}): boolean {
  const { playlists, volume, setLastSource } = useAmbientStore.getState()
  ambientPlayer.setVolume(volume)
  const playlistId = playlistIdOf(key)
  let ok: boolean
  if (playlistId !== null) {
    const playlist = playlists.find((entry) => entry.id === playlistId)
    ok =
      playlist !== undefined &&
      ambientPlayer.playQueue(
        playlist.tracks.map((track) => track.ref),
        { key, index: options.index },
      )
  } else {
    ok = ambientPlayer.play(resolveAmbientSource(key), key)
  }
  if (ok && options.remember !== false) setLastSource(key)
  return ok
}

/** Titre d'une vidéo ou playlist YouTube (oEmbed, CORS autorisé), `null` si injoignable. */
export async function fetchYouTubeTitle(source: AmbientSource, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeUrl(source))}`, {
      signal,
    })
    if (!response.ok) return null
    const data = (await response.json()) as { title?: unknown }
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null
  } catch {
    return null
  }
}
