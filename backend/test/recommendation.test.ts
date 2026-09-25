import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AlMedia } from '../src/services/anilist.service.js'
import {
  DISCOVERY_EVERY,
  LIKE_DELTA,
  SCORE_LIMIT,
  SKIP_DELTA,
  applyFeedback,
  emptyProfile,
  isExcluded,
  isUnexplored,
  matchPercentage,
  rankDeck,
  type Candidate,
  type TasteProfile,
  type WorkFeatures,
} from '../src/services/recommendation/scoring.js'
import { BILINGUAL } from './fixtures.js'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('recommend')
installMangadexMock()
const { client, close } = await startServer()
after(close)

/* ---- Données de test ------------------------------------------------------ */

const features = (genres: string[], tags: [string, number][] = [], meanScore: number | null = 75): WorkFeatures => ({
  genres,
  tags: tags.map(([name, rank]) => ({ name, rank })),
  meanScore,
})

const ACTION = features(['Action', 'Adventure'], [['Revenge', 90], ['Dungeon', 80]], 78)
const ROMANCE = features(['Romance', 'Comedy'], [['School', 85]], 78)

/** Générateur déterministe : les tests ne dépendent pas de `Math.random`. */
function lcg(seed = 42) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const candidate = (key: number, f: WorkFeatures, popularity = 1000, ids = [`al-${key}`]): Candidate => ({
  key,
  ids,
  features: f,
  popularity,
})

/* ---- Profil ----------------------------------------------------------------- */

describe('recommandation — profil de goûts', () => {
  it('un « j’aime » ajoute +3 aux genres, et aux tags au prorata de leur pertinence', () => {
    const profile = applyFeedback(emptyProfile(), ACTION, LIKE_DELTA)
    assert.equal(profile.genres.Action, 3)
    assert.equal(profile.genres.Adventure, 3)
    assert.equal(profile.tags.Revenge, 2.7)
    assert.equal(profile.tags.Dungeon, 2.4)
  })

  it('un « passer » retire 2 ; ne modifie jamais le profil d’origine', () => {
    const start = emptyProfile()
    const profile = applyFeedback(start, ROMANCE, SKIP_DELTA)
    assert.equal(profile.genres.Romance, -2)
    assert.deepEqual(start, emptyProfile())
  })

  it('annuler un swipe (delta opposé) ramène exactement au profil précédent', () => {
    const liked = applyFeedback(emptyProfile(), ACTION, LIKE_DELTA)
    assert.deepEqual(applyFeedback(liked, ACTION, -LIKE_DELTA), emptyProfile())
  })

  it('les scores sont bornés : cent « j’aime » ne font pas exploser le profil', () => {
    let profile = emptyProfile()
    for (let i = 0; i < 100; i += 1) profile = applyFeedback(profile, ACTION, LIKE_DELTA)
    assert.equal(profile.genres.Action, SCORE_LIMIT)
  })

  it('un tag anecdotique (pertinence < 40 %) ne compte pas', () => {
    const profile = applyFeedback(emptyProfile(), features(['Drama'], [['Cooking', 20]]), LIKE_DELTA)
    assert.equal(profile.tags.Cooking, undefined)
  })
})

/* ---- Compatibilité ------------------------------------------------------------ */

describe('recommandation — pourcentage de match', () => {
  it('sans profil, seule la qualité départage (45-65 %)', () => {
    const empty = emptyProfile()
    const great = matchPercentage(empty, features(['Drama'], [], 92))
    const weak = matchPercentage(empty, features(['Drama'], [], 50))
    assert.ok(great > weak, `${great} > ${weak}`)
    for (const value of [great, weak]) assert.ok(value >= 45 && value <= 65, String(value))
  })

  it('un genre aimé fait monter le match, un genre passé le fait baisser', () => {
    let profile: TasteProfile = emptyProfile()
    profile = applyFeedback(profile, ACTION, LIKE_DELTA)
    profile = applyFeedback(profile, ACTION, LIKE_DELTA)
    profile = applyFeedback(profile, ROMANCE, SKIP_DELTA)
    profile = applyFeedback(profile, ROMANCE, SKIP_DELTA)

    const neutral = matchPercentage(profile, features(['Mystery'], [], 78))
    const action = matchPercentage(profile, features(['Action'], [['Revenge', 95]], 78))
    const romance = matchPercentage(profile, features(['Romance'], [['School', 90]], 78))
    assert.ok(action > 80, `action ${action}`)
    assert.ok(action > neutral && neutral > romance, `${action} > ${neutral} > ${romance}`)
  })

  it('plus de « j’aime » sur un genre → match croissant (monotone)', () => {
    let profile = emptyProfile()
    let previous = matchPercentage(profile, ACTION)
    for (let i = 0; i < 6; i += 1) {
      profile = applyFeedback(profile, ACTION, LIKE_DELTA)
      const next = matchPercentage(profile, ACTION)
      assert.ok(next >= previous, `${next} >= ${previous}`)
      previous = next
    }
  })

  it('toujours un entier entre 0 et 100, quel que soit le profil', () => {
    const random = lcg(7)
    const names = ['Action', 'Romance', 'Drama', 'Horror', 'Comedy', 'Sports']
    for (let run = 0; run < 300; run += 1) {
      const profile: TasteProfile = { genres: {}, tags: {} }
      for (const name of names) profile.genres[name] = Math.round((random() - 0.5) * 2 * SCORE_LIMIT)
      const work = features(
        names.filter(() => random() > 0.5),
        [['Revenge', Math.round(random() * 100)]],
        Math.round(random() * 100),
      )
      const value = matchPercentage(profile, work)
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 100, String(value))
    }
  })

  it('« peu exploré » = aucun de ses genres n’a encore été vraiment jugé', () => {
    const profile = applyFeedback(emptyProfile(), ACTION, LIKE_DELTA)
    assert.equal(isUnexplored(profile, features(['Horror'])), true)
    assert.equal(isUnexplored(profile, features(['Horror', 'Action'])), false)
  })
})

/* ---- Composition du deck ------------------------------------------------------ */

describe('recommandation — filtre anti-répétition et ratio 80/20', () => {
  it('une œuvre déjà vue sous N’IMPORTE LEQUEL de ses ids est écartée', () => {
    const work = candidate(1, ACTION, 1000, ['uuid-md', 'al-1'])
    assert.equal(isExcluded(work, new Set(['al-1'])), true)
    assert.equal(isExcluded(work, new Set(['uuid-md'])), true)
    assert.equal(isExcluded(work, new Set(['al-2'])), false)
  })

  it('rankDeck n’ajoute jamais une œuvre exclue, ni deux fois la même', () => {
    const pool = [
      candidate(1, ACTION, 1000, ['md-1', 'al-1']),
      candidate(1, ACTION, 1000, ['md-1-bis', 'al-1']), // doublon de source
      candidate(2, ROMANCE),
      candidate(3, ACTION),
    ]
    const deck = rankDeck(pool, emptyProfile(), { excluded: new Set(['md-1']), limit: 10, random: lcg() })
    const keys = deck.map((item) => item.candidate.key)
    assert.deepEqual([...keys].sort(), [2, 3])
  })

  it('les cartes suivent la compatibilité : les goûts du profil passent devant', () => {
    let profile = emptyProfile()
    for (let i = 0; i < 3; i += 1) profile = applyFeedback(profile, ACTION, LIKE_DELTA)
    const pool = Array.from({ length: 20 }, (_, index) => candidate(index, index % 2 ? ACTION : ROMANCE))
    const deck = rankDeck(pool, profile, { excluded: new Set(), limit: 4, random: lcg() })
    assert.ok(deck.every((item) => item.candidate.features.genres.includes('Action')))
  })

  it('1 carte sur 5 vient d’un genre peu exploré et très bien noté (> 80 %)', () => {
    let profile = emptyProfile()
    for (let i = 0; i < 4; i += 1) profile = applyFeedback(profile, ACTION, LIKE_DELTA)
    const liked = Array.from({ length: 40 }, (_, index) => candidate(index, ACTION))
    const gems = Array.from({ length: 10 }, (_, index) => candidate(100 + index, features(['Horror'], [], 88)))
    const mediocre = Array.from({ length: 10 }, (_, index) => candidate(200 + index, features(['Sports'], [], 60)))

    const deck = rankDeck([...liked, ...gems, ...mediocre], profile, { excluded: new Set(), limit: 20, random: lcg() })
    assert.equal(deck.length, 20)
    deck.forEach((item, index) => {
      const slot = (index + 1) % DISCOVERY_EVERY === 0
      assert.equal(item.discovery, slot, `position ${index + 1}`)
      if (slot) {
        assert.ok(item.candidate.features.genres.includes('Horror'))
        assert.ok((item.candidate.features.meanScore ?? 0) > 80)
      }
    })
    // Aucune « découverte » médiocre.
    assert.ok(deck.every((item) => !item.candidate.features.genres.includes('Sports') || !item.discovery))
  })

  it('sans pépite à découvrir, le deck se remplit quand même par compatibilité', () => {
    const pool = Array.from({ length: 12 }, (_, index) => candidate(index, features(['Action'], [], 70)))
    const deck = rankDeck(pool, emptyProfile(), { excluded: new Set(), limit: 10, random: lcg() })
    assert.equal(deck.length, 10)
    assert.ok(deck.every((item) => !item.discovery))
  })

  it('instantané : 5 000 candidats classés en moins de 50 ms', () => {
    const random = lcg(3)
    const genres = ['Action', 'Romance', 'Drama', 'Horror', 'Comedy', 'Fantasy', 'Sports', 'Mystery']
    const tags = ['Revenge', 'School', 'Dungeon', 'Isekai', 'Survival', 'Time Travel']
    const pool = Array.from({ length: 5000 }, (_, index) =>
      candidate(
        index,
        features(
          genres.filter(() => random() > 0.7),
          tags.filter(() => random() > 0.6).map((tag) => [tag, Math.round(random() * 100)] as [string, number]),
          Math.round(40 + random() * 55),
        ),
        Math.round(random() * 300_000),
      ),
    )
    let profile = emptyProfile()
    for (const item of pool.slice(0, 40)) profile = applyFeedback(profile, item.features, LIKE_DELTA)
    const excluded = new Set(pool.slice(0, 400).map((item) => `al-${item.key}`))

    rankDeck(pool, profile, { excluded, limit: 20 }) // échauffement du JIT
    const started = performance.now()
    const deck = rankDeck(pool, profile, { excluded, limit: 20 })
    const elapsed = performance.now() - started
    assert.equal(deck.length, 20)
    assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`)
  })
})

/* ---- Intégration : catalogue, deck, profil de compte --------------------------- */

let nextId = 9000
function media(overrides: Partial<AlMedia> & { genres: string[] }): AlMedia {
  nextId += 1
  return {
    id: nextId,
    title: { romaji: `Titre ${nextId}`, english: `Title ${nextId}`, native: null },
    countryOfOrigin: 'JP',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    meanScore: 75,
    popularity: 5000,
    isAdult: false,
    tags: [],
    description: 'A story.<br>(Source: Test)',
    coverImage: { extraLarge: 'https://s4.anilist.co/cover.jpg', large: null, color: null },
    startDate: { year: 2021 },
    siteUrl: `https://anilist.co/manga/${nextId}`,
    staff: { edges: [{ role: 'Story & Art', node: { name: { full: 'Mangaka' } } }] },
    ...overrides,
  }
}

/** Œuvre AniList jointe à la fiche MangaDex BILINGUAL des autres tests. */
const LINKED_ID = 105_398
const ACTION_WORKS = Array.from({ length: 30 }, () =>
  media({ genres: ['Action', 'Adventure'], tags: [{ name: 'Revenge', rank: 90, isMediaSpoiler: false, isAdult: false }] }),
)
const ROMANCE_WORKS = Array.from({ length: 30 }, () => media({ genres: ['Romance', 'Comedy'] }))
const MANHWA_WORKS = Array.from({ length: 15 }, () =>
  media({ genres: ['Fantasy'], countryOfOrigin: 'KR', meanScore: 86 }),
)
const HIDDEN = [
  media({ genres: ['Action'], isAdult: true }),
  media({ genres: ['Action'], format: 'NOVEL' }),
]

describe('deck — catalogue agrégé (intégration)', () => {
  let guest: TestClient

  before(async () => {
    const { upsertMedia, linkMangadex, reloadPool } = await import('../src/services/catalog.service.js')
    await upsertMedia([
      media({ genres: ['Action'], id: LINKED_ID } as Partial<AlMedia> & { genres: string[] }),
      ...ACTION_WORKS,
      ...ROMANCE_WORKS,
      ...MANHWA_WORKS,
      ...HIDDEN,
    ])
    // Deux fiches MangaDex pour la même œuvre : seule la première (la plus suivie) est liée.
    const duplicate = { ...BILINGUAL, id: '99999999-9999-4999-8999-999999999999' }
    const linked = { ...BILINGUAL, attributes: { ...BILINGUAL.attributes, links: { al: String(LINKED_ID) } } }
    await linkMangadex([linked, { ...duplicate, attributes: linked.attributes }])
    await reloadPool()
    guest = client()
  })

  const deck = (who: TestClient, body: Record<string, unknown>) => who.request('POST', '/discover/deck', body)

  it('renvoie des cartes notées (matchPercentage) depuis le catalogue, sans appel réseau', async () => {
    const response = await deck(guest, { limit: 10, lang: 'fr' })
    assert.equal(response.status, 200)
    assert.equal(response.body.source, 'catalog')
    assert.equal(response.body.books.length, 10)
    for (const book of response.body.books) {
      assert.ok(Number.isInteger(book.matchPercentage) && book.matchPercentage >= 0 && book.matchPercentage <= 100)
      assert.equal(typeof book.discovery, 'boolean')
    }
  })

  it('le contenu adulte et les romans n’entrent jamais dans le catalogue', async () => {
    const ids = new Set<string>()
    for (let page = 0; page < 5; page += 1) {
      const response = await deck(guest, { limit: 40, seen: [...ids] })
      for (const book of response.body.books) ids.add(book.id)
    }
    for (const hidden of HIDDEN) assert.equal(ids.has(`al-${hidden.id}`), false)
  })

  it('une œuvre liée à MangaDex est servie avec son UUID et ses textes FR ; le doublon MangaDex est ignoré', async () => {
    const ids = new Set<string>()
    let linked: { id: string; title: string } | undefined
    for (let page = 0; page < 5 && !linked; page += 1) {
      const response = await deck(guest, { limit: 40, seen: [...ids], lang: 'fr' })
      for (const book of response.body.books) ids.add(book.id)
      linked = response.body.books.find((book: { id: string }) => book.id === BILINGUAL.id)
    }
    assert.ok(linked, 'œuvre liée servie')
    assert.equal(linked.title, 'La Voie du sabre')
    assert.equal(ids.has('99999999-9999-4999-8999-999999999999'), false)
    assert.equal(ids.has(`al-${LINKED_ID}`), false)
  })

  it('filtre d’origine : « Manhwa » ne renvoie que des œuvres coréennes', async () => {
    const response = await deck(guest, { origin: 'manhwa', limit: 40 })
    assert.equal(response.body.books.length, MANHWA_WORKS.length)
    assert.ok(response.body.books.every((book: { kind: string }) => book.kind === 'manhwa'))
  })

  it('anti-répétition invité : cartes vues, aimées et passées ne reviennent jamais', async () => {
    const first = (await deck(guest, { limit: 12 })).body.books.map((book: { id: string }) => book.id)
    const liked = first.slice(0, 4).map((id: string) => ({ id, categories: [], rating: null }))
    const skipped = first.slice(4, 8)
    const seen = first.slice(8)
    const next = (await deck(guest, { limit: 40, liked, skipped, seen })).body.books.map((book: { id: string }) => book.id)
    for (const id of first) assert.equal(next.includes(id), false, id)
  })

  it('invité : son historique suffit à personnaliser le deck', async () => {
    const liked = ACTION_WORKS.slice(0, 5).map((work) => ({ id: `al-${work.id}`, categories: [], rating: null }))
    const skipped = ROMANCE_WORKS.slice(0, 5).map((work) => `al-${work.id}`)
    const response = await deck(guest, { limit: 8, liked, skipped })
    assert.equal(response.body.personalized, true)
    const top = response.body.books.filter((book: { discovery: boolean }) => !book.discovery)
    assert.ok(top.every((book: { categories: string[] }) => book.categories.includes('Action')), JSON.stringify(top.map((b: { categories: string[] }) => b.categories)))
    assert.ok(top.every((book: { matchPercentage: number }) => book.matchPercentage > 80))
  })

  it('compte : chaque swipe met à jour le profil (+3 / -2) et « Retour » l’annule', async () => {
    const account = client()
    await account.request('POST', '/auth/register', { email: `reco-${Date.now()}@example.com`, password: 'motdepasse-test' })
    const { prisma } = await import('../src/db.js')
    const me = (await account.request('GET', '/auth/me')).body.user
    const scores = async () =>
      JSON.parse((await prisma.userPreference.findUnique({ where: { userId: me.id } }))?.scores ?? '{"genres":{},"tags":{}}')

    const action = (await deck(account, { shelf: 'action', limit: 1 })).body.books[0]
    await account.request('POST', '/library/swipe', { mangaId: action.id, action: 'wishlist', book: action })
    assert.equal((await scores()).genres.Action, 3)

    const romance = (await deck(account, { shelf: 'romance', limit: 1 })).body.books[0]
    await account.request('POST', '/library/swipe', { mangaId: romance.id, action: 'skipped' })
    // Rejouer le même skip (file d'envoi) ne pénalise pas deux fois.
    await account.request('POST', '/library/swipe', { mangaId: romance.id, action: 'skipped' })
    assert.equal((await scores()).genres.Romance, -2)

    // Anti-répétition côté compte : ni l'œuvre aimée ni l'œuvre passée ne reviennent.
    const all = (await deck(account, { limit: 40 })).body.books.map((book: { id: string }) => book.id)
    assert.equal(all.includes(action.id), false)
    assert.equal(all.includes(romance.id), false)

    // « Retour » sur le skip, puis sur le wishlist : profil revenu à zéro.
    await account.request('DELETE', `/library/${romance.id}`)
    await account.request('DELETE', `/library/${action.id}`)
    const after = await scores()
    assert.equal(after.genres.Romance, undefined)
    assert.equal(after.genres.Action, undefined)
  })

  it('une fiche AniList seule est consultable via /manga/al-<id>', async () => {
    const work = ROMANCE_WORKS[0]!
    const response = await guest.request('GET', `/manga/al-${work.id}?lang=fr`)
    assert.equal(response.status, 200)
    assert.equal(response.body.book.title, `Title ${work.id}`)
    assert.equal(response.body.book.synopsis, 'A story.')
    assert.equal(response.body.book.synopsisLanguage, 'en')
    assert.deepEqual(response.body.book.categories.slice(0, 2), ['Romance', 'Comédie'])
  })
})
