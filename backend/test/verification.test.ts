import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installMangadexMock, lastCodeFor, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('verification')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { outbox } = await import('../src/lib/mailer.js')

let counter = 0
const newEmail = () => `verif-${Date.now()}-${(counter += 1)}@example.com`
const password = 'motdepasse-test'

/** Remet le délai de renvoi à zéro, comme si la minute d'attente était passée. */
const skipCooldown = (email: string) =>
  prisma.pendingRegistration.update({ where: { email }, data: { lastSentAt: new Date(Date.now() - 61_000) } })

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('inscription — code de vérification par e-mail', () => {
  it('le formulaire n’ouvre AUCUN compte : il envoie un code et met l’inscription en attente', async () => {
    const email = newEmail()
    const device = client()
    const response = await device.request('POST', '/auth/register', { email, password, displayName: 'Nami', preferredLanguage: 'fr' })
    assert.equal(response.status, 202)
    assert.equal(response.body.email, email)
    assert.ok(response.body.expiresAt > Date.now() && response.body.resendAt > Date.now())

    assert.equal(await prisma.user.count({ where: { email } }), 0, 'pas de compte')
    assert.equal((await device.request('GET', '/auth/me')).status, 401, 'pas de session')

    const mail = outbox.at(-1)!
    assert.equal(mail.to, email)
    const code = await lastCodeFor(email)
    assert.match(code, /^\d{6}$/)
    // D'un seul bloc, sans espace : copiable d'un geste (et reconnu comme code par Gmail / iOS).
    assert.equal(mail.subject, `${code} — ton code Bookshelf`)
    assert.match(mail.text, /Bonjour Nami,/)
    assert.ok(mail.text.includes(`    ${code}\n`))
    assert.match(mail.html, new RegExp(`user-select:all;">${code}</td>`))
  })

  it('le code n’est jamais stocké en clair', async () => {
    const email = newEmail()
    await client().request('POST', '/auth/register', { email, password })
    const pending = await prisma.pendingRegistration.findUniqueOrThrow({ where: { email } })
    const code = await lastCodeFor(email)
    assert.equal(pending.codeHash.length, 64)
    assert.ok(!pending.codeHash.includes(code))
    assert.notEqual(pending.passwordHash, password)
  })

  it('e-mail en anglais pour une inscription en anglais, nom échappé dans le HTML', async () => {
    const email = newEmail()
    await client().request('POST', '/auth/register', { email, password, displayName: '<b>Zoro</b>', preferredLanguage: 'en' })
    const mail = outbox.at(-1)!
    assert.match(mail.subject, /your Bookshelf code$/)
    assert.ok(mail.html.includes('Hi &lt;b&gt;Zoro&lt;/b&gt;,'))
    assert.ok(!mail.html.includes('<b>Zoro</b>'))
  })

  it('bon code → compte créé (e-mail vérifié), session ouverte, bibliothèque invitée fusionnée', async () => {
    const email = newEmail()
    const device = client()
    await device.request('POST', '/auth/register', { email, password })
    const book = { id: 'guest-book-1', title: 'Livre invité' }
    const verified = await device.request('POST', '/auth/register/verify', {
      email,
      code: await lastCodeFor(email),
      initialData: { entries: [{ book, status: 'wishlist' }], skipped: [] },
    })
    assert.equal(verified.status, 201)
    assert.equal(verified.body.user.email, email)
    assert.equal(verified.body.library.entries[0].book.id, 'guest-book-1')
    assert.equal((await device.request('GET', '/auth/me')).status, 200)

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    assert.ok(user.emailVerifiedAt instanceof Date)
    assert.equal(await prisma.pendingRegistration.count({ where: { email } }), 0, 'attente terminée')
    // Le mot de passe choisi au formulaire est bien celui du compte.
    assert.equal((await client().request('POST', '/auth/login', { email, password })).status, 200)
  })

  it('code faux → essai consommé ; au 5ᵉ, code bloqué même s’il devient bon', async () => {
    const email = newEmail()
    const device = client()
    await device.request('POST', '/auth/register', { email, password })
    const code = await lastCodeFor(email)

    const first = await device.request('POST', '/auth/register/verify', { email, code: wrongCode(code) })
    assert.equal(first.status, 400)
    assert.equal(first.body.error.code, 'code_invalid')
    assert.equal(first.body.error.remainingAttempts, 4)

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await device.request('POST', '/auth/register/verify', { email, code: wrongCode(code) })
    }
    const fifth = await device.request('POST', '/auth/register/verify', { email, code: wrongCode(code) })
    assert.equal(fifth.body.error.code, 'code_locked')
    const right = await device.request('POST', '/auth/register/verify', { email, code })
    assert.equal(right.body.error.code, 'code_locked')
    assert.equal(await prisma.user.count({ where: { email } }), 0)
  })

  it('nouveau code : délai de 60 s, puis l’ancien code ne vaut plus rien et le nouveau crée le compte', async () => {
    const email = newEmail()
    const device = client()
    await device.request('POST', '/auth/register', { email, password })
    const oldCode = await lastCodeFor(email)

    const tooSoon = await device.request('POST', '/auth/register/resend', { email })
    assert.equal(tooSoon.status, 429)
    assert.equal(tooSoon.body.error.code, 'resend_too_soon')
    assert.ok(tooSoon.body.error.retryAfter > 0 && tooSoon.body.error.retryAfter <= 60)

    await skipCooldown(email)
    const resent = await device.request('POST', '/auth/register/resend', { email })
    assert.equal(resent.status, 200)
    const newCode = await lastCodeFor(email)
    if (newCode !== oldCode) {
      const stale = await device.request('POST', '/auth/register/verify', { email, code: oldCode })
      assert.equal(stale.body.error.code, 'code_invalid')
    }
    assert.equal((await device.request('POST', '/auth/register/verify', { email, code: newCode })).status, 201)
  })

  it('renvoyer le formulaire trop vite est refusé (anti-spam de la boîte de quelqu’un d’autre)', async () => {
    const email = newEmail()
    await client().request('POST', '/auth/register', { email, password })
    const again = await client().request('POST', '/auth/register', { email, password })
    assert.equal(again.status, 429)
    assert.equal(again.body.error.code, 'resend_too_soon')
  })

  it('5 codes au plus par heure et par adresse', async () => {
    const email = newEmail()
    await client().request('POST', '/auth/register', { email, password })
    await prisma.pendingRegistration.update({ where: { email }, data: { sends: 5 } })
    await skipCooldown(email)
    const capped = await client().request('POST', '/auth/register/resend', { email })
    assert.equal(capped.status, 429)
    assert.equal(capped.body.error.code, 'rate_limited')
  })

  it('code expiré (15 min) → refusé, il faut en redemander un', async () => {
    const email = newEmail()
    await client().request('POST', '/auth/register', { email, password })
    await prisma.pendingRegistration.update({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const late = await client().request('POST', '/auth/register/verify', { email, code: await lastCodeFor(email) })
    assert.equal(late.status, 400)
    assert.equal(late.body.error.code, 'code_expired')
  })

  it('e-mail déjà pris : refusé dès le formulaire, sans envoyer de code', async () => {
    const email = newEmail()
    assert.equal((await client().signUp({ email, password })).status, 201)
    const sent = outbox.length
    const taken = await client().request('POST', '/auth/register', { email, password })
    assert.equal(taken.status, 409)
    assert.equal(taken.body.error.code, 'email_taken')
    assert.equal(outbox.length, sent)
  })

  it('code pour une adresse sans inscription en attente, ou code mal formé', async () => {
    const unknown = await client().request('POST', '/auth/register/verify', { email: newEmail(), code: '123456' })
    assert.equal(unknown.body.error.code, 'registration_not_found')
    const malformed = await client().request('POST', '/auth/register/verify', { email: newEmail(), code: '12a456' })
    assert.equal(malformed.status, 400)
    assert.equal(malformed.body.error.code, 'validation_error')
  })
})

describe('mot de passe oublié — code par e-mail', () => {
  it('un code part si le compte existe ; la réponse est la même s’il n’existe pas', async () => {
    const email = newEmail()
    assert.equal((await client().signUp({ email, password, displayName: 'Robin' })).status, 201)
    const sent = outbox.length
    const known = await client().request('POST', '/auth/password/forgot', { email })
    assert.equal(known.status, 202)
    assert.equal(outbox.length, sent + 1)
    const mail = outbox.at(-1)!
    const code = await lastCodeFor(email)
    assert.equal(mail.subject, `${code} — réinitialise ton mot de passe Bookshelf`)
    assert.match(mail.text, /Bonjour Robin,/)

    const ghost = await client().request('POST', '/auth/password/forgot', { email: newEmail() })
    assert.equal(ghost.status, 202)
    assert.deepEqual(Object.keys(ghost.body).sort(), Object.keys(known.body).sort())
    assert.equal(outbox.length, sent + 1, 'aucun e-mail pour une adresse inconnue')
  })

  it('le bon code change le mot de passe, coupe les autres sessions et connecte cet appareil', async () => {
    const email = newEmail()
    const other = client()
    assert.equal((await other.signUp({ email, password })).status, 201)
    assert.equal((await other.request('GET', '/auth/me')).status, 200)

    const device = client()
    await device.request('POST', '/auth/password/forgot', { email })
    const code = await lastCodeFor(email)
    const wrong = await device.request('POST', '/auth/password/reset', { email, code: wrongCode(code), newPassword: 'nouveau-mot-de-passe' })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.error.code, 'code_invalid')
    assert.equal(wrong.body.error.remainingAttempts, 4)

    const reset = await device.request('POST', '/auth/password/reset', { email, code, newPassword: 'nouveau-mot-de-passe' })
    assert.equal(reset.status, 200, JSON.stringify(reset.body))
    assert.equal(reset.body.user.email, email)
    assert.equal((await device.request('GET', '/auth/me')).status, 200, 'connecté')
    assert.equal((await other.request('GET', '/auth/me')).status, 401, 'ancienne session coupée')

    assert.equal((await client().request('POST', '/auth/login', { email, password })).status, 401, 'ancien mot de passe refusé')
    assert.equal((await client().request('POST', '/auth/login', { email, password: 'nouveau-mot-de-passe' })).status, 200)
    // Le code ne sert qu'une fois.
    const again = await client().request('POST', '/auth/password/reset', { email, code, newPassword: 'encore-un-autre' })
    assert.equal(again.body.error.code, 'reset_not_found')
  })

  it('garde-fous : 60 s entre deux envois, code expiré, mot de passe trop court', async () => {
    const email = newEmail()
    await client().signUp({ email, password })
    await client().request('POST', '/auth/password/forgot', { email })
    const tooSoon = await client().request('POST', '/auth/password/forgot', { email })
    assert.equal(tooSoon.status, 429)
    assert.equal(tooSoon.body.error.code, 'resend_too_soon')

    const code = await lastCodeFor(email)
    const short = await client().request('POST', '/auth/password/reset', { email, code, newPassword: 'court' })
    assert.equal(short.body.error.code, 'validation_error')
    await prisma.passwordReset.update({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const late = await client().request('POST', '/auth/password/reset', { email, code, newPassword: 'nouveau-mot-de-passe' })
    assert.equal(late.body.error.code, 'code_expired')
  })
})
