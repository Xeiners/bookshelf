/**
 * Revue des images d'énigme (administration) : clé stable d'une image, file des images à revoir,
 * valider / bannir / effacer, journal, accès réservé aux administrateurs ; et une image bannie
 * n'est plus jamais tirée comme énigme.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('dle-review')
process.env.ADMIN_EMAILS = 'chef@example.com'
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { createDleReview } = await import('../src/modules/dle/dle.review.js')
const { reviewKey } = await import('../src/modules/dle/dle.jikan.js')
const { forgetReviews, isBanned } = await import('../src/modules/dle/dle.review.store.js')

type Account = TestClient & { userId: string; email: string }
let admin: Account
let visitor: Account

before(async () => {
  for (const [email, name] of [['chef@example.com', 'Chef'], ['simple@example.com', 'Simple']] as const) {
    const device = client()
    const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
    assert.equal(signed.status, 201, JSON.stringify(signed.body))
    const account = Object.assign(device, { userId: signed.body.user.id as string, email })
    if (email.startsWith('chef')) admin = account
    else visitor = account
  }
})

beforeEach(async () => {
  await prisma.dleImageReview.deleteMany()
  await prisma.adminAction.deleteMany()
  forgetReviews()
})

/** Un univers de test : deux personnages et quelques images candidates, sans réseau. */
function fakeUniverse() {
  const urls = {
    shika: ['https://static.wikia.nocookie.net/naruto/images/a/ab/Shikamaru_Part_II.png/revision/latest/scale-to-width-down/900?cb=2020', 'https://cdn.myanimelist.net/images/characters/3/12345l.jpg', 'https://s4.anilist.co/file/anilistcdn/character/large/b1-x.png'],
    hidan: ['https://static.wikia.nocookie.net/naruto/images/c/cd/Hidan.png/revision/latest/scale-to-width-down/900'],
  }
  let loaded = true
  const bytes = { body: Buffer.from('x'), contentType: 'image/png' }
  const portraits = {
    charactersWithPortrait: async () => new Set(['shika', 'hidan']),
    charactersWithPuzzleImage: async () => new Set(['shika', 'hidan']),
    candidates: async () => ({ ready: loaded, images: new Map(Object.entries(urls)) }),
    peekCandidates: () => (loaded ? new Map(Object.entries(urls)) : null),
    candidateImage: async () => bytes,
    portraitImage: async () => bytes,
    puzzleImage: async () => bytes,
    forget: () => undefined,
  }
  return {
    universe: { label: 'Naruto', portraits, characters: [{ id: 'shika', name: 'Shikamaru Nara' }, { id: 'hidan', name: 'Hidan' }] },
    urls,
    unload: () => (loaded = false),
  }
}

const adminActor = () => ({ id: 'admin-test', email: 'chef@example.com' })

describe('revue des images — clé stable', () => {
  it('même image, quelle que soit la taille, la révision ou les paramètres demandés', () => {
    assert.equal(reviewKey('https://cdn.myanimelist.net/images/characters/3/12345.jpg'), reviewKey('https://cdn.myanimelist.net/images/characters/3/12345l.jpg'))
    assert.equal(reviewKey('https://static.wikia.nocookie.net/naruto/images/a/ab/Shika.png/revision/latest/scale-to-width-down/900?cb=1'), reviewKey('https://static.wikia.nocookie.net/naruto/images/a/ab/Shika.png/revision/latest?cb=2'))
    assert.notEqual(reviewKey('https://cdn.myanimelist.net/images/characters/3/12345.jpg'), reviewKey('https://cdn.myanimelist.net/images/characters/3/99999.jpg'))
  })
})

describe('revue des images — la file et les décisions', () => {
  it('la file suit l’ordre des personnages, et ce qu’on a jugé n’y revient pas', async () => {
    const { universe, urls } = fakeUniverse()
    const review = createDleReview({ naruto: universe })
    const first = await review.queue('naruto', 10)
    assert.deepEqual([first.ready, first.remaining, first.items.length], [true, 4, 4])
    assert.deepEqual(first.items.map((item) => item.characterId), ['shika', 'shika', 'shika', 'hidan'])
    assert.equal(first.items[0]!.name, 'Shikamaru Nara')
    const key = first.items[0]!.key
    assert.equal((await review.decide(adminActor(), 'naruto', 'shika', key, 'approve')).remaining, 3)
    const second = await review.queue('naruto', 2)
    assert.deepEqual([second.remaining, second.items.length], [3, 2])
    assert.ok(second.items.every((item) => item.key !== key))
    assert.equal(reviewKey(urls.shika[0]!), key)
  })

  it('bannir : l’image est exclue du tirage, journalisée, et l’annulation la rend', async () => {
    const { universe, urls } = fakeUniverse()
    const review = createDleReview({ naruto: universe })
    const key = reviewKey(urls.shika[1]!)
    await review.decide(adminActor(), 'naruto', 'shika', key, 'ban')
    assert.equal(isBanned('naruto', 'shika', key), true)
    assert.equal(isBanned('naruto', 'hidan', key), false, 'par personnage')
    assert.equal((await prisma.dleImageReview.findFirstOrThrow()).status, 'BANNED')
    assert.equal(await prisma.adminAction.count({ where: { action: 'dle_image_ban' } }), 1)
    // Après un redémarrage (mémoire vidée), la base fait foi.
    forgetReviews()
    const overview = (await review.overview())[0]!
    assert.deepEqual([overview.banned, overview.approved], [1, 0])
    assert.equal(isBanned('naruto', 'shika', key), true)
    await review.decide(adminActor(), 'naruto', 'shika', key, 'clear')
    assert.equal(isBanned('naruto', 'shika', key), false)
    assert.equal(await prisma.dleImageReview.count(), 0)
    assert.equal(await prisma.adminAction.count({ where: { action: 'dle_image_restore' } }), 1)
  })

  it('un verdict peut changer : validée puis bannie, une seule ligne', async () => {
    const { universe, urls } = fakeUniverse()
    const review = createDleReview({ naruto: universe })
    const key = reviewKey(urls.shika[2]!)
    await review.decide(adminActor(), 'naruto', 'shika', key, 'approve')
    await review.decide(adminActor(), 'naruto', 'shika', key, 'ban')
    assert.equal(await prisma.dleImageReview.count(), 1)
    assert.equal(isBanned('naruto', 'shika', key), true)
  })

  it('refuse l’inconnu : univers, personnage, clé inventée, images pas encore chargées', async () => {
    const { universe, unload } = fakeUniverse()
    const review = createDleReview({ naruto: universe })
    await assert.rejects(review.queue('inconnu', 5), /introuvable/i)
    await assert.rejects(review.decide(adminActor(), 'naruto', 'personne', 'k', 'ban'), /introuvable/i)
    await assert.rejects(review.decide(adminActor(), 'naruto', 'shika', 'cle-inventee', 'ban'), /plus candidate/i)
    assert.equal(await prisma.dleImageReview.count(), 0)
    unload()
    assert.equal((await review.queue('naruto', 5)).ready, false)
    await assert.rejects(review.decide(adminActor(), 'naruto', 'shika', 'k', 'ban'), /chargent/i)
  })
})

describe('revue des images — routes', () => {
  it('réservées aux administrateurs (404 pour les autres)', async () => {
    const guest = client()
    for (const route of ['/admin/dle-images', '/admin/dle-images/naruto/queue']) {
      assert.equal((await guest.request('GET', route)).status, 401, route)
      assert.equal((await visitor.request('GET', route)).status, 404, route)
    }
    assert.equal((await visitor.request('POST', '/admin/dle-images/naruto/review', { characterId: 'x', key: 'y', decision: 'ban' })).status, 404)
  })

  it('l’administrateur voit les univers ; une décision mal formée ou sur un inconnu est refusée', async () => {
    const overview = await admin.request('GET', '/admin/dle-images')
    assert.equal(overview.status, 200, JSON.stringify(overview.body))
    const categories = overview.body.universes.map((entry: { category: string }) => entry.category)
    assert.deepEqual(categories, ['naruto', 'onepiece', 'jojo', 'jjk', 'dragonball', 'mha', 'aot', 'hxh', 'fireforce'])
    assert.equal((await admin.request('POST', '/admin/dle-images/naruto/review', { characterId: 'x', key: 'y', decision: 'detruire' })).status, 400)
    assert.equal((await admin.request('POST', '/admin/dle-images/inconnu/review', { characterId: 'x', key: 'y', decision: 'clear' })).status, 404)
    assert.equal((await admin.request('GET', '/admin/dle-images/naruto/image?character=inconnu&key=k')).status, 404)
  })
})
