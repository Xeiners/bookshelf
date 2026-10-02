import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { en } from '../src/i18n/en'
import { fr } from '../src/i18n/fr'
import {
  MAX_KEPT,
  flaggedOffers,
  freshArrivals,
  latestCursor,
  mergeNotifications,
  notificationCopy,
  relativeTime,
  splitByRead,
  targetOf,
  unreadTrades,
} from '../src/lib/notifications'
import type { AppNotification } from '../src/services/notificationsApi'
import type { TradeCard } from '../src/services/tradesApi'

const card = (id: string, name: string): TradeCard => ({
  id,
  number: 1,
  series: 1,
  name,
  mangaTitle: name,
  title: name,
  character: null,
  characterName: null,
  description: '',
  power: 0,
  imageUrl: `/api/covers/${id}`,
  rarity: 'RARE',
  mangaId: `manga-${id}`,
})

const accepted = (id: string, createdAt: string, read = false): AppNotification => ({
  id,
  type: 'trade_accepted',
  read,
  active: true,
  createdAt,
  data: { offerId: `offer-${id}`, received: card('b', 'Berserk'), given: card('a', 'Akira'), by: { id: 'u2', displayName: 'Mika' } },
})

const match = (id: string, createdAt: string, options: { read?: boolean; active?: boolean } = {}): AppNotification => ({
  id,
  type: 'trade_match',
  read: options.read ?? false,
  active: options.active ?? true,
  createdAt,
  data: { offerId: `offer-${id}`, offered: card('c', 'Claymore'), requested: card('d', 'Dorohedoro'), by: { id: 'u3', displayName: null } },
})

describe('notifications — liste', () => {
  it('fusion : version reçue prioritaire, plus récentes d’abord, sans doublon', () => {
    const current = [accepted('1', '2026-10-01T10:00:00.000Z'), match('2', '2026-10-01T09:00:00.000Z')]
    const merged = mergeNotifications(current, [match('2', '2026-10-01T09:00:00.000Z', { active: false }), match('3', '2026-10-01T11:00:00.000Z')])
    assert.deepEqual(
      merged.map((item) => item.id),
      ['3', '1', '2'],
    )
    assert.equal(merged.find((item) => item.id === '2')?.active, false)
  })

  it(`fusion : ${MAX_KEPT} au plus en mémoire`, () => {
    const many = Array.from({ length: MAX_KEPT + 10 }, (_, index) => match(String(index), new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()))
    assert.equal(mergeNotifications([], many).length, MAX_KEPT)
  })

  it('arrivées : seulement les inconnues non lues, dans l’ordre d’arrivée', () => {
    const known = new Set(['1'])
    const incoming = [match('3', '2026-10-01T12:00:00.000Z'), accepted('1', '2026-10-01T10:00:00.000Z'), match('2', '2026-10-01T11:00:00.000Z'), match('4', '2026-10-01T13:00:00.000Z', { read: true })]
    assert.deepEqual(
      freshArrivals(known, incoming).map((item) => item.id),
      ['2', '3'],
    )
  })

  it('curseur : la plus récente ; liste vide → aucun', () => {
    assert.equal(latestCursor([]), undefined)
    assert.equal(latestCursor([match('1', '2026-10-01T09:00:00.000Z'), match('2', '2026-10-01T12:00:00.000Z')]), '2026-10-01T12:00:00.000Z')
  })

  it('non lues d’abord, compte et offres signalées', () => {
    const items = [accepted('1', '2026-10-01T10:00:00.000Z', true), match('2', '2026-10-01T09:00:00.000Z'), match('3', '2026-10-01T08:00:00.000Z', { read: true })]
    const { fresh, earlier } = splitByRead(items)
    assert.deepEqual(fresh.map((item) => item.id), ['2'])
    assert.deepEqual(earlier.map((item) => item.id), ['1', '3'])
    assert.equal(unreadTrades(items), 1)
    assert.deepEqual([...flaggedOffers(items)], ['offer-2'])
  })
})

describe('notifications — destination et texte', () => {
  it('échange conclu → « Mes échanges » ; offre ouverte → l’offre ; offre partie → le marché', () => {
    assert.deepEqual(targetOf(accepted('1', '2026-10-01T10:00:00.000Z')), { kind: 'my-trades' })
    assert.deepEqual(targetOf(match('2', '2026-10-01T10:00:00.000Z')), { kind: 'offer', offerId: 'offer-2' })
    assert.deepEqual(targetOf(match('3', '2026-10-01T10:00:00.000Z', { active: false })), { kind: 'market' })
  })

  it('texte rédigé dans la langue de l’app ; pseudo absent → anonyme', () => {
    const done = notificationCopy(accepted('1', '2026-10-01T10:00:00.000Z'), fr)
    assert.equal(done.title, 'Mika a accepté ton échange')
    assert.match(done.body, /Berserk/)
    assert.equal(done.card.id, 'b')
    assert.equal(done.behind.id, 'a')
    const offer = notificationCopy(match('2', '2026-10-01T10:00:00.000Z'), en)
    assert.equal(offer.title, 'Claymore is at the Market')
    assert.match(offer.body, new RegExp(en.trades.anonymous))
    assert.match(offer.body, /Dorohedoro/)
  })

  it('date relative : à l’instant, minutes, heures, hier, puis la date', () => {
    const now = Date.parse('2026-10-02T12:00:00.000Z')
    const at = (seconds: number) => new Date(now - seconds * 1000).toISOString()
    assert.equal(relativeTime(at(20), now, 'fr-FR', 'à l’instant'), 'à l’instant')
    // `Intl` sépare nombre et unité d'une espace insécable (fine en français) : `\s` la reconnaît.
    assert.match(relativeTime(at(5 * 60), now, 'fr-FR', '…'), /5\smin/)
    assert.match(relativeTime(at(3 * 3600), now, 'en-US', '…'), /3\shr/)
    assert.equal(relativeTime(at(26 * 3600), now, 'fr-FR', '…'), 'hier')
    assert.match(relativeTime(at(10 * 86_400), now, 'fr-FR', '…'), /22\ssept/)
    assert.equal(relativeTime('pas une date', now, 'fr-FR', 'à l’instant'), 'à l’instant')
  })
})
