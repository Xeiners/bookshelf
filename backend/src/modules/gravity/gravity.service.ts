import { prisma } from '../../core/db.js'
import { HttpError, notFound } from '../../core/http/errors.js'
import type { Admin } from '../admin/admin.service.js'
import { BUILTIN_LEVELS } from './gravity.levels.js'
import { LevelSchema, type GravityLevelData, type GravityRun } from './gravity.schema.js'
import { aiProviders, type AiProvider } from './gravity.ai.js'
import { claimGravityRewards, type GravityRewardDto } from './gravity.rewards.js'
import { boosterStatus, type BoosterStatus } from '../cards/cards.service.js'

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
  /** Longueur (unités) et rouleaux : de quoi décrire le niveau dans la liste. */
  length: number
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
  /** IA branchées pour écrire des plans (une clé par IA) ; vide : génération par IA indisponible. */
  ai: AiProvider[]
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
    ai: aiProviders(),
  }
}

/** Un niveau complet, prêt à jouer. */
export async function gravityLevel(id: string): Promise<GravityLevelData> {
  await seedGravityLevels()
  const row = await prisma.gravityLevel.findUnique({ where: { id } })
  if (!row) throw notFound('Niveau introuvable.')
  return LevelSchema.parse(JSON.parse(row.data))
}

/** Départ du ninja (`START_X` côté jeu). */
const START_X = 4
/**
 * Une réussite ne peut pas être plus rapide que la course pure, du départ à l'arrivée (le ninja
 * court à vitesse fixe) ; la marge couvre les plateformes mobiles qui le portent un peu plus vite.
 */
const MIN_TIME_FACTOR = 0.9

export interface GravityRunOutcome {
  progress: GravityProgressDto
  /** Ce que la partie rapporte (niveaux intégrés, une fois chacun) ; `null` : rien. */
  reward: GravityRewardDto | null
  /** Nouveau solde de Poussières d'Étoile, et réserve de boosters, s'ils ont changé. */
  stardust: number | null
  boosters: BoosterStatus | null
}

/** Une partie jouée : la progression ne garde que le meilleur ; une réussite peut rapporter (cf. `gravity.rewards.ts`). */
export async function recordGravityRun(userId: string, levelId: string, run: GravityRun, now = new Date()): Promise<GravityRunOutcome> {
  const level = await prisma.gravityLevel.findUnique({ where: { id: levelId }, select: { id: true, builtin: true, difficulty: true, data: true } })
  if (!level) throw notFound('Niveau introuvable.')
  const shape = JSON.parse(level.data) as GravityLevelData
  const finished = run.completed
  if (finished && run.timeMs < ((shape.length - START_X) / shape.speed) * 1000 * MIN_TIME_FACTOR) {
    throw new HttpError(400, 'gravity_implausible', 'Partie invraisemblable.')
  }
  const scrollTotal = shape.elements.filter((element) => element.type === 'scroll').length
  const key = { userId_levelId: { userId, levelId } }
  // La ligne existe avant la transaction : les récompenses s'y réclament par mise à jour conditionnelle.
  await prisma.gravityProgress.upsert({ where: key, create: { userId, levelId }, update: {} })
  const better = (value: number | null, next: number) => (value === null ? next : Math.min(value, next))
  const { row, claimed } = await prisma.$transaction(async (tx) => {
    const current = (await tx.gravityProgress.findUnique({ where: key }))!
    const claimed = finished ? await claimGravityRewards(tx, userId, level, run, scrollTotal) : null
    const data = {
      bestPercent: Math.max(current.bestPercent, finished ? 100 : run.percent),
      completed: current.completed || finished,
      bestTimeMs: finished ? better(current.bestTimeMs, run.timeMs) : current.bestTimeMs,
      fewestDeaths: finished ? better(current.fewestDeaths, run.deaths) : current.fewestDeaths,
      scrolls: finished ? Math.max(current.scrolls, run.scrolls) : current.scrolls,
      attempts: current.attempts + 1,
    }
    return { row: await tx.gravityProgress.update({ where: key, data }), claimed }
  })
  const reward = claimed?.reward ?? null
  return {
    progress: progressOf(row),
    reward,
    stardust: claimed?.balance ?? null,
    boosters: reward && reward.boosters + reward.legendaryPacks > 0 ? await boosterStatus(userId, now) : null,
  }
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
