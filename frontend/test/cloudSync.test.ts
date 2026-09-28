import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { ProgressSync, SYNC_DELAY_MS, newestPosition, percentFrom, serverPosition } from '../src/lib/reader/cloudSync'
import type { CloudPosition } from '../src/types/novel'

/** Laisse s'écouler les promesses en attente (setImmediate n'est pas simulé). */
const settle = () => new Promise((resolve) => setImmediate(resolve))

const position = (cfi: string, percent: number, at: number): CloudPosition => ({ cfi, percent, at })

/** Appareil simulé : ce qu'il garde localement (IndexedDB) et ce qu'il envoie. */
function device(options: { online?: () => boolean; server?: FakeServer } = {}) {
  const stored: { position: CloudPosition; pending: boolean }[] = []
  const sent: { position: CloudPosition; keepalive: boolean }[] = []
  const sync = new ProgressSync({
    persist: (value, pending) => {
      stored.push({ position: value, pending })
    },
    send: async (value, { keepalive }) => {
      if (options.online && !options.online()) throw new Error('offline')
      sent.push({ position: value, keepalive })
      options.server?.receive(value)
    },
  })
  return { sync, stored, sent, last: () => stored.at(-1) }
}

/** API simulée : même règle que `saveProgress` (la position la plus récente gagne). */
class FakeServer {
  current: CloudPosition | null = null
  receive(value: CloudPosition) {
    if (!this.current || value.at > this.current.at) this.current = value
  }
}

describe('position de reprise', () => {
  it('position serveur : absente tant que le livre n’a jamais été ouvert', () => {
    assert.equal(serverPosition({ lastCfi: null, progressPercent: 0, progressAt: null }), null)
    assert.deepEqual(serverPosition({ lastCfi: 'epubcfi(/6/4)', progressPercent: 12, progressAt: 5 }), position('epubcfi(/6/4)', 12, 5))
  })

  it('la plus récente gagne ; à égalité, celle du serveur', () => {
    const local = position('epubcfi(/6/4)', 10, 100)
    const server = position('epubcfi(/6/8)', 20, 200)
    assert.equal(newestPosition(local, server), server)
    assert.equal(newestPosition({ ...local, at: 300 }, server)?.cfi, 'epubcfi(/6/4)')
    assert.equal(newestPosition({ ...local, at: 200 }, server), server)
    assert.equal(newestPosition(null, server), server)
    assert.equal(newestPosition(local, null), local)
    assert.equal(newestPosition(null, null), null)
  })

  it('avancement : au dixième de %, borné ; inconnu (positions non calculées) → le précédent, jamais 0', () => {
    assert.equal(percentFrom(0.4237, 0), 42.4)
    assert.equal(percentFrom(1.2, 0), 100)
    assert.equal(percentFrom(null, 37.5), 37.5)
    assert.equal(percentFrom(Number.NaN, 12), 12)
  })
})

describe('ProgressSync — persistance du CFI et envoi regroupé', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
  afterEach(() => mock.timers.reset())

  it('chaque page est écrite TOUT DE SUITE sur l’appareil (en attente), avant tout envoi', () => {
    const phone = device()
    phone.sync.push(position('epubcfi(/6/4!/4/2/1:0)', 10, 1))
    assert.deepEqual(phone.last(), { position: position('epubcfi(/6/4!/4/2/1:0)', 10, 1), pending: true })
    assert.equal(phone.sent.length, 0)
    assert.equal(phone.sync.pending, true)
  })

  it('une seconde après la DERNIÈRE page tournée, un seul envoi : la position la plus récente', async () => {
    const phone = device()
    for (let page = 1; page <= 5; page += 1) {
      phone.sync.push(position(`epubcfi(/6/${page * 2})`, page, page))
      mock.timers.tick(SYNC_DELAY_MS - 100)
    }
    assert.equal(phone.sent.length, 0, 'lecture rapide : rien n’est encore parti')
    mock.timers.tick(100)
    await settle()
    assert.deepEqual(
      phone.sent.map((entry) => entry.position.cfi),
      ['epubcfi(/6/10)'],
    )
    assert.deepEqual(phone.last(), { position: position('epubcfi(/6/10)', 5, 5), pending: false }, 'confirmée : plus en attente')
    assert.equal(phone.sync.pending, false)
  })

  it('hors-ligne : la position reste en attente sur l’appareil, puis part au retour du réseau', async () => {
    let online = false
    const phone = device({ online: () => online })
    phone.sync.push(position('epubcfi(/6/12)', 30, 10))
    mock.timers.tick(SYNC_DELAY_MS)
    await settle()
    assert.equal(phone.sent.length, 0)
    assert.equal(phone.last()?.pending, true)

    online = true
    assert.equal(await phone.sync.flush(), true)
    assert.equal(phone.sent.length, 1)
    assert.equal(phone.last()?.pending, false)
  })

  it('application en arrière-plan : envoi immédiat, `keepalive` (survit à la fermeture)', async () => {
    const phone = device()
    phone.sync.push(position('epubcfi(/6/14)', 40, 20))
    await phone.sync.flush({ keepalive: true })
    assert.deepEqual(phone.sent, [{ position: position('epubcfi(/6/14)', 40, 20), keepalive: true }])
    // Le minuteur est annulé : pas de second envoi.
    mock.timers.tick(SYNC_DELAY_MS * 2)
    await settle()
    assert.equal(phone.sent.length, 1)
  })

  it('page tournée pendant un envoi : la nouvelle reste à envoyer (jamais marquée confirmée à tort)', async () => {
    let release: () => void = () => {}
    const stored: { position: CloudPosition; pending: boolean }[] = []
    const sync = new ProgressSync({
      persist: (value, pending) => {
        stored.push({ position: value, pending })
      },
      send: () => new Promise<void>((resolve) => (release = resolve)),
    })
    sync.push(position('epubcfi(/6/2)', 1, 1))
    const inFlight = sync.flush()
    sync.push(position('epubcfi(/6/4)', 2, 2))
    release()
    await inFlight
    assert.equal(sync.pending, true)
    assert.ok(!stored.some((entry) => entry.position.cfi === 'epubcfi(/6/2)' && !entry.pending), 'l’ancienne n’écrase pas la nouvelle')
  })

  it('rien de nouveau : même CFI et même % → ni écriture, ni envoi', async () => {
    const phone = device()
    phone.sync.push(position('epubcfi(/6/2)', 5, 1))
    phone.sync.push(position('epubcfi(/6/2)', 5, 2))
    assert.equal(phone.stored.length, 1)
    mock.timers.tick(SYNC_DELAY_MS)
    await settle()
    assert.equal(phone.sent.length, 1)
  })

  it('téléphone → ordinateur : l’ordinateur reprend à la phrase exacte lue sur le téléphone', async () => {
    const server = new FakeServer()
    const phone = device({ server })
    phone.sync.push(position('epubcfi(/6/20!/4/2/14/1:37)', 61.2, 1_000))
    mock.timers.tick(SYNC_DELAY_MS)
    await settle()

    // Sur l'ordinateur : une ancienne position locale, plus vieille que celle du téléphone.
    const computerLocal = position('epubcfi(/6/8!/4/2/1:0)', 20, 500)
    const resume = newestPosition(computerLocal, server.current)
    assert.equal(resume?.cfi, 'epubcfi(/6/20!/4/2/14/1:37)')
    assert.equal(resume?.percent, 61.2)
  })

  it('une position hors-ligne plus ancienne, envoyée tard, ne recule pas le serveur', async () => {
    const server = new FakeServer()
    server.receive(position('epubcfi(/6/30)', 80, 5_000))
    const oldPhone = device({ server })
    oldPhone.sync.push(position('epubcfi(/6/10)', 25, 2_000))
    await oldPhone.sync.flush()
    assert.equal(server.current?.cfi, 'epubcfi(/6/30)')
  })
})
