import { prisma } from '../../db.js'
import { HttpError, notFound, unauthorized } from '../../lib/errors.js'
import { BookSchema } from '../books/book.schema.js'
import { RARITIES, isRarity, type Rarity } from '../cards/boosters.logic.js'
import { toCardDto, type CardDto } from '../cards/cards.service.js'
import { mangadexGet, type MdCollection } from '../manga/mangadex.client.js'
import type { ProfilePatch } from './profile.schemas.js'
import { isUnlocked, titlesFor, type ProfileStats, type TitleId } from './titles.js'

/*
 * Profil d'un compte : présentation (pseudo, bio, titre), avatar et vitrine de
 * cartes, statistiques de collection, de lecture et de boosters. Seules des
 * cartes POSSÉDÉES peuvent être exposées : vérifié à chaque écriture.
 */

/** Carte exposée (avatar, vitrine) : la carte et ses exemplaires. */
export interface ProfileCard extends CardDto {
  count: number
}

export interface Profile {
  profile: {
    id: string
    email: string
    displayName: string | null
    bio: string | null
    activeTitle: TitleId | null
    createdAt: number
    avatarUrl: string | null
    avatar: ProfileCard | null
    featured: ProfileCard[]
  }
  stats: ProfileStats
  titles: { id: TitleId; unlocked: boolean }[]
}

/** Un roman est « terminé » au-delà de ce pourcentage (la dernière page n'atteint pas toujours 100). */
const NOVEL_FINISHED_PERCENT = 98

/** Lecture tolérante de `featuredCardIds` : une valeur corrompue vaut une vitrine vide. */
function parseFeatured(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function profileStats(userId: string): Promise<ProfileStats> {
  const [setByRarity, owned, statuses, chapters, novels, novelsStarted, novelsFinished, user] = await Promise.all([
    prisma.card.groupBy({ by: ['rarity'], _count: { _all: true } }),
    prisma.userCard.findMany({ where: { userId }, select: { count: true, card: { select: { rarity: true } } } }),
    prisma.libraryEntry.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    prisma.libraryEntry.aggregate({ where: { userId }, _sum: { chaptersRead: true } }),
    prisma.userBook.count({ where: { userId } }),
    prisma.userBook.count({ where: { userId, progressPercent: { gt: 0 } } }),
    prisma.userBook.count({ where: { userId, progressPercent: { gte: NOVEL_FINISHED_PERCENT } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { boostersOpened: true } }),
  ])

  const byRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, { total: 0, owned: 0 }])) as Record<
    Rarity,
    { total: number; owned: number }
  >
  for (const group of setByRarity) if (isRarity(group.rarity)) byRarity[group.rarity].total = group._count._all
  for (const entry of owned) if (isRarity(entry.card.rarity)) byRarity[entry.card.rarity].owned += 1

  const byStatus = (status: string) => statuses.find((group) => group.status === status)?._count._all ?? 0
  const reading = byStatus('reading')
  const read = byStatus('read')
  const consulted = reading + read + novelsStarted
  const finished = read + novelsFinished

  return {
    collection: {
      total: setByRarity.reduce((sum, group) => sum + group._count._all, 0),
      owned: owned.length,
      copies: owned.reduce((sum, entry) => sum + entry.count, 0),
      byRarity,
    },
    reading: {
      wishlist: byStatus('wishlist'),
      reading,
      read,
      chaptersRead: chapters._sum.chaptersRead ?? 0,
      novels,
      novelsFinished,
      consulted,
      completion: consulted > 0 ? Math.round((Math.min(finished, consulted) / consulted) * 1000) / 1000 : 0,
    },
    gacha: { boostersOpened: user?.boostersOpened ?? 0 },
  }
}

/** Cartes possédées parmi `cardIds`, avec leur fiche, indexées par id. */
async function ownedCards(userId: string, cardIds: readonly string[]): Promise<Map<string, ProfileCard>> {
  if (cardIds.length === 0) return new Map()
  const rows = await prisma.userCard.findMany({
    where: { userId, cardId: { in: [...cardIds] } },
    select: { count: true, card: true },
  })
  return new Map(rows.map((row) => [row.card.id, { ...toCardDto(row.card), count: row.count }]))
}

export async function getProfile(userId: string): Promise<Profile> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw unauthorized()

  const featuredIds = parseFeatured(user.featuredCardIds)
  const [stats, cards] = await Promise.all([
    profileStats(userId),
    ownedCards(userId, [...featuredIds, ...(user.avatarCardId ? [user.avatarCardId] : [])]),
  ])
  const titles = titlesFor(stats)
  const activeTitle = titles.find((title) => title.id === user.activeTitle && title.unlocked)?.id ?? null

  return {
    profile: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      bio: user.bio,
      activeTitle,
      createdAt: user.createdAt.getTime(),
      avatarUrl: user.avatarUrl,
      // Par prudence, une carte qui ne serait plus possédée n'est pas exposée.
      avatar: (user.avatarCardId && cards.get(user.avatarCardId)) || null,
      featured: featuredIds.flatMap((id) => cards.get(id) ?? []),
    },
    stats,
    titles,
  }
}

/**
 * Mise à jour du profil. Toute carte citée (avatar, vitrine) doit être
 * possédée par le compte : sinon 400 `card_not_owned`, et rien n'est écrit.
 * Un titre pas encore débloqué est refusé (400 `title_locked`).
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
  const cited = [...(patch.featuredCardIds ?? []), ...(patch.avatarCardId ? [patch.avatarCardId] : [])]
  const owned = await ownedCards(userId, cited)
  const missing = [...new Set(cited.filter((id) => !owned.has(id)))]
  if (missing.length > 0) {
    throw new HttpError(400, 'card_not_owned', 'Seules les cartes de ta collection peuvent être exposées.', {
      cardIds: missing,
    })
  }

  if (patch.activeTitle && !isUnlocked(patch.activeTitle, await profileStats(userId))) {
    throw new HttpError(400, 'title_locked', 'Ce titre n’est pas encore débloqué.')
  }

  const data = {
    ...(patch.displayName !== undefined && { displayName: patch.displayName }),
    ...(patch.bio !== undefined && { bio: patch.bio }),
    ...(patch.avatarCardId !== undefined && {
      avatarCardId: patch.avatarCardId,
      ...(patch.avatarCardId !== null && { avatarUrl: null }),
    }),
    ...(patch.avatarUrl !== undefined && {
      avatarUrl: patch.avatarUrl,
      ...(patch.avatarUrl !== null && { avatarCardId: null }),
    }),
    ...(patch.featuredCardIds !== undefined && { featuredCardIds: JSON.stringify(patch.featuredCardIds) }),
    ...(patch.activeTitle !== undefined && { activeTitle: patch.activeTitle }),
  }
  // `updateMany` : un compte supprimé entre-temps donne 0 ligne, pas une exception.
  const { count } = await prisma.user.updateMany({ where: { id: userId }, data })
  if (count === 0) throw unauthorized()
  return getProfile(userId)
}

export interface AvatarOption {
  url: string
  label: string
  source: 'cover' | 'volume' | 'card'
}

interface MdCover {
  id: string
  attributes: { fileName: string; volume?: string | null }
}

const MANGADEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPEN_LIBRARY_ID = /^ol:(OL\d+W)$/i

const uniqueOptions = (options: AvatarOption[]) =>
  [...new Map(options.map((option) => [option.url, option])).values()].slice(0, 40)

async function mangadexCovers(workId: string): Promise<AvatarOption[]> {
  if (!MANGADEX_ID.test(workId)) return []
  try {
    const response = await mangadexGet<MdCollection<MdCover>>('/cover', {
      manga: [workId],
      limit: 40,
      'order[volume]': 'asc',
    })
    return response.data.map((cover) => ({
      url: `/api/covers/${workId}/${cover.attributes.fileName}?size=512`,
      label: cover.attributes.volume ? `Volume ${cover.attributes.volume}` : 'Couverture alternative',
      source: 'volume' as const,
    }))
  } catch {
    return []
  }
}

async function openLibraryCovers(workId: string): Promise<AvatarOption[]> {
  const id = OPEN_LIBRARY_ID.exec(workId)?.[1]
  if (!id) return []
  try {
    const response = await fetch(`https://openlibrary.org/works/${id}/editions.json?limit=40`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) return []
    const payload = (await response.json()) as { entries?: { title?: string; covers?: number[] }[] }
    return (payload.entries ?? []).flatMap((edition): AvatarOption[] => {
      const cover = edition.covers?.find((value) => Number.isInteger(value) && value > 0)
      return cover
        ? [{ url: `https://covers.openlibrary.org/b/id/${cover}-L.jpg`, label: edition.title?.trim() || 'Édition', source: 'volume' }]
        : []
    })
  } catch {
    return []
  }
}

/** Images disponibles pour une œuvre qui appartient réellement à la bibliothèque du compte. */
export async function avatarOptions(
  userId: string,
  input: { kind: 'library' | 'book'; workId: string },
): Promise<{ title: string; options: AvatarOption[] }> {
  if (input.kind === 'book') {
    const book = await prisma.userBook.findFirst({ where: { id: input.workId, userId } })
    if (!book) throw notFound('Livre absent de ta bibliothèque.')
    const url = book.coverUrl ?? (book.coverPath ? `/api/books/${book.id}/cover?v=${book.sha256.slice(0, 12)}` : null)
    return { title: book.title, options: url ? [{ url, label: 'Couverture principale', source: 'cover' }] : [] }
  }

  const entry = await prisma.libraryEntry.findUnique({ where: { userId_workId: { userId, workId: input.workId } } })
  if (!entry) throw notFound('Œuvre absente de ta bibliothèque.')
  let cover: string | null = null
  try {
    const snapshot = BookSchema.safeParse(JSON.parse(entry.snapshot) as unknown)
    if (snapshot.success) cover = snapshot.data.cover
  } catch {
    // Ancien instantané illisible : les cartes associées restent proposées.
  }

  const cards = await prisma.userCard.findMany({
    where: { userId, card: { mangaId: input.workId } },
    select: { card: { select: { imageUrl: true, title: true } } },
  })
  const options: AvatarOption[] = [
    ...(cover ? [{ url: cover, label: 'Couverture principale', source: 'cover' as const }] : []),
    ...cards.map(({ card }) => ({ url: card.imageUrl, label: card.title, source: 'card' as const })),
    ...(await Promise.all([mangadexCovers(input.workId), openLibraryCovers(input.workId)])).flat(),
  ]
  return { title: entry.title, options: uniqueOptions(options) }
}
