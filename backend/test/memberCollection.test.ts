/**
 * Photo de profil visible de tous (adresse publique par compte, anciennes adresses
 * réécrites, jamais la photo d'un autre) et album d'un autre membre (profil public
 * seulement, sauf le sien).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('member-collection')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')

type Account = TestClient & { userId: string }

async function account(email: string, displayName: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

/** Un PNG minimal : la signature suffit à l'API pour reconnaître le format. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 64 }, (_, index) => index)])

let alice: Account
let bastien: Account

before(async () => {
  await prisma.card.createMany({
    data: ['COMMON', 'RARE', 'EPIC'].map((rarity, index) => ({
      id: `card-${index}`,
      number: index + 1,
      title: `Œuvre ${index}`,
      name: `Œuvre ${index}`,
      imageUrl: `/api/covers/${index}`,
      rarity,
      mangaId: `manga-${index}`,
    })),
  })
  alice = await account('alice@example.com', 'Alice')
  bastien = await account('bastien@example.com', 'Bastien')
})

describe('photo de profil', () => {
  it('importée : une adresse publique, servie aux autres comptes et aux invités', async () => {
    const upload = await alice.send('POST', '/profile/avatar-upload', { body: PNG, headers: { 'Content-Type': 'image/png' } })
    assert.equal(upload.status, 201)
    const { avatarUrl } = (await upload.json()) as { avatarUrl: string }
    assert.match(avatarUrl, new RegExp(`^/api/users/${alice.userId}/avatar\\?v=\\d+$`))

    const cropped = `${avatarUrl}#bookshelf-avatar=1.20,40,60,circle`
    assert.equal((await alice.request('PATCH', '/profile', { avatarUrl: cropped })).status, 200)

    // Les autres voient l'adresse (recadrage compris)… et l'image derrière.
    const seen = await bastien.request('GET', `/users/${alice.userId}`)
    assert.equal(seen.body.profile.avatarUrl, cropped)
    for (const viewer of [bastien, client()]) {
      const image = await viewer.send('GET', `/users/${alice.userId}/avatar`)
      assert.equal(image.status, 200)
      assert.equal(image.headers.get('content-type'), 'image/png')
      assert.match(image.headers.get('cache-control') ?? '', /public/)
    }
    const found = await bastien.request('GET', '/users?q=Alice')
    assert.equal(found.body.members.find((member: { id: string }) => member.id === alice.userId)?.avatarUrl, cropped)
    assert.equal((await client().send('GET', `/users/${bastien.userId}/avatar`)).status, 404)
  })

  it('ancienne adresse (« photo de la personne connectée ») : réécrite vers celle du titulaire', async () => {
    await prisma.user.update({ where: { id: alice.userId }, data: { avatarUrl: '/api/profile/avatar-image?v=7#bookshelf-avatar=1.00,50,50,hexagon' } })
    const seen = await bastien.request('GET', `/users/${alice.userId}`)
    assert.equal(seen.body.profile.avatarUrl, `/api/users/${alice.userId}/avatar?v=7#bookshelf-avatar=1.00,50,50,hexagon`)
  })

  it('on ne peut pas porter la photo d’un autre compte', async () => {
    const stolen = await bastien.request('PATCH', '/profile', { avatarUrl: `/api/users/${alice.userId}/avatar?v=1` })
    assert.equal(stolen.status, 400)
    assert.equal(stolen.body.error.code, 'avatar_not_owned')
  })
})

describe('collection d’un membre', () => {
  it('profil public : tout le set, ce qu’il possède et ses doublons — visible de tous', async () => {
    await prisma.userCard.createMany({ data: [{ userId: alice.userId, cardId: 'card-0', count: 3 }, { userId: alice.userId, cardId: 'card-2', count: 1 }] })
    for (const viewer of [bastien, client()]) {
      const album = await viewer.request('GET', `/users/${alice.userId}/collection`)
      assert.equal(album.status, 200, JSON.stringify(album.body))
      assert.equal(album.body.owner.displayName, 'Alice')
      assert.equal(album.body.total, 3)
      assert.equal(album.body.owned, 2)
      assert.equal(album.body.cards.find((card: { id: string }) => card.id === 'card-0').count, 3)
      assert.equal(album.body.owner.email, undefined)
    }
  })

  it('profil privé : 403 pour les autres, visible par son titulaire ; compte inconnu : 404', async () => {
    await prisma.user.update({ where: { id: alice.userId }, data: { isProfilePublic: false } })
    const refused = await bastien.request('GET', `/users/${alice.userId}/collection`)
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error.code, 'profile_private')
    assert.equal((await alice.request('GET', `/users/${alice.userId}/collection`)).status, 200)
    assert.equal((await bastien.request('GET', '/users/inconnu123456/collection')).status, 404)
  })
})
