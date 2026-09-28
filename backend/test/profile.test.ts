/**
 * Profil : lecture enrichie (statistiques, cartes exposées, titres), mise à
 * jour avec vérification stricte de la possession des cartes, compteur de
 * boosters, changement de mot de passe et espace occupé par les romans.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('profile')
installMangadexMock()
mockedHosts.add('graphql.anilist.co')
mockedHosts.add('kitsu.io')
extraMocks.push((url) => {
  if (url.hostname === 'kitsu.io') {
    return new Response(JSON.stringify(url.pathname.endsWith('/characters') ? { data: [], included: [] } : { data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    })
  }
  return url.hostname === 'graphql.anilist.co'
    ? new Response(JSON.stringify({
        data: {
          Page: {
            media: [{ title: { english: 'Œuvre COMMON' }, characters: { edges: [{ role: 'MAIN', node: { name: { full: 'Hero COMMON' }, image: { large: 'https://s4.anilist.co/file/anilistcdn/character/large/hero.jpg' } } }] } }],
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : undefined,
})
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')

const PASSWORD = 'motdepasse-test'
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const

/** Un petit set, une carte par rareté : `card-common`, `card-rare`… */
const CARD_IDS = RARITIES.map((rarity) => `card-${rarity.toLowerCase()}`)

before(async () => {
  await prisma.card.createMany({
    data: RARITIES.map((rarity, index) => ({
      id: CARD_IDS[index]!,
      number: index + 1,
      title: `Œuvre ${rarity}`,
      name: `Œuvre ${rarity}`,
      imageUrl: `/api/covers/${index}`,
      rarity,
      mangaId: `manga-${index}`,
      characterName: index === 0 ? 'Hero COMMON' : null,
    })),
  })
})

async function signedUp(): Promise<TestClient & { userId: string; email: string }> {
  const account = client()
  const email = `profile-${Date.now()}-${Math.random()}@example.com`
  await account.signUp({ email, password: PASSWORD, displayName: 'Lectrice' })
  const userId = (await account.request('GET', '/auth/me')).body.user.id as string
  return Object.assign(account, { userId, email })
}

/** Donne des cartes au compte, sans passer par un booster. */
const give = (userId: string, cardIds: string[], count = 1) =>
  prisma.userCard.createMany({ data: cardIds.map((cardId) => ({ userId, cardId, count })) })

describe('GET /api/profile/me', () => {
  it('réservé aux comptes : 401 pour un invité', async () => {
    assert.equal((await client().request('GET', '/profile/me')).status, 401)
    assert.equal((await client().request('PATCH', '/profile', { bio: 'x' })).status, 401)
  })

  it('compte neuf : profil vierge, statistiques à zéro, seul le titre de départ débloqué', async () => {
    const account = await signedUp()
    const { status, body } = await account.request('GET', '/profile/me')
    assert.equal(status, 200)
    assert.equal(body.profile.displayName, 'Lectrice')
    assert.equal(body.profile.email, account.email)
    assert.equal(body.profile.bio, null)
    assert.equal(body.profile.avatarUrl, null)
    assert.equal(body.profile.avatar, null)
    assert.deepEqual(body.profile.featured, [])
    assert.equal(body.profile.activeTitle, null)
    assert.equal(typeof body.profile.createdAt, 'number')

    assert.equal(body.stats.collection.total, RARITIES.length)
    assert.equal(body.stats.collection.owned, 0)
    assert.deepEqual(body.stats.collection.byRarity.MYTHIC, { total: 1, owned: 0 })
    assert.equal(body.stats.reading.consulted, 0)
    assert.equal(body.stats.reading.completion, 0)
    assert.equal(body.stats.gacha.boostersOpened, 0)
    assert.deepEqual(
      body.titles.filter((title: { unlocked: boolean }) => title.unlocked).map((title: { id: string }) => title.id),
      ['newcomer'],
    )
  })

  it('statistiques : cartes par rareté (doublons à part), lectures et progression globale', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-common', 'card-mythic'], 3)
    const entry = (workId: string, status: string) => ({ userId: account.userId, workId, status, snapshot: '{}', title: workId })
    await prisma.libraryEntry.createMany({
      data: [entry('w1', 'read'), entry('w2', 'reading'), entry('w3', 'wishlist'), entry('w4', 'read')],
    })

    const { body } = await account.request('GET', '/profile/me')
    assert.equal(body.stats.collection.owned, 2)
    assert.equal(body.stats.collection.copies, 6)
    assert.deepEqual(body.stats.collection.byRarity.COMMON, { total: 1, owned: 1 })
    assert.deepEqual(body.stats.collection.byRarity.RARE, { total: 1, owned: 0 })
    assert.equal(body.stats.reading.read, 2)
    assert.equal(body.stats.reading.reading, 1)
    assert.equal(body.stats.reading.wishlist, 1)
    // Ouverts : 2 lus + 1 en cours ; terminés : 2 sur 3.
    assert.equal(body.stats.reading.consulted, 3)
    assert.equal(body.stats.reading.completion, 0.667)
    assert.equal(body.titles.find((title: { id: string }) => title.id === 'mythicHunter').unlocked, true)
  })

  it('vitrine automatique : les trois dernières œuvres lues, dans l’ordre récent', async () => {
    const account = await signedUp()
    await prisma.libraryEntry.createMany({
      data: [1, 2, 3, 4].map((index) => ({
        userId: account.userId,
        workId: `recent-${index}`,
        status: index === 1 ? 'wishlist' : 'reading',
        title: `Lecture ${index}`,
        snapshot: JSON.stringify({ cover: `https://images.example.test/${index}.jpg` }),
        updatedAt: new Date(2026, 0, index),
      })),
    })

    const { body } = await account.request('GET', '/profile/me')
    assert.deepEqual(body.profile.recentReads.map((work: { id: string }) => work.id), ['recent-4', 'recent-3', 'recent-2'])
    assert.equal(body.profile.recentReads[0].cover, 'https://images.example.test/4.jpg')
  })
})

describe('PATCH /api/profile', () => {
  it('pseudo, bio, avatar et vitrine de cartes possédées : enregistrés, fiches détaillées dans l’ordre choisi', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-rare', 'card-epic', 'card-legendary'])

    const { status, body } = await account.request('PATCH', '/profile', {
      displayName: '  Kaori  ',
      bio: '  Fan de seinen.  ',
      avatarCardId: 'card-legendary',
      featuredCardIds: ['card-epic', 'card-rare', 'card-legendary'],
    })
    assert.equal(status, 200)
    assert.equal(body.profile.displayName, 'Kaori')
    assert.equal(body.profile.bio, 'Fan de seinen.')
    assert.equal(body.profile.avatar.id, 'card-legendary')
    assert.equal(body.profile.avatar.rarity, 'LEGENDARY')
    assert.deepEqual(body.profile.featured.map((card: { id: string }) => card.id), ['card-epic', 'card-rare', 'card-legendary'])
    assert.equal(body.profile.featured[0].count, 1)

    // Relu depuis la base, et le pseudo suit sur la session.
    assert.equal((await account.request('GET', '/profile/me')).body.profile.avatar.id, 'card-legendary')
    assert.equal((await account.request('GET', '/auth/me')).body.user.displayName, 'Kaori')
  })

  it('texte vide ou `null` : effacé ; champ absent : inchangé', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-common'])
    await account.request('PATCH', '/profile', { bio: 'Une bio', avatarCardId: 'card-common' })

    const cleared = await account.request('PATCH', '/profile', { bio: '   ' })
    assert.equal(cleared.body.profile.bio, null)
    assert.equal(cleared.body.profile.avatar.id, 'card-common', 'avatar inchangé')

    const noAvatar = await account.request('PATCH', '/profile', { avatarCardId: null, featuredCardIds: [] })
    assert.equal(noAvatar.body.profile.avatar, null)
    assert.deepEqual(noAvatar.body.profile.featured, [])
  })

  it('avatar de bibliothèque : URL HTTPS enregistrée, prioritaire et exclusive avec la carte', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-common'])
    await account.request('PATCH', '/profile', { avatarCardId: 'card-common' })

    const avatarUrl = 'https://covers.openlibrary.org/b/id/42-L.jpg#bookshelf-avatar=1.25,45,32,hexagon'
    const selected = await account.request('PATCH', '/profile', { avatarUrl })
    assert.equal(selected.status, 200)
    assert.equal(selected.body.profile.avatarUrl, avatarUrl)
    assert.equal(selected.body.profile.avatar, null)

    const card = await account.request('PATCH', '/profile', { avatarCardId: 'card-common' })
    assert.equal(card.body.profile.avatarUrl, null)
    assert.equal(card.body.profile.avatar.id, 'card-common')

    const unsafe = await account.request('PATCH', '/profile', { avatarUrl: 'javascript:alert(1)' })
    assert.equal(unsafe.status, 400)
    assert.equal(unsafe.body.error.code, 'validation_error')
  })

  it('galerie avatar : une œuvre de la bibliothèque expose uniquement ses personnages', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-common'])
    await prisma.libraryEntry.create({
      data: {
        userId: account.userId,
        workId: 'manga-0',
        status: 'reading',
        title: 'Œuvre COMMON',
        snapshot: JSON.stringify({ id: 'manga-0', title: 'Œuvre COMMON', cover: 'https://images.example.test/main.jpg' }),
      },
    })

    const { status, body } = await account.request('GET', '/profile/avatar-options?kind=library&workId=manga-0')
    assert.equal(status, 200)
    assert.equal(body.title, 'Œuvre COMMON')
    assert.deepEqual(body.options.map((option: { source: string }) => option.source), ['character'])

    const other = await signedUp()
    assert.equal((await other.request('GET', '/profile/avatar-options?kind=library&workId=manga-0')).status, 404)
  })

  it('carte non possédée (avatar ou vitrine) : 400 `card_not_owned`, rien n’est écrit', async () => {
    const account = await signedUp()
    await give(account.userId, ['card-common'])
    await account.request('PATCH', '/profile', { bio: 'Avant', featuredCardIds: ['card-common'] })

    const featured = await account.request('PATCH', '/profile', {
      bio: 'Après',
      featuredCardIds: ['card-common', 'card-mythic'],
    })
    assert.equal(featured.status, 400)
    assert.equal(featured.body.error.code, 'card_not_owned')
    assert.deepEqual(featured.body.error.cardIds, ['card-mythic'])

    const avatar = await account.request('PATCH', '/profile', { avatarCardId: 'card-epic' })
    assert.equal(avatar.body.error.code, 'card_not_owned')
    const unknown = await account.request('PATCH', '/profile', { avatarCardId: 'carte-inexistante' })
    assert.equal(unknown.body.error.code, 'card_not_owned')

    const { body } = await account.request('GET', '/profile/me')
    assert.equal(body.profile.bio, 'Avant', 'mise à jour refusée en bloc')
    assert.deepEqual(body.profile.featured.map((card: { id: string }) => card.id), ['card-common'])
    assert.equal(body.profile.avatar, null)
  })

  it('les cartes d’un AUTRE compte ne comptent pas', async () => {
    const owner = await signedUp()
    await give(owner.userId, ['card-mythic'])
    const other = await signedUp()
    const { status, body } = await other.request('PATCH', '/profile', { avatarCardId: 'card-mythic' })
    assert.equal(status, 400)
    assert.equal(body.error.code, 'card_not_owned')
  })

  it('vitrine : 3 cartes au plus, sans doublon', async () => {
    const account = await signedUp()
    await give(account.userId, CARD_IDS)
    const tooMany = await account.request('PATCH', '/profile', { featuredCardIds: CARD_IDS.slice(0, 4) })
    assert.equal(tooMany.status, 400)
    assert.equal(tooMany.body.error.code, 'validation_error')
    const twice = await account.request('PATCH', '/profile', { featuredCardIds: ['card-rare', 'card-rare'] })
    assert.equal(twice.status, 400)
    assert.equal(twice.body.error.code, 'validation_error')
  })

  it('validation : champ inconnu, bio trop longue, corps vide → 400', async () => {
    const account = await signedUp()
    for (const body of [{ email: 'pirate@example.com' }, { bio: 'x'.repeat(161) }, {}, { activeTitle: 'roi-du-monde' }]) {
      const response = await account.request('PATCH', '/profile', body)
      assert.equal(response.status, 400, JSON.stringify(body))
      assert.equal(response.body.error.code, 'validation_error')
    }
  })

  it('titre : refusé tant qu’il n’est pas débloqué, accepté ensuite', async () => {
    const account = await signedUp()
    const locked = await account.request('PATCH', '/profile', { activeTitle: 'mythicHunter' })
    assert.equal(locked.status, 400)
    assert.equal(locked.body.error.code, 'title_locked')

    await give(account.userId, ['card-mythic'])
    const unlocked = await account.request('PATCH', '/profile', { activeTitle: 'mythicHunter' })
    assert.equal(unlocked.status, 200)
    assert.equal(unlocked.body.profile.activeTitle, 'mythicHunter')
    const starter = await account.request('PATCH', '/profile', { activeTitle: 'newcomer' })
    assert.equal(starter.body.profile.activeTitle, 'newcomer')
  })
})

describe('boosters ouverts', () => {
  it('chaque ouverture incrémente le compteur du profil', async () => {
    const account = await signedUp()
    const { openBooster } = await import('../src/modules/cards/cards.service.js')
    await openBooster(account.userId, { unlimited: true })
    await openBooster(account.userId, { unlimited: true })
    const { body } = await account.request('GET', '/profile/me')
    assert.equal(body.stats.gacha.boostersOpened, 2)
    assert.equal(body.stats.collection.copies, 10)
  })
})

describe('POST /api/auth/password', () => {
  it('mot de passe actuel faux : 400 `wrong_password` ; juste : le nouveau remplace l’ancien', async () => {
    const account = await signedUp()
    const wrong = await account.request('POST', '/auth/password', { currentPassword: 'pas-le-bon', newPassword: 'nouveau-mdp-123' })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.error.code, 'wrong_password')

    const short = await account.request('POST', '/auth/password', { currentPassword: PASSWORD, newPassword: 'court' })
    assert.equal(short.status, 400)
    assert.equal(short.body.error.code, 'validation_error')

    const changed = await account.request('POST', '/auth/password', { currentPassword: PASSWORD, newPassword: 'nouveau-mdp-123' })
    assert.equal(changed.status, 204)
    assert.equal((await account.request('GET', '/auth/me')).status, 200, 'session conservée')

    const oldLogin = await client().request('POST', '/auth/login', { email: account.email, password: PASSWORD })
    assert.equal(oldLogin.status, 401)
    const newLogin = await client().request('POST', '/auth/login', { email: account.email, password: 'nouveau-mdp-123' })
    assert.equal(newLogin.status, 200)
  })

  it('réservé aux comptes', async () => {
    const response = await client().request('POST', '/auth/password', { currentPassword: 'x', newPassword: 'nouveau-mdp-123' })
    assert.equal(response.status, 401)
  })
})

describe('GET /api/books/storage', () => {
  it('espace occupé par les romans du compte, et quota', async () => {
    const account = await signedUp()
    const { status, body } = await account.request('GET', '/books/storage')
    assert.equal(status, 200)
    assert.equal(body.usedBytes, 0)
    assert.equal(body.count, 0)
    assert.ok(body.quotaBytes > 0)
    assert.equal((await client().request('GET', '/books/storage')).status, 401)
  })
})
