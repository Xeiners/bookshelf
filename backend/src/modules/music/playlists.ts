import { z } from 'zod'
import { prisma } from '../../db.js'

/*
 * Playlists de musique d'ambiance d'un compte, synchronisées entre ses
 * appareils. Chaque appareil envoie toutes ses playlists (suppressions
 * comprises) ; le serveur garde, playlist par playlist, la version la plus
 * récente (`updatedAt`, horloge de l'appareil qui l'a modifiée), puis renvoie
 * l'état fusionné. Hors-ligne, l'appareil garde ses modifications et les
 * envoie au retour du réseau : elles gagnent si elles sont plus récentes.
 */

export const PLAYLIST_LIMITS = { playlists: 50, tracks: 200, name: 60 } as const
/** Playlists envoyées au plus par synchronisation, suppressions comprises. */
const MAX_ENTRIES = 300

const TrackSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['video', 'playlist']),
  /** Identifiant YouTube (vidéo ou `list=`). */
  ref: z.string().regex(/^[\w-]{2,64}$/),
  title: z.string().max(300).nullable(),
})

const PlaylistSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().trim().max(PLAYLIST_LIMITS.name),
  tracks: z.array(TrackSchema).max(PLAYLIST_LIMITS.tracks),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean().default(false),
})

export const SyncBodySchema = z.object({ playlists: z.array(PlaylistSchema).max(MAX_ENTRIES).default([]) })

export type SyncPlaylist = z.infer<typeof PlaylistSchema>

/**
 * Fusion (pure) : pour chaque playlist, la version la plus récente l'emporte.
 * Une horloge d'appareil en avance est ramenée à « maintenant » (elle ne doit
 * pas figer une playlist pour les autres). Une suppression perd ses morceaux.
 * Au-delà de la limite, les playlists nouvelles de cet envoi sont écartées.
 * `changed` : ce qu'il faut écrire.
 */
export function mergePlaylists(stored: readonly SyncPlaylist[], incoming: readonly SyncPlaylist[], now: number) {
  const byId = new Map(stored.map((playlist) => [playlist.id, playlist]))
  let alive = stored.filter((playlist) => !playlist.deleted).length
  const changed: SyncPlaylist[] = []

  for (const raw of incoming) {
    const next: SyncPlaylist = {
      ...raw,
      name: raw.name || '…',
      updatedAt: Math.min(raw.updatedAt, now),
      tracks: raw.deleted ? [] : raw.tracks,
    }
    const current = byId.get(next.id)
    if (current && next.updatedAt <= current.updatedAt) continue
    const revives = !next.deleted && (!current || current.deleted)
    if (revives && alive >= PLAYLIST_LIMITS.playlists) continue
    if (revives) alive += 1
    if (next.deleted && current && !current.deleted) alive -= 1
    byId.set(next.id, next)
    changed.push(next)
  }

  const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return { merged, changed }
}

/** Morceaux enregistrés (JSON) : une valeur illisible vaut une playlist vide. */
function parseTracks(raw: string): SyncPlaylist['tracks'] {
  try {
    const parsed = z.array(TrackSchema).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** Synchronise les playlists d'un appareil avec celles du compte ; renvoie l'état fusionné. */
export async function syncPlaylists(userId: string, incoming: readonly SyncPlaylist[]): Promise<SyncPlaylist[]> {
  const rows = await prisma.musicPlaylist.findMany({ where: { userId } })
  const stored: SyncPlaylist[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    tracks: row.deleted ? [] : parseTracks(row.tracks),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deleted: row.deleted,
  }))

  const { merged, changed } = mergePlaylists(stored, incoming, Date.now())
  if (changed.length > 0) {
    await prisma.$transaction(
      changed.map((playlist) => {
        const data = {
          name: playlist.name,
          tracks: JSON.stringify(playlist.tracks),
          createdAt: new Date(playlist.createdAt),
          updatedAt: new Date(playlist.updatedAt),
          deleted: playlist.deleted,
        }
        return prisma.musicPlaylist.upsert({
          where: { userId_id: { userId, id: playlist.id } },
          create: { userId, id: playlist.id, ...data },
          update: data,
        })
      }),
    )
  }
  return merged
}
