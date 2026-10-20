import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
import { clientKey } from '../src/core/http/rateLimit.js'
import { prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('security')

const { client, close } = await startServer()
after(close)

describe('en-têtes de sécurité', () => {
  it('durcit chaque réponse de l’API et interdit la mise en cache du JSON', async () => {
    const response = await client().send('GET', '/health')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-powered-by'), null)
  })
})

describe('photo de profil', () => {
  it('ré-encodée en WebP sans métadonnées (GPS…), taille bornée ; image illisible refusée', async () => {
    const device = client()
    const signed = await device.signUp({ email: 'photo@example.com', password: 'motdepasse-test', displayName: 'Photo' })
    assert.equal(signed.status, 201)
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c33' } })
      .withExif({ IFD0: { Copyright: 'position-secrete' } })
      .jpeg()
      .toBuffer()
    assert.ok(jpeg.includes(Buffer.from('position-secrete')), 'le fichier de départ porte bien des métadonnées')

    const uploaded = await device.send('POST', '/profile/avatar-upload', { body: new Uint8Array(jpeg), headers: { 'Content-Type': 'image/jpeg' } })
    assert.equal(uploaded.status, 201)
    const served = await device.send('GET', `/users/${signed.body.user.id}/avatar`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/webp')
    const bytes = Buffer.from(await served.arrayBuffer())
    assert.equal(bytes.includes(Buffer.from('position-secrete')), false, 'métadonnées retirées')
    const { width } = await sharp(bytes).metadata()
    assert.equal(width, 1024)

    const broken = await device.send('POST', '/profile/avatar-upload', { body: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), headers: { 'Content-Type': 'image/jpeg' } })
    assert.equal(broken.status, 415)
  })
})

describe('clé de limitation par adresse', () => {
  it('IPv4 telle quelle ; IPv6 regroupée par bloc /64 (changer d’adresse dans son bloc ne remet pas le compteur à zéro)', () => {
    assert.equal(clientKey('203.0.113.9'), '203.0.113.9')
    assert.equal(clientKey('::ffff:203.0.113.9'), '::ffff:203.0.113.9')
    assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), clientKey('2001:db8:1:2:1::9'))
    assert.equal(clientKey('2001:db8:1:2::1'), '2001:0db8:0001:0002::/64')
    assert.notEqual(clientKey('2001:db8:1:3::1'), clientKey('2001:db8:1:2::1'))
    assert.equal(clientKey(undefined), 'unknown')
  })
})

describe('changement de mot de passe', () => {
  it('coupe les autres appareils (une session volée ne survit pas), garde celui-ci', async () => {
    const owner = client()
    const signed = await owner.signUp({ email: 'revoke@example.com', password: 'motdepasse-test', displayName: 'Revoke' })
    assert.equal(signed.status, 201)
    const thief = client()
    assert.equal((await thief.request('POST', '/auth/login', { email: 'revoke@example.com', password: 'motdepasse-test' })).status, 200)
    assert.equal((await thief.request('GET', '/auth/me')).status, 200)

    const changed = await owner.request('POST', '/auth/password', { currentPassword: 'motdepasse-test', newPassword: 'nouveau-motdepasse-1' })
    assert.equal(changed.status, 204)
    assert.equal((await thief.request('GET', '/auth/me')).status, 401, 'l’autre appareil est déconnecté')
    assert.equal((await owner.request('GET', '/auth/me')).status, 200, 'cet appareil reste connecté')
  })
})
