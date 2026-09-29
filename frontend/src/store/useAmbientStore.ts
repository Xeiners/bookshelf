import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Un morceau enregistré : une vidéo ou une playlist YouTube. */
export interface AmbientTrack {
  id: string
  kind: 'video' | 'playlist'
  /** Identifiant YouTube (vidéo ou `list=`). */
  ref: string
  /** Titre lu via oEmbed à l'ajout, `null` s'il n'a pas pu l'être. */
  title: string | null
}

export interface AmbientPlaylist {
  id: string
  name: string
  tracks: AmbientTrack[]
  createdAt: number
}

export const AMBIENT_LIMITS = { playlists: 50, tracks: 200, name: 60 } as const

interface AmbientPrefs {
  /** Lance l'ambiance à l'ouverture du lecteur. Désactivée par défaut. */
  autoPlay: boolean
  /** 0 → 100, comme l'API YouTube. */
  volume: number
  /** Dernière écoute : identifiant d'ambiance, `playlist:<id>`, ou lien / ID YouTube collé. */
  lastSource: string | null
  playlists: AmbientPlaylist[]
  /** Dernière playlist où un morceau a été ajouté : proposée en premier. */
  lastPlaylistId: string | null
}

/** Issue d'un ajout : `duplicate` si le morceau y est déjà, `full` au-delà de la limite. */
export type AddTrackResult = 'added' | 'duplicate' | 'full' | 'missing'

interface AmbientState extends AmbientPrefs {
  setAutoPlay: (autoPlay: boolean) => void
  setVolume: (volume: number) => void
  setLastSource: (source: string) => void
  /** Crée une playlist vide et renvoie son identifiant (`null` au-delà de la limite). */
  createPlaylist: (name: string) => string | null
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addTrack: (playlistId: string, track: Omit<AmbientTrack, 'id'>) => AddTrackResult
  /** Crée une playlist garnie d'un coup (import d'une playlist YouTube). `null` au-delà de la limite. */
  importPlaylist: (name: string, tracks: Omit<AmbientTrack, 'id'>[]) => string | null
  removeTrack: (playlistId: string, trackId: string) => void
  moveTrack: (playlistId: string, trackId: string, delta: -1 | 1) => void
}

const DEFAULT_VOLUME = 40

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, AMBIENT_LIMITS.name)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Playlists relues du stockage : les entrées mal formées sont écartées, une à une. */
export function sanitizePlaylists(value: unknown): AmbientPlaylist[] {
  if (!Array.isArray(value)) return []
  const playlists: AmbientPlaylist[] = []
  for (const raw of value.slice(0, AMBIENT_LIMITS.playlists)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue
    const tracks: AmbientTrack[] = []
    for (const track of Array.isArray(raw.tracks) ? raw.tracks.slice(0, AMBIENT_LIMITS.tracks) : []) {
      if (!isRecord(track) || typeof track.id !== 'string' || typeof track.ref !== 'string' || !track.ref) continue
      if (track.kind !== 'video' && track.kind !== 'playlist') continue
      tracks.push({
        id: track.id,
        kind: track.kind,
        ref: track.ref,
        title: typeof track.title === 'string' && track.title ? track.title : null,
      })
    }
    playlists.push({
      id: raw.id,
      name: cleanName(raw.name) || '…',
      tracks,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    })
  }
  return playlists
}

/** Applique `change` à une playlist précise. */
const updatePlaylist = (
  playlists: AmbientPlaylist[],
  id: string,
  change: (playlist: AmbientPlaylist) => AmbientPlaylist,
): AmbientPlaylist[] => playlists.map((playlist) => (playlist.id === id ? change(playlist) : playlist))

/**
 * Musique d'ambiance : préférences et playlists, propres à l'appareil
 * (localStorage), jamais envoyées au serveur.
 */
export const useAmbientStore = create<AmbientState>()(
  persist(
    (set, get) => ({
      autoPlay: false,
      volume: DEFAULT_VOLUME,
      lastSource: null,
      playlists: [],
      lastPlaylistId: null,

      setAutoPlay: (autoPlay) => set({ autoPlay }),
      setVolume: (volume) => set({ volume: Math.round(Math.min(100, Math.max(0, volume))) }),
      setLastSource: (lastSource) => set({ lastSource }),

      createPlaylist: (name) => {
        if (get().playlists.length >= AMBIENT_LIMITS.playlists) return null
        const playlist: AmbientPlaylist = { id: newId(), name: cleanName(name) || '…', tracks: [], createdAt: Date.now() }
        set((state) => ({ playlists: [...state.playlists, playlist] }))
        return playlist.id
      },
      renamePlaylist: (id, name) => {
        const clean = cleanName(name)
        if (!clean) return
        set((state) => ({ playlists: updatePlaylist(state.playlists, id, (playlist) => ({ ...playlist, name: clean })) }))
      },
      deletePlaylist: (id) =>
        set((state) => ({
          playlists: state.playlists.filter((playlist) => playlist.id !== id),
          lastSource: state.lastSource === `playlist:${id}` ? null : state.lastSource,
          lastPlaylistId: state.lastPlaylistId === id ? null : state.lastPlaylistId,
        })),

      addTrack: (playlistId, track) => {
        const target = get().playlists.find((playlist) => playlist.id === playlistId)
        if (!target) return 'missing'
        if (target.tracks.some((entry) => entry.ref === track.ref)) return 'duplicate'
        if (target.tracks.length >= AMBIENT_LIMITS.tracks) return 'full'
        set((state) => ({
          lastPlaylistId: playlistId,
          playlists: updatePlaylist(state.playlists, playlistId, (playlist) => ({
            ...playlist,
            tracks: [...playlist.tracks, { ...track, id: newId() }],
          })),
        }))
        return 'added'
      },
      importPlaylist: (name, tracks) => {
        if (get().playlists.length >= AMBIENT_LIMITS.playlists) return null
        const seen = new Set<string>()
        const unique = tracks.filter((track) => !seen.has(track.ref) && seen.add(track.ref)).slice(0, AMBIENT_LIMITS.tracks)
        const playlist: AmbientPlaylist = {
          id: newId(),
          name: cleanName(name) || '…',
          tracks: unique.map((track) => ({ ...track, id: newId() })),
          createdAt: Date.now(),
        }
        set((state) => ({ playlists: [...state.playlists, playlist], lastPlaylistId: playlist.id }))
        return playlist.id
      },
      removeTrack: (playlistId, trackId) =>
        set((state) => ({
          playlists: updatePlaylist(state.playlists, playlistId, (playlist) => ({
            ...playlist,
            tracks: playlist.tracks.filter((track) => track.id !== trackId),
          })),
        })),
      moveTrack: (playlistId, trackId, delta) =>
        set((state) => ({
          playlists: updatePlaylist(state.playlists, playlistId, (playlist) => {
            const from = playlist.tracks.findIndex((track) => track.id === trackId)
            const to = from + delta
            if (from < 0 || to < 0 || to >= playlist.tracks.length) return playlist
            const tracks = [...playlist.tracks]
            const [moved] = tracks.splice(from, 1)
            if (moved) tracks.splice(to, 0, moved)
            return { ...playlist, tracks }
          }),
        })),
    }),
    {
      name: 'bookshelf:ambient:v1',
      version: 1,
      partialize: (state): AmbientPrefs => ({
        autoPlay: state.autoPlay,
        volume: state.volume,
        lastSource: state.lastSource,
        playlists: state.playlists,
        lastPlaylistId: state.lastPlaylistId,
      }),
      // Valeurs corrompues : retour aux défauts, champ par champ.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Record<keyof AmbientPrefs, unknown>>
        return {
          ...current,
          autoPlay: saved.autoPlay === true,
          volume:
            typeof saved.volume === 'number' && Number.isFinite(saved.volume)
              ? Math.round(Math.min(100, Math.max(0, saved.volume)))
              : DEFAULT_VOLUME,
          lastSource: typeof saved.lastSource === 'string' && saved.lastSource.trim() ? saved.lastSource : null,
          playlists: sanitizePlaylists(saved.playlists),
          lastPlaylistId: typeof saved.lastPlaylistId === 'string' ? saved.lastPlaylistId : null,
        }
      },
    },
  ),
)
