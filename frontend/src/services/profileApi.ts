import type { Language } from '../i18n'
import type { CollectionCard, Rarity } from '../lib/boosters'
import type { Book } from '../types/book'
import type { Collection } from './cardsApi'
import { api, API_BASE, ApiError } from './api'

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

export interface ProfileWork {
  id: string
  title: string
  cover: string | null
  kind: 'library' | 'book'
}

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
    recentReads: ProfileWork[]
    /** Profil visible en entier par les autres ; privé : pseudo, avatar, titre et vitrine seulement. */
    isProfilePublic: boolean
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
  isProfilePublic?: boolean
}

/** Œuvre d'un profil public (cf. `backend/src/modules/users/publicProfile.service.ts`). */
export interface PublicWork {
  /** Id MangaDex (`library`) ou id du roman importé (`novel`). */
  id: string
  kind: 'library' | 'novel'
  title: string
  author: string | null
  cover: string | null
  /** De 0 à 1. */
  progress: number
  chaptersRead: number
  updatedAt: number
  /** Fiche (MangaDex) pour ouvrir l'œuvre ou l'ajouter ; `null` pour un roman importé. */
  book: Book | null
}

/** `GET /api/users/:id` : ce que tout le monde voit d'un compte. Jamais d'e-mail. */
export interface PublicProfileData {
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
  library: { reading: PublicWork[]; read: PublicWork[]; readingTotal: number; readTotal: number } | null
  isSelf: boolean
}

/** Résultat de `GET /api/users?q=` : de quoi reconnaître un membre avant d'ouvrir son profil. */
export interface MemberSummary {
  id: string
  displayName: string
  activeTitle: TitleId | null
  avatarUrl: string | null
  avatar: ProfileCard | null
  isProfilePublic: boolean
  /** `null` : profil privé. */
  cardsOwned: number | null
  /** Œuvres en cours et terminées ; `null` : profil privé. */
  readsCount: number | null
  isSelf: boolean
}

export interface BooksStorage {
  usedBytes: number
  quotaBytes: number
  count: number
}

export interface AvatarOption {
  url: string
  label: string
  source: 'character' | 'card' | 'cover' | 'volume' | 'upload'
}

/** Limites partagées avec l'API. */
export const FEATURED_MAX = 3
export const BIO_MAX = 160
export const DISPLAY_NAME_MAX = 40

/** `GET /api/users/:id/collection` : tout le set, ce que le membre possède et ses doublons. */
export interface MemberCollection extends Collection {
  owner: { id: string; displayName: string | null }
}

export const profileApi = {
  me: (signal?: AbortSignal) => api<ProfileData>('/profile/me', { signal }),
  /** Profil public d'un compte ; 404 `user_not_found` s'il n'existe pas. */
  publicProfile: (userId: string, lang: Language, signal?: AbortSignal) =>
    api<PublicProfileData>(`/users/${encodeURIComponent(userId)}?lang=${lang}`, { signal }),
  /** Album d'un membre (profil public, ou le sien) ; 403 `profile_private` sinon. */
  memberCollection: (userId: string, signal?: AbortSignal) =>
    api<MemberCollection>(`/users/${encodeURIComponent(userId)}/collection`, { signal }),
  /** Membres par pseudo ; sans texte, les derniers inscrits. */
  searchMembers: (query: string, signal?: AbortSignal) =>
    api<{ members: MemberSummary[] }>(`/users?${new URLSearchParams({ q: query }).toString()}`, { signal }).then(
      (response) => response.members,
    ),
  /** 400 `card_not_owned` si une carte citée n'est pas possédée, `title_locked` si le titre n'est pas débloqué. */
  update: (patch: ProfilePatch) => api<ProfileData>('/profile', { method: 'PATCH', body: patch }),
  avatarOptions: (kind: 'library' | 'book' | 'catalog', workId: string, signal?: AbortSignal) =>
    api<{ title: string; options: AvatarOption[] }>(
      `/profile/avatar-options?kind=${kind}&workId=${encodeURIComponent(workId)}`,
      { signal },
    ),
  uploadAvatar: async (file: File, signal?: AbortSignal) => {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/profile/avatar-upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ApiError(0, 'network_error', 'Network unreachable') // i18n-ignore
    }
    const payload = await response.json().catch(() => null) as { avatarUrl?: string; error?: { code?: string; message?: string } } | null
    if (!response.ok || !payload?.avatarUrl) {
      throw new ApiError(response.status, payload?.error?.code ?? 'avatar_upload_failed', payload?.error?.message ?? `HTTP ${response.status}`)
    }
    return payload.avatarUrl
  },
  /** 400 `wrong_password` si l'actuel est faux. */
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    api<void>('/auth/password', { method: 'POST', body: input }),
  /** Espace occupé par les romans EPUB du compte, sur le serveur. */
  booksStorage: (signal?: AbortSignal) => api<BooksStorage>('/books/storage', { signal }),
}
