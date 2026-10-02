/**
 * Notifications côté front — fonctions pures, testées
 * (`frontend/test/notifications.test.ts`) : fusion des listes sondées, tri,
 * ce qui mérite un bandeau, texte, date relative, et où mène chaque notification.
 */
import type { Dictionary } from '../i18n/fr'
import type { AppNotification } from '../services/notificationsApi'
import type { TradeCard } from '../services/tradesApi'
import { partyName } from './trades'

/** Liste gardée en mémoire, au plus (l'API en renvoie 50). */
export const MAX_KEPT = 60

/** Les plus récentes d'abord ; à égalité, l'id départage (ordre stable). */
const newestFirst = (a: AppNotification, b: AppNotification) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

/**
 * Ajoute ce que le sondage rapporte à ce qu'on a déjà : une notification déjà
 * connue est remplacée par sa version reçue (lue ailleurs, offre fermée).
 */
export function mergeNotifications(current: readonly AppNotification[], incoming: readonly AppNotification[]): AppNotification[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].sort(newestFirst).slice(0, MAX_KEPT)
}

/** Nouvelles venues, pas encore lues : elles ont droit à un bandeau. Les plus anciennes d'abord (ordre d'arrivée). */
export function freshArrivals(known: ReadonlySet<string>, incoming: readonly AppNotification[]): AppNotification[] {
  return incoming.filter((item) => !item.read && !known.has(item.id)).sort((a, b) => -newestFirst(a, b))
}

/** Curseur du prochain sondage : la date de la plus récente connue. */
export const latestCursor = (items: readonly AppNotification[]): string | undefined =>
  items.reduce<string | undefined>((latest, item) => (!latest || item.createdAt > latest ? item.createdAt : latest), undefined)

/** Aujourd'hui / Plus tôt : les non lues d'abord, puis le reste. */
export function splitByRead(items: readonly AppNotification[]): { fresh: AppNotification[]; earlier: AppNotification[] } {
  return { fresh: items.filter((item) => !item.read), earlier: items.filter((item) => item.read) }
}

/** Où mène une notification : « Mes échanges » (échange fait), ou l'offre au marché. */
export type NotificationTarget = { kind: 'my-trades' } | { kind: 'offer'; offerId: string } | { kind: 'market' }

export function targetOf(item: AppNotification): NotificationTarget {
  if (item.type === 'trade_accepted') return { kind: 'my-trades' }
  // Offre partie entre-temps : le marché reste la meilleure destination.
  return item.active ? { kind: 'offer', offerId: item.data.offerId } : { kind: 'market' }
}

/** Notifications du Marché non lues : l'onglet Activités et la tuile du Marché s'allument. */
export const unreadTrades = (items: readonly AppNotification[]) =>
  items.filter((item) => !item.read && (item.type === 'trade_accepted' || item.type === 'trade_match')).length

/** Offres signalées par une notification non lue : marquées « Pour toi » au marché. */
export const flaggedOffers = (items: readonly AppNotification[]): Set<string> =>
  new Set(items.filter((item) => !item.read && item.type === 'trade_match').map((item) => item.data.offerId))

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** « il y a 3 min », « hier »… ; moins d'une minute : `now` (fourni par le dictionnaire). */
export function relativeTime(iso: string, now: number, locale: string, justNow: string): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds) || seconds < 60) return justNow
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, size] of UNITS) {
    if (seconds >= size || unit === 'minute') {
      if (unit === 'day' && seconds >= 7 * 86_400) {
        return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
      }
      return format.format(-Math.floor(seconds / size), unit)
    }
  }
  return justNow
}

export interface NotificationCopy {
  title: string
  body: string
  /** Carte mise en avant (celle que l'on reçoit, ou que l'on pourrait recevoir). */
  card: TradeCard
  /** Carte cédée, glissée derrière la première. */
  behind: TradeCard
}

/** Phrase d'une notification, rédigée dans la langue de l'app (le serveur n'envoie que des données). */
export function notificationCopy(item: AppNotification, t: Dictionary): NotificationCopy {
  const name = partyName(item.data.by, t.trades.anonymous)
  if (item.type === 'trade_accepted') {
    return {
      title: t.notifications.tradeAccepted.title(name),
      body: t.notifications.tradeAccepted.body(item.data.received.name, item.data.given.name),
      card: item.data.received,
      behind: item.data.given,
    }
  }
  return {
    title: t.notifications.tradeMatch.title(item.data.offered.name),
    body: t.notifications.tradeMatch.body(name, item.data.requested.name),
    card: item.data.offered,
    behind: item.data.requested,
  }
}
