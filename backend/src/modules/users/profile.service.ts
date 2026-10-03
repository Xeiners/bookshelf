import { prisma } from '../../db.js'
import { config } from '../../config.js'
import { bestTitleMatch } from '../../extensions/titleMatch.js'
import { TtlCache } from '../../lib/cache.js'
import { HttpError, notFound, unauthorized } from '../../lib/errors.js'
import { RARITIES, isRarity, type Rarity } from '../cards/boosters.logic.js'
import { toCardDto, type CardDto } from '../cards/cards.service.js'
import { booksFor, findWork } from '../../services/catalog.service.js'
import { photoOwner, withPublicPhoto } from './avatarUpload.js'
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

export interface ProfileWork {
  id: string
  title: string
  cover: string | null
  kind: 'library' | 'book'
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
    recentReads: ProfileWork[]
    /** Profil visible en entier par les autres (`GET /api/users/:id`). */
    isProfilePublic: boolean
  }
  stats: ProfileStats
  titles: { id: TitleId; unlocked: boolean }[]
}

/** Un roman est « terminé » au-delà de ce pourcentage (la dernière page n'atteint pas toujours 100). */
const NOVEL_FINISHED_PERCENT = 98

/** Lecture tolérante de `featuredCardIds` : une valeur corrompue vaut une vitrine vide. */
export function parseFeatured(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function profileStats(userId: string): Promise<ProfileStats> {
  const [setByRarity, owned, statuses, chapters, novels, novelsStarted, novelsFinished, user, dle] = await Promise.all([
    prisma.card.groupBy({ by: ['rarity'], _count: { _all: true } }),
    prisma.userCard.findMany({ where: { userId }, select: { count: true, card: { select: { rarity: true } } } }),
    prisma.libraryEntry.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    prisma.libraryEntry.aggregate({ where: { userId }, _sum: { chaptersRead: true } }),
    prisma.userBook.count({ where: { userId } }),
    // Un roman rattaché à une fiche compte déjà par sa fiche (en cours, lu) : seuls les autres s'ajoutent.
    prisma.userBook.count({ where: { userId, workId: null, progressPercent: { gt: 0 } } }),
    prisma.userBook.count({ where: { userId, workId: null, progressPercent: { gte: NOVEL_FINISHED_PERCENT } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { boostersOpened: true } }),
    prisma.dleStats.findUnique({ where: { userId }, select: { dailySolved: true, roomsWon: true } }),
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
    dle: { dailySolved: dle?.dailySolved ?? 0, roomsWon: dle?.roomsWon ?? 0 },
  }
}

/** Cartes possédées parmi `cardIds`, avec leur fiche, indexées par id. */
export async function ownedCards(userId: string, cardIds: readonly string[]): Promise<Map<string, ProfileCard>> {
  if (cardIds.length === 0) return new Map()
  const rows = await prisma.userCard.findMany({
    where: { userId, cardId: { in: [...cardIds] } },
    select: { count: true, card: true },
  })
  return new Map(rows.map((row) => [row.card.id, { ...toCardDto(row.card), count: row.count }]))
}

function snapshotCover(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('cover' in value)) return null
    return typeof value.cover === 'string' ? value.cover : null
  } catch {
    return null
  }
}

/** Trois dernières œuvres réellement entamées, utilisées tant que la vitrine n'est pas personnalisée. */
async function recentReads(userId: string): Promise<ProfileWork[]> {
  const [library, books] = await Promise.all([
    prisma.libraryEntry.findMany({
      where: { userId, status: { in: ['reading', 'read'] } },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { workId: true, title: true, snapshot: true, updatedAt: true },
    }),
    prisma.userBook.findMany({
      // Rattachés à une fiche : déjà présents parmi les entrées de la bibliothèque.
      where: { userId, workId: null, progressPercent: { gt: 0 } },
      orderBy: { progressAt: 'desc' },
      take: 6,
      select: { id: true, title: true, coverUrl: true, coverPath: true, sha256: true, progressAt: true, updatedAt: true },
    }),
  ])

  return [
    ...library.map((entry) => ({
      at: entry.updatedAt.getTime(),
      work: { id: entry.workId, title: entry.title, cover: snapshotCover(entry.snapshot), kind: 'library' as const },
    })),
    ...books.map((book) => ({
      at: (book.progressAt ?? book.updatedAt).getTime(),
      work: {
        id: book.id,
        title: book.title,
        cover: book.coverUrl ?? (book.coverPath ? `/api/books/${book.id}/cover?v=${book.sha256.slice(0, 12)}` : null),
        kind: 'book' as const,
      },
    })),
  ].sort((a, b) => b.at - a.at).slice(0, 3).map(({ work }) => work)
}

export async function getProfile(userId: string): Promise<Profile> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw unauthorized()

  const featuredIds = parseFeatured(user.featuredCardIds)
  const [stats, cards, automaticReads] = await Promise.all([
    profileStats(userId),
    ownedCards(userId, [...featuredIds, ...(user.avatarCardId ? [user.avatarCardId] : [])]),
    recentReads(userId),
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
      recentReads: automaticReads,
      isProfilePublic: user.isProfilePublic,
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

  // Photo importée : seulement la sienne (l'adresse d'un autre compte ferait porter sa photo).
  const avatarUrl = patch.avatarUrl ? withPublicPhoto(userId, patch.avatarUrl) : patch.avatarUrl
  const owner = photoOwner(avatarUrl ?? null)
  if (owner !== null && owner !== userId) throw new HttpError(400, 'avatar_not_owned', 'Utilise ta propre photo.')

  const data = {
    ...(patch.displayName !== undefined && { displayName: patch.displayName }),
    ...(patch.bio !== undefined && { bio: patch.bio }),
    ...(patch.avatarCardId !== undefined && {
      avatarCardId: patch.avatarCardId,
      ...(patch.avatarCardId !== null && { avatarUrl: null }),
    }),
    ...(avatarUrl !== undefined && {
      avatarUrl,
      ...(avatarUrl !== null && { avatarCardId: null }),
    }),
    ...(patch.featuredCardIds !== undefined && { featuredCardIds: JSON.stringify(patch.featuredCardIds) }),
    ...(patch.activeTitle !== undefined && { activeTitle: patch.activeTitle }),
    ...(patch.isProfilePublic !== undefined && { isProfilePublic: patch.isProfilePublic }),
  }
  // `updateMany` : un compte supprimé entre-temps donne 0 ligne, pas une exception.
  const { count } = await prisma.user.updateMany({ where: { id: userId }, data })
  if (count === 0) throw unauthorized()
  return getProfile(userId)
}

export interface AvatarOption {
  url: string
  label: string
  source: 'character' | 'card' | 'cover' | 'volume'
}

const characterCache = new TtlCache<AvatarOption[]>({ maxEntries: 500, ttlMs: 24 * 60 * 60 * 1000 })

const uniqueOptions = (options: AvatarOption[]) =>
  [...new Map(options.map((option) => [option.url, option])).values()].slice(0, 40)

interface AniListMedia {
  title?: { romaji?: string | null; english?: string | null; native?: string | null }
  characters?: {
    edges?: {
      role?: string | null
      node?: { name?: { full?: string | null }; image?: { large?: string | null } }
    }[]
  }
}

/** Portraits officiels indexés par AniList. Toute panne laisse simplement agir le repli local. */
async function anilistCharacters(title: string): Promise<AvatarOption[]> {
  const key = title.trim().toLocaleLowerCase()
  if (!key) return []
  return characterCache.getOrLoad(key, async () => {
    try {
      const query = `
        query ($search: String!) {
          Page(page: 1, perPage: 3) {
            media(search: $search, isAdult: false) {
              title { romaji english native }
              characters(page: 1, perPage: 24) {
                edges { role node { name { full } image { large } } }
              }
            }
          }
        }
      `
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': config.mangadexUserAgent },
        body: JSON.stringify({ query, variables: { search: title } }),
        signal: AbortSignal.timeout(7_000),
      })
      if (!response.ok) return []
      const payload = (await response.json()) as { data?: { Page?: { media?: AniListMedia[] } } }
      const candidates = payload.data?.Page?.media ?? []
      const media = bestTitleMatch(
        candidates,
        [title],
        (candidate) => [candidate.title?.english, candidate.title?.romaji, candidate.title?.native].filter((value): value is string => !!value),
        0.72,
      )?.candidate
      return (media?.characters?.edges ?? [])
        .sort((a, b) => (a.role === 'MAIN' ? -1 : 1) - (b.role === 'MAIN' ? -1 : 1))
        .flatMap((edge): AvatarOption[] => {
          const url = edge.node?.image?.large
          return url ? [{ url, label: edge.node?.name?.full?.trim() || 'Personnage', source: 'character' }] : []
        })
    } catch {
      return []
    }
  }, (options) => options.length > 0 ? 24 * 60 * 60 * 1000 : 30_000)
}

interface KitsuMedia {
  id: string
  attributes: { canonicalTitle?: string | null; titles?: Record<string, string | null> }
}

interface KitsuCharacter {
  id: string
  type: string
  attributes: { name?: string | null; image?: { original?: string | null } | null }
}

const kitsuCharacterCache = new TtlCache<AvatarOption[]>({ maxEntries: 500, ttlMs: 24 * 60 * 60 * 1000 })

async function kitsuMediaCharacters(kind: 'manga' | 'anime', title: string): Promise<AvatarOption[]> {
  const search = new URL(`https://kitsu.io/api/edge/${kind}`)
  search.searchParams.set('filter[text]', title)
  search.searchParams.set('page[limit]', '5')
  const headers = { Accept: 'application/vnd.api+json', 'User-Agent': config.mangadexUserAgent }
  const response = await fetch(search, { headers, signal: AbortSignal.timeout(6_000) })
  if (!response.ok) return []
  const payload = (await response.json()) as { data?: KitsuMedia[] }
  const media = bestTitleMatch(
    payload.data ?? [],
    [title],
    (candidate) => [candidate.attributes.canonicalTitle, ...Object.values(candidate.attributes.titles ?? {})]
      .filter((value): value is string => !!value),
    0.55,
  )?.candidate
  if (!media) return []

  const charactersUrl = new URL(`https://kitsu.io/api/edge/${kind}/${encodeURIComponent(media.id)}/characters`)
  charactersUrl.searchParams.set('include', 'character')
  charactersUrl.searchParams.set('page[limit]', '20')
  const charactersResponse = await fetch(charactersUrl, { headers, signal: AbortSignal.timeout(6_000) })
  if (!charactersResponse.ok) return []
  const characters = (await charactersResponse.json()) as { included?: KitsuCharacter[] }
  return (characters.included ?? []).flatMap((character): AvatarOption[] => {
    if (character.type !== 'characters') return []
    const url = character.attributes.image?.original
    return url ? [{ url, label: character.attributes.name?.trim() || 'Personnage', source: 'character' }] : []
  })
}

/** AniList en source principale, complété par les versions manga et anime de Kitsu. */
async function characterPortraits(title: string): Promise<AvatarOption[]> {
  const key = title.trim().toLocaleLowerCase()
  if (!key) return []
  return kitsuCharacterCache.getOrLoad(key, async () => {
    const [anilist, manga, anime] = await Promise.all([
      anilistCharacters(title),
      kitsuMediaCharacters('manga', title).catch(() => []),
      kitsuMediaCharacters('anime', title).catch(() => []),
    ])
    return uniqueOptions([...anilist, ...manga, ...anime])
  }, (options) => options.length > 0 ? 24 * 60 * 60 * 1000 : 30_000)
}

/** Portraits disponibles pour une œuvre de la bibliothèque ou du catalogue. */
export async function avatarOptions(
  userId: string,
  input: { kind: 'library' | 'book' | 'catalog'; workId: string },
): Promise<{ title: string; options: AvatarOption[] }> {
  if (input.kind === 'catalog') {
    const item = await findWork(input.workId)
    if (!item) throw notFound('Œuvre absente du catalogue.')
    const [entry] = await booksFor([{ item }], 'en')
    if (!entry) throw notFound('Œuvre absente du catalogue.')
    return { title: entry.book.title, options: await characterPortraits(entry.book.title) }
  }

  if (input.kind === 'book') {
    const book = await prisma.userBook.findFirst({ where: { id: input.workId, userId } })
    if (!book) throw notFound('Livre absent de ta bibliothèque.')
    const portraits = await characterPortraits(book.title)
    return {
      title: book.title,
      options: portraits,
    }
  }

  const entry = await prisma.libraryEntry.findUnique({ where: { userId_workId: { userId, workId: input.workId } } })
  if (!entry) throw notFound('Œuvre absente de ta bibliothèque.')
  return { title: entry.title, options: await characterPortraits(entry.title) }
}
