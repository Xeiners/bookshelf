import { prisma } from '../../core/db.js'
import { HttpError, notFound } from '../../core/http/errors.js'
import type { Admin } from '../admin/admin.service.js'
import { BUILTIN_LEVELS } from './gravity.levels.js'
import { LevelSchema, type GravityLevelData, type GravityRun } from './gravity.schema.js'
import { aiAvailable } from './gravity.ai.js'

/*
 * Gravity Ninja : les niveaux (intégrés, semés une fois par démarrage ; ou créés dans l'atelier des
 * admins) et la progression de chacun. Une progression ne baisse jamais : meilleur avancement,
 * niveau fini une fois pour toutes, meilleur temps, le moins de chutes, le plus de rouleaux.
 */

export interface GravityLevelSummary {
  id: string
  name: string
  theme: string
  difficulty: number
  builtin: boolean
  /** Longueur (unités) et nombre de points de reprise : de quoi décrire le niveau dans la liste. */
  length: number
  checkpoints: number
  scrolls: number
}

export interface GravityProgressDto {
  bestPercent: number
  completed: boolean
  bestTimeMs: number | null
  fewestDeaths: number | null
  scrolls: number
  attempts: number
}

export interface GravityOverview {
  levels: GravityLevelSummary[]
  progress: Record<string, GravityProgressDto>
  /** Génération de plans par IA possible (clé de l'API Claude présente). */
  ai: boolean
}

let seeded: Promise<void> | null = null

/** Les niveaux intégrés, (re)semés au premier besoin : nom, thème et contenu suivent le code. */
export function seedGravityLevels(): Promise<void> {
  seeded ??= (async () => {
    for (const [position, raw] of BUILTIN_LEVELS.entries()) {
      const level = LevelSchema.parse(raw)
      const fields = { name: level.name, theme: level.theme, difficulty: level.difficulty, position, data: JSON.stringify(level) }
      await prisma.gravityLevel.upsert({ where: { id: level.id }, create: { id: level.id, builtin: true, ...fields }, update: { builtin: true, ...fields } })
    }
  })().catch((error: unknown) => {
    seeded = null
    throw error
  })
  return seeded
}

const summaryOf = (row: { id: string; name: string; theme: string; difficulty: number; builtin: boolean; data: string }): GravityLevelSummary => {
  const level = JSON.parse(row.data) as GravityLevelData
  return {
    id: row.id,
    name: row.name,
    theme: row.theme,
    difficulty: row.difficulty,
    builtin: row.builtin,
    length: level.length,
    checkpoints: level.elements.filter((element) => element.type === 'checkpoint').length,
    scrolls: level.elements.filter((element) => element.type === 'scroll').length,
  }
}

const progressOf = (row: { bestPercent: number; completed: boolean; bestTimeMs: number | null; fewestDeaths: number | null; scrolls: number; attempts: number }): GravityProgressDto => ({
  bestPercent: row.bestPercent,
  completed: row.completed,
  bestTimeMs: row.bestTimeMs,
  fewestDeaths: row.fewestDeaths,
  scrolls: row.scrolls,
  attempts: row.attempts,
})

/** Les niveaux, dans l'ordre, et ma progression sur chacun. */
export async function gravityOverview(userId: string): Promise<GravityOverview> {
  await seedGravityLevels()
  const [levels, progress] = await Promise.all([
    prisma.gravityLevel.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    prisma.gravityProgress.findMany({ where: { userId } }),
  ])
  return {
    levels: levels.map(summaryOf),
    progress: Object.fromEntries(progress.map((row) => [row.levelId, progressOf(row)])),
    ai: aiAvailable(),
  }
}

/** Un niveau complet, prêt à jouer. */
export async function gravityLevel(id: string): Promise<GravityLevelData> {
  await seedGravityLevels()
  const row = await prisma.gravityLevel.findUnique({ where: { id } })
  if (!row) throw notFound('Niveau introuvable.')
  return LevelSchema.parse(JSON.parse(row.data))
}

/** Une partie jouée : la progression ne garde que le meilleur. */
export async function recordGravityRun(userId: string, levelId: string, run: GravityRun): Promise<GravityProgressDto> {
  const level = await prisma.gravityLevel.findUnique({ where: { id: levelId }, select: { id: true } })
  if (!level) throw notFound('Niveau introuvable.')
  const key = { userId_levelId: { userId, levelId } }
  const current = await prisma.gravityProgress.findUnique({ where: key })
  const finished = run.completed
  const better = (value: number | null, next: number) => (value === null ? next : Math.min(value, next))
  const data = {
    bestPercent: Math.max(current?.bestPercent ?? 0, finished ? 100 : run.percent),
    completed: (current?.completed ?? false) || finished,
    bestTimeMs: finished ? better(current?.bestTimeMs ?? null, run.timeMs) : (current?.bestTimeMs ?? null),
    fewestDeaths: finished ? better(current?.fewestDeaths ?? null, run.deaths) : (current?.fewestDeaths ?? null),
    scrolls: finished ? Math.max(current?.scrolls ?? 0, run.scrolls) : (current?.scrolls ?? 0),
    attempts: (current?.attempts ?? 0) + 1,
  }
  const row = await prisma.gravityProgress.upsert({ where: key, create: { userId, levelId, ...data }, update: data })
  return progressOf(row)
}

/** Enregistre un niveau de l'atelier (nouveau, ou remplace un niveau de l'atelier du même identifiant). */
export async function saveGravityLevel(admin: Admin, input: unknown): Promise<GravityLevelSummary> {
  await seedGravityLevels()
  const level = LevelSchema.parse(input)
  const existing = await prisma.gravityLevel.findUnique({ where: { id: level.id }, select: { builtin: true } })
  if (existing?.builtin) throw new HttpError(409, 'gravity_builtin', 'Un niveau intégré ne se remplace pas : change son identifiant.')
  const last = await prisma.gravityLevel.aggregate({ _max: { position: true } })
  const fields = { name: level.name, theme: level.theme, difficulty: level.difficulty, data: JSON.stringify(level) }
  const row = await prisma.gravityLevel.upsert({
    where: { id: level.id },
    create: { id: level.id, ...fields, position: (last._max.position ?? 0) + 1, createdBy: admin.id },
    update: fields,
  })
  return summaryOf(row)
}

/** Supprime un niveau de l'atelier (et les progressions dessus). Les niveaux intégrés restent. */
export async function deleteGravityLevel(id: string): Promise<void> {
  const row = await prisma.gravityLevel.findUnique({ where: { id }, select: { builtin: true } })
  if (!row) throw notFound('Niveau introuvable.')
  if (row.builtin) throw new HttpError(409, 'gravity_builtin', 'Un niveau intégré ne se supprime pas.')
  await prisma.gravityLevel.delete({ where: { id } })
}
