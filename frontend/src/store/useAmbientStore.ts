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
  /** Dernière modification (horloge de cet appareil) : arbitre la synchronisation entre appareils. */
  updatedAt: number
}

/** Playlist supprimée ici, pas encore confirmée par le compte : la suppression doit atteindre les autres appareils. */
export interface DeletedPlaylist {
  id: string
  createdAt: number
  deletedAt: number
}

/** Playlist telle que le compte la renvoie (`POST /api/music/playlists/sync`). */
export interface RemotePlaylist {
  id: string
  name: string
  tracks: AmbientTrack[]
  createdAt: number
  updatedAt: number
  deleted: boolean
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
  /** Suppressions en attente d'envoi au compte. */
  deletedPlaylists: DeletedPlaylist[]
}

/** Issue d'un ajout : `duplicate` si le morceau y est déjà, `full` au-delà de la limite. */
export type AddTrackResult = 'added' | 'duplicate' | 'full' | 'missing'

/** Bilan d'un ajout groupé (tous les morceaux d'une playlist YouTube). */
export interface AddTracksReport {
  added: number
  /** Déjà dans la playlist (ou en double dans le lot). */
  duplicates: number
  /** Écartés : la playlist a atteint sa limite. */
  overflow: number
}

interface AmbientState extends AmbientPrefs {
  setAutoPlay: (autoPlay: boolean) => void
  setVolume: (volume: number) => void
  setLastSource: (source: string) => void
  /** Crée une playlist vide et renvoie son identifiant (`null` au-delà de la limite). */
  createPlaylist: (name: string) => string | null
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addTrack: (playlistId: string, track: Omit<AmbientTrack, 'id'>) => AddTrackResult
  /**
   * Remplace un morceau (une playlist YouTube gardée d'un bloc) par ses vidéos,
   * à sa place, sans doublon ni dépassement.
   */
  expandTrack: (playlistId: string, trackId: string, tracks: Omit<AmbientTrack, 'id'>[]) => AddTracksReport | null
  /** Ajoute plusieurs morceaux d'un coup, sans doublon ni dépassement ; `null` si la playlist n'existe pas. */
  addTracks: (playlistId: string, tracks: Omit<AmbientTrack, 'id'>[]) => AddTracksReport | null
  /** Crée une playlist garnie d'un coup (import d'une playlist YouTube). `null` au-delà de la limite. */
  importPlaylist: (name: string, tracks: Omit<AmbientTrack, 'id'>[]) => string | null
  removeTrack: (playlistId: string, trackId: string) => void
  moveTrack: (playlistId: string, trackId: string, delta: -1 | 1) => void
  /**
   * État du compte reçu d'une synchronisation : pour chaque playlist, la
   * version la plus récente l'emporte (celle d'ici si elle a changé depuis).
   */
  applyRemote: (remote: readonly RemotePlaylist[]) => void
  /** Déconnexion : les playlists du compte ne restent pas sur l'appareil. */
  clearPlaylists: () => void
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
      // Playlists d'avant la synchronisation : datées de leur création.
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    })
  }
  return playlists
}

/** Suppressions en attente relues du stockage. */
function sanitizeDeleted(value: unknown): DeletedPlaylist[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) =>
    isRecord(raw) && typeof raw.id === 'string' && typeof raw.deletedAt === 'number'
      ? [{ id: raw.id, createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0, deletedAt: raw.deletedAt }]
      : [],
  )
}

/**
 * Fusion (pure) de l'état local avec celui du compte. Une playlist modifiée
 * ici depuis (plus récente) reste telle quelle : la prochaine synchronisation
 * l'enverra. Une suppression locale plus récente l'emporte aussi ; confirmée
 * par le compte, elle quitte la file d'attente.
 */
export function mergeRemote(
  local: readonly AmbientPlaylist[],
  deleted: readonly DeletedPlaylist[],
  remote: readonly RemotePlaylist[],
): { playlists: AmbientPlaylist[]; deletedPlaylists: DeletedPlaylist[] } {
  const byId = new Map(local.map((playlist) => [playlist.id, playlist]))
  const pendingDeletes = new Map(deleted.map((entry) => [entry.id, entry]))
  for (const item of remote) {
    const mine = byId.get(item.id)
    const deletion = pendingDeletes.get(item.id)
    if (item.deleted) {
      if (mine && mine.updatedAt <= item.updatedAt) byId.delete(item.id)
      if (deletion && deletion.deletedAt <= item.updatedAt) pendingDeletes.delete(item.id)
      continue
    }
    // Supprimée ici après la dernière version du compte : elle reste supprimée.
    if (deletion && deletion.deletedAt > item.updatedAt) continue
    if (deletion) pendingDeletes.delete(item.id)
    if (!mine || item.updatedAt > mine.updatedAt) {
      byId.set(item.id, { id: item.id, name: item.name, tracks: item.tracks, createdAt: item.createdAt, updatedAt: item.updatedAt })
    }
  }
  return {
    playlists: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    deletedPlaylists: [...pendingDeletes.values()],
  }
}

/** Applique `change` à une playlist précise, et la date (elle partira vers le compte). */
const updatePlaylist = (
  playlists: AmbientPlaylist[],
  id: string,
  change: (playlist: AmbientPlaylist) => AmbientPlaylist,
): AmbientPlaylist[] =>
  playlists.map((playlist) => {
    if (playlist.id !== id) return playlist
    const next = change(playlist)
    return next === playlist ? playlist : { ...next, updatedAt: Math.max(Date.now(), playlist.updatedAt + 1) }
  })

/**
 * Musique d'ambiance : préférences propres à l'appareil (localStorage), et
 * playlists — gardées ici, et synchronisées avec le compte quand on est
 * connecté (cf. `lib/audio/playlistSync.ts`).
 */
export const useAmbientStore = create<AmbientState>()(
  persist(
    (set, get) => ({
      autoPlay: false,
      volume: DEFAULT_VOLUME,
      lastSource: null,
      playlists: [],
      lastPlaylistId: null,
      deletedPlaylists: [],

      setAutoPlay: (autoPlay) => set({ autoPlay }),
      setVolume: (volume) => set({ volume: Math.round(Math.min(100, Math.max(0, volume))) }),
      setLastSource: (lastSource) => set({ lastSource }),

      createPlaylist: (name) => {
        if (get().playlists.length >= AMBIENT_LIMITS.playlists) return null
        const now = Date.now()
        const playlist: AmbientPlaylist = { id: newId(), name: cleanName(name) || '…', tracks: [], createdAt: now, updatedAt: now }
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
          deletedPlaylists: [
            ...state.deletedPlaylists.filter((entry) => entry.id !== id),
            {
              id,
              createdAt: state.playlists.find((playlist) => playlist.id === id)?.createdAt ?? Date.now(),
              deletedAt: Math.max(Date.now(), (state.playlists.find((playlist) => playlist.id === id)?.updatedAt ?? 0) + 1),
            },
          ],
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
      expandTrack: (playlistId, trackId, tracks) => {
        const target = get().playlists.find((playlist) => playlist.id === playlistId)
        const at = target?.tracks.findIndex((track) => track.id === trackId) ?? -1
        if (!target || at < 0) return null
        const rest = target.tracks.filter((track) => track.id !== trackId)
        const known = new Set(rest.map((track) => track.ref))
        const fresh = tracks.filter((track) => !known.has(track.ref) && known.add(track.ref))
        const kept = fresh.slice(0, Math.max(0, AMBIENT_LIMITS.tracks - rest.length))
        set((state) => ({
          playlists: updatePlaylist(state.playlists, playlistId, (playlist) => ({
            ...playlist,
            tracks: [...rest.slice(0, at), ...kept.map((track) => ({ ...track, id: newId() })), ...rest.slice(at)],
          })),
        }))
        return { added: kept.length, duplicates: tracks.length - fresh.length, overflow: fresh.length - kept.length }
      },
      addTracks: (playlistId, tracks) => {
        const target = get().playlists.find((playlist) => playlist.id === playlistId)
        if (!target) return null
        const known = new Set(target.tracks.map((track) => track.ref))
        const fresh = tracks.filter((track) => !known.has(track.ref) && known.add(track.ref))
        const room = Math.max(0, AMBIENT_LIMITS.tracks - target.tracks.length)
        const kept = fresh.slice(0, room)
        if (kept.length > 0) {
          set((state) => ({
            lastPlaylistId: playlistId,
            playlists: updatePlaylist(state.playlists, playlistId, (playlist) => ({
              ...playlist,
              tracks: [...playlist.tracks, ...kept.map((track) => ({ ...track, id: newId() }))],
            })),
          }))
        }
        return { added: kept.length, duplicates: tracks.length - fresh.length, overflow: fresh.length - kept.length }
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
          updatedAt: Date.now(),
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

      applyRemote: (remote) => set((state) => mergeRemote(state.playlists, state.deletedPlaylists, remote)),
      clearPlaylists: () =>
        set((state) => ({
          playlists: [],
          deletedPlaylists: [],
          lastPlaylistId: null,
          lastSource: state.lastSource?.startsWith('playlist:') ? null : state.lastSource,
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
        deletedPlaylists: state.deletedPlaylists,
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
          deletedPlaylists: sanitizeDeleted(saved.deletedPlaylists),
        }
      },
    },
  ),
)
