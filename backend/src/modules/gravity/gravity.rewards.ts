import type { Prisma } from '../../generated/prisma/client.js'
import { creditStardust } from '../stardust/stardust.service.js'

/*
 * Gravity Ninja : les récompenses des niveaux intégrés (jamais ceux de l'atelier). Chacune ne se
 * gagne qu'une fois :
 *  - première réussite d'un niveau : des Poussières d'Étoile selon son palier ;
 *  - ses trois rouleaux réunis dans une partie finie : un bonus de moitié ;
 *  - tous les niveaux d'un palier finis : un booster offert (palier Extrême : un booster Légendaire).
 * Les paliers suivent ceux du jeu (`tierOf`, `frontend/src/lib/gravity/constants.ts`).
 */

export const GRAVITY_TIERS = ['easy', 'medium', 'hard', 'extreme'] as const
export type GravityTier = (typeof GRAVITY_TIERS)[number]

export const gravityTierOf = (difficulty: number): GravityTier => (difficulty <= 2 ? 'easy' : difficulty <= 5 ? 'medium' : difficulty <= 8 ? 'hard' : 'extreme')

/** Poussières d'Étoile d'une première réussite, par palier ; les trois rouleaux en rapportent la moitié en plus. */
export const CLEAR_STARDUST: Record<GravityTier, number> = { easy: 50, medium: 100, hard: 200, extreme: 350 }
export const scrollsBonus = (tier: GravityTier) => CLEAR_STARDUST[tier] / 2

export interface GravityRewardDto {
  tier: GravityTier
  /** Ce que la partie rapporte : première réussite, bonus des rouleaux (en ✦). */
  clear: number
  scrolls: number
  /** Palier terminé par cette partie : un booster offert, ou un booster Légendaire (Extrême). */
  tierComplete: boolean
  boosters: number
  legendaryPacks: number
}

/**
 * Récompenses d'une partie finie, dans la transaction de son enregistrement. Les réclamations sont
 * atomiques (mise à jour conditionnelle de la progression) : deux envois simultanés de la même
 * réussite ne paient qu'une fois. Renvoie `null` si la partie ne rapporte rien.
 */
export async function claimGravityRewards(
  tx: Prisma.TransactionClient,
  userId: string,
  level: { id: string; builtin: boolean; difficulty: number },
  run: { scrolls: number },
  scrollTotal: number,
): Promise<{ reward: GravityRewardDto; balance: number | null } | null> {
  const where = { userId, levelId: level.id }
  const first = (await tx.gravityProgress.updateMany({ where: { ...where, completed: false }, data: { completed: true } })).count === 1
  const allScrolls = scrollTotal > 0 && run.scrolls >= scrollTotal && (await tx.gravityProgress.updateMany({ where: { ...where, scrolls: { lt: scrollTotal } }, data: { scrolls: scrollTotal } })).count === 1
  if (!level.builtin || (!first && !allScrolls)) return null

  const tier = gravityTierOf(level.difficulty)
  const clear = first ? CLEAR_STARDUST[tier] : 0
  const scrolls = allScrolls ? scrollsBonus(tier) : 0
  const balance = clear + scrolls > 0 ? await creditStardust(tx, userId, clear + scrolls, 'gravity_ninja', { levelId: level.id, first, allScrolls }) : null

  // Le palier : terminé par cette première réussite si tous ses niveaux intégrés sont finis.
  let tierComplete = false
  if (first) {
    const ids = (await tx.gravityLevel.findMany({ where: { builtin: true }, select: { id: true, difficulty: true } })).filter((row) => gravityTierOf(row.difficulty) === tier).map((row) => row.id)
    tierComplete = (await tx.gravityProgress.count({ where: { userId, completed: true, levelId: { in: ids } } })) === ids.length
  }
  const legendaryPacks = tierComplete && tier === 'extreme' ? 1 : 0
  const boosters = tierComplete && tier !== 'extreme' ? 1 : 0
  if (boosters + legendaryPacks > 0) {
    await tx.userBooster.upsert({
      where: { userId },
      create: { userId, giftedBoosters: boosters, legendaryPacks },
      update: { giftedBoosters: { increment: boosters }, legendaryPacks: { increment: legendaryPacks } },
    })
  }
  return { reward: { tier, clear, scrolls, tierComplete, boosters, legendaryPacks }, balance }
}
