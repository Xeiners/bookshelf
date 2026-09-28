/**
 * Boosters et collection de cartes : régénération du stock, tirage selon les
 * raretés, composition du set (logique pure), puis l'API de bout en bout
 * (stock serveur, ouverture atomique, collection, favoris).
 */
import assert from 'node:assert/strict'
import { before, after, describe, it } from 'node:test'
import {
  BOOSTER_INTERVAL_MS,
  DROP_RATES,
  GUARANTEED_RATES,
  MAX_BOOSTERS,
  RARITIES,
  SET_LAYOUT,
  SET_SIZE,
  assignRarities,
  consume,
  numberSet,
  remainingQuotas,
  drawPack,
  drawRarity,
  initialState,
  regenerate,
  secondsUntilNext,
  type Rarity,
} from '../src/modules/cards/boosters.logic.js'
import { seededRandom } from '../src/lib/seeded.js'
import type { WorkStatistics } from '../src/services/catalog.service.js'
import { catalogManga } from './fixtures.js'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('cards')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const HOUR = 60 * 60 * 1000
const T0 = new Date('2026-09-28T12:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

/* ---- Stock : régénération ------------------------------------------------------ */

describe('boosters — régénération (1 toutes les 3 h, 2 au plus)', () => {
  it('un compte neuf a un stock plein, sans compte à rebours', () => {
    const state = regenerate(initialState(), T0)
    assert.equal(state.available, MAX_BOOSTERS)
    assert.equal(state.nextBoosterAt, null)
    assert.equal(secondsUntilNext(state, T0), null)
  })

  it('ouvrir depuis un stock plein démarre le compte à rebours ; ouvrir encore ne le remet pas à zéro', () => {
    const first = consume(initialState(), T0)!
    assert.equal(first.available, 1)
    assert.equal(first.nextBoosterAt?.getTime(), at(3 * HOUR).getTime())
    const second = consume(first, at(HOUR))!
    assert.equal(second.available, 0)
    assert.equal(second.nextBoosterAt?.getTime(), at(3 * HOUR).getTime(), 'échéance inchangée')
    assert.equal(consume(second, at(2 * HOUR)), null, 'stock vide')
  })

  it('chaque échéance passée ajoute un booster ; le retard n’est pas perdu', () => {
    const empty = { available: 0, nextBoosterAt: at(3 * HOUR), lastClaimedAt: T0 }
    const one = regenerate(empty, at(3 * HOUR + 30 * 60 * 1000))
    assert.equal(one.available, 1)
    // Prochaine échéance : 3 h après la précédente, pas 3 h après la lecture.
    assert.equal(one.nextBoosterAt?.getTime(), at(6 * HOUR).getTime())
    assert.equal(secondsUntilNext(one, at(3 * HOUR + 30 * 60 * 1000)), 2.5 * 3600)
  })

  it('plafonné à 2, même après une longue absence ; stock plein → plus de minuteur', () => {
    const empty = { available: 0, nextBoosterAt: at(3 * HOUR), lastClaimedAt: T0 }
    const later = regenerate(empty, at(72 * HOUR))
    assert.equal(later.available, MAX_BOOSTERS)
    assert.equal(later.nextBoosterAt, null)
  })

  it('consommer régénère d’abord : un booster arrivé pendant l’absence est utilisable', () => {
    const empty = { available: 0, nextBoosterAt: at(3 * HOUR), lastClaimedAt: T0 }
    const opened = consume(empty, at(4 * HOUR))!
    assert.equal(opened.available, 0)
    assert.equal(opened.nextBoosterAt?.getTime(), at(6 * HOUR).getTime())
  })

  it('secondes restantes arrondies au-dessus, jamais négatives', () => {
    const state = { available: 0, nextBoosterAt: at(1500), lastClaimedAt: T0 }
    assert.equal(secondsUntilNext(state, T0), 2)
    assert.equal(secondsUntilNext(state, at(5000)), 0)
  })

  it('état incohérent (stock incomplet sans échéance) : le compte à rebours repart', () => {
    const state = regenerate({ available: 1, nextBoosterAt: null, lastClaimedAt: null }, T0)
    assert.equal(state.nextBoosterAt?.getTime(), at(BOOSTER_INTERVAL_MS).getTime())
  })
})

/* ---- Tirage ------------------------------------------------------------------------ */

describe('boosters — tirage aléatoire', () => {
  it('probabilités cumulées : bornes exactes', () => {
    assert.equal(drawRarity(() => 0), 'COMMON')
    assert.equal(drawRarity(() => 0.5999), 'COMMON')
    assert.equal(drawRarity(() => 0.6), 'RARE')
    assert.equal(drawRarity(() => 0.9), 'EPIC')
    assert.equal(drawRarity(() => 0.96), 'LEGENDARY')
    assert.equal(drawRarity(() => 0.985), 'LEGENDARY')
    assert.equal(drawRarity(() => 0.995), 'MYTHIC')
    assert.equal(drawRarity(() => 0.99999999), 'MYTHIC')
  })

  it('les probabilités somment à 1, la garantie exclut les Communes', () => {
    const sum = (rates: Record<Rarity, number>) => RARITIES.reduce((total, rarity) => total + rates[rarity], 0)
    assert.ok(Math.abs(sum(DROP_RATES) - 1) < 1e-9)
    assert.ok(Math.abs(sum(GUARANTEED_RATES) - 1) < 1e-9)
    assert.equal(GUARANTEED_RATES.COMMON, 0)
  })

  it('sur 200 000 tirages, chaque rareté suit sa probabilité (± 0,5 point)', () => {
    const random = seededRandom('rates')
    const counts = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<Rarity, number>
    const draws = 200_000
    for (let index = 0; index < draws; index += 1) counts[drawRarity(random)] += 1
    for (const rarity of RARITIES) {
      assert.ok(Math.abs(counts[rarity] / draws - DROP_RATES[rarity]) < 0.005, `${rarity} : ${counts[rarity] / draws}`)
    }
  })

  const SET = RARITIES.flatMap((rarity) => Array.from({ length: SET_LAYOUT[rarity] }, (_, index) => ({ id: `${rarity}-${index}`, rarity })))

  it('un booster : 3 cartes distinctes, la dernière toujours Rare ou mieux', () => {
    const random = seededRandom('packs')
    for (let pack = 0; pack < 5000; pack += 1) {
      const cards = drawPack(SET, random)
      assert.equal(cards.length, 3)
      assert.equal(new Set(cards.map((card) => card.id)).size, 3)
      assert.notEqual(cards[2]!.rarity, 'COMMON')
    }
  })

  it('rareté absente du set : repli sur la rareté voisine, jamais de carte fantôme', () => {
    const noMythic = SET.filter((card) => card.rarity !== 'MYTHIC')
    const cards = drawPack(noMythic, () => 0.9999)
    assert.equal(cards.length, 3)
    assert.ok(cards.every((card) => card.rarity === 'LEGENDARY'))
  })

  it('set minuscule : les doublons d’un même booster sont tolérés plutôt que de manquer une carte', () => {
    const cards = drawPack([{ id: 'only', rarity: 'RARE' }], seededRandom('tiny'))
    assert.deepEqual(cards.map((card) => card.id), ['only', 'only', 'only'])
  })
})

/* ---- Composition du set ------------------------------------------------------------ */

describe('set de cartes — raretés', () => {
  it('300 cartes : 10 Mythiques, 20 Légendaires, 50 Épiques, 80 Rares, 140 Communes', () => {
    assert.equal(SET_SIZE, 300)
    const candidates = Array.from({ length: 400 }, (_, index) => ({ mangaId: `m${index}`, popularity: 1000 * index, rating: 6 + (index % 30) / 10 }))
    const layout = assignRarities(candidates.slice(0, SET_SIZE))
    for (const rarity of RARITIES) assert.equal(layout.filter((card) => card.rarity === rarity).length, SET_LAYOUT[rarity])
  })

  it('quotas restants : les cartes déjà au set occupent leurs places', () => {
    const quotas = remainingQuotas(['MYTHIC', 'MYTHIC', 'COMMON'], { MYTHIC: 2, LEGENDARY: 1, EPIC: 1, RARE: 1, COMMON: 3 })
    assert.deepEqual(quotas, { MYTHIC: 0, LEGENDARY: 1, EPIC: 1, RARE: 1, COMMON: 2 })
  })

  it('numérotation de l’album : des plus rares aux plus communes, puis par prestige', () => {
    const numbered = numberSet([
      { mangaId: 'common-a', rarity: 'COMMON', prestige: 9 },
      { mangaId: 'mythic-b', rarity: 'MYTHIC', prestige: 5 },
      { mangaId: 'mythic-a', rarity: 'MYTHIC', prestige: 8 },
      { mangaId: 'rare-a', rarity: 'RARE', prestige: 7 },
    ])
    assert.deepEqual(numbered, [
      { mangaId: 'mythic-a', number: 1 },
      { mangaId: 'mythic-b', number: 2 },
      { mangaId: 'rare-a', number: 3 },
      { mangaId: 'common-a', number: 4 },
    ])
  })

  it('les plus prestigieuses (note, puis notoriété) sont les plus rares', () => {
    const layout = assignRarities([
      { mangaId: 'classic', popularity: 200_000, rating: 9.2 },
      { mangaId: 'obscure', popularity: 50, rating: 6.1 },
      { mangaId: 'famous-average', popularity: 250_000, rating: 7 },
    ])
    assert.deepEqual(layout.map((card) => [card.mangaId, card.rarity]), [
      ['classic', 'MYTHIC'],
      ['famous-average', 'MYTHIC'],
      ['obscure', 'MYTHIC'],
    ])
    assert.equal(layout[0]!.mangaId, 'classic')
  })

  it('origines : ~60 % manga, 30 % manhwa, 10 % manhua, complétées par les plus suivies', async () => {
    const { pickSetWorks } = await import('../src/modules/cards/cards.service.js')
    const item = (id: string, country: string, popularity: number) =>
      ({ key: id, ids: [id], mangadexId: id, country, popularity, features: { genres: [], tags: [], meanScore: null }, rating: null, status: null, chapters: null, year: null, searchText: '' })
    const items = [
      ...Array.from({ length: 400 }, (_, index) => item(`jp${index}`, 'JP', 10_000 - index)),
      ...Array.from({ length: 200 }, (_, index) => item(`kr${index}`, 'KR', 5_000 - index)),
      // Manhua trop peu nombreux : leurs places vont aux plus suivis.
      ...Array.from({ length: 10 }, (_, index) => item(`cn${index}`, 'CN', 100 - index)),
    ]
    const picked = pickSetWorks(items)
    assert.equal(picked.length, SET_SIZE)
    const count = (works: typeof picked, country: string) => works.filter((work) => work.country === country).length
    assert.equal(count(picked, 'KR'), 90)
    assert.equal(count(picked, 'CN'), 10)
    assert.equal(count(picked, 'JP'), 200)

    // Agrandissement : les œuvres déjà au set comptent dans le quota de leur origine, et ne reviennent pas.
    const existing = new Set(picked.slice(0, 150).map((work) => work.mangadexId))
    const more = pickSetWorks(items, SET_SIZE, existing)
    assert.equal(more.length, SET_SIZE - 150)
    assert.equal(more.some((work) => existing.has(work.mangadexId)), false)
  })
})

/* ---- API --------------------------------------------------------------------------- */

const statistics = new Map<string, WorkStatistics>()
const WORKS = Array.from({ length: 360 }, (_, index) => {
  const manga = catalogManga({ genres: ['Action'], originalLanguage: (['ja', 'ja', 'ko', 'zh'] as const)[index % 4] })
  statistics.set(manga.id, { follows: 1000 + index * 37, rating: 6 + (index % 35) / 10 })
  return manga
})

async function signedUp(): Promise<TestClient & { userId: string }> {
  const account = client()
  await account.signUp({ email: `cards-${Date.now()}-${Math.random()}@example.com`, password: 'motdepasse-test' })
  const userId = (await account.request('GET', '/auth/me')).body.user.id as string
  return Object.assign(account, { userId })
}

describe('API — collection pas encore prête', () => {
  it('catalogue vide : 503, et le booster n’est pas dépensé', async () => {
    const account = await signedUp()
    const opened = await account.request('POST', '/boosters/open')
    assert.equal(opened.status, 503)
    assert.equal(opened.body.error.code, 'collection_not_ready')
    assert.equal((await account.request('GET', '/boosters/status')).body.available, 2)
  })
})

describe('API — boosters et collection', () => {
  before(async () => {
    const { upsertWorks, reloadPool } = await import('../src/services/catalog.service.js')
    await upsertWorks(WORKS, statistics)
    await reloadPool()
  })

  it('agrandir le set : les cartes existantes gardent leur identité et leur rareté, l’album est renuméroté', async () => {
    const { growCardSet } = await import('../src/modules/cards/cards.service.js')
    const { prisma } = await import('../src/db.js')
    const half = Object.fromEntries(RARITIES.map((rarity) => [rarity, SET_LAYOUT[rarity] / 2])) as Record<Rarity, number>
    await growCardSet(half)
    const before = await prisma.card.findMany({ select: { id: true, rarity: true, mangaId: true } })
    assert.equal(before.length, SET_SIZE / 2)

    await growCardSet()
    const after = await prisma.card.findMany({ orderBy: { number: 'asc' }, select: { id: true, rarity: true, mangaId: true, number: true } })
    assert.equal(after.length, SET_SIZE)
    for (const card of before) {
      assert.deepEqual(after.find((entry) => entry.id === card.id)?.rarity, card.rarity, card.mangaId)
    }
    for (const rarity of RARITIES) assert.equal(after.filter((card) => card.rarity === rarity).length, SET_LAYOUT[rarity])
    assert.deepEqual(after.map((card) => card.number), Array.from({ length: SET_SIZE }, (_, index) => index + 1))
    // Des plus rares aux plus communes.
    const rank = (rarity: string) => ['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE', 'COMMON'].indexOf(rarity)
    assert.ok(after.every((card, index) => index === 0 || rank(after[index - 1]!.rarity) <= rank(card.rarity)))
  })

  it('réservé aux comptes : 401 pour un invité', async () => {
    const guest = client()
    for (const [method, route] of [['GET', '/boosters/status'], ['POST', '/boosters/open'], ['GET', '/cards/collection'], ['PATCH', '/cards/x/favorite']] as const) {
      assert.equal((await guest.request(method, route)).status, 401, route)
    }
  })

  it('invité : 2 boosters d’essai, reçus signés, album reconstitué, puis 409', async () => {
    const guest = client()
    const first = await guest.request('POST', '/boosters/guest/open', { receipts: [] })
    assert.equal(first.status, 200)
    assert.equal(first.body.cards.length, 3)
    assert.equal(first.body.remaining, 1)
    assert.ok(first.body.cards.every((pulled: { isNew: boolean; count: number }) => pulled.count >= 1))

    const second = await guest.request('POST', '/boosters/guest/open', { receipts: [first.body.receipt] })
    assert.equal(second.status, 200)
    assert.equal(second.body.remaining, 0)
    const receipts = [first.body.receipt, second.body.receipt]

    const done = await guest.request('POST', '/boosters/guest/open', { receipts })
    assert.equal(done.status, 409)
    assert.equal(done.body.error.code, 'guest_limit')
    // Le même reçu présenté deux fois ne vaut qu'un essai.
    assert.equal((await guest.request('POST', '/boosters/guest/open', { receipts: [first.body.receipt, first.body.receipt] })).status, 200)

    const album = (await guest.request('POST', '/cards/guest/collection', { receipts })).body
    assert.equal(album.total, SET_SIZE)
    assert.equal(album.cards.reduce((sum: number, card: { count: number }) => sum + card.count, 0), 6)
    assert.equal(album.cards.filter((card: { isFavorite: boolean }) => card.isFavorite).length, 0)
  })

  it('reçu retouché ou fabriqué : ignoré', async () => {
    const { signGuestPack, readGuestPack } = await import('../src/modules/cards/guestPacks.js')
    const receipt = signGuestPack(['a', 'b', 'c'])
    assert.deepEqual(readGuestPack(receipt)?.cardIds, ['a', 'b', 'c'])
    const [payload, signature] = receipt.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), c: ['x', 'x', 'x'] })).toString('base64url')
    assert.equal(readGuestPack(`${forged}.${signature}`), null)
    assert.equal(readGuestPack('n.importe.quoi'), null)
    assert.equal(readGuestPack(''), null)
  })

  it('inscription : les cartes d’essai rejoignent le compte, qui démarre avec 2 boosters', async () => {
    const guest = client()
    const first = await guest.request('POST', '/boosters/guest/open', { receipts: [] })
    const second = await guest.request('POST', '/boosters/guest/open', { receipts: [first.body.receipt] })
    const receipts = [first.body.receipt, second.body.receipt]
    const expected = (await guest.request('POST', '/cards/guest/collection', { receipts })).body

    const created = await guest.signUp({ email: `guest-${Date.now()}@example.com`, password: 'motdepasse-test', guestPacks: receipts })
    assert.equal(created.status, 201)
    assert.equal(created.body.guestCards, 6)
    assert.equal((await guest.request('GET', '/boosters/status')).body.available, 2)
    const collection = (await guest.request('GET', '/cards/collection')).body
    const counts = (album: { cards: { id: string; count: number }[] }) => album.cards.filter((card) => card.count > 0).map((card) => `${card.id}×${card.count}`)
    assert.deepEqual(counts(collection), counts(expected))
  })

  it('stock initial : 2/2, pas de minuteur, horloge du serveur jointe', async () => {
    const { body } = await (await signedUp()).request('GET', '/boosters/status')
    assert.equal(body.available, 2)
    assert.equal(body.max, 2)
    assert.equal(body.secondsUntilNext, null)
    assert.equal(body.intervalSeconds, 3 * 3600)
    assert.ok(Math.abs(Date.parse(body.serverTime) - Date.now()) < 5000)
  })

  it('ouvrir : 3 cartes enregistrées, stock décrémenté, minuteur de 3 h ; stock vide → 409', async () => {
    const account = await signedUp()
    const first = await account.request('POST', '/boosters/open')
    assert.equal(first.status, 200)
    assert.equal(first.body.cards.length, 3)
    for (const pulled of first.body.cards) {
      assert.ok(RARITIES.includes(pulled.card.rarity))
      assert.match(pulled.card.imageUrl, /^\/api\/covers\//)
      assert.ok(pulled.count >= 1)
    }
    assert.equal(first.body.status.available, 1)
    assert.ok(first.body.status.secondsUntilNext > 3 * 3600 - 10)

    assert.equal((await account.request('POST', '/boosters/open')).status, 200)
    const empty = await account.request('POST', '/boosters/open')
    assert.equal(empty.status, 409)
    assert.equal(empty.body.error.code, 'no_booster')
    assert.ok(empty.body.error.secondsUntilNext > 0)

    const collection = (await account.request('GET', '/cards/collection')).body
    assert.equal(collection.total, SET_SIZE)
    const owned = collection.cards.filter((card: { owned: boolean }) => card.owned)
    assert.equal(collection.owned, owned.length)
    // 6 cartes tirées : leurs exemplaires (doublons compris) font 6.
    assert.equal(owned.reduce((sum: number, card: { count: number }) => sum + card.count, 0), 6)
    assert.ok(collection.cards.filter((card: { owned: boolean }) => !card.owned).every((card: { count: number }) => card.count === 0))
    assert.equal(collection.byRarity.MYTHIC.total, SET_LAYOUT.MYTHIC)
  })

  it('ouvertures simultanées : jamais plus de boosters dépensés que le stock', async () => {
    const account = await signedUp()
    const results = await Promise.all(Array.from({ length: 4 }, () => account.request('POST', '/boosters/open')))
    const statuses = results.map((result) => result.status).sort()
    assert.deepEqual(statuses.filter((status) => status === 200).length, 2, statuses.join(','))
    assert.equal((await account.request('GET', '/boosters/status')).body.available, 0)
  })

  it('le temps du serveur fait foi : 3 h plus tard, un booster est revenu', async () => {
    const account = await signedUp()
    const { openBooster, boosterStatus } = await import('../src/modules/cards/cards.service.js')
    await openBooster(account.userId, { now: T0 })
    await openBooster(account.userId, { now: at(10 * 60 * 1000) })
    assert.equal((await boosterStatus(account.userId, at(2 * HOUR))).available, 0)
    const later = await boosterStatus(account.userId, at(3 * HOUR))
    assert.equal(later.available, 1)
    assert.equal(later.secondsUntilNext, 3 * 3600)
    // Doublon : même tirage (graine fixe) → la carte déjà possédée voit son compteur augmenter.
    const { prisma } = await import('../src/db.js')
    const before = await prisma.userCard.count({ where: { userId: account.userId } })
    const again = await openBooster(account.userId, { now: at(3 * HOUR), random: seededRandom('same') })
    const after = await prisma.userCard.count({ where: { userId: account.userId } })
    assert.equal(after - before, again.cards.filter((pulled) => pulled.isNew).length)
  })

  it('favori : sur une carte possédée seulement', async () => {
    const account = await signedUp()
    const { body } = await account.request('POST', '/boosters/open')
    const owned = body.cards[0].card.id
    assert.equal((await account.request('PATCH', `/cards/${owned}/favorite`, { isFavorite: true })).status, 204)
    const collection = (await account.request('GET', '/cards/collection')).body
    assert.equal(collection.cards.find((card: { id: string }) => card.id === owned).isFavorite, true)
    const missing = collection.cards.find((card: { owned: boolean }) => !card.owned).id
    assert.equal((await account.request('PATCH', `/cards/${missing}/favorite`, { isFavorite: true })).status, 404)
    assert.equal((await account.request('PATCH', `/cards/${owned}/favorite`, { isFavorite: 'oui' })).status, 400)
  })

  it('mode recette (BOOSTER_UNLIMITED_MODE) : ouvertures illimitées, stock intact, cartes enregistrées', async () => {
    const account = await signedUp()
    const { openBooster, boosterStatus } = await import('../src/modules/cards/cards.service.js')
    const { prisma } = await import('../src/db.js')
    for (let pack = 0; pack < 6; pack += 1) {
      const { cards, status } = await openBooster(account.userId, { unlimited: true })
      assert.equal(cards.length, 3)
      assert.equal(status.unlimited, true)
      assert.equal(status.available, status.max)
      assert.equal(status.secondsUntilNext, null)
    }
    // Rien n'a été dépensé : le compte garde son stock plein, hors recette aussi.
    assert.equal(await prisma.userBooster.count({ where: { userId: account.userId } }), 0)
    assert.equal((await boosterStatus(account.userId, new Date(), false)).available, 2)
    const copies = await prisma.userCard.aggregate({ where: { userId: account.userId }, _sum: { count: true } })
    assert.equal(copies._sum.count, 18)
  })

  it('mode recette coupé par défaut : le statut le dit', async () => {
    const { body } = await (await signedUp()).request('GET', '/boosters/status')
    assert.equal(body.unlimited, false)
  })

  it('le set est généré une seule fois, figé', async () => {
    const { prisma } = await import('../src/db.js')
    const { ensureCardSet } = await import('../src/modules/cards/cards.service.js')
    const before = await prisma.card.findMany({ orderBy: { number: 'asc' }, select: { id: true } })
    await Promise.all([ensureCardSet(), ensureCardSet()])
    const after = await prisma.card.findMany({ orderBy: { number: 'asc' }, select: { id: true } })
    assert.deepEqual(after, before)
    assert.equal(after.length, SET_SIZE)
  })
})
