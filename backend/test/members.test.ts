/**
 * Membres : sans texte, TOUS les membres par pages ; recherche dès la première lettre.
 * « Informer tout le monde » : tous les autres membres prévenus, une fois par jour.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('members')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const { MEMBER_PAGE } = await import('../src/modules/users/publicProfile.service.js')

type Account = TestClient & { userId: string }
async function member(name: string): Promise<Account> {
  const account = client()
  const signed = await account.signUp({ email: `${name.toLowerCase()}-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(account, { userId: (await account.request('GET', '/auth/me')).body.user.id as string })
}

let sender: Account
before(async () => {
  sender = await member('Zelda')
  // Une communauté plus grande qu'une page.
  await prisma.user.createMany({
    data: Array.from({ length: MEMBER_PAGE + 7 }, (_, index) => ({ email: `m${index}@example.com`, passwordHash: 'x', displayName: `Membre ${index}` })),
  })
  await prisma.card.create({ data: { id: 'share-card', number: 9001, series: 3, title: 'Œuvre', name: 'Perso', imageUrl: '/api/cards/art/x', rarity: 'EPIC', mangaId: 'mal-character-9001' } })
  await prisma.userCard.create({ data: { userId: sender.userId, cardId: 'share-card' } })
})

describe('membres et « Informer tout le monde »', () => {
  it('sans texte : tous les membres, page après page, sans doublon', async () => {
    const seen = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    do {
      const query: string = cursor ? `?cursor=${cursor}` : ''
      const page = await sender.request('GET', `/users${query}`)
      assert.equal(page.status, 200)
      assert.ok(page.body.members.length <= MEMBER_PAGE)
      for (const found of page.body.members) {
        assert.ok(!seen.has(found.id), 'pas deux fois le même membre')
        seen.add(found.id)
      }
      cursor = page.body.next
      pages += 1
    } while (cursor && pages < 10)
    assert.equal(seen.size, await prisma.user.count({ where: { displayName: { not: null } } }))
    assert.ok(pages >= 2)
  })

  it('recherche dès la première lettre', async () => {
    const found = await sender.request('GET', '/users?q=z')
    assert.ok(found.body.members.some((entry: { displayName: string }) => entry.displayName === 'Zelda'))
    assert.equal(found.body.next, null)
  })

  it('informer tout le monde : chaque autre membre prévenu, puis une fois par jour seulement', async () => {
    await prisma.user.updateMany({ where: { email: 'm0@example.com' }, data: { suspendedAt: new Date() } })
    const sent = await sender.request('POST', '/cards/share', { cardIds: ['share-card'], everyone: true, message: 'Regardez !' })
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    const others = await prisma.user.count({ where: { id: { not: sender.userId }, suspendedAt: null } })
    assert.equal(sent.body.notified, others)
    assert.equal(await prisma.notification.count({ where: { type: 'card_share' } }), others)
    const again = await sender.request('POST', '/cards/share', { cardIds: ['share-card'], everyone: true })
    assert.equal(again.status, 429)
    assert.equal(again.body.error.code, 'share_everyone_cooldown')
    // Prévenir quelques membres choisis reste possible.
    const chosen = (await prisma.user.findFirstOrThrow({ where: { email: 'm1@example.com' } })).id
    assert.equal((await sender.request('POST', '/cards/share', { cardIds: ['share-card'], toUserIds: [chosen] })).body.notified, 1)
    assert.equal((await sender.request('POST', '/cards/share', { cardIds: ['share-card'] })).status, 400, 'ni membre ni tout le monde')
  })
})
