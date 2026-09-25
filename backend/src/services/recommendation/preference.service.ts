import { prisma } from '../../db.js'
import type { Book } from '../../modules/books/book.schema.js'
import { featuresFromBook, findWork, getPool } from '../catalog.service.js'
import {
  LIKE_DELTA,
  SKIP_DELTA,
  accumulateFeedback,
  applyFeedback,
  emptyProfile,
  likeWeight,
  type TasteProfile,
  type WorkFeatures,
} from './scoring.js'

/*
 * Profil de goûts (`UserPreference`) : lu à chaque deck, écrit à chaque swipe.
 *
 * Les mises à jour sont « au mieux » : une erreur ici est journalisée mais ne
 * fait jamais échouer le swipe lui-même — la bibliothèque prime sur le profil.
 */

export type Feedback = 'like' | 'skip'

const DELTA: Record<Feedback, number> = { like: LIKE_DELTA, skip: SKIP_DELTA }

function parseProfile(raw: string): TasteProfile {
  try {
    const parsed = JSON.parse(raw) as Partial<TasteProfile>
    return { genres: parsed.genres ?? {}, tags: parsed.tags ?? {} }
  } catch {
    return emptyProfile()
  }
}

export async function getProfile(userId: string): Promise<TasteProfile> {
  const row = await prisma.userPreference.findUnique({ where: { userId }, select: { scores: true } })
  return row ? parseProfile(row.scores) : emptyProfile()
}

/** Caractéristiques d'une œuvre : catalogue d'abord, sinon ses libellés. */
async function featuresOf(workId: string, book?: Pick<Book, 'categories' | 'rating'>): Promise<WorkFeatures | null> {
  const work = await findWork(workId)
  if (work) return work.features
  return book ? featuresFromBook(book) : null
}

/** Ajoute `delta` au profil pour une œuvre ; `swipes` compte les œuvres prises en compte. */
async function applyDelta(
  userId: string,
  workId: string,
  delta: number,
  swipeChange: number,
  book?: Pick<Book, 'categories' | 'rating'>,
): Promise<void> {
  try {
    if (delta === 0 && swipeChange === 0) return
    const features = await featuresOf(workId, book)
    if (!features) return
    const row = await prisma.userPreference.findUnique({ where: { userId } })
    const next = applyFeedback(row ? parseProfile(row.scores) : emptyProfile(), features, delta)
    const swipes = Math.max(0, (row?.swipes ?? 0) + swipeChange)
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, scores: JSON.stringify(next), swipes },
      update: { scores: JSON.stringify(next), swipes },
    })
  } catch (error) {
    console.warn('[préférences] mise à jour ignorée :', error)
  }
}

/**
 * Applique un swipe au profil. `sign = -1` l'annule (bouton « Retour »,
 * suppression) : le profil revient exactement où il était. `weight` : poids
 * d'un « j'aime » déjà favori ou noté (cf. `likeWeight`), à retirer en entier.
 */
export async function recordFeedback(
  userId: string,
  workId: string,
  feedback: Feedback,
  options: { book?: Pick<Book, 'categories' | 'rating'>; sign?: 1 | -1; weight?: number } = {},
): Promise<void> {
  const sign = options.sign ?? 1
  const base = feedback === 'like' ? (options.weight ?? DELTA.like) : DELTA.skip
  await applyDelta(userId, workId, sign * base, sign, options.book)
}

/**
 * Favori ou note modifiés : seul l'écart de poids est appliqué (passer de 3★ à
 * 5★ ajoute +4, retirer un favori retire 2). Le nombre de swipes ne bouge pas.
 */
export async function recordReappraisal(
  userId: string,
  workId: string,
  before: { favorite?: boolean; userRating?: number | null },
  after: { favorite?: boolean; userRating?: number | null },
  book?: Pick<Book, 'categories' | 'rating'>,
): Promise<void> {
  await applyDelta(userId, workId, likeWeight(after) - likeWeight(before), 0, book)
}

export interface LikedItem {
  id: string
  book?: Pick<Book, 'categories' | 'rating'>
  favorite?: boolean
  userRating?: number | null
}

export interface History {
  liked: Iterable<LikedItem>
  skipped: Iterable<string>
}

/** Profil recalculé depuis tout un historique (invité, ou fusion de comptes). */
export async function profileFromHistory(history: History): Promise<{ profile: TasteProfile; swipes: number }> {
  const { byId } = await getPool()
  // Profil neuf, modifié en place : linéaire en la taille de l'historique.
  const profile = emptyProfile()
  let swipes = 0

  for (const item of history.liked) {
    const features = byId.get(item.id)?.features ?? (item.book ? featuresFromBook(item.book) : null)
    if (!features) continue
    accumulateFeedback(profile, features, likeWeight(item))
    swipes += 1
  }
  for (const id of history.skipped) {
    const features = byId.get(id)?.features
    if (!features) continue
    accumulateFeedback(profile, features, SKIP_DELTA)
    swipes += 1
  }
  return { profile, swipes }
}

/** Reconstruit le profil d'un compte depuis sa bibliothèque et ses skips (après une fusion invité). */
export async function rebuildProfile(userId: string): Promise<void> {
  try {
    const [entries, skips] = await Promise.all([
      prisma.libraryEntry.findMany({
        where: { userId },
        select: { workId: true, snapshot: true, favorite: true, userRating: true },
      }),
      prisma.skippedWork.findMany({ where: { userId }, select: { workId: true } }),
    ])
    const liked = entries.map((entry) => {
      let book: Pick<Book, 'categories' | 'rating'> | undefined
      try {
        const parsed = JSON.parse(entry.snapshot) as Partial<Book>
        book = { categories: parsed.categories ?? [], rating: parsed.rating ?? null }
      } catch {
        book = undefined
      }
      return { id: entry.workId, book, favorite: entry.favorite, userRating: entry.userRating }
    })
    const { profile, swipes } = await profileFromHistory({ liked, skipped: skips.map((skip) => skip.workId) })
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, scores: JSON.stringify(profile), swipes },
      update: { scores: JSON.stringify(profile), swipes },
    })
  } catch (error) {
    console.warn('[préférences] reconstruction ignorée :', error)
  }
}

/** Ids déjà vus par un compte : bibliothèque ET swipes « Passer ». */
export async function seenIds(userId: string): Promise<Set<string>> {
  const [entries, skips] = await Promise.all([
    prisma.libraryEntry.findMany({ where: { userId }, select: { workId: true } }),
    prisma.skippedWork.findMany({ where: { userId }, select: { workId: true } }),
  ])
  return new Set([...entries.map((entry) => entry.workId), ...skips.map((skip) => skip.workId)])
}
