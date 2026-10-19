import { prisma } from '../../db.js'

/*
 * Revue des images d'énigme : ce que l'administrateur a validé ou banni, gardé en mémoire (lu
 * une fois depuis la base, puis tenu à jour à chaque décision) pour que le tirage d'une énigme
 * n'attende jamais la base. Une image bannie n'est plus jamais servie comme énigme.
 */

export type ReviewStatus = 'APPROVED' | 'BANNED'

interface Verdicts {
  banned: Set<string>
  approved: Set<string>
}

/** `category` → `characterId` → verdicts. */
const verdicts = new Map<string, Map<string, Verdicts>>()
let loading: Promise<void> | null = null
let loaded = false

const slot = (category: string, characterId: string): Verdicts => {
  let byCharacter = verdicts.get(category)
  if (!byCharacter) verdicts.set(category, (byCharacter = new Map()))
  let entry = byCharacter.get(characterId)
  if (!entry) byCharacter.set(characterId, (entry = { banned: new Set(), approved: new Set() }))
  return entry
}

/** Lit toutes les revues, une seule fois (les suivantes attendent la même lecture). */
export function reviewsReady(): Promise<void> {
  if (loaded) return Promise.resolve()
  loading ??= prisma.dleImageReview
    .findMany({ select: { category: true, characterId: true, imageKey: true, status: true } })
    .then((rows) => {
      verdicts.clear()
      for (const row of rows) (row.status === 'BANNED' ? slot(row.category, row.characterId).banned : slot(row.category, row.characterId).approved).add(row.imageKey)
      loaded = true
    })
    .finally(() => (loading = null))
  return loading
}

/** L'image est-elle bannie ? Valable une fois `reviewsReady()` résolu. */
export const isBanned = (category: string, characterId: string, key: string): boolean => verdicts.get(category)?.get(characterId)?.banned.has(key) ?? false

export const isReviewed = (category: string, characterId: string, key: string): boolean => {
  const entry = verdicts.get(category)?.get(characterId)
  return Boolean(entry && (entry.banned.has(key) || entry.approved.has(key)))
}

/** Nombre d'images validées et bannies d'un univers. */
export function countsOf(category: string): { approved: number; banned: number } {
  let approved = 0
  let banned = 0
  for (const entry of verdicts.get(category)?.values() ?? []) {
    approved += entry.approved.size
    banned += entry.banned.size
  }
  return { approved, banned }
}

/** Enregistre (ou, `status` nul, efface) la décision sur une image. */
export async function setReview(category: string, characterId: string, key: string, status: ReviewStatus | null, reviewer: string): Promise<void> {
  await reviewsReady()
  if (status === null) {
    await prisma.dleImageReview.deleteMany({ where: { category, characterId, imageKey: key } })
  } else {
    await prisma.dleImageReview.upsert({
      where: { category_characterId_imageKey: { category, characterId, imageKey: key } },
      create: { category, characterId, imageKey: key, status, reviewedBy: reviewer },
      update: { status, reviewedBy: reviewer, reviewedAt: new Date() },
    })
  }
  const entry = slot(category, characterId)
  entry.banned.delete(key)
  entry.approved.delete(key)
  if (status === 'BANNED') entry.banned.add(key)
  if (status === 'APPROVED') entry.approved.add(key)
}

/** Tests : repartir d'une mémoire vide (relue depuis la base au prochain accès). */
export function forgetReviews(): void {
  verdicts.clear()
  loaded = false
  loading = null
}
