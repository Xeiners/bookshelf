import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { HttpError, notFound } from '../../lib/errors.js'
import { createNotification, type RecordRewardData } from '../notifications/notifications.service.js'
import { WELCOME_GIFT_BOXES } from '../runner/runner.wardrobe.js'

/*
 * Records de tous les temps. Quand un joueur bat le meilleur score jamais fait dans un mode
 * (Manga Runner, Bomb Party solo classique ou manga, Plus ou Moins), il gagne une
 * récompense à choisir : un booster de cartes, ou une boîte mystère de la garde-robe (à
 * ouvrir quand il veut). Le premier score d'un mode ne bat aucun record : il en faut un.
 */

export type RecordGame = RecordRewardData['game']
export const REWARD_CHOICES = ['booster', 'box'] as const
export type RewardChoice = (typeof REWARD_CHOICES)[number]

export interface RecordRewardDto {
  id: string
  game: RecordGame
  score: number
  previous: number
  createdAt: string
}

const toDto = (row: { id: string; game: string; score: number; previous: number; createdAt: Date }): RecordRewardDto => ({
  id: row.id,
  game: row.game as RecordGame,
  score: row.score,
  previous: row.previous,
  createdAt: row.createdAt.toISOString(),
})

/**
 * Dans la transaction qui enregistre une partie : si `score` bat le record de tous les
 * temps du mode (`previous`, lu AVANT l'enregistrement), la récompense est créée et le
 * joueur prévenu. Renvoie la récompense, ou `null`.
 */
export async function awardRecord(tx: Prisma.TransactionClient, userId: string, game: RecordGame, score: number, previous: number): Promise<RecordRewardDto | null> {
  if (previous <= 0 || score <= previous) return null
  const row = await tx.recordReward.create({ data: { userId, game, score, previous } })
  await createNotification(tx, userId, 'record_reward', { rewardId: row.id, game, score, previous })
  return toDto(row)
}

/** Records de tous les temps de chaque mode, lus dans la transaction (avant l'enregistrement). */
export const recordOf = {
  runner: async (tx: Prisma.TransactionClient) => (await tx.runnerStats.aggregate({ _max: { best: true } }))._max.best ?? 0,
  bomb_classic: async (tx: Prisma.TransactionClient) => (await tx.bombStats.aggregate({ _max: { bestClassic: true } }))._max.bestClassic ?? 0,
  bomb_manga: async (tx: Prisma.TransactionClient) => (await tx.bombStats.aggregate({ _max: { bestManga: true } }))._max.bestManga ?? 0,
  higher_lower: async (tx: Prisma.TransactionClient) => (await tx.higherLowerStats.aggregate({ _max: { best: true } }))._max.best ?? 0,
} satisfies Record<RecordGame, (tx: Prisma.TransactionClient) => Promise<number>>

/** Récompenses encore à choisir. */
export async function pendingRewards(userId: string): Promise<RecordRewardDto[]> {
  const rows = await prisma.recordReward.findMany({ where: { userId, claimedAt: null }, orderBy: { createdAt: 'asc' } })
  return rows.map(toDto)
}

/**
 * Choisit sa récompense : un booster (réserve, hors plafond) ou une boîte mystère (à ouvrir
 * dans la garde-robe). Une seule fois : 409 `reward_claimed` ensuite, 404 si elle n'est pas
 * la sienne.
 */
export async function claimReward(userId: string, id: string, choice: RewardChoice, now = new Date()): Promise<{ choice: RewardChoice; pending: RecordRewardDto[] }> {
  const row = await prisma.recordReward.findUnique({ where: { id } })
  if (!row || row.userId !== userId) throw notFound('Récompense introuvable.')
  // Ligne des statistiques du Runner créée hors transaction (PostgreSQL), pour la boîte.
  if (choice === 'box') await prisma.runnerStats.upsert({ where: { userId }, create: { userId }, update: {} }).catch(() => undefined)
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.recordReward.updateMany({ where: { id, userId, claimedAt: null }, data: { claimedAt: now, choice } })
    if (count === 0) throw new HttpError(409, 'reward_claimed', 'Récompense déjà choisie.')
    if (choice === 'booster') await tx.userBooster.upsert({ where: { userId }, create: { userId, giftedBoosters: 1 }, update: { giftedBoosters: { increment: 1 } } })
    else await tx.runnerStats.upsert({ where: { userId }, create: { userId, giftBoxes: WELCOME_GIFT_BOXES + 1 }, update: { giftBoxes: { increment: 1 } } })
  })
  return { choice, pending: await pendingRewards(userId) }
}
