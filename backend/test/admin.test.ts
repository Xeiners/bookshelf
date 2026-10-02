/**
 * Administration : accès réservé à `ADMIN_EMAILS` (404 pour les autres), liste
 * et recherche des comptes, boosters offerts (hors plafond, ouverts après le
 * stock normal, jamais perdus), carte offerte, suspension (connexion refusée,
 * sessions coupées, offres retirées), réactivation, modération, journal.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('admin')
process.env.ADMIN_EMAILS = 'chef@example.com, Second@Example.com'
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { MAX_BOOSTERS } = await import('../src/modules/cards/boosters.logic.js')

const PASSWORD = 'motdepasse-test'
type Account = TestClient & { userId: string; email: string }

async function account(email: string, displayName: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: PASSWORD, displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string, email })
}

let admin: Account
let alice: Account
let bastien: Account

before(async () => {
  // Petit set : de quoi ouvrir des boosters sans catalogue MangaDex.
  await prisma.card.createMany({
    data: ['COMMON', 'COMMON', 'COMMON', 'RARE', 'RARE', 'EPIC'].map((rarity, index) => ({
      id: `card-${index}`,
      number: index + 1,
      title: `Œuvre ${index}`,
      name: `Œuvre ${index}`,
      imageUrl: `/api/covers/${index}`,
      rarity,
      mangaId: `manga-${index}`,
    })),
  })
  admin = await account('chef@example.com', 'Chef')
  alice = await account('alice@example.com', 'Alice')
  bastien = await account('bastien@example.com', 'Bastien')
})

describe('admin — accès', () => {
  it('invité : 401 ; compte ordinaire : 404 (l’administration n’existe pas pour lui)', async () => {
    assert.equal((await client().request('GET', '/admin/overview')).status, 401)
    for (const [method, route] of [['GET', '/admin/overview'], ['GET', '/admin/users'], ['POST', `/admin/users/${bastien.userId}/boosters`]] as const) {
      assert.equal((await alice.request(method, route, method === 'POST' ? { count: 1 } : undefined)).status, 404, route)
    }
  })

  it('`isAdmin` dans le profil : vrai pour ADMIN_EMAILS (casse ignorée), faux sinon', async () => {
    assert.equal((await admin.request('GET', '/auth/me')).body.user.isAdmin, true)
    assert.equal((await alice.request('GET', '/auth/me')).body.user.isAdmin, false)
    const second = await account('second@example.com', 'Second')
    assert.equal((await second.request('GET', '/auth/me')).body.user.isAdmin, true)
  })
})

describe('admin — comptes', () => {
  it('liste, recherche par e-mail ou pseudo, vue d’ensemble, fiche', async () => {
    const all = await admin.request('GET', '/admin/users')
    assert.equal(all.status, 200)
    assert.ok(all.body.users.length >= 3)
    const found = await admin.request('GET', '/admin/users?q=alice')
    assert.deepEqual(found.body.users.map((user: { id: string }) => user.id), [alice.userId])
    assert.equal((await admin.request('GET', '/admin/users?q=Bast')).body.users[0].id, bastien.userId)

    const overview = await admin.request('GET', '/admin/overview')
    assert.ok(overview.body.users >= 3)

    const detail = await admin.request('GET', `/admin/users/${alice.userId}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.user.email, 'alice@example.com')
    assert.equal(detail.body.user.suspended, false)
    assert.equal(detail.body.user.boosters.max, MAX_BOOSTERS)
    assert.equal((await admin.request('GET', '/admin/users/inconnu')).status, 404)
  })
})

describe('admin — cadeaux', () => {
  it('boosters offerts : hors plafond, ouverts après le stock normal, le compte est prévenu', async () => {
    const gift = await admin.request('POST', `/admin/users/${bastien.userId}/boosters`, { count: 3, message: 'Merci !' })
    assert.equal(gift.status, 200, JSON.stringify(gift.body))
    assert.equal(gift.body.boosters.gifted, 3)

    const status = await bastien.request('GET', '/boosters/status')
    assert.equal(status.body.available, MAX_BOOSTERS + 3)
    assert.equal(status.body.gifted, 3)

    // Le stock normal d'abord, puis les cadeaux : tous s'ouvrent, aucun ne se perd.
    for (let index = 0; index < MAX_BOOSTERS + 3; index += 1) {
      const opened = await bastien.request('POST', '/boosters/open')
      assert.equal(opened.status, 200, `ouverture ${index + 1} : ${JSON.stringify(opened.body)}`)
      assert.equal(opened.body.status.gifted, Math.min(3, MAX_BOOSTERS + 3 - index - 1))
    }
    assert.equal((await bastien.request('POST', '/boosters/open')).body.error.code, 'no_booster')

    const notifications = await bastien.request('GET', '/notifications')
    const notice = notifications.body.notifications.find((item: { type: string }) => item.type === 'booster_gift')
    assert.equal(notice?.data.count, 3)
    assert.equal(notice?.data.message, 'Merci !')
  })

  it('carte offerte : elle entre dans l’album (ou un exemplaire de plus), le compte est prévenu', async () => {
    const before = (await prisma.userCard.findUnique({ where: { userId_cardId: { userId: alice.userId, cardId: 'card-5' } } }))?.count ?? 0
    const gift = await admin.request('POST', `/admin/users/${alice.userId}/cards`, { cardId: 'card-5', count: 2 })
    assert.equal(gift.status, 200, JSON.stringify(gift.body))
    assert.equal(gift.body.count, before + 2)
    assert.equal(gift.body.card.rarity, 'EPIC')
    const notice = (await alice.request('GET', '/notifications')).body.notifications.find((item: { type: string }) => item.type === 'card_gift')
    assert.equal(notice?.data.card.id, 'card-5')
    assert.equal(notice?.data.message, null)

    assert.equal((await admin.request('POST', `/admin/users/${alice.userId}/cards`, { cardId: 'inconnue' })).status, 404)
    assert.equal((await admin.request('POST', `/admin/users/${alice.userId}/boosters`, { count: 0 })).status, 400)
    assert.equal((await admin.request('GET', '/admin/cards?q=Œuvre 5')).body.cards[0].id, 'card-5')
  })
})

describe('admin — suspension et modération', () => {
  it('suspendre : sessions coupées, connexion refusée avec le motif, offres retirées ; réactiver', async () => {
    const victim = await account('suspendu@example.com', 'Suspendu')
    await prisma.userCard.create({ data: { userId: victim.userId, cardId: 'card-0', count: 2 } })
    assert.equal((await victim.request('POST', '/trades', { offeredCardId: 'card-0', requestedCardId: 'card-1' })).status, 201)

    const suspended = await admin.request('POST', `/admin/users/${victim.userId}/suspend`, { reason: 'Spam au Marché' })
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body))
    assert.equal(suspended.body.user.suspended, true)
    assert.equal(suspended.body.user.openOffers, 0)

    // La session déjà ouverte tombe aussitôt.
    const me = await victim.request('GET', '/auth/me')
    assert.equal(me.status, 401)
    assert.equal(me.body.error.code, 'account_suspended')
    assert.equal((await victim.request('GET', '/library')).status, 401)
    // Et la connexion est refusée — avec le motif, mais seulement si le mot de passe est juste.
    const login = await client().request('POST', '/auth/login', { email: 'suspendu@example.com', password: PASSWORD })
    assert.equal(login.status, 403)
    assert.equal(login.body.error.code, 'account_suspended')
    assert.equal(login.body.error.reason, 'Spam au Marché')
    assert.equal((await client().request('POST', '/auth/login', { email: 'suspendu@example.com', password: 'faux-mot-de-passe' })).body.error.code, 'invalid_credentials')
    assert.equal((await admin.request('GET', '/admin/users?filter=suspended')).body.users.some((user: { id: string }) => user.id === victim.userId), true)

    const restored = await admin.request('POST', `/admin/users/${victim.userId}/unsuspend`)
    assert.equal(restored.body.user.suspended, false)
    // L'ancienne session reste coupée ; une nouvelle connexion fonctionne.
    assert.equal((await victim.request('GET', '/auth/me')).status, 401)
    const again = client()
    assert.equal((await again.request('POST', '/auth/login', { email: 'suspendu@example.com', password: PASSWORD })).status, 200)
    assert.equal((await again.request('GET', '/auth/me')).status, 200)
  })

  it('un administrateur ne peut pas être suspendu', async () => {
    const refused = await admin.request('POST', `/admin/users/${admin.userId}/suspend`, {})
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error.code, 'admin_protected')
  })

  it('modérer : pseudo, bio, avatar, profil privé ; journal de toutes les actions', async () => {
    await prisma.user.update({ where: { id: bastien.userId }, data: { bio: 'Pub', avatarCardId: 'card-0', isProfilePublic: true } })
    const moderated = await admin.request('POST', `/admin/users/${bastien.userId}/moderate`, { displayName: true, bio: true, avatar: true, makePrivate: true })
    assert.equal(moderated.status, 200, JSON.stringify(moderated.body))
    const row = await prisma.user.findUniqueOrThrow({ where: { id: bastien.userId } })
    assert.equal(row.displayName, null)
    assert.equal(row.bio, null)
    assert.equal(row.avatarCardId, null)
    assert.equal(row.isProfilePublic, false)
    assert.equal((await admin.request('POST', `/admin/users/${bastien.userId}/moderate`, {})).status, 400)

    const audit = await admin.request('GET', '/admin/audit')
    const actions = audit.body.entries.map((entry: { action: string }) => entry.action)
    for (const action of ['gift_boosters', 'gift_card', 'suspend', 'unsuspend', 'moderate']) assert.ok(actions.includes(action), action)
    assert.equal(audit.body.entries[0].adminEmail, 'chef@example.com')
    const forBastien = await admin.request('GET', `/admin/audit?userId=${bastien.userId}`)
    assert.ok(forBastien.body.entries.every((entry: { targetUserId: string }) => entry.targetUserId === bastien.userId))
  })
})
