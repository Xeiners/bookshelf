import { api } from './api'
import type { TradeCard, TradeParty } from './tradesApi'

/** Notifications du compte (cf. `backend/src/modules/notifications/`). Le texte est rédigé ici, dans la langue de l'app. */
interface NotificationBase {
  id: string
  read: boolean
  createdAt: string
  /** `trade_match` : l'offre est-elle encore ouverte ? */
  active: boolean
}

/** Un autre collectionneur a accepté MON offre. */
export interface TradeAcceptedNotification extends NotificationBase {
  type: 'trade_accepted'
  data: { offerId: string; received: TradeCard; given: TradeCard; by: TradeParty }
}

/** Nouvelle offre au marché : une carte qui me manque, contre une carte que j'ai. */
export interface TradeMatchNotification extends NotificationBase {
  type: 'trade_match'
  data: { offerId: string; offered: TradeCard; requested: TradeCard; by: TradeParty }
}

/** L'équipe a offert des boosters (administration). */
export interface BoosterGiftNotification extends NotificationBase {
  type: 'booster_gift'
  data: { count: number; message: string | null }
}

/** L'équipe a offert une carte (administration). */
export interface CardGiftNotification extends NotificationBase {
  type: 'card_gift'
  /** `from` : un membre l'offre ; absent, c'est l'équipe. */
  data: { card: TradeCard; count: number; message: string | null; from?: { id: string; displayName: string | null } | null }
}

/** Un membre montre des cartes de son tirage (« Informer ») : rien ne change de main. */
export interface CardShareNotification extends NotificationBase {
  type: 'card_share'
  data: { cards: TradeCard[]; by: { id: string; displayName: string | null }; message: string | null }
}

/** Un membre m'offre une boîte mystère (garde-robe du Manga Runner). */
export interface BoxGiftNotification extends NotificationBase {
  type: 'box_gift'
  data: { from: { id: string; displayName: string | null }; message: string | null }
}

/** Promotion lancée par l'équipe : un booster ou une boîte mystère à prix réduit, jusqu'à `endsAt`. */
export interface PromotionNotification extends NotificationBase {
  type: 'promotion'
  data: { promotionId: string; target: 'booster' | 'box'; price: number; regular: number; endsAt: string; message: string | null }
}

/** Record de tous les temps battu : une récompense à choisir (booster ou boîte). */
export interface RecordRewardNotification extends NotificationBase {
  type: 'record_reward'
  data: { rewardId: string; game: RecordGame; score: number; previous: number }
}

export type RecordGame = 'runner' | 'bomb_classic' | 'bomb_manga' | 'higher_lower'

export type AppNotification =
  | TradeAcceptedNotification
  | TradeMatchNotification
  | BoosterGiftNotification
  | CardGiftNotification
  | CardShareNotification
  | BoxGiftNotification
  | PromotionNotification
  | RecordRewardNotification

export interface NotificationList {
  notifications: AppNotification[]
  unread: number
}

export const notificationsApi = {
  /** `since` : seulement les plus récentes (sondage) ; `unread` compte toujours tout. */
  list: (since?: string, signal?: AbortSignal) =>
    api<NotificationList>(`/notifications${since ? `?since=${encodeURIComponent(since)}` : ''}`, { signal }),
  /** Sans `ids` : toutes. */
  markRead: (ids?: string[]) => api<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
  remove: (id: string) => api<{ unread: number }>(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
