import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CollectionCard, Rarity } from '../src/lib/boosters'
import { diffMarket, offerableDuplicates, partyName, requestableFor, reservedCopies, sortMarket, splitMine } from '../src/lib/trades'
import type { TradeOffer, TradeStatus } from '../src/services/tradesApi'

const card = (id: string, number: number, rarity: Rarity, count: number): CollectionCard => ({
  id,
  number,
  series: 1,
  name: `Œuvre ${id}`,
  mangaTitle: `Œuvre ${id}`,
  title: `Œuvre ${id}`,
  character: null,
  characterName: null,
  description: '',
  power: 0,
  imageUrl: `/api/covers/${id}`,
  rarity,
  mangaId: `manga-${id}`,
  owned: count > 0,
  count,
  isFavorite: false,
  obtainedAt: count > 0 ? '2026-09-30T00:00:00Z' : null,
})

const offer = (id: string, offered: CollectionCard, requested: CollectionCard, options: { mine?: boolean; status?: TradeStatus; updatedAt?: string } = {}): TradeOffer => ({
  id,
  status: options.status ?? 'OPEN',
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: options.updatedAt ?? '2026-09-30T10:00:00Z',
  offered,
  requested,
  owner: { id: 'u1', displayName: 'Lectrice' },
  acceptedBy: null,
  mine: options.mine ?? true,
  canAccept: false,
  ownsOffered: true,
})

const ALBUM = [
  card('mythic', 1, 'MYTHIC', 3),
  card('epic', 2, 'EPIC', 2),
  card('common-a', 3, 'COMMON', 2),
  card('common-b', 4, 'COMMON', 1),
  card('common-c', 5, 'COMMON', 0),
  card('common-d', 6, 'COMMON', 0),
]
const byId = (id: string) => ALBUM.find((entry) => entry.id === id)!

describe('marché — doublons proposables', () => {
  it('au moins deux exemplaires : un proposé, un gardé', () => {
    const duplicates = offerableDuplicates(ALBUM, new Map())
    assert.deepEqual(duplicates.map((entry) => [entry.id, entry.free]), [['mythic', 2], ['epic', 1], ['common-a', 1]])
  })

  it('les exemplaires réservés par mes offres ouvertes ne sont plus libres', () => {
    const reserved = reservedCopies([
      offer('o1', byId('common-a'), byId('common-c')),
      offer('o2', byId('mythic'), byId('mythic')),
      // Offre close, ou offre d'un autre : ne réservent rien chez moi.
      offer('o3', byId('epic'), byId('epic'), { status: 'CANCELLED' }),
      offer('o4', byId('epic'), byId('epic'), { mine: false }),
    ])
    assert.deepEqual([...reserved], [['common-a', 1], ['mythic', 1]])
    const duplicates = offerableDuplicates(ALBUM, reserved)
    assert.deepEqual(duplicates.map((entry) => [entry.id, entry.free]), [['mythic', 1], ['epic', 1]])
  })
})

describe('marché — cartes demandables', () => {
  it('même rareté, autre carte, manquantes d’abord', () => {
    const all = requestableFor(ALBUM, byId('common-a'), { missingOnly: false })
    assert.deepEqual(all.map((entry) => entry.id), ['common-c', 'common-d', 'common-b'])
  })

  it('seulement les manquantes, et recherche insensible à la casse et à la ponctuation', () => {
    assert.deepEqual(requestableFor(ALBUM, byId('common-a'), { missingOnly: true }).map((entry) => entry.id), ['common-c', 'common-d'])
    assert.deepEqual(requestableFor(ALBUM, byId('common-a'), { missingOnly: false, query: 'ŒUVRE Common D' }).map((entry) => entry.id), ['common-d'])
  })
})

describe('marché — mes échanges', () => {
  it('ouvertes d’abord (les miennes), puis l’historique du plus récent au plus ancien', () => {
    const offers = [
      offer('old', byId('epic'), byId('epic'), { status: 'COMPLETED', updatedAt: '2026-09-01T00:00:00Z' }),
      offer('open', byId('common-a'), byId('common-c')),
      offer('recent', byId('mythic'), byId('mythic'), { status: 'CANCELLED', updatedAt: '2026-09-29T00:00:00Z' }),
      offer('accepted', byId('epic'), byId('epic'), { status: 'COMPLETED', mine: false, updatedAt: '2026-09-15T00:00:00Z' }),
    ]
    const { open, history } = splitMine(offers)
    assert.deepEqual(open.map((entry) => entry.id), ['open'])
    assert.deepEqual(history.map((entry) => entry.id), ['recent', 'accepted', 'old'])
  })

  it('un collectionneur sans pseudo reste anonyme', () => {
    assert.equal(partyName({ displayName: '  ' }, 'Un collectionneur'), 'Un collectionneur')
    assert.equal(partyName(null, 'Un collectionneur'), 'Un collectionneur')
    assert.equal(partyName({ displayName: 'Khalil' }, 'Un collectionneur'), 'Khalil')
  })
})

describe('marché — rafraîchissement et ordre', () => {
  const a = card('a', 1, 'RARE', 2)
  const b = card('b', 2, 'RARE', 0)
  const c = card('c', 3, 'EPIC', 0)

  it('rafraîchir : les offres affichées gardent leur place, les nouvelles attendent, les parties sont signalées', () => {
    const shown = [offer('1', a, b, { mine: false }), offer('2', b, a, { mine: false })]
    const updated = { ...offer('2', b, a, { mine: false }), canAccept: true }
    const fetched = [offer('3', c, a, { mine: false }), updated]
    const { market, incoming, gone } = diffMarket(shown, fetched)
    assert.deepEqual(market.map((entry) => entry.id), ['1', '2'])
    assert.equal(market[1]!.canAccept, true)
    assert.deepEqual(incoming.map((entry) => entry.id), ['3'])
    assert.deepEqual(gone, ['1'])
  })

  it('« Pour moi » : faisables, puis manquantes, puis les plus rares, puis les plus récentes', () => {
    const base = (id: string, offered: CollectionCard, createdAt: string, canAccept: boolean, ownsOffered: boolean) => ({
      ...offer(id, offered, a, { mine: false }),
      createdAt,
      canAccept,
      ownsOffered,
    })
    const offers = [
      base('owned-ok', b, '2026-10-01T10:00:00Z', true, true),
      base('missing-rare', b, '2026-10-01T09:00:00Z', true, false),
      base('missing-epic', c, '2026-10-01T08:00:00Z', true, false),
      base('impossible', c, '2026-10-01T12:00:00Z', false, false),
      base('missing-rare-new', b, '2026-10-01T11:00:00Z', true, false),
    ]
    assert.deepEqual(
      sortMarket(offers, 'best').map((entry) => entry.id),
      ['missing-epic', 'missing-rare-new', 'missing-rare', 'owned-ok', 'impossible'],
    )
    assert.deepEqual(sortMarket(offers, 'recent').map((entry) => entry.id), offers.map((entry) => entry.id))
  })
})
