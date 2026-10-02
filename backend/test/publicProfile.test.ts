/**
 * Profils publics (`GET /api/users/:id`) et recherche de membres
 * (`GET /api/users?q=`) : ce qu'un autre compte (ou un invité) voit, ce qui ne
 * sort jamais (e-mail, photo privée, instantanés du client), et le commutateur
 * `isProfilePublic` (privé : pseudo, avatar, titre et vitrine seulement).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { BILINGUAL, ENGLISH_ONLY } from './fixtures.js'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('public-profile')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { normalizeName, rankMembers } = await import('../src/modules/users/publicProfile.service.js')

async function account(name: string | null): Promise<{ device: TestClient; id: string; email: string }> {
  const device = client()
  const email = `member-${Math.random().toString(36).slice(2)}@example.com`
  await device.signUp({ email, password: 'motdepasse-test' })
  const id = (await device.request('GET', '/auth/me')).body.user.id
  if (name) await device.request('PATCH', '/profile', { displayName: name })
  return { device, id, email }
}

describe('GET /api/users/:id', () => {
  let owner: TestClient
  let email: string
  let visitor: TestClient
  let userId: string
  let realTitle: string

  before(async () => {
    ;({ device: owner, id: userId, email } = await account(null))
    visitor = client()

    const reading = (await owner.request('GET', `/manga/${BILINGUAL.id}?lang=fr`)).body.book
    realTitle = reading.title
    // Instantané trafiqué par le client : il ne doit jamais atteindre un autre compte.
    await owner.request('POST', '/library/swipe', {
      mangaId: reading.id,
      action: 'reading',
      book: { ...reading, title: 'Titre trafiqué', cover: 'https://exemple.invalid/pub.jpg' },
    })
    const read = (await owner.request('GET', `/manga/${ENGLISH_ONLY.id}?lang=fr`)).body.book
    await owner.request('POST', '/library/swipe', { mangaId: read.id, action: 'read', book: read })

    const patched = await owner.request('PATCH', '/profile', {
      displayName: 'Lectrice',
      bio: 'Shōnen et romans noirs.',
      // Photo importée, à l'ancienne adresse : réécrite vers l'adresse publique du titulaire.
      avatarUrl: '/api/profile/avatar-image?v=1',
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.profile.isProfilePublic, true, 'public par défaut')
  })

  it('profil public : présentation, statistiques et lectures, jamais l’e-mail', async () => {
    const response = await visitor.request('GET', `/users/${userId}?lang=fr`)
    assert.equal(response.status, 200)
    const raw = JSON.stringify(response.body)
    assert.ok(!raw.includes(email), 'e-mail exposé')
    assert.ok(!raw.includes('passwordHash'))

    const { profile, stats, library, isSelf } = response.body
    assert.equal(isSelf, false)
    assert.equal(profile.displayName, 'Lectrice')
    assert.equal(profile.bio, 'Shōnen et romans noirs.')
    assert.equal(typeof profile.createdAt, 'number')
    assert.match(profile.avatarUrl, /^\/api\/users\/[a-z0-9]+\/avatar\?v=1$/, 'photo visible des autres, à l’adresse de son titulaire')
    assert.equal(typeof stats.collection.total, 'number')
    assert.equal(stats.reading.reading, 1)
    assert.equal(stats.reading.read, 1)

    assert.equal(library.readingTotal, 1)
    assert.equal(library.readTotal, 1)
    const [current] = library.reading
    assert.equal(current.id, BILINGUAL.id)
    assert.equal(current.title, realTitle, 'titre repris de l’instantané du client')
    assert.ok(!raw.includes('Titre trafiqué'))
    assert.ok(!raw.includes('exemple.invalid'))
    assert.equal(current.book.id, BILINGUAL.id)
    assert.equal(library.read[0].progress, 1)
  })

  it('son propre profil : `isSelf`', async () => {
    const response = await owner.request('GET', `/users/${userId}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.isSelf, true)
  })

  it('profil privé : pseudo, avatar, titre et vitrine seulement', async () => {
    const patched = await owner.request('PATCH', '/profile', { isProfilePublic: false })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.profile.isProfilePublic, false)

    const response = await visitor.request('GET', `/users/${userId}`)
    assert.equal(response.status, 200)
    const { profile, stats, library } = response.body
    assert.equal(profile.isProfilePublic, false)
    assert.equal(profile.displayName, 'Lectrice')
    assert.deepEqual(profile.featured, [])
    assert.equal(profile.bio, null)
    assert.equal(profile.createdAt, null)
    assert.equal(stats, null)
    assert.equal(library, null)
    assert.ok(!JSON.stringify(response.body).includes(realTitle))

    await owner.request('PATCH', '/profile', { isProfilePublic: true })
  })

  it('profil introuvable ou identifiant invalide : 404 `user_not_found`', async () => {
    for (const id of ['cmzzzzzzzzzzzzzzzzzzzzzzz', 'pas-un-id', '..%2Fprofile']) {
      const response = await visitor.request('GET', `/users/${id}`)
      assert.equal(response.status, 404, id)
      assert.equal(response.body.error.code, 'user_not_found', id)
    }
  })

  it('le commutateur n’accepte qu’un booléen', async () => {
    const response = await owner.request('PATCH', '/profile', { isProfilePublic: 'non' })
    assert.equal(response.status, 400)
  })
})

describe('recherche de membres', () => {
  it('compare sans accents ni casse, les plus pertinents d’abord', () => {
    assert.equal(normalizeName('  Élodie   MARTIN '), 'elodie martin')
    const rows = [{ displayName: 'Marc Élodie' }, { displayName: 'Lodie' }, { displayName: 'élodie' }, { displayName: 'Élodie Martin' }, { displayName: 'Paul' }]
    assert.deepEqual(
      rankMembers(rows, 'Elodie').map((row) => row.displayName),
      ['élodie', 'Élodie Martin', 'Marc Élodie'],
    )
    assert.deepEqual(rankMembers(rows, 'lod').map((row) => row.displayName), ['Lodie', 'élodie', 'Marc Élodie', 'Élodie Martin'])
    assert.deepEqual(rankMembers(rows, '   '), [])
  })

  let elodie: Awaited<ReturnType<typeof account>>
  let hidden: Awaited<ReturnType<typeof account>>

  before(async () => {
    elodie = await account('Élodie Recherche')
    hidden = await account('Élodie Discrète')
    await hidden.device.request('PATCH', '/profile', { isProfilePublic: false })
    // Sans pseudo : jamais trouvable (l'e-mail ne sert pas à chercher).
    await account(null)
  })

  it('trouve par pseudo, profils privés compris, sans e-mail ni compteurs privés', async () => {
    const response = await client().request('GET', '/users?q=elodie')
    assert.equal(response.status, 200)
    const members = response.body.members as { id: string; displayName: string; isProfilePublic: boolean; cardsOwned: number | null; readsCount: number | null }[]
    const byId = new Map(members.map((member) => [member.id, member]))
    assert.ok(byId.has(elodie.id))
    assert.ok(byId.has(hidden.id))
    assert.equal(byId.get(elodie.id)?.cardsOwned, 0)
    assert.equal(byId.get(elodie.id)?.readsCount, 0)
    assert.equal(byId.get(hidden.id)?.isProfilePublic, false)
    assert.equal(byId.get(hidden.id)?.cardsOwned, null)
    assert.equal(byId.get(hidden.id)?.readsCount, null)
    const raw = JSON.stringify(response.body)
    assert.ok(!raw.includes(elodie.email) && !raw.includes('@example.com'), 'e-mail exposé')
  })

  it('l’e-mail ne sert jamais à chercher', async () => {
    const response = await client().request('GET', `/users?q=${encodeURIComponent(elodie.email.split('@')[0]!)}`)
    assert.deepEqual(response.body.members, [])
  })

  it('sans texte : les derniers inscrits ayant un pseudo ; `isSelf` pour soi', async () => {
    const response = await elodie.device.request('GET', '/users')
    assert.equal(response.status, 200)
    const members = response.body.members as { id: string; displayName: string; isSelf: boolean }[]
    assert.ok(members.length > 0 && members.every((member) => member.displayName))
    assert.equal(members.find((member) => member.id === elodie.id)?.isSelf, true)
  })

  it('recherche trop longue : 400', async () => {
    const response = await client().request('GET', `/users?q=${'a'.repeat(41)}`)
    assert.equal(response.status, 400)
  })
})
