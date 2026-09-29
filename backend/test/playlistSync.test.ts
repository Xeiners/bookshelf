/**
 * Playlists d'ambiance synchronisées (`POST /api/music/playlists/sync`) : créée
 * sur le téléphone, retrouvée sur l'ordinateur ; renommage, suppression,
 * modification hors-ligne plus ancienne, comptes étanches.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('playlist-sync')
installMangadexMock()
const { client, close } = await startServer()
after(close)

const { mergePlaylists, PLAYLIST_LIMITS } = await import('../src/modules/music/playlists.js')

const T0 = Date.now() - 60_000
const playlist = (id: string, name: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tracks: [{ id: `t-${id}`, kind: 'video', ref: 'lTRiuFIWV54', title: 'Lofi' }],
  createdAt: T0,
  updatedAt,
  deleted: false,
  ...extra,
})

describe('fusion des playlists', () => {
  it('la version la plus récente gagne ; une horloge en avance est ramenée à maintenant', () => {
    const now = T0 + 10_000
    const { merged, changed } = mergePlaylists(
      [playlist('a', 'Ancien', T0 + 5_000) as never],
      [playlist('a', 'Plus vieux', T0 + 1_000) as never, playlist('b', 'Futur', now + 999_999) as never],
      now,
    )
    assert.deepEqual(merged.map((item) => item.name), ['Ancien', 'Futur'])
    assert.equal(changed.length, 1)
    assert.equal(changed[0]?.updatedAt, now)
  })

  it('au-delà de la limite, les nouvelles playlists de l’envoi sont écartées', () => {
    const stored = Array.from({ length: PLAYLIST_LIMITS.playlists }, (_, index) => playlist(`p${index}`, `P${index}`, T0) as never)
    const { changed } = mergePlaylists(stored, [playlist('en-trop', 'En trop', T0 + 1) as never], T0 + 10)
    assert.equal(changed.length, 0)
  })
})

describe('POST /api/music/playlists/sync', () => {
  const email = `musique-${Date.now()}@example.com`
  const password = 'motdepasse-test'
  let phone: TestClient
  let computer: TestClient
  const sync = (who: TestClient, playlists: unknown[] = []) => who.request('POST', '/music/playlists/sync', { playlists })

  before(async () => {
    phone = client()
    assert.equal((await phone.signUp({ email, password })).status, 201)
    computer = client()
    assert.equal((await computer.request('POST', '/auth/login', { email, password })).status, 200)
  })

  it('sans compte : 401', async () => {
    assert.equal((await sync(client())).status, 401)
  })

  it('créée sur le téléphone, retrouvée sur l’ordinateur (morceaux compris)', async () => {
    const created = await sync(phone, [playlist('nuit', 'Nuit blanche', T0 + 1_000)])
    assert.equal(created.status, 200)
    assert.deepEqual(created.body.playlists.map((item: { name: string }) => item.name), ['Nuit blanche'])

    const seen = await sync(computer)
    assert.equal(seen.status, 200)
    assert.equal(seen.body.playlists.length, 1)
    assert.equal(seen.body.playlists[0].name, 'Nuit blanche')
    assert.deepEqual(seen.body.playlists[0].tracks, [{ id: 't-nuit', kind: 'video', ref: 'lTRiuFIWV54', title: 'Lofi' }])
  })

  it('renommée sur l’ordinateur : le téléphone suit ; son ancienne version hors-ligne ne l’écrase pas', async () => {
    await sync(computer, [playlist('nuit', 'Nuit blanche 🌙', T0 + 2_000)])
    const stale = await sync(phone, [playlist('nuit', 'Nuit blanche', T0 + 1_000)])
    assert.equal(stale.body.playlists[0].name, 'Nuit blanche 🌙')
  })

  it('supprimée sur le téléphone : l’ordinateur l’apprend (sans ses morceaux)', async () => {
    await sync(phone, [playlist('nuit', 'Nuit blanche 🌙', T0 + 3_000, { deleted: true })])
    const seen = await sync(computer)
    assert.equal(seen.body.playlists[0].deleted, true)
    assert.deepEqual(seen.body.playlists[0].tracks, [])
  })

  it('un autre compte ne voit rien ; même identifiant de playlist, sans collision', async () => {
    const other = client()
    await other.signUp({ email: `autre-${Date.now()}@example.com`, password })
    assert.deepEqual((await sync(other)).body.playlists, [])
    const own = await sync(other, [playlist('nuit', 'À moi', T0 + 5_000)])
    assert.equal(own.body.playlists[0].name, 'À moi')
    assert.equal((await sync(computer)).body.playlists[0].deleted, true, 'la playlist de l’autre compte n’a pas bougé')
  })

  it('données invalides : 400', async () => {
    assert.equal((await sync(phone, [{ id: 'x', name: 'Sans morceaux valides', tracks: [{ id: 't', kind: 'audio', ref: 'x' }], createdAt: 1, updatedAt: 2 }])).status, 400)
    assert.equal((await sync(phone, [playlist('../evil', 'Chemin', T0)])).status, 400)
  })
})
