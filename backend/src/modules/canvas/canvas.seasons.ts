import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../core/config.js'
import { prisma } from '../../core/db.js'
import { notFound } from '../../core/http/errors.js'
import { createNotification } from '../notifications/notifications.service.js'
import { creditStardust } from '../stardust/stardust.service.js'
import { SEASON_PODIUM } from './canvas.constants.js'
import { loadOccupancy, renderOverview, resetTiles } from './realtime/canvas.tiles.js'
import { fromRow, monthKey, world } from './realtime/canvas.world.js'

/*
 * Saisons de la toile : une par mois (UTC). Au changement de mois, la toile en cours est close
 * — ses objets restent consultables (galerie, time-lapse), une image d'ensemble en est tirée —
 * et une toile vierge s'ouvre. Les trois cadres les plus aimés reçoivent des Poussières.
 */

export interface SeasonStats {
  objects: number
  artists: number
  frames: number
  likes: number
  podium: { frameId: string; title: string; ownerId: string; likes: number }[]
}

export interface SeasonDto {
  id: string
  key: string
  startedAt: string
  endedAt: string | null
  current: boolean
  hasArchive: boolean
  stats: SeasonStats | null
}

const parseStats = (json: string): SeasonStats | null => {
  try {
    const value = JSON.parse(json) as Partial<SeasonStats>
    return typeof value.objects === 'number' ? (value as SeasonStats) : null
  } catch {
    return null
  }
}

export async function listSeasons(): Promise<SeasonDto[]> {
  const rows = await prisma.canvasSeason.findMany({ orderBy: { startedAt: 'desc' }, take: 36 })
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    current: row.id === world.seasonId,
    hasArchive: row.archive !== null,
    stats: parseStats(row.stats),
  }))
}

export async function seasonStats(seasonId: string): Promise<SeasonStats> {
  const [objects, artists, frames, likes, podium] = await Promise.all([
    prisma.canvasObject.count({ where: { seasonId } }),
    prisma.canvasObject.groupBy({ by: ['ownerId'], where: { seasonId } }).then((groups) => groups.length),
    prisma.canvasObject.count({ where: { seasonId, type: 'f' } }),
    prisma.canvasObject.aggregate({ where: { seasonId }, _sum: { likes: true } }).then((result) => result._sum.likes ?? 0),
    prisma.canvasObject.findMany({ where: { seasonId, type: 'f', hiddenAt: null, likes: { gt: 0 } }, orderBy: [{ likes: 'desc' }, { createdAt: 'asc' }], take: SEASON_PODIUM.length }),
  ])
  return {
    objects,
    artists,
    frames,
    likes,
    podium: podium.map((row) => ({ frameId: row.id, title: String((JSON.parse(row.data) as { tt?: string }).tt ?? ''), ownerId: row.ownerId, likes: row.likes })),
  }
}

/** Clôt une saison : statistiques, podium, image d'ensemble (fabriquée en tâche de fond). */
async function finalizeSeason(finished: { id: string; key: string }): Promise<void> {
  const stats = await seasonStats(finished.id)
  await prisma.$transaction(async (tx) => {
    for (const [index, entry] of stats.podium.entries()) {
      const stardust = SEASON_PODIUM[index]!
      await creditStardust(tx, entry.ownerId, stardust, 'canvas_season', { season: finished.key, rank: index + 1 })
      await createNotification(tx, entry.ownerId, 'canvas_reward', { kind: 'podium', season: finished.key, rank: index + 1, stardust, title: entry.title })
    }
    await tx.canvasSeason.update({ where: { id: finished.id }, data: { endedAt: new Date(), stats: JSON.stringify(stats) } })
  })
  // L'image d'ensemble est longue à fabriquer : la nouvelle saison n'attend pas.
  void archiveSeason(finished.id, finished.key).catch((error) => console.error('[canvas] archive', error))
}

/** Clôt la saison en cours et ouvre celle de `nextKey`. */
export async function closeSeason(nextKey: string): Promise<void> {
  await world.flush()
  const finished = { id: world.seasonId, key: world.seasonKey }
  await finalizeSeason(finished)
  await world.open(nextKey)
  resetTiles()
  await loadOccupancy(world.seasonId)
  world.emit({ type: 'season', key: nextKey })
}

/** Au démarrage : une saison restée ouverte pendant un arrêt à cheval sur deux mois est close. */
export async function finalizeStaleSeasons(): Promise<number> {
  const stale = await prisma.canvasSeason.findMany({ where: { endedAt: null, id: { not: world.seasonId } } })
  for (const season of stale) await finalizeSeason({ id: season.id, key: season.key })
  return stale.length
}

const ARCHIVE_OBJECTS = 40_000

export async function archiveSeason(seasonId: string, key: string): Promise<boolean> {
  const rows = await prisma.canvasObject.findMany({ where: { seasonId, hiddenAt: null }, orderBy: { z: 'asc' }, take: ARCHIVE_OBJECTS })
  const image = await renderOverview(rows.map(fromRow))
  if (!image) return false
  await mkdir(config.canvas.dir, { recursive: true })
  const file = `${key}.png`
  await writeFile(path.join(config.canvas.dir, file), image)
  await prisma.canvasSeason.update({ where: { id: seasonId }, data: { archive: file } })
  return true
}

/** Le mois a changé ? Alors la saison change. Rend `true` si c'est le cas. */
export async function rolloverIfNeeded(now = new Date()): Promise<boolean> {
  const key = monthKey(now)
  if (!world.ready || key <= world.seasonKey) return false
  await closeSeason(key)
  return true
}

export async function seasonArchive(seasonId: string): Promise<string> {
  const season = await prisma.canvasSeason.findUnique({ where: { id: seasonId }, select: { archive: true } })
  if (!season?.archive || !/^\d{4}-\d{2}\.png$/.test(season.archive)) throw notFound('Pas d’archive pour cette saison.')
  return path.join(config.canvas.dir, season.archive)
}

export interface TimelapseItem {
  id: string
  o: string
  t: number
  d: unknown
}

/** Les objets d'une saison dans l'ordre où ils ont été dessinés (par pages, pour le time-lapse). */
export async function timelapse(seasonId: string, after: string | undefined, limit: number): Promise<{ items: TimelapseItem[]; next: string | null }> {
  if (seasonId === world.seasonId) await world.flush()
  const rows = await prisma.canvasObject.findMany({
    where: { seasonId, hiddenAt: null, type: { not: 'f' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: { id: true, ownerId: true, createdAt: true, data: true },
  })
  const page = rows.slice(0, limit)
  return {
    items: page.map((row) => ({ id: row.id, o: row.ownerId, t: row.createdAt.getTime(), d: JSON.parse(row.data) as unknown })),
    next: rows.length > limit ? page[page.length - 1]!.id : null,
  }
}

/** Les cadres de la toile (celle en cours ou une saison passée), les plus aimés d'abord. */
export async function gallery(seasonId: string, userId: string, limit = 30) {
  if (seasonId === world.seasonId) await world.flush()
  const rows = await prisma.canvasObject.findMany({
    where: { seasonId, type: 'f', hiddenAt: null },
    orderBy: [{ likes: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { owner: { select: { id: true, displayName: true, avatarUrl: true } } },
  })
  const liked = new Set((await prisma.canvasLike.findMany({ where: { userId, objectId: { in: rows.map((row) => row.id) } }, select: { objectId: true } })).map((like) => like.objectId))
  return rows.map((row) => {
    const data = JSON.parse(row.data) as { x: number; y: number; w: number; h: number; tt?: string }
    return { id: row.id, title: data.tt ?? '', likes: row.likes, liked: liked.has(row.id), mine: row.ownerId === userId, owner: { id: row.owner.id, name: row.owner.displayName }, x: data.x, y: data.y, w: data.w, h: data.h }
  })
}
