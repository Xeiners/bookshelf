import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { matchesCatalogPace, matchesMood, MOODS, PACES } from '../src/modules/oracle/decks.js'
import type { AlMedia } from '../src/services/anilist.service.js'
import { likeWeight } from '../src/services/recommendation/scoring.js'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('features')
installMangadexMock()
const { client, close } = await startServer()
after(close)

/* ---- Catalogue de test ------------------------------------------------------ */

let nextId = 50_000
type Overrides = Partial<Omit<AlMedia, 'tags'>> & { genres: string[]; tags?: [string, number][] }
function media({ tags = [], ...overrides }: Overrides): AlMedia {
  nextId += 1
  return {
    id: nextId,
    title: { romaji: `Romaji ${nextId}`, english: `English ${nextId}`, native: null },
    countryOfOrigin: 'JP',
    format: 'MANGA',
    status: 'FINISHED',
    chapters: 100,
    meanScore: 80,
    popularity: 10_000,
    isAdult: false,
    description: 'Story.',
    coverImage: { extraLarge: null, large: null, color: null },
    startDate: { year: 2015 },
    siteUrl: `https://anilist.co/manga/${nextId}`,
    staff: { edges: [{ role: 'Story & Art', node: { name: { full: `Author ${nextId}` } } }] },
    ...overrides,
    tags: tags.map(([name, rank]) => ({ name, rank, isMediaSpoiler: false, isAdult: false })),
  }
}

const HUNTER = media({
  genres: ['Action', 'Adventure'],
  title: { romaji: 'Hunter x Hunter', english: 'Hunter × Hunter', native: 'ハンター×ハンター' },
  staff: { edges: [{ role: 'Story & Art', node: { name: { full: 'Yoshihiro Togashi' } } }] },
  popularity: 200_000,
  meanScore: 90,
  status: 'RELEASING',
  chapters: null,
  startDate: { year: 1998 },
})
const ROMANCE_KR = Array.from({ length: 12 }, (_, index) =>
  media({ genres: ['Romance', 'Drama'], countryOfOrigin: 'KR', meanScore: 70 + index, startDate: { year: 2010 + index } }),
)
const HORROR = Array.from({ length: 12 }, (_, index) =>
  media({
    genres: ['Horror', 'Mystery'],
    countryOfOrigin: (['JP', 'KR', 'CN'] as const)[index % 3],
    meanScore: 76 + (index % 10),
    status: index % 2 ? 'FINISHED' : 'RELEASING',
    chapters: index % 2 ? 40 : null,
  }),
)
const ACTION = Array.from({ length: 30 }, (_, index) =>
  media({ genres: ['Action'], countryOfOrigin: index % 5 === 0 ? 'CN' : 'JP', meanScore: 74 + (index % 15), popularity: 1000 * (index + 1) }),
)

before(async () => {
  const { upsertMedia, reloadPool } = await import('../src/services/catalog.service.js')
  await upsertMedia([HUNTER, ...ROMANCE_KR, ...HORROR, ...ACTION])
  await reloadPool()
})

/* ---- Favoris et notes ------------------------------------------------------- */

describe('favoris et notes personnelles', () => {
  it('poids d’un titre aimé : favori +2, ±2 par étoile d’écart à 3★', () => {
    assert.equal(likeWeight({}), 3)
    assert.equal(likeWeight({ favorite: true }), 5)
    assert.equal(likeWeight({ userRating: 5 }), 7)
    assert.equal(likeWeight({ userRating: 1 }), -1)
    assert.equal(likeWeight({ favorite: true, userRating: 4.5 }), 8)
  })

  let account: TestClient
  let userId: string
  const scores = async () => {
    const { prisma } = await import('../src/db.js')
    const row = await prisma.userPreference.findUnique({ where: { userId } })
    return JSON.parse(row?.scores ?? '{"genres":{},"tags":{}}') as { genres: Record<string, number> }
  }

  before(async () => {
    account = client()
    await account.request('POST', '/auth/register', { email: `fav-${Date.now()}@example.com`, password: 'motdepasse-test' })
    userId = (await account.request('GET', '/auth/me')).body.user.id
    const book = (await account.request('GET', `/manga/al-${HUNTER.id}?lang=fr`)).body.book
    await account.request('POST', '/library/swipe', { mangaId: book.id, action: 'read', book })
  })

  it('favori et note sont enregistrés, relus avec la bibliothèque', async () => {
    const patched = await account.request('PATCH', `/library/al-${HUNTER.id}`, { favorite: true, userRating: 4.5 })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.entry.favorite, true)
    assert.equal(patched.body.entry.userRating, 4.5)
    const library = (await account.request('GET', '/library')).body
    assert.equal(library.entries[0].favorite, true)
    assert.equal(library.entries[0].userRating, 4.5)
  })

  it('le profil suit : 3 (lu) + 2 (favori) + 3 (4,5★) = 8 sur Action', async () => {
    assert.equal((await scores()).genres.Action, 8)
  })

  it('baisser la note ou retirer le favori n’applique que l’écart', async () => {
    await account.request('PATCH', `/library/al-${HUNTER.id}`, { userRating: 1, favorite: false })
    assert.equal((await scores()).genres.Action, -1)
    await account.request('PATCH', `/library/al-${HUNTER.id}`, { userRating: null })
    assert.equal((await scores()).genres.Action, 3)
  })

  it('note refusée hors des demi-étoiles 0,5 → 5', async () => {
    for (const userRating of [0, 0.3, 5.5, 3.25]) {
      const response = await account.request('PATCH', `/library/al-${HUNTER.id}`, { userRating })
      assert.equal(response.status, 400, String(userRating))
    }
  })

  it('retirer le titre annule tout son poids (favori et note compris)', async () => {
    await account.request('PATCH', `/library/al-${HUNTER.id}`, { favorite: true, userRating: 5 })
    await account.request('DELETE', `/library/al-${HUNTER.id}`)
    assert.equal((await scores()).genres.Action, undefined)
  })

  it('fusion invité → compte : favori et note rejoignent le compte', async () => {
    const device = client()
    const book = (await device.request('GET', `/manga/al-${ROMANCE_KR[0]!.id}?lang=fr`)).body.book
    const register = await device.request('POST', '/auth/register', {
      email: `merge-fav-${Date.now()}@example.com`,
      password: 'motdepasse-test',
      initialData: { entries: [{ book, status: 'read', progress: 1, favorite: true, userRating: 3.5 }], skipped: [] },
    })
    assert.equal(register.status, 201)
    const entry = (await device.request('GET', '/library')).body.entries[0]
    assert.equal(entry.favorite, true)
    assert.equal(entry.userRating, 3.5)
  })
})

/* ---- Recherche --------------------------------------------------------------- */

describe('recherche dans le catalogue', () => {
  const guest = client()
  const browse = (body: Record<string, unknown>) => guest.request('POST', '/discover/browse', { lang: 'fr', ...body })

  it('titres de toutes les langues, sans accents ni ponctuation, et auteurs', async () => {
    for (const q of ['hunter x', 'HUNTER × HUNTER', 'ハンター', 'togashi']) {
      const { body } = await browse({ q })
      assert.equal(body.books[0]?.id, `al-${HUNTER.id}`, q)
    }
  })

  it('filtres combinés : origine + genres (ET) + note minimale', async () => {
    const { body } = await browse({ origin: 'manhwa', genres: ['Romance', 'Drama'], minScore: 78, limit: 48 })
    assert.equal(body.total, ROMANCE_KR.filter((work) => (work.meanScore ?? 0) >= 78).length)
    assert.ok(body.books.every((book: { kind: string; rating: number }) => book.kind === 'manhwa' && book.rating >= 3.9))
  })

  it('statut de parution', async () => {
    const ongoing = (await browse({ genres: ['Horror'], status: 'ongoing', limit: 48 })).body
    const completed = (await browse({ genres: ['Horror'], status: 'completed', limit: 48 })).body
    assert.equal(ongoing.total + completed.total, HORROR.length)
    assert.ok(ongoing.books.every((book: { publicationStatus: string }) => book.publicationStatus === 'ongoing'))
  })

  it('tris : note, récents, popularité', async () => {
    const byScore = (await browse({ genres: ['Romance'], sort: 'score' })).body.books.map((book: { rating: number }) => book.rating)
    assert.deepEqual(byScore, [...byScore].sort((a, b) => b - a))
    const byYear = (await browse({ genres: ['Romance'], sort: 'recent' })).body.books.map((book: { year: number }) => book.year)
    assert.deepEqual(byYear, [...byYear].sort((a, b) => b - a))
    const popular = (await browse({ sort: 'popularity' })).body.books[0]
    assert.equal(popular.id, `al-${HUNTER.id}`)
  })

  it('« Pour toi » : trié par % de match d’après l’historique', async () => {
    const liked = HORROR.slice(0, 4).map((work) => ({ id: `al-${work.id}`, favorite: true }))
    const { body } = await browse({ sort: 'match', liked, limit: 10 })
    assert.equal(body.personalized, true)
    const matches = body.books.map((book: { matchPercentage: number }) => book.matchPercentage)
    assert.deepEqual(matches, [...matches].sort((a, b) => b - a))
    assert.ok(body.books.slice(0, 5).every((book: { categories: string[] }) => book.categories.includes('Horreur')))
  })

  it('pagination sans doublon, hasMore exact', async () => {
    const first = (await browse({ limit: 20, sort: 'popularity' })).body
    const second = (await browse({ limit: 20, page: 2, sort: 'popularity' })).body
    const ids = [...first.books, ...second.books].map((book: { id: string }) => book.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(first.hasMore, true)
    const last = (await browse({ limit: 20, page: Math.ceil(first.total / 20), sort: 'popularity' })).body
    assert.equal(last.hasMore, false)
  })

  it('titre rare : réponse du catalogue immédiate, complément MangaDex à part', async () => {
    const first = (await browse({ q: 'blade road' })).body
    assert.equal(first.supplement, true)
    assert.equal(first.books.length, 0)
    const extra = (await browse({ q: 'blade road', source: 'mangadex' })).body
    assert.ok(extra.books.some((book: { id: string }) => book.id === '11111111-1111-4111-8111-111111111111'))
    // Une recherche fournie ne déclenche pas de complément.
    assert.equal((await browse({ q: 'romaji' })).body.supplement, false)
  })

  it('complément MangaDex : une œuvre déjà au catalogue (même id AniList) n’est pas doublée', async () => {
    const { reloadPool } = await import('../src/services/catalog.service.js')
    const { prisma } = await import('../src/db.js')
    const { BILINGUAL } = await import('./fixtures.js')
    // Une autre fiche MangaDex, liée à l'œuvre AniList HUNTER, est déjà au catalogue…
    await prisma.catalogWork.update({ where: { anilistId: HUNTER.id }, data: { mangadexId: '99999999-0000-4000-8000-000000000000' } })
    await reloadPool()
    // … la fiche BILINGUAL de la même œuvre (links.al) ne doit pas ressortir en complément.
    BILINGUAL.attributes.links = { al: String(HUNTER.id) }
    // Autre texte : autre clé de cache, la réponse MangaDex (simulée) porte le lien.
    const extra = (await browse({ q: 'la voie du sabre', source: 'mangadex' })).body
    const ids = extra.books.map((book: { id: string }) => book.id)
    assert.equal(ids.includes(BILINGUAL.id), false)
    // Les fiches sans équivalent au catalogue, elles, sont bien proposées.
    assert.ok(ids.includes('22222222-2222-4222-8222-222222222222'))
  })

  it('genres proposés en filtre, traduits', async () => {
    const { body } = await guest.request('GET', '/discover/genres?lang=fr')
    const horror = body.genres.find((genre: { id: string }) => genre.id === 'Horror')
    assert.deepEqual(horror, { id: 'Horror', label: 'Horreur', count: HORROR.length })
  })
})

/* ---- Oracle ------------------------------------------------------------------ */

describe('Oracle — tirage sur le catalogue', () => {
  it('rythme « épique » : chapitres connus ≥ 150, OU série en cours depuis 6 ans', () => {
    const epic = PACES.find((pace) => pace.id === 'epic')!
    assert.equal(matchesCatalogPace(epic, { status: 'FINISHED', chapters: 200, year: 2010 }, 2026), true)
    assert.equal(matchesCatalogPace(epic, { status: 'RELEASING', chapters: null, year: 2015 }, 2026), true)
    assert.equal(matchesCatalogPace(epic, { status: 'RELEASING', chapters: null, year: 2024 }, 2026), false)
    const short = PACES.find((pace) => pace.id === 'short')!
    assert.equal(matchesCatalogPace(short, { status: 'FINISHED', chapters: 40, year: 2020 }, 2026), true)
    assert.equal(matchesCatalogPace(short, { status: 'FINISHED', chapters: null, year: 2020 }, 2026), false)
  })

  it('ambiance à tags : il faut un tag pertinent (≥ 50 %)', () => {
    const isekai = MOODS.find((mood) => mood.id === 'isekai')!
    assert.equal(matchesMood(isekai, { genres: ['Fantasy'], tags: [{ name: 'Isekai', rank: 80 }] }), true)
    assert.equal(matchesMood(isekai, { genres: ['Fantasy'], tags: [{ name: 'Isekai', rank: 20 }] }), false)
  })

  it('les titres tirés portent l’ambiance, le tirage est déterministe', async () => {
    const guest = client()
    let checked = 0
    for (let day = 1; day <= 60 && checked < 3; day += 1) {
      const seed = `device-x:2026-01-${String(day).padStart(2, '0')}`
      const first = (await guest.request('GET', `/oracle/draw?seed=${seed}&lang=fr`)).body
      if (!['action', 'horror', 'mystery'].includes(first.mood)) continue
      checked += 1
      const again = (await guest.request('GET', `/oracle/draw?seed=${seed}&lang=fr`)).body
      assert.deepEqual(again.picks.map((b: { id: string }) => b.id), first.picks.map((b: { id: string }) => b.id))
      const label = { action: 'Action', horror: 'Horreur', mystery: 'Mystère' }[first.mood as 'action']
      assert.ok(first.picks.every((book: { categories: string[] }) => book.categories.includes(label)), first.mood)
    }
    assert.ok(checked > 0, 'au moins un tirage sur une ambiance du catalogue de test')
  })

  it('de tout : sur 60 jours, la Pépite vient de plusieurs origines', async () => {
    const guest = client()
    const kinds = new Set<string>()
    for (let day = 1; day <= 60; day += 1) {
      const seed = `device-y:2026-02-${String(day).padStart(2, '0')}`
      const draw = (await guest.request('GET', `/oracle/draw?seed=${seed}&lang=fr`)).body
      if (draw.picks[0]?.id.startsWith('al-')) kinds.add(draw.picks[0].kind)
    }
    assert.ok(kinds.size >= 2, [...kinds].join(','))
  })
})
