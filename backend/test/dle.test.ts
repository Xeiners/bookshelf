/**
 * BookshelfDLE et Poussières d'Étoile : logique pure (comparaison des attributs,
 * zoom, gains, classement, jour de Paris), énigme du jour (même réponse pour tous,
 * jamais révélée avant d'être trouvée, gains et série une seule fois), achat de
 * booster (atomique, jamais à découvert), salons à plusieurs (attente longue,
 * progression des autres sans leurs œuvres, classement, gains, revanche).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('dle')
installMangadexMock()

// Jikan simulé : quelques personnages de Naruto (romanisations de MyAnimeList) et leurs portraits.
const JIKAN_NAMES = ['Uzumaki, Naruto', 'Uchiha, Sasuke', 'Hyuuga, Neji', 'Kankurou', 'Killer Bee', 'Monkey D., Luffy', 'Roronoa, Zoro', 'Nami', 'Kuujou, Joutarou', 'Giovanna, Giorno', 'Itadori, Yuuji', 'Gojou, Satoru', "Zen'in, Maki"]
mockedHosts.add('api.jikan.moe')
mockedHosts.add('cdn.myanimelist.net')
for (const host of ['naruto.fandom.com', 'onepiece.fandom.com', 'jojo.fandom.com', 'jujutsu-kaisen.fandom.com', 'kitsu.app']) mockedHosts.add(host)
extraMocks.push((url) => {
  // Kitsu : aucun personnage (les portraits des tests viennent du Jikan simulé).
  if (url.hostname === 'kitsu.app') return new Response(JSON.stringify({ data: [], included: [], links: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  // Wikis Fandom : aucune fiche (les portraits des tests viennent du Jikan simulé).
  if (url.hostname.endsWith('.fandom.com')) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.hostname === 'api.jikan.moe') {
    const data = JIKAN_NAMES.map((name, index) => ({ character: { name, images: { jpg: { image_url: `https://cdn.myanimelist.net/images/characters/1/${index}.jpg` } } } }))
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (url.hostname === 'cdn.myanimelist.net') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
  return undefined
})
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const logic = await import('../src/modules/dle/dle.logic.js')
const rooms = await import('../src/modules/dle/dle.rooms.js')
const { BOOSTER_PRICE } = await import('../src/modules/stardust/stardust.service.js')

after(() => rooms.resetRooms())

type Account = TestClient & { userId: string }

async function account(email: string, displayName: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

const work = (overrides: Partial<import('../src/modules/dle/dle.logic.js').DleWork> = {}) => ({
  id: 'w',
  number: 1,
  name: 'Œuvre',
  imageUrl: '/api/covers/x/y.jpg',
  rarity: 'RARE' as const,
  series: 1,
  country: 'JP',
  genres: ['Action', 'Fantasy'],
  status: 'ongoing',
  year: 2015,
  popularity: 60_000,
  ...overrides,
})

const RARITY = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const
const UUID = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

let alice: Account
let bastien: Account
let chloe: Account

before(async () => {
  // Douze œuvres jouables : cartes du set et ce que le catalogue en sait.
  const indexes = Array.from({ length: 12 }, (_, index) => index)
  await prisma.card.createMany({
    data: indexes.map((index) => ({
      id: `card-${index}`,
      number: index + 1,
      title: `Œuvre ${index}`,
      name: `Œuvre ${index}`,
      imageUrl: `/api/covers/${UUID(index)}/cover-${index}.jpg?size=512`,
      rarity: RARITY[index % RARITY.length],
      mangaId: UUID(index),
    })),
  })
  await prisma.catalogWork.createMany({
    data: indexes.map((index) => ({
      mangadexId: UUID(index),
      country: ['JP', 'KR', 'CN'][index % 3] as string,
      genres: JSON.stringify(index % 2 === 0 ? ['Action', 'Fantasy'] : ['Romance']),
      tags: '[]',
      mangadex: '{}',
      status: index % 2 === 0 ? 'ongoing' : 'completed',
      year: 2000 + index,
      popularity: 20_000 + index * 15_000,
      searchText: `oeuvre ${index} alias${index}`,
    })),
  })
  alice = await account('alice@example.com', 'Alice')
  bastien = await account('bastien@example.com', 'Bastien')
  chloe = await account('chloe@example.com', 'Chloé')
})

/* ---- Logique pure ------------------------------------------------------------- */

describe('dle — logique', () => {
  it('compare chaque attribut : exact, proche, faux, et le sens de la réponse', () => {
    const answer = work({ year: 2015, rarity: 'EPIC', popularity: 60_000 })
    const same = logic.compareWorks(answer, answer)
    for (const attribute of logic.ATTRIBUTES) assert.equal(same[attribute].verdict, 'exact', attribute)

    const feedback = logic.compareWorks(
      work({ country: 'KR', genres: ['Action', 'Romance'], status: 'completed', year: 2017, rarity: 'COMMON', popularity: 150_000 }),
      answer,
    )
    assert.equal(feedback.origin.verdict, 'wrong')
    assert.equal(feedback.genres.verdict, 'partial')
    assert.equal(feedback.status.verdict, 'wrong')
    assert.deepEqual(feedback.year, { verdict: 'partial', direction: 'lower' })
    assert.deepEqual(feedback.rarity, { verdict: 'wrong', direction: 'higher' })
    assert.deepEqual(feedback.popularity, { verdict: 'wrong', direction: 'lower' })

    assert.equal(logic.compareWorks(work({ genres: ['Drama'] }), answer).genres.verdict, 'wrong')
    assert.equal(logic.compareWorks(work({ year: 2005 }), answer).year.verdict, 'wrong')
    assert.equal(logic.compareWorks(work({ rarity: 'LEGENDARY' }), answer).rarity.verdict, 'partial')
    assert.equal(logic.compareWorks(work({ year: null }), work({ year: null })).year.verdict, 'exact')
  })

  it('paliers de popularité, zoom, couleurs vues par les autres', () => {
    assert.deepEqual([0, 49_999, 50_000, 99_999, 100_000, 500_000].map(logic.popularityTier), [0, 0, 1, 2, 3, 4])
    assert.equal(logic.zoomScale(0), 5)
    assert.equal(logic.zoomScale(99), 1)
    assert.ok(logic.ZOOM_STEPS.every((step, index, steps) => index === 0 || step < (steps[index - 1] as number)))
    const focus = logic.zoomFocus(() => 0.5)
    assert.ok(focus.x >= 22 && focus.x <= 78 && focus.y >= 22 && focus.y <= 78)
    assert.deepEqual(logic.trailOf('zoom', null, [], false), ['wrong'])
    assert.equal(logic.trailOf('classic', logic.compareWorks(work(), work()), logic.ATTRIBUTES, true).length, logic.ATTRIBUTES.length)
    assert.equal(logic.closeness(['exact', 'partial', 'wrong']), 3)
  })

  it('gains : plus on trouve vite, plus on gagne ; la série ajoute un bonus plafonné', () => {
    assert.equal(logic.dailyReward(1, 1), 65)
    assert.ok(logic.dailyReward(3, 1) < logic.dailyReward(2, 1))
    assert.equal(logic.dailyReward(40, 1), 25)
    assert.equal(logic.dailyReward(1, 3), 75)
    assert.equal(logic.dailyReward(1, 50), 90)
    assert.deepEqual([1, 2, 3, 4].map((rank) => logic.roomReward(rank, true)), [40, 25, 15, 10])
    assert.equal(logic.roomReward(1, false), 5)
  })

  it('classement : les plus rapides à trouver, puis les plus proches ; égalités partagées', () => {
    const ranked = logic.rankContenders([
      { id: 'lent', solved: true, solvedMs: 9000, attempts: 2, best: 12 },
      { id: 'perdu', solved: false, solvedMs: null, attempts: 6, best: 4 },
      { id: 'rapide', solved: true, solvedMs: 3000, attempts: 5, best: 12 },
      { id: 'proche', solved: false, solvedMs: null, attempts: 6, best: 9 },
      { id: 'jumeau', solved: false, solvedMs: null, attempts: 6, best: 9 },
    ])
    assert.deepEqual(ranked.map((entry) => entry.id), ['rapide', 'lent', 'proche', 'jumeau', 'perdu'])
    assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 3, 3, 5])
  })

  it('jour de Paris et minuit suivant (heure d’hiver et d’été)', () => {
    assert.equal(logic.parisDay(new Date('2026-01-15T22:30:00Z')), '2026-01-15')
    assert.equal(logic.parisDay(new Date('2026-01-15T23:30:00Z')), '2026-01-16')
    assert.equal(logic.nextParisMidnight(new Date('2026-01-15T12:00:00Z')).toISOString(), '2026-01-15T23:00:00.000Z')
    assert.equal(logic.nextParisMidnight(new Date('2026-07-15T12:00:00Z')).toISOString(), '2026-07-15T22:00:00.000Z')
    // Veille du passage à l'heure d'été : minuit tombe encore en heure d'hiver.
    assert.equal(logic.nextParisMidnight(new Date('2026-03-28T12:00:00Z')).toISOString(), '2026-03-28T23:00:00.000Z')
  })

  it('seulement des œuvres connues ; complétées par les plus suivies si la sélection manque', async () => {
    const { famousOnly, isFamous } = await import('../src/modules/dle/dle.works.js')
    assert.equal(isFamous('One Piece'), true)
    assert.equal(isFamous('Solo Leveling: Ragnarok'), true)
    assert.equal(isFamous('SPY×FAMILY'), true)
    assert.equal(isFamous('The NPCs in this Village Sim Game Must Be Real!'), false)
    const obscure = Array.from({ length: 100 }, (_, index) => ({ name: `Inconnue ${index}`, popularity: index }))
    const famous = ['One Piece', 'Chainsaw Man', "Frieren: Beyond Journey's End"].map((name) => ({ name, popularity: 0 }))
    const picked = famousOnly([...obscure, ...famous])
    assert.ok(famous.every((work) => picked.includes(work)), 'les célèbres d’abord')
    assert.equal(picked.length, 80)
    assert.ok(picked.includes(obscure[99]!) && !picked.includes(obscure[0]!), 'complétées par les plus suivies')
  })

  it('codes de salon : lisibles, normalisés à la saisie', () => {
    const code = logic.roomCode(Math.random)
    assert.match(code, logic.ROOM_CODE)
    assert.equal(logic.normalizeRoomCode(' ab-c2 3d '), 'ABC23D')
  })
})

/* ---- Énigme du jour ------------------------------------------------------------- */

async function dailyAnswer(mode: 'classic' | 'zoom'): Promise<string> {
  const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'manga', mode } } })
  assert.ok(puzzle, 'énigme du jour enregistrée')
  return puzzle.cardId
}

describe('dle — énigme du jour', () => {
  it('visiteur : accueil vierge, mais pas d’énigme du jour ; liste des œuvres pour la saisie', async () => {
    const visitor = await client().request('GET', '/dle')
    assert.equal(visitor.status, 200)
    assert.equal(visitor.body.guest, null)
    assert.equal(visitor.body.stardust, 0)
    assert.equal((await client().request('GET', '/dle/daily/manga/classic')).status, 401)
    assert.equal((await client().request('POST', '/dle/rooms/quick', { mode: 'classic' })).body.error.code, 'guest_required')
    const works = await alice.request('GET', '/dle/works')
    assert.equal(works.status, 200)
    assert.equal(works.body.works.length, 12)
    assert.match(works.body.works[0].search, /alias0/)
  })

  it('classique : la réponse reste secrète, chaque essai est comparé, la victoire paie une fois', async () => {
    const start = await alice.request('GET', '/dle/daily/manga/classic')
    assert.equal(start.status, 200)
    assert.equal(start.body.solved, false)
    assert.equal(start.body.answer, null)
    assert.deepEqual(start.body.guesses, [])
    assert.ok(Date.parse(start.body.nextAt) > Date.now())

    const answer = await dailyAnswer('classic')
    const wrong = ['card-0', 'card-1', 'card-2'].find((id) => id !== answer) as string
    const miss = await alice.request('POST', '/dle/daily/manga/classic/guess', { cardId: wrong })
    assert.equal(miss.status, 200, JSON.stringify(miss.body))
    assert.equal(miss.body.earned, 0)
    assert.equal(miss.body.view.guesses.length, 1)
    assert.equal(miss.body.view.guesses[0].correct, false)
    assert.ok(miss.body.view.guesses[0].feedback.origin.verdict)
    assert.ok(miss.body.view.guesses[0].values.genres)
    assert.equal(miss.body.view.answer, null)

    assert.equal((await alice.request('POST', '/dle/daily/manga/classic/guess', { cardId: wrong })).body.error.code, 'already_guessed')
    assert.equal((await alice.request('POST', '/dle/daily/manga/classic/guess', { cardId: 'inconnue' })).body.error.code, 'unknown_work')

    const win = await alice.request('POST', '/dle/daily/manga/classic/guess', { cardId: answer })
    assert.equal(win.status, 200)
    assert.equal(win.body.view.solved, true)
    assert.equal(win.body.view.answer.id, answer)
    assert.equal(win.body.earned, logic.dailyReward(2, 1))
    assert.equal(win.body.balance, win.body.earned)
    assert.equal(win.body.streak, 1)

    const again = await alice.request('POST', '/dle/daily/manga/classic/guess', { cardId: wrong })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'already_solved')

    const overview = await alice.request('GET', '/dle')
    assert.equal(overview.body.stardust, win.body.earned)
    assert.deepEqual(overview.body.daily.manga.classic, { attempts: 2, solved: true, reward: win.body.earned })
    assert.equal(overview.body.stats.dailyStreak, 1)
    assert.equal(overview.body.stats.dailySolved, 1)
    assert.equal(overview.body.boosterPrice, BOOSTER_PRICE)
  })

  it('même énigme pour tout le monde ; chacun a ses propres essais', async () => {
    const answer = await dailyAnswer('classic')
    const view = await bastien.request('GET', '/dle/daily/manga/classic')
    assert.deepEqual(view.body.guesses, [])
    const win = await bastien.request('POST', '/dle/daily/manga/classic/guess', { cardId: answer })
    assert.equal(win.body.view.solved, true)
    assert.equal(win.body.earned, logic.dailyReward(1, 1))
  })

  it('zoom : un point de mire, une couverture servie sans son adresse, une autre réponse que le classique', async () => {
    const view = await alice.request('GET', '/dle/daily/manga/zoom')
    assert.equal(view.status, 200)
    assert.ok(view.body.focus.x >= 22 && view.body.focus.x <= 78)
    assert.equal(view.body.guesses.length, 0)
    assert.notEqual(await dailyAnswer('zoom'), await dailyAnswer('classic'))
    const zoomMiss = await alice.request('POST', '/dle/daily/manga/zoom/guess', { cardId: (await dailyAnswer('classic')) })
    assert.equal(zoomMiss.body.view.guesses[0].feedback, null)
    // Deux énigmes résolues le même jour : la série ne compte qu'un jour.
    const win = await alice.request('POST', '/dle/daily/manga/zoom/guess', { cardId: await dailyAnswer('zoom') })
    assert.equal(win.body.streak, 1)
  })
})

/* ---- Poussières d'Étoile ---------------------------------------------------------- */

describe('poussières — achat de booster', () => {
  it('solde insuffisant : 409, rien n’est débité', async () => {
    const poor = await chloe.request('POST', '/stardust/booster')
    assert.equal(poor.status, 409)
    assert.equal(poor.body.error.code, 'not_enough_stardust')
    assert.equal(poor.body.error.price, BOOSTER_PRICE)
    assert.equal((await chloe.request('GET', '/stardust')).body.balance, 0)
  })

  it('achat : débit, booster de réserve, historique ; deux achats simultanés ne passent jamais à découvert', async () => {
    await prisma.user.update({ where: { id: chloe.userId }, data: { stardust: BOOSTER_PRICE + 40 } })
    const [first, second] = await Promise.all([chloe.request('POST', '/stardust/booster'), chloe.request('POST', '/stardust/booster')])
    const statuses = [first.status, second.status].sort()
    assert.deepEqual(statuses, [200, 409])
    const bought = first.status === 200 ? first : second
    assert.equal(bought.body.balance, 40)
    assert.equal(bought.body.status.gifted, 1)

    const wallet = await chloe.request('GET', '/stardust')
    assert.equal(wallet.body.balance, 40)
    assert.equal(wallet.body.history[0].reason, 'booster_purchase')
    assert.equal(wallet.body.history[0].amount, -BOOSTER_PRICE)
  })
})

/* ---- Salons ------------------------------------------------------------------------- */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('dle — salons', () => {
  let code = ''

  it('créer, rejoindre par code (saisie libre), voir les autres arriver en attente longue', async () => {
    const created = await alice.request('POST', '/dle/rooms', { mode: 'classic', visibility: 'private' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    code = created.body.code
    assert.match(code, logic.ROOM_CODE)
    assert.equal(created.body.phase, 'lobby')
    assert.equal(created.body.hostId, alice.userId)

    // Alice attend un changement ; l'arrivée de Bastien la réveille.
    const waiting = alice.request('GET', `/dle/rooms/${code}?v=${created.body.version}`)
    await wait(50)
    const joined = await bastien.request('POST', `/dle/rooms/${code.toLowerCase().slice(0, 3)}-${code.slice(3)}/join`)
    assert.equal(joined.status, 200, JSON.stringify(joined.body))
    const woke = await waiting
    assert.equal(woke.status, 200)
    assert.ok(woke.body.version > created.body.version)
    assert.deepEqual(woke.body.players.map((player: { name: string }) => player.name), ['Alice', 'Bastien'])
    assert.equal(woke.body.rewarded, true)
    assert.equal(woke.body.players[0].email, undefined)

    assert.equal((await chloe.request('GET', `/dle/rooms/${code}`)).status, 403)
    assert.equal((await bastien.request('POST', `/dle/rooms/${code}/start`)).body.error.code, 'not_host')
    assert.equal((await alice.request('GET', '/dle/rooms/ZZZZZZ')).status, 404)
  })

  it('manche : compte à rebours, progression des autres sans leurs œuvres, classement et gains', async () => {
    const started = await alice.request('POST', `/dle/rooms/${code}/start`)
    assert.equal(started.body.phase, 'countdown')
    assert.equal(started.body.results, null)
    assert.equal((await bastien.request('POST', `/dle/rooms/${code}/guess`, { cardId: 'card-0' })).body.error.code, 'not_started')

    await wait(rooms.COUNTDOWN_MS + 100)
    const answer = rooms.roomAnswerForTests(code) as string
    const wrong = ['card-3', 'card-4', 'card-5'].find((id) => id !== answer) as string

    const miss = await bastien.request('POST', `/dle/rooms/${code}/guess`, { cardId: wrong })
    assert.equal(miss.status, 200, JSON.stringify(miss.body))
    assert.equal(miss.body.phase, 'playing')
    assert.equal(miss.body.mine.guesses[0].work.id, wrong)

    // Alice voit les couleurs de l'essai de Bastien, jamais l'œuvre.
    const seen = await alice.request('GET', `/dle/rooms/${code}`)
    const opponent = seen.body.players.find((player: { id: string }) => player.id === bastien.userId)
    assert.equal(opponent.trail.length, 1)
    assert.equal(opponent.trail[0].length, logic.ATTRIBUTES.length)
    assert.ok(!JSON.stringify(seen.body).includes(answer), 'la réponse ne fuit pas')
    assert.ok(!JSON.stringify(seen.body.players).includes(wrong), 'les œuvres des autres ne fuient pas')

    const balanceBefore = (await alice.request('GET', '/stardust')).body.balance
    const win = await alice.request('POST', `/dle/rooms/${code}/guess`, { cardId: answer })
    assert.equal(win.body.mine.done, true)
    assert.equal(win.body.phase, 'playing')
    const giveUp = await bastien.request('POST', `/dle/rooms/${code}/forfeit`)
    assert.equal(giveUp.body.phase, 'results')
    const { standings, answer: revealed } = giveUp.body.results
    assert.equal(revealed.id, answer)
    assert.deepEqual(standings.map((entry: { id: string }) => entry.id), [alice.userId, bastien.userId])
    assert.equal(standings[0].reward, 40)
    assert.equal(standings[1].reward, 5)
    assert.equal((await alice.request('GET', '/stardust')).body.balance, balanceBefore + 40)
    const stats = (await alice.request('GET', '/dle')).body.stats
    assert.equal(stats.roomsPlayed, 1)
    assert.equal(stats.roomsWon, 1)
  })

  it('revanche : retour au salon d’attente ; partir transmet l’hôte ; le dernier ferme le salon', async () => {
    assert.equal((await bastien.request('POST', `/dle/rooms/${code}/rematch`)).body.error.code, 'not_host')
    const rematch = await alice.request('POST', `/dle/rooms/${code}/rematch`)
    assert.equal(rematch.body.phase, 'lobby')
    assert.deepEqual(rematch.body.mine.guesses, [])

    assert.equal((await alice.request('POST', `/dle/rooms/${code}/leave`)).status, 204)
    const after = await bastien.request('GET', `/dle/rooms/${code}`)
    assert.equal(after.body.hostId, bastien.userId)
    assert.equal(after.body.players.length, 1)
    await bastien.request('POST', `/dle/rooms/${code}/leave`)
    assert.equal((await bastien.request('GET', `/dle/rooms/${code}`)).status, 404)
  })

  it('partie rapide : rejoint le salon public qui attend dans ce mode, sinon en ouvre un', async () => {
    const first = await alice.request('POST', '/dle/rooms/quick', { mode: 'zoom' })
    assert.equal(first.body.visibility, 'public')
    const second = await bastien.request('POST', '/dle/rooms/quick', { mode: 'zoom' })
    assert.equal(second.body.code, first.body.code)
    assert.equal(second.body.autoStartAt, undefined, 'pas de départ automatique : l’hôte décide')
    const other = await chloe.request('POST', '/dle/rooms/quick', { mode: 'classic' })
    assert.notEqual(other.body.code, first.body.code)
    // Un compte n'est que dans un salon : en rejoindre un autre quitte le premier.
    await chloe.request('POST', `/dle/rooms/${first.body.code}/join`)
    assert.equal((await chloe.request('GET', `/dle/rooms/${other.body.code}`)).status, 404)
    assert.equal((await alice.request('GET', '/dle')).body.currentRoom, first.body.code)
    // Pas de couverture avant le départ.
    assert.equal((await alice.request('GET', `/dle/rooms/${first.body.code}/image`)).status, 404)
  })
})

/* ---- Naruto ------------------------------------------------------------------------- */

describe('dle — Naruto', () => {
  it('logique : ensembles (affiliation, nature, rôle), arc de première apparition avec sens', async () => {
    const { NARUTO_CHARACTERS, ARCS, compareCharacters } = await import('../src/modules/dle/naruto.characters.js')
    const { nameKey } = await import('../src/modules/dle/dle.jikan.js')
    const find = (id: string) => NARUTO_CHARACTERS.find((character) => character.id === id)!
    const feedback = compareCharacters(find('sasuke'), find('naruto'))
    assert.equal(feedback.affiliation.verdict, 'partial')
    assert.equal(feedback.nature.verdict, 'wrong')
    assert.equal(feedback.role.verdict, 'partial')
    assert.equal(feedback.gender.verdict, 'exact')
    assert.equal(feedback.status.verdict, 'exact')
    assert.equal(feedback.debut.verdict, 'exact')
    assert.deepEqual(compareCharacters(find('itachi'), find('naruto')).debut, { verdict: 'wrong', direction: 'lower' })
    assert.deepEqual(compareCharacters(find('naruto'), find('zabuza')).debut, { verdict: 'partial', direction: 'higher' })
    assert.equal(compareCharacters(find('rock-lee'), find('tenten')).nature.verdict, 'exact', 'deux natures vides : identiques')

    // Fiches cohérentes : ids uniques, arcs connus.
    assert.equal(new Set(NARUTO_CHARACTERS.map((character) => character.id)).size, NARUTO_CHARACTERS.length)
    assert.ok(NARUTO_CHARACTERS.every((character) => (ARCS as readonly string[]).includes(character.debut)))
    // Romanisations de MyAnimeList.
    assert.equal(nameKey('Hyuuga, Neji'), nameKey('Neji Hyuga'))
    assert.equal(nameKey('Oonoki'), nameKey('Onoki'))
    assert.equal(nameKey('Akimichi, Chouji'), nameKey('Choji Akimichi'))
  })

  it('énigme classique du jour, propre à la catégorie ; gains et série communs', async () => {
    const works = await alice.request('GET', '/dle/works?category=naruto')
    assert.equal(works.status, 200)
    const nagato = works.body.works.find((work: { id: string }) => work.id === 'nagato')
    assert.match(nagato.search, /pain/)
    assert.equal(nagato.rarity, null)

    const view = await alice.request('GET', '/dle/daily/naruto/classic')
    assert.equal(view.status, 200, JSON.stringify(view.body))
    assert.equal(view.body.category, 'naruto')
    const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'naruto', mode: 'classic' } } })
    assert.ok(puzzle)
    const wrong = ['naruto', 'sasuke'].find((id) => id !== puzzle.cardId) as string
    const miss = await alice.request('POST', '/dle/daily/naruto/classic/guess', { cardId: wrong })
    assert.deepEqual(Object.keys(miss.body.view.guesses[0].feedback), ['affiliation', 'nature', 'role', 'gender', 'status', 'debut'])
    assert.ok(Array.isArray(miss.body.view.guesses[0].values.affiliation))
    assert.equal((await alice.request('POST', '/dle/daily/naruto/classic/guess', { cardId: 'card-0' })).body.error.code, 'unknown_work')

    const before = (await alice.request('GET', '/stardust')).body.balance
    const win = await alice.request('POST', '/dle/daily/naruto/classic/guess', { cardId: puzzle.cardId })
    assert.equal(win.body.view.solved, true)
    assert.ok(win.body.earned > 0)
    assert.equal(win.body.balance, before + win.body.earned)
    const overview = (await alice.request('GET', '/dle')).body
    assert.equal(overview.daily.naruto.classic.solved, true)
    assert.equal(overview.daily.naruto.zoom.solved, false)
    assert.equal(overview.daily.manga.classic.solved, true)
  })

  it('portrait : seulement les personnages qui en ont un, image servie sans son adresse', async () => {
    const view = await bastien.request('GET', '/dle/daily/naruto/zoom')
    assert.equal(view.status, 200, JSON.stringify(view.body))
    assert.ok(view.body.focus)
    const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'naruto', mode: 'zoom' } } })
    assert.ok(['naruto', 'sasuke', 'neji', 'kankuro', 'killer-b'].includes(puzzle!.cardId), puzzle!.cardId)
    const image = await bastien.send('GET', '/dle/daily/naruto/zoom/image')
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/jpeg')
    assert.equal((await bastien.send('GET', '/dle/characters/naruto/neji/image')).status, 200)
    assert.equal((await bastien.send('GET', '/dle/characters/naruto/madara/image')).status, 404, 'pas de portrait : 404')
    assert.equal((await bastien.send('GET', '/dle/characters/manga/card-0/image')).status, 404, 'pas une catégorie de personnages')
  })

  it('partie rapide : jamais deux catégories dans le même salon', async () => {
    const first = await chloe.request('POST', '/dle/rooms/quick', { category: 'naruto', mode: 'classic' })
    assert.equal(first.body.category, 'naruto')
    const second = await bastien.request('POST', '/dle/rooms/quick', { category: 'naruto', mode: 'classic' })
    assert.equal(second.body.code, first.body.code)
    const manga = await alice.request('POST', '/dle/rooms/quick', { category: 'manga', mode: 'classic' })
    assert.notEqual(manga.body.code, first.body.code)
    assert.equal(manga.body.category, 'manga')
  })
})

/* ---- One Piece ---------------------------------------------------------------------- */

describe('dle — One Piece', () => {
  it('logique : primes par paliers avec sens, fruits et haki par ensembles', async () => {
    const { ONEPIECE_CHARACTERS, ONEPIECE_ARCS, bountyTier, compareOnePiece } = await import('../src/modules/dle/onepiece.characters.js')
    const find = (id: string) => ONEPIECE_CHARACTERS.find((character) => character.id === id)!
    assert.deepEqual([null, 1000, 100_000_000, 999_000_000, 1_000_000_000, 5_000_000_000].map(bountyTier), [0, 1, 2, 3, 4, 5])
    const feedback = compareOnePiece(find('zoro'), find('luffy'))
    assert.equal(feedback.affiliation.verdict, 'exact')
    assert.equal(feedback.fruit.verdict, 'wrong')
    assert.equal(feedback.haki.verdict, 'exact')
    assert.deepEqual(feedback.bounty, { verdict: 'partial', direction: 'higher' })
    assert.equal(feedback.origin.verdict, 'exact')
    assert.equal(feedback.debut.verdict, 'exact')
    assert.equal(compareOnePiece(find('blackbeard'), find('ace')).fruit.verdict, 'partial', 'deux fruits, dont un logia')
    assert.equal(new Set(ONEPIECE_CHARACTERS.map((character) => character.id)).size, ONEPIECE_CHARACTERS.length)
    assert.ok(ONEPIECE_CHARACTERS.every((character) => (ONEPIECE_ARCS as readonly string[]).includes(character.debut)))
  })

  it('énigme classique et portrait du jour, propres à la catégorie', async () => {
    const classic = await chloe.request('GET', '/dle/daily/onepiece/classic')
    assert.equal(classic.status, 200, JSON.stringify(classic.body))
    const day = logic.parisDay(new Date())
    const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day, category: 'onepiece', mode: 'classic' } } })
    const wrong = ['luffy', 'zoro'].find((id) => id !== puzzle!.cardId) as string
    const miss = await chloe.request('POST', '/dle/daily/onepiece/classic/guess', { cardId: wrong })
    assert.deepEqual(Object.keys(miss.body.view.guesses[0].feedback), ['affiliation', 'fruit', 'haki', 'bounty', 'origin', 'debut'])
    assert.equal(typeof miss.body.view.guesses[0].values.bounty, 'number')

    const portrait = await chloe.request('GET', '/dle/daily/onepiece/zoom')
    assert.equal(portrait.status, 200, JSON.stringify(portrait.body))
    const zoom = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day, category: 'onepiece', mode: 'zoom' } } })
    assert.ok(['luffy', 'zoro', 'nami'].includes(zoom!.cardId), zoom!.cardId)
    assert.equal((await chloe.request('GET', '/dle')).body.daily.onepiece.classic.attempts, 1)
  })
})

/* ---- JoJo ------------------------------------------------------------------------------ */

describe('dle — JoJo', () => {
  it('logique : pouvoirs par ensembles, partie avec sens ; romanisations de MyAnimeList', async () => {
    const { JOJO_CHARACTERS, compareJojo } = await import('../src/modules/dle/jojo.characters.js')
    const { nameKey } = await import('../src/modules/dle/dle.jikan.js')
    const find = (id: string) => JOJO_CHARACTERS.find((character) => character.id === id)!
    const feedback = compareJojo(find('jotaro'), find('dio'))
    assert.equal(feedback.power.verdict, 'partial')
    assert.equal(feedback.stand.verdict, 'exact')
    assert.equal(feedback.role.verdict, 'wrong')
    assert.deepEqual(feedback.debut, { verdict: 'wrong', direction: 'lower' })
    assert.deepEqual(compareJojo(find('josuke'), find('jotaro')).debut, { verdict: 'partial', direction: 'lower' })
    assert.equal(new Set(JOJO_CHARACTERS.map((character) => character.id)).size, JOJO_CHARACTERS.length)
    assert.equal(nameKey('Kuujou, Joutarou'), nameKey('Jotaro Kujo'))
    // Le Josuke de JoJolion ne prend jamais le portrait de celui de la partie 4.
    assert.notEqual(nameKey(find('gappy').name), nameKey('Higashikata, Jousuke'))
  })

  it('énigme classique et portrait du jour', async () => {
    const classic = await chloe.request('GET', '/dle/daily/jojo/classic')
    assert.equal(classic.status, 200, JSON.stringify(classic.body))
    const portrait = await chloe.request('GET', '/dle/daily/jojo/zoom')
    assert.equal(portrait.status, 200, JSON.stringify(portrait.body))
    const zoom = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'jojo', mode: 'zoom' } } })
    assert.ok(['jotaro', 'giorno'].includes(zoom!.cardId), zoom!.cardId)
    assert.equal((await chloe.send('GET', '/dle/characters/jojo/jotaro/image')).status, 200)
  })
})

/* ---- VERSUS / COOP, invités, 10 joueurs ----------------------------------------------- */

describe('dle — invités, COOP, 10 joueurs', () => {
  it('salons de 10 joueurs au plus ; l’hôte choisit VERSUS ou COOP dans la salle d’attente', async () => {
    assert.equal(rooms.MAX_PLAYERS, 10)
    const created = await alice.request('POST', '/dle/rooms', { mode: 'classic', kind: 'coop' })
    assert.equal(created.body.kind, 'coop')
    assert.equal(created.body.maxPlayers, 10)
    const code = created.body.code
    await bastien.request('POST', `/dle/rooms/${code}/join`)
    assert.equal((await bastien.request('POST', `/dle/rooms/${code}/kind`, { kind: 'versus' })).body.error.code, 'not_host')
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/kind`, { kind: 'versus' })).body.kind, 'versus')
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/kind`, { kind: 'coop' })).body.kind, 'coop')
  })

  it('COOP : grille commune avec l’auteur de chaque essai, victoire collective', async () => {
    const code = (await alice.request('GET', '/dle')).body.currentRoom as string
    await alice.request('POST', `/dle/rooms/${code}/start`)
    await wait(rooms.COUNTDOWN_MS + 100)
    const answer = rooms.roomAnswerForTests(code) as string
    const wrong = ['card-6', 'card-7', 'card-8'].find((id) => id !== answer) as string

    const miss = await bastien.request('POST', `/dle/rooms/${code}/guess`, { cardId: wrong })
    assert.equal(miss.status, 200, JSON.stringify(miss.body))
    // Alice voit l'essai de Bastien sur la grille commune, avec son auteur ; elle ne peut pas le reproposer.
    const seen = await alice.request('GET', `/dle/rooms/${code}`)
    assert.equal(seen.body.mine.guesses.length, 1)
    assert.equal(seen.body.mine.guesses[0].work.id, wrong)
    assert.equal(seen.body.mine.guesses[0].by, bastien.userId)
    assert.equal(seen.body.mine.guesses[0].byName, 'Bastien')
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/guess`, { cardId: wrong })).body.error.code, 'already_guessed')

    const win = await alice.request('POST', `/dle/rooms/${code}/guess`, { cardId: answer })
    assert.equal(win.body.phase, 'results')
    const { standings } = win.body.results
    assert.ok(standings.every((entry: { solved: boolean; rank: number }) => entry.solved && entry.rank === 1), 'tout le monde gagne')
    assert.deepEqual(standings.map((entry: { reward: number }) => entry.reward), [rooms.COOP_WIN_REWARD, rooms.COOP_WIN_REWARD])
    await alice.request('POST', `/dle/rooms/${code}/leave`)
    await bastien.request('POST', `/dle/rooms/${code}/leave`)
  })

  it('invité : un pseudo suffit ; ses Poussières sont un reçu signé, échangé une seule fois par un compte', async () => {
    const guest = client()
    const named = await guest.request('POST', '/dle/guest', { name: '  Zorro<script>  ' })
    assert.equal(named.status, 200)
    assert.match(named.body.guest.id, /^guest_/)
    assert.equal(named.body.guest.name, 'Zorroscript')
    assert.equal((await guest.request('GET', '/dle')).body.guest.name, 'Zorroscript')
    assert.equal((await guest.request('GET', '/dle/daily/manga/classic')).status, 401, 'pas d’énigme du jour sans compte')

    const room = await guest.request('POST', '/dle/rooms', { mode: 'classic' })
    assert.equal(room.status, 201, JSON.stringify(room.body))
    const code = room.body.code
    await chloe.request('POST', `/dle/rooms/${code}/join`)
    const lobby = await chloe.request('GET', `/dle/rooms/${code}`)
    assert.deepEqual(lobby.body.players.map((player: { name: string }) => player.name), ['Zorroscript', 'Chloé'])

    await guest.request('POST', `/dle/rooms/${code}/start`)
    await wait(rooms.COUNTDOWN_MS + 100)
    const answer = rooms.roomAnswerForTests(code) as string
    await guest.request('POST', `/dle/rooms/${code}/guess`, { cardId: answer })
    const done = await chloe.request('POST', `/dle/rooms/${code}/forfeit`)
    assert.equal(done.body.phase, 'results')
    assert.equal(done.body.results.receipt, null, 'un compte n’a pas de reçu : ses gains sont déjà en base')
    const final = await guest.request('GET', `/dle/rooms/${code}`)
    const receipt = final.body.results.receipt as string
    assert.ok(receipt)
    assert.equal(final.body.results.standings[0].guest, true)
    assert.equal(final.body.results.standings[0].reward, 40)

    const before = (await chloe.request('GET', '/stardust')).body.balance
    const claimed = await chloe.request('POST', '/stardust/claim', { receipts: [receipt, receipt, `${receipt}x`, 'nimporte.quoi'] })
    assert.equal(claimed.body.credited, 40, 'un reçu compte une fois ; un reçu falsifié, jamais')
    assert.equal(claimed.body.balance, before + 40)
    assert.equal((await alice.request('POST', '/stardust/claim', { receipts: [receipt] })).body.credited, 0, 'déjà échangé, même par un autre compte')
  })

  it('reçus : falsifiés ou périmés, refusés ; plafond par compte', async () => {
    const guests = await import('../src/modules/dle/dle.guests.js')
    const token = guests.signReceipt(30)
    assert.equal(guests.readReceipt(token)?.a, 30)
    const [payload, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), a: 99 })).toString('base64url')}.${signature}`
    assert.equal(guests.readReceipt(forged), null)
    assert.equal(guests.readReceipt(guests.signReceipt(30, Date.now() - 15 * 24 * 60 * 60 * 1000)), null)
    const many = Array.from({ length: 12 }, () => guests.signReceipt(40))
    const claimed = await bastien.request('POST', '/stardust/claim', { receipts: many })
    assert.equal(claimed.body.credited, guests.GUEST_CLAIM_CAP)
  })
})

describe('dle — réglages de l’hôte', () => {
  it('essais illimités par défaut ; l’hôte règle les essais et la durée, les autres non', async () => {
    const created = await alice.request('POST', '/dle/rooms', { mode: 'classic' })
    assert.equal(created.body.maxGuesses, null)
    assert.equal(created.body.roundSeconds, 180)
    const code = created.body.code
    await bastien.request('POST', `/dle/rooms/${code}/join`)
    assert.equal((await bastien.request('POST', `/dle/rooms/${code}/settings`, { maxGuesses: 5 })).body.error.code, 'not_host')
    const set = await alice.request('POST', `/dle/rooms/${code}/settings`, { maxGuesses: 5, roundSeconds: 600 })
    assert.equal(set.body.maxGuesses, 5)
    assert.equal(set.body.roundSeconds, 600)
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/settings`, { roundSeconds: 7 })).status, 400)
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/settings`, { maxGuesses: null })).body.maxGuesses, null)
    await alice.request('POST', `/dle/rooms/${code}/leave`)
    await bastien.request('POST', `/dle/rooms/${code}/leave`)
  })
})

describe('dle — plusieurs formats à la suite', () => {
  it('Classique puis Couverture : la manche suivante part seule, puis le classement général', async () => {
    rooms.ROOM_TIMING.intermissionMs = 200
    const created = await alice.request('POST', '/dle/rooms', { modes: ['zoom', 'classic'] })
    assert.deepEqual(created.body.modes, ['classic', 'zoom'], 'toujours Classique d’abord')
    const code = created.body.code
    await bastien.request('POST', `/dle/rooms/${code}/join`)
    await alice.request('POST', `/dle/rooms/${code}/start`)

    // Manche 1 : Classique. Alice trouve, Bastien abandonne.
    await wait(rooms.COUNTDOWN_MS + 100)
    let view = await alice.request('GET', `/dle/rooms/${code}`)
    assert.equal(view.body.mode, 'classic')
    assert.equal(view.body.stage, 0)
    await alice.request('POST', `/dle/rooms/${code}/guess`, { cardId: rooms.roomAnswerForTests(code) })
    view = await bastien.request('POST', `/dle/rooms/${code}/forfeit`)
    assert.equal(view.body.phase, 'results')
    assert.ok(view.body.nextStageAt, 'la manche suivante est annoncée')
    assert.equal(view.body.results.overall, null)
    assert.equal((await alice.request('POST', `/dle/rooms/${code}/rematch`)).body.error.code, 'room_started', 'pas de revanche avant la fin')

    // Manche 2 : Couverture, d'elle-même. Bastien trouve, Alice abandonne.
    await wait(300 + rooms.COUNTDOWN_MS + 100)
    view = await bastien.request('GET', `/dle/rooms/${code}`)
    assert.equal(view.body.mode, 'zoom')
    assert.equal(view.body.stage, 1)
    assert.equal(view.body.phase, 'playing')
    await bastien.request('POST', `/dle/rooms/${code}/guess`, { cardId: rooms.roomAnswerForTests(code) })
    view = await alice.request('POST', `/dle/rooms/${code}/forfeit`)
    assert.equal(view.body.phase, 'results')
    assert.equal(view.body.nextStageAt, null)
    const overall = view.body.results.overall as { id: string; points: number; solved: number; rank: number }[]
    assert.equal(overall.length, 2)
    assert.deepEqual(overall.map((entry) => [entry.points, entry.solved, entry.rank]), [[3, 1, 1], [3, 1, 1]], 'une manche chacun : égalité')

    // Revanche : retour au salon d'attente, première manche.
    const again = await alice.request('POST', `/dle/rooms/${code}/rematch`)
    assert.equal(again.body.phase, 'lobby')
    assert.equal(again.body.mode, 'classic')
    await alice.request('POST', `/dle/rooms/${code}/leave`)
    await bastien.request('POST', `/dle/rooms/${code}/leave`)
  })
})

describe('dle — Pixels', () => {
  it('énigme du jour propre au format, image servie sans son adresse, gains comme les autres', async () => {
    assert.deepEqual(logic.trailOf('pixel', null, [], true), ['exact'])
    for (const category of ['manga', 'naruto'] as const) {
      const view = await chloe.request('GET', `/dle/daily/${category}/pixel`)
      assert.equal(view.status, 200, JSON.stringify(view.body))
      assert.equal(view.body.mode, 'pixel')
      assert.equal(view.body.focus, null, 'pas de point de mire : on affine, on ne zoome pas')
    }
    // Portrait (les couvertures MangaDex ne sont pas simulées par le banc d'essai).
    assert.equal((await chloe.send('GET', '/dle/daily/naruto/pixel/image')).status, 200)
    assert.equal((await chloe.send('GET', '/dle/daily/manga/classic/image')).status, 400, 'le classique n’a pas d’image')
    const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'naruto', mode: 'pixel' } } })
    assert.ok(['naruto', 'sasuke', 'neji', 'kankuro', 'killer-b'].includes(puzzle!.cardId), 'seulement des personnages qui ont un portrait')
    const win = await chloe.request('POST', '/dle/daily/naruto/pixel/guess', { cardId: puzzle!.cardId })
    assert.ok(win.body.earned > 0)
    assert.equal((await chloe.request('GET', '/dle')).body.daily.naruto.pixel.solved, true)
  })

  it('salons : les Pixels se jouent après Classique et Couverture, toujours dans cet ordre', async () => {
    const created = await alice.request('POST', '/dle/rooms', { modes: ['pixel', 'classic'] })
    assert.deepEqual(created.body.modes, ['classic', 'pixel'])
    const all = await alice.request('POST', `/dle/rooms/${created.body.code}/settings`, { modes: ['pixel', 'zoom', 'classic'] })
    assert.deepEqual(all.body.modes, ['classic', 'zoom', 'pixel'])
    await alice.request('POST', `/dle/rooms/${created.body.code}/leave`)
  })
})

describe('dle — Jujutsu Kaisen', () => {
  it('logique : grades et arcs ordonnés avec sens, affiliations par ensembles ; romanisations', async () => {
    const { JJK_CHARACTERS, JJK_ARCS, compareJjk } = await import('../src/modules/dle/jjk.characters.js')
    const { nameKey } = await import('../src/modules/dle/dle.jikan.js')
    const find = (id: string) => JJK_CHARACTERS.find((character) => character.id === id)!
    const feedback = compareJjk(find('megumi'), find('maki'))
    assert.equal(feedback.affiliation.verdict, 'exact', 'Tokyo et le clan Zen’in, tous les deux')
    assert.deepEqual(feedback.grade, { verdict: 'wrong', direction: 'lower' })
    assert.equal(feedback.gender.verdict, 'wrong')
    assert.deepEqual(feedback.debut, { verdict: 'partial', direction: 'lower' })
    assert.deepEqual(compareJjk(find('nanami'), find('gojo')).grade, { verdict: 'partial', direction: 'higher' })
    assert.equal(new Set(JJK_CHARACTERS.map((character) => character.id)).size, JJK_CHARACTERS.length)
    assert.ok(JJK_CHARACTERS.every((character) => (JJK_ARCS as readonly string[]).includes(character.debut)))
    assert.equal(nameKey('Itadori, Yuuji'), nameKey('Yuji Itadori'))
    assert.equal(nameKey("Zen'in, Maki"), nameKey("Zen'in Maki"))
  })

  it('énigmes du jour : classique, et pixels parmi les personnages qui ont un portrait', async () => {
    const classic = await chloe.request('GET', '/dle/daily/jjk/classic')
    assert.equal(classic.status, 200, JSON.stringify(classic.body))
    const pixel = await chloe.request('GET', '/dle/daily/jjk/pixel')
    assert.equal(pixel.status, 200, JSON.stringify(pixel.body))
    const puzzle = await prisma.dlePuzzle.findUnique({ where: { day_category_mode: { day: logic.parisDay(new Date()), category: 'jjk', mode: 'pixel' } } })
    assert.ok(['yuji', 'gojo', 'maki'].includes(puzzle!.cardId), puzzle!.cardId)
    assert.equal((await chloe.send('GET', '/dle/characters/jjk/gojo/image')).status, 200)
    assert.ok('jjk' in (await chloe.request('GET', '/dle')).body.daily)
  })
})
