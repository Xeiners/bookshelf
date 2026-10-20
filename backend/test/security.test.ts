import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
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
