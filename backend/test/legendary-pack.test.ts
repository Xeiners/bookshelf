/**
 * Booster Légendaire de la boutique : 4200 ✦, acheté et ouvert d'un coup ; la dernière carte
 * est Légendaire (ou Mythique) ; solde insuffisant : rien n'est débité ni tiré.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('legendary-pack')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/core/db.js')
const { LEGENDARY_PACK_PRICE } = await import('../src/modules/stardust/prices.js')

before(async () => {
  await prisma.card.createMany({
    data: ['COMMON', 'COMMON', 'COMMON', 'RARE', 'RARE', 'EPIC', 'LEGENDARY', 'LEGENDARY', 'MYTHIC'].map((rarity, index) => ({
      id: `card-${index}`,
      number: index + 1,
      title: `Œuvre ${index}`,
      name: `Œuvre ${index}`,
      imageUrl: `/api/covers/${index}`,
      rarity,
      mangaId: `manga-${index}`,
    })),
  })
})

describe('Booster Légendaire acheté', () => {
  it('4200 ✦ : débité, quatre cartes, la dernière Légendaire ou mieux ; sans le solde : 409, rien ne bouge', async () => {
    const device = client()
    const signed = await device.signUp({ email: 'legende@example.com', password: 'motdepasse-test', displayName: 'Légende' })
    const userId = signed.body.user.id as string

    assert.equal((await device.request('GET', '/stardust')).body.legendaryPackPrice, LEGENDARY_PACK_PRICE)

    await prisma.user.update({ where: { id: userId }, data: { stardust: LEGENDARY_PACK_PRICE - 1 } })
    const short = await device.request('POST', '/stardust/legendary-pack')
    assert.equal(short.status, 409)
    assert.equal(short.body.error.code, 'not_enough_stardust')
    assert.equal(await prisma.userCard.count({ where: { userId } }), 0)

    await prisma.user.update({ where: { id: userId }, data: { stardust: LEGENDARY_PACK_PRICE + 120 } })
    const bought = await device.request('POST', '/stardust/legendary-pack')
    assert.equal(bought.status, 200, JSON.stringify(bought.body))
    assert.equal(bought.body.balance, 120)
    assert.equal(bought.body.cards.length, 4)
    assert.ok(['LEGENDARY', 'MYTHIC'].includes(bought.body.cards[3].card.rarity))
    // Ni stock ni garantie touchés.
    assert.equal(bought.body.status.legendaryPacks, 0)

    const history = (await device.request('GET', '/stardust')).body.history
    assert.equal(history[0].reason, 'legendary_pack_purchase')
    assert.equal(history[0].amount, -LEGENDARY_PACK_PRICE)
  })
})
