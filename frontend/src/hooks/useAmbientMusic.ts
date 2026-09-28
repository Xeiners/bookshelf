import { createContext, useEffect, useSyncExternalStore } from 'react'
import { useT } from '../i18n'
import { isCustomKey, playAmbient, playlistIdOf } from '../lib/audio/ambientPlayback'
import { isAmbientPresetId, type AmbientPresetId } from '../lib/audio/ambientPresets'
import { ambientPlayer } from '../lib/audio/youtubePlayer'
import { useAmbientStore } from '../store/useAmbientStore'

/** Ambiance suggérée pour l'œuvre ouverte (selon ses genres) ; `null` hors du lecteur. */
export const AmbientSuggestionContext = createContext<AmbientPresetId | null>(null)

/** État du lecteur de musique (lecture, pause, titre, file), réactif. */
export function useAmbientPlayer() {
  return useSyncExternalStore(ambientPlayer.subscribe, ambientPlayer.getSnapshot, ambientPlayer.getSnapshot)
}

/**
 * Lecture automatique à l'ouverture du lecteur, si l'option est active et que
 * rien ne joue déjà : dernière playlist ou lien de l'utilisateur, sinon
 * l'ambiance suggérée par le genre. Une musique lancée ainsi se coupe à la
 * fermeture du lecteur ; celle choisie à la main continue dans l'application.
 */
export function useAmbientSession(suggested: AmbientPresetId) {
  useEffect(() => {
    const { autoPlay, lastSource } = useAmbientStore.getState()
    if (!autoPlay || ambientPlayer.getPlayingState() !== 'idle') return
    const own = lastSource !== null && (isCustomKey(lastSource) || playlistIdOf(lastSource) !== null)
    const started =
      (own && playAmbient(lastSource, { remember: false })) || playAmbient(suggested, { remember: false })
    if (!started) return
    const key = ambientPlayer.getSnapshot().key
    return () => {
      if (ambientPlayer.getSnapshot().key === key) ambientPlayer.stop()
    }
  }, [suggested])
}

/** Ce qui joue, en mots : titre principal et ligne de détail (playlist, état). */
export function useAmbientLabel(): { title: string; detail: string | null } {
  const t = useT()
  const copy = t.ambient
  const snapshot = useAmbientPlayer()
  const playlists = useAmbientStore((state) => state.playlists)

  const status = { idle: null, loading: copy.loading, playing: null, paused: copy.paused, error: copy.error }[snapshot.state]
  const { key } = snapshot
  if (key === null) return { title: copy.nothing, detail: null }

  if (isAmbientPresetId(key)) return { title: copy.presets[key].label, detail: status ?? snapshot.title }

  const playlistId = playlistIdOf(key)
  const playlist = playlistId !== null ? playlists.find((entry) => entry.id === playlistId) : undefined
  if (playlist) {
    const track = playlist.tracks.find((entry) => entry.ref === snapshot.source?.id)
    const position = `${playlist.name} · ${snapshot.index + 1}/${snapshot.length}`
    return {
      title: snapshot.title ?? track?.title ?? copy.youtube,
      detail: status ? `${position} · ${status}` : position,
    }
  }
  return { title: snapshot.title ?? copy.custom, detail: status }
}
