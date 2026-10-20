import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
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
