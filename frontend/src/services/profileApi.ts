import type { CollectionCard, Rarity } from '../lib/boosters'
import { api } from './api'

/** Titres affichables sous le pseudo (cf. `backend/src/modules/users/titles.ts`). */
export const TITLE_IDS = [
  'newcomer',
  'collector',
  'archivist',
  'completionist',
  'mythicHunter',
  'packOpener',
  'highRoller',
  'bookworm',
  'sage',
] as const
export type TitleId = (typeof TITLE_IDS)[number]

/** Carte exposée (avatar, vitrine) : sa fiche et ses exemplaires. */
export type ProfileCard = Omit<CollectionCard, 'owned' | 'isFavorite' | 'obtainedAt'>

export interface ProfileStats {
  collection: {
    total: number
    owned: number
    copies: number
    byRarity: Record<Rarity, { total: number; owned: number }>
  }
  reading: {
    wishlist: number
    reading: number
    read: number
    chaptersRead: number
    novels: number
    novelsFinished: number
    consulted: number
    /** De 0 à 1. */
    completion: number
  }
  gacha: { boostersOpened: number }
}

export interface ProfileData {
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

/** Champ absent : inchangé ; `null` : effacé. */
export interface ProfilePatch {
  displayName?: string | null
  bio?: string | null
  avatarCardId?: string | null
  avatarUrl?: string | null
  featuredCardIds?: string[]
  activeTitle?: TitleId | null
}

export interface BooksStorage {
  usedBytes: number
  quotaBytes: number
  count: number
}

export interface AvatarOption {
  url: string
  label: string
  source: 'cover' | 'volume' | 'card'
}

/** Limites partagées avec l'API. */
export const FEATURED_MAX = 3
export const BIO_MAX = 160
export const DISPLAY_NAME_MAX = 40

export const profileApi = {
  me: (signal?: AbortSignal) => api<ProfileData>('/profile/me', { signal }),
  /** 400 `card_not_owned` si une carte citée n'est pas possédée, `title_locked` si le titre n'est pas débloqué. */
  update: (patch: ProfilePatch) => api<ProfileData>('/profile', { method: 'PATCH', body: patch }),
  avatarOptions: (kind: 'library' | 'book', workId: string, signal?: AbortSignal) =>
    api<{ title: string; options: AvatarOption[] }>(
      `/profile/avatar-options?kind=${kind}&workId=${encodeURIComponent(workId)}`,
      { signal },
    ),
  /** 400 `wrong_password` si l'actuel est faux. */
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    api<void>('/auth/password', { method: 'POST', body: input }),
  /** Espace occupé par les romans EPUB du compte, sur le serveur. */
  booksStorage: (signal?: AbortSignal) => api<BooksStorage>('/books/storage', { signal }),
}
