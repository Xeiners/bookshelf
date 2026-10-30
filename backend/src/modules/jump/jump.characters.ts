import { prisma } from '../../core/db.js'
import { HttpError, conflict, notFound, unauthorized } from '../../core/http/errors.js'
import { isGuestId } from '../dle/dle.guests.js'

/*
 * Page Jump : les personnages. La Lune est offerte à tous ; les autres s'achètent en Poussières ✦,
 * une fois pour toutes, puis se choisissent librement. Le catalogue (identifiants et prix) est
 * repris par le front (`frontend/src/lib/jump/characters.ts`), qui les dessine ; le serveur fait
 * foi pour les prix. Un invité joue avec la Lune : acheter demande un compte.
 */

export const JUMP_CHARACTERS = [
  { id: 'moon', price: 0 },
  { id: 'pakkun', price: 400 },
  { id: 'saitama', price: 400 },
  { id: 'pikachu', price: 600 },
  { id: 'chopper', price: 600 },
  { id: 'anya', price: 800 },
  { id: 'nezuko', price: 800 },
  { id: 'naruto', price: 1200 },
  { id: 'luffy', price: 1200 },
  { id: 'goku', price: 1800 },
  { id: 'pochita', price: 600 },
  { id: 'deku', price: 800 },
  { id: 'killua', price: 800 },
  { id: 'zenitsu', price: 800 },
  { id: 'tanjiro', price: 1000 },
  { id: 'itadori', price: 1200 },
  { id: 'kakashi', price: 1500 },
  { id: 'zoro', price: 1500 },
  { id: 'gojo', price: 2500 },
] as const

export type JumpCharacterId = (typeof JUMP_CHARACTERS)[number]['id']
export const DEFAULT_CHARACTER: JumpCharacterId = 'moon'

const priceOf = (id: string): number | null => JUMP_CHARACTERS.find((character) => character.id === id)?.price ?? null

export interface CharactersView {
  /** Personnages possédés (la Lune comprise). */
  owned: string[]
  selected: string
}

/** Ce que possède un joueur, et son choix (un invité : la Lune). */
export async function charactersOf(userId: string): Promise<CharactersView> {
  if (isGuestId(userId)) return { owned: [DEFAULT_CHARACTER], selected: DEFAULT_CHARACTER }
  const [rows, stats] = await Promise.all([
    prisma.jumpCharacter.findMany({ where: { userId }, select: { characterId: true } }),
    prisma.jumpStats.findUnique({ where: { userId }, select: { character: true } }),
  ])
  const owned = [DEFAULT_CHARACTER, ...rows.map((row) => row.characterId).filter((id) => priceOf(id) !== null && id !== DEFAULT_CHARACTER)]
  const selected = stats && owned.includes(stats.character) ? stats.character : DEFAULT_CHARACTER
  return { owned, selected }
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002'

/**
 * Achète un personnage et le choisit aussitôt. 404 s'il n'existe pas ; 409 `character_owned` s'il
 * est déjà à soi ; 409 `not_enough_stardust` si le solde ne suffit pas (débit atomique : deux
 * achats simultanés ne dépensent jamais deux fois).
 */
export async function buyCharacter(userId: string, id: string): Promise<CharactersView & { balance: number }> {
  if (isGuestId(userId)) throw unauthorized('Un compte est nécessaire pour acheter un personnage.')
  const price = priceOf(id)
  if (price === null) throw notFound('Personnage inconnu.')
  if (price === 0) throw conflict('Ce personnage est déjà à toi.', 'character_owned')
  let balance = 0
  try {
    await prisma.$transaction(async (tx) => {
      await tx.jumpCharacter.create({ data: { userId, characterId: id } })
      const { count } = await tx.user.updateMany({ where: { id: userId, stardust: { gte: price } }, data: { stardust: { decrement: price } } })
      if (count === 0) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { stardust: true } })
        throw new HttpError(409, 'not_enough_stardust', 'Pas assez de Poussières d’Étoile.', { balance: user?.stardust ?? 0, price })
      }
      await tx.stardustEntry.create({ data: { userId, amount: -price, reason: 'jump_character', data: JSON.stringify({ character: id }) } })
      await tx.jumpStats.upsert({ where: { userId }, create: { userId, character: id }, update: { character: id } })
      balance = (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { stardust: true } })).stardust
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Ce personnage est déjà à toi.', 'character_owned')
    throw error
  }
  return { ...(await charactersOf(userId)), balance }
}

/** Choisit un personnage possédé. 404 s'il n'existe pas ou n'est pas à soi. */
export async function selectCharacter(userId: string, id: string): Promise<CharactersView> {
  if (isGuestId(userId)) throw unauthorized('Un compte est nécessaire pour choisir un personnage.')
  const view = await charactersOf(userId)
  if (!view.owned.includes(id)) throw notFound('Personnage non débloqué.')
  await prisma.jumpStats.upsert({ where: { userId }, create: { userId, character: id }, update: { character: id } })
  return { ...view, selected: id }
}
