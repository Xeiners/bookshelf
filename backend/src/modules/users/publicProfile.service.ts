import { prisma } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'
import type { Book } from '../books/book.schema.js'
import { getMangas } from '../manga/manga.service.js'
import { toCardDto } from '../cards/cards.service.js'
import { ownedCards, parseFeatured, profileStats, type ProfileCard } from './profile.service.js'
import { TITLE_IDS, titlesFor, type ProfileStats, type TitleId } from './titles.js'

const isTitleId = (value: string | null): value is TitleId => value !== null && (TITLE_IDS as readonly string[]).includes(value)

/*
 * Profils des autres comptes, consultables par tous (invités compris), et
 * recherche de membres par pseudo.
 *
 *  - profil public (par défaut) : présentation, vitrine, statistiques de
 *    collection, de lecture et de boosters, lectures en cours et terminées ;
 *  - profil privé (`isProfilePublic = false`) : pseudo, avatar, titre et
 *    vitrine seulement.
 *
 * Jamais d'e-mail, ni de donnée de session. Les fiches des œuvres viennent de
 * MangaDex, côté serveur : jamais de l'instantané `snapshot` envoyé par le
 * client du propriétaire, qu'un autre compte ne doit pas voir tel quel.
 */

/** Œuvres listées par onglet (les plus récemment lues d'abord). */
const LIST_LIMIT = 60
/** Un roman est « terminé » au-delà de ce pourcentage (cf. `profile.service.ts`). */
const NOVEL_FINISHED_PERCENT = 98
const MANGADEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PublicWork {
  /** Id MangaDex (`library`) ou id du roman importé (`novel`). */
  id: string
  kind: 'library' | 'novel'
  title: string
  author: string | null
  cover: string | null
  /** Avancement, de 0 à 1. */
  progress: number
  chaptersRead: number
  updatedAt: number
  /** Fiche de l'œuvre (MangaDex) : ouverture et ajout à sa propre bibliothèque. `null` : roman importé, ou fiche indisponible. */
  book: Book | null
}

export interface PublicProfile {
  profile: {
    id: string
    displayName: string | null
    activeTitle: TitleId | null
    avatarUrl: string | null
    avatar: ProfileCard | null
    featured: ProfileCard[]
    isProfilePublic: boolean
    /** `null` : profil privé. */
    bio: string | null
    /** `null` : profil privé. */
    createdAt: number | null
  }
  /** `null` : profil privé. */
  stats: ProfileStats | null
  /** `null` : profil privé. */
  library: {
    reading: PublicWork[]
    read: PublicWork[]
    /** Totaux réels (les listes sont bornées à `LIST_LIMIT`). */
    readingTotal: number
    readTotal: number
  } | null
  /** Le visiteur regarde son propre profil (aperçu de ce que voient les autres). */
  isSelf: boolean
}

export const userNotFound = () => new HttpError(404, 'user_not_found', 'Profil introuvable.')

/**
 * Avatar visible par les autres : une image HTTPS ou une couverture relayée
 * (`/api/covers/`). La photo importée (`/api/profile/avatar-image`) et les
 * couvertures de romans (`/api/books/`) ne sont servies qu'à leur propriétaire :
 * l'avatar public retombe alors sur la carte, sinon l'initiale.
 */
export function publicAvatarUrl(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('/api/')) return url.startsWith('/api/covers/') ? url : null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Couverture de roman montrable à un autre compte : seulement une image HTTPS externe. */
const publicNovelCover = (url: string | null) => (url && url.startsWith('https://') ? url : null)

/** Fiches MangaDex des œuvres citées ; une panne de MangaDex laisse simplement les titres seuls. */
async function mangadexBooks(ids: readonly string[], language: Language): Promise<Map<string, Book>> {
  const valid = [...new Set(ids.filter((id) => MANGADEX_ID.test(id)))]
  if (valid.length === 0) return new Map()
  try {
    const books = await getMangas(valid, language)
    return new Map(books.map((book) => [book.id, book]))
  } catch {
    return new Map()
  }
}

async function publicLibrary(userId: string, language: Language, totals: ProfileStats['reading']) {
  const librarySelect = { workId: true, title: true, progress: true, chaptersRead: true, updatedAt: true } as const
  const novelSelect = { id: true, title: true, author: true, coverUrl: true, progressPercent: true, progressAt: true, updatedAt: true } as const
  // Romans rattachés à une fiche : déjà listés par leur fiche de bibliothèque.
  const readingNovelWhere = { userId, workId: null, progressPercent: { gt: 0, lt: NOVEL_FINISHED_PERCENT } }
  const [readingEntries, readEntries, readingNovels, readNovels, readingNovelCount] = await Promise.all([
    prisma.libraryEntry.findMany({ where: { userId, status: 'reading' }, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT, select: librarySelect }),
    prisma.libraryEntry.findMany({ where: { userId, status: 'read' }, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT, select: librarySelect }),
    prisma.userBook.findMany({
      where: readingNovelWhere,
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
      select: novelSelect,
    }),
    prisma.userBook.findMany({
      where: { userId, workId: null, progressPercent: { gte: NOVEL_FINISHED_PERCENT } },
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
      select: novelSelect,
    }),
    prisma.userBook.count({ where: readingNovelWhere }),
  ])

  // Deux lots (≤ 60 ids chacun) : la limite d'un appel groupé à MangaDex est de 100.
  const [readingBooks, readBooks] = await Promise.all([
    mangadexBooks(readingEntries.map((entry) => entry.workId), language),
    mangadexBooks(readEntries.map((entry) => entry.workId), language),
  ])

  type Entry = (typeof readingEntries)[number]
  type Novel = (typeof readingNovels)[number]
  const fromEntry = (entry: Entry, books: Map<string, Book>, finished: boolean): PublicWork => {
    const book = books.get(entry.workId) ?? null
    return {
      id: entry.workId,
      kind: 'library',
      title: book?.title ?? entry.title,
      author: book?.authors[0] ?? null,
      cover: book?.cover ?? null,
      progress: finished ? 1 : Math.min(1, Math.max(0, entry.progress)),
      chaptersRead: entry.chaptersRead,
      updatedAt: entry.updatedAt.getTime(),
      book,
    }
  }
  const fromNovel = (novel: Novel): PublicWork => ({
    id: novel.id,
    kind: 'novel',
    title: novel.title,
    author: novel.author,
    cover: publicNovelCover(novel.coverUrl),
    progress: Math.min(1, Math.max(0, novel.progressPercent / 100)),
    chaptersRead: 0,
    updatedAt: (novel.progressAt ?? novel.updatedAt).getTime(),
    book: null,
  })
  const newestFirst = (works: PublicWork[]) => works.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIST_LIMIT)

  return {
    reading: newestFirst([...readingEntries.map((entry) => fromEntry(entry, readingBooks, false)), ...readingNovels.map(fromNovel)]),
    read: newestFirst([...readEntries.map((entry) => fromEntry(entry, readBooks, true)), ...readNovels.map(fromNovel)]),
    readingTotal: totals.reading + readingNovelCount,
    readTotal: totals.read + totals.novelsFinished,
  }
}

export async function getPublicProfile(userId: string, language: Language, viewerId: string | null): Promise<PublicProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    // Sélection explicite : ni e-mail, ni mot de passe ne quittent la base.
    select: {
      id: true,
      displayName: true,
      bio: true,
      avatarCardId: true,
      avatarUrl: true,
      featuredCardIds: true,
      activeTitle: true,
      isProfilePublic: true,
      createdAt: true,
    },
  })
  if (!user) throw userNotFound()

  const featuredIds = parseFeatured(user.featuredCardIds)
  const [stats, cards] = await Promise.all([
    // Toujours calculées : le titre affiché doit être réellement débloqué, même sur un profil privé.
    profileStats(user.id),
    ownedCards(user.id, [...featuredIds, ...(user.avatarCardId ? [user.avatarCardId] : [])]),
  ])
  const activeTitle = titlesFor(stats).find((title) => title.id === user.activeTitle && title.unlocked)?.id ?? null
  const open = user.isProfilePublic

  return {
    profile: {
      id: user.id,
      displayName: user.displayName,
      activeTitle,
      avatarUrl: publicAvatarUrl(user.avatarUrl),
      avatar: (user.avatarCardId && cards.get(user.avatarCardId)) || null,
      featured: featuredIds.flatMap((id) => cards.get(id) ?? []),
      isProfilePublic: open,
      bio: open ? user.bio : null,
      createdAt: open ? user.createdAt.getTime() : null,
    },
    stats: open ? stats : null,
    library: open ? await publicLibrary(user.id, language, stats.reading) : null,
    isSelf: viewerId === user.id,
  }
}

/* ---- Recherche de membres ------------------------------------------------------ */

/** Résultat de recherche : de quoi reconnaître quelqu'un, sans ouvrir son profil. */
export interface MemberSummary {
  id: string
  displayName: string
  /** Titre choisi (vérifié à l'enregistrement ; revérifié à l'ouverture du profil). */
  activeTitle: TitleId | null
  avatarUrl: string | null
  avatar: ProfileCard | null
  isProfilePublic: boolean
  /** Cartes différentes possédées ; `null` : profil privé. */
  cardsOwned: number | null
  /** Œuvres en cours et terminées ; `null` : profil privé. */
  readsCount: number | null
  isSelf: boolean
}

/** Comptes parcourus par une recherche (les plus récents) : largement assez pour une instance perso. */
const SEARCH_POOL = 5000
const SEARCH_LIMIT = 20
/** Sans texte : les derniers inscrits. */
const RECENT_LIMIT = 12

/** Pseudo comparable : sans accents ni majuscules (« Élodie » ≈ « elodie »). */
export const normalizeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Pseudos qui contiennent la recherche, les plus pertinents d'abord : égalité,
 * puis début du pseudo, puis début d'un mot, puis n'importe où ; à égalité,
 * le pseudo le plus court.
 */
export function rankMembers<T extends { displayName: string }>(rows: readonly T[], query: string): T[] {
  const wanted = normalizeName(query)
  if (!wanted) return []
  return rows
    .flatMap((row) => {
      const name = normalizeName(row.displayName)
      const at = name.indexOf(wanted)
      if (at < 0) return []
      const score = name === wanted ? 0 : at === 0 ? 1 : name.split(' ').some((word) => word.startsWith(wanted)) ? 2 : 3
      return [{ row, score, length: name.length }]
    })
    .sort((a, b) => a.score - b.score || a.length - b.length || a.row.displayName.localeCompare(b.row.displayName))
    .map(({ row }) => row)
}

/**
 * Membres dont le pseudo contient `query` (sans pseudo, un compte n'est pas
 * trouvable : l'e-mail ne sert jamais à chercher). Moins de deux lettres : les
 * derniers inscrits. Profils privés compris : on les trouve, on n'en voit que
 * la vitrine.
 */
export async function searchMembers(query: string, viewerId: string | null): Promise<MemberSummary[]> {
  const term = query.trim()
  const pool = await prisma.user.findMany({
    where: { displayName: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: term.length < 2 ? RECENT_LIMIT : SEARCH_POOL,
    select: { id: true, displayName: true, avatarCardId: true, avatarUrl: true, activeTitle: true, isProfilePublic: true },
  })
  const members = pool.flatMap((row) => (row.displayName ? [{ ...row, displayName: row.displayName }] : []))
  const rows = term.length < 2 ? members : rankMembers(members, term).slice(0, SEARCH_LIMIT)
  if (rows.length === 0) return []

  const withAvatar = rows.flatMap((row) => (row.avatarCardId ? [{ userId: row.id, cardId: row.avatarCardId }] : []))
  const publicIds = rows.filter((row) => row.isProfilePublic).map((row) => row.id)
  const [avatars, cardCounts, readCounts] = await Promise.all([
    withAvatar.length > 0
      ? prisma.userCard.findMany({ where: { OR: withAvatar }, select: { userId: true, count: true, card: true } })
      : Promise.resolve([]),
    publicIds.length > 0
      ? prisma.userCard.groupBy({ by: ['userId'], where: { userId: { in: publicIds } }, _count: { _all: true } })
      : Promise.resolve([]),
    publicIds.length > 0
      ? prisma.libraryEntry.groupBy({
          by: ['userId'],
          where: { userId: { in: publicIds }, status: { in: ['reading', 'read'] } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ])
  const avatarOf = new Map(avatars.map((row) => [row.userId, { ...toCardDto(row.card), count: row.count }]))
  const cardsOf = new Map(cardCounts.map((group) => [group.userId, group._count._all]))
  const readsOf = new Map(readCounts.map((group) => [group.userId, group._count._all]))

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    activeTitle: isTitleId(row.activeTitle) ? row.activeTitle : null,
    avatarUrl: publicAvatarUrl(row.avatarUrl),
    avatar: avatarOf.get(row.id) ?? null,
    isProfilePublic: row.isProfilePublic,
    cardsOwned: row.isProfilePublic ? (cardsOf.get(row.id) ?? 0) : null,
    readsCount: row.isProfilePublic ? (readsOf.get(row.id) ?? 0) : null,
    isSelf: row.id === viewerId,
  }))
}
