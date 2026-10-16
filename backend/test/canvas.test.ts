/**
 * Toile partagée : WebSocket temps réel (objets, curseurs, aperçus), règles d'écriture
 * (propriétaire, cadres réservés, pinceaux, débits), « j'aime », signalements, administration,
 * persistance, tuiles raster et saisons.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'
import WebSocket from 'ws'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('canvas')
process.env.ADMIN_EMAILS = 'canvas-chef@example.com'
installMangadexMock()
const { client, close, port } = await startServer()
after(close)

const { prisma } = await import('../src/db.js')
const { world } = await import('../src/modules/canvas/canvas.world.js')
const { rolloverIfNeeded } = await import('../src/modules/canvas/canvas.seasons.js')
const { config } = await import('../src/config.js')

type Account = TestClient & { userId: string }
let counter = 0
async function account(name: string, email = `${name.toLowerCase()}-${Date.now()}-${(counter += 1)}@example.com`): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName: name })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

const id = () => randomBytes(8).toString('hex')

/** Un onglet : messages reçus, attente d'un message précis. */
class Tab {
  readonly inbox: any[] = []
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.inbox.push(JSON.parse(raw.toString())))
  }
  static open(device: TestClient, headers: Record<string, string> = {}): Promise<Tab> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/canvas/ws`, { headers: { Cookie: device.cookie(), ...headers } })
      const tab = new Tab(ws)
      ws.once('open', () => resolve(tab))
      ws.once('unexpected-response', (_request, response) => reject(Object.assign(new Error(`HTTP ${response.statusCode}`), { status: response.statusCode })))
      ws.once('error', reject)
    })
  }
  send(message: unknown): void {
    this.ws.send(JSON.stringify(message))
  }
  async waitFor<T = any>(predicate: (message: any) => boolean, ms = 3000): Promise<T> {
    const started = Date.now()
    for (;;) {
      const found = this.inbox.find(predicate)
      if (found) return found as T
      if (Date.now() - started > ms) throw new Error(`message attendu non reçu (${JSON.stringify(this.inbox.map((m) => m.t)).slice(0, 300)})`)
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  async noMessage(predicate: (message: any) => boolean, ms = 250): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
    assert.equal(this.inbox.find(predicate), undefined)
  }
  clear(): void {
    this.inbox.length = 0
  }
  /** Envoie une opération et rend son accusé. */
  async op(op: Record<string, unknown>): Promise<any> {
    const cid = Math.floor(Math.random() * 1e9)
    this.send({ t: 'op', cid, ...op })
    return this.waitFor((message) => message.t === 'ack' && message.cid === cid)
  }
  async ops(ops: Record<string, unknown>[]): Promise<any> {
    const cid = Math.floor(Math.random() * 1e9)
    this.send({ t: 'ops', cid, ops })
    return this.waitFor((message) => message.t === 'ack' && message.cid === cid)
  }
  view(b: [number, number, number, number], extra: Record<string, unknown> = {}): void {
    this.send({ t: 'view', b, vec: 1, ...extra })
  }
  close(): void {
    this.ws.close()
  }
}

const stroke = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ t: 's', c: '#112233', sw: 4, p: [x, y, 0.5, x + 10, y + 6, 0.6, x + 22, y + 4, 0.4], ...extra })
const rect = (x: number, y: number, w = 100, h = 60, extra: Record<string, unknown> = {}) => ({ t: 'r', x, y, w, h, c: '#000000', f: '#ff0000', sw: 2, ...extra })
const frame = (x: number, y: number, w = 400, h = 300, extra: Record<string, unknown> = {}) => ({ t: 'f', x, y, w, h, tt: 'Mon cadre', c: '#1b1b1f', f: '#ffffff', co: [], ...extra })

describe('Toile — connexion', () => {
  it('refuse sans session, avec une origine étrangère ; accueille avec la saison et les limites', async () => {
    await assert.rejects(Tab.open(client()), (error: { status?: number }) => error.status === 401)
    const ana = await account('Ana')
    await assert.rejects(Tab.open(ana, { Origin: 'https://evil.example' }), (error: { status?: number }) => error.status === 403)
    const tab = await Tab.open(ana)
    const welcome = await tab.waitFor((message) => message.t === 'welcome')
    assert.equal(welcome.me.u, ana.userId)
    assert.equal(welcome.me.draw, true)
    assert.match(welcome.season, /^\d{4}-\d{2}$/)
    assert.equal(welcome.limits.cell, 4096)
    assert.ok(Array.isArray(welcome.peers))
    tab.close()
  })

  it('un compte a au plus 3 onglets', async () => {
    const ana = await account('Trois')
    const tabs = await Promise.all([Tab.open(ana), Tab.open(ana), Tab.open(ana)])
    await assert.rejects(Tab.open(ana), (error: { status?: number }) => error.status === 429)
    for (const tab of tabs) tab.close()
  })

  it('l’accueil REST donne la saison, mes droits et les pinceaux ; les cadres sont listés', async () => {
    const ana = await account('Rest')
    const home = await ana.request('GET', '/canvas')
    assert.equal(home.status, 200)
    assert.equal(home.body.me.canDraw, true)
    assert.ok(home.body.brushes.some((brush: { id: string }) => brush.id === 'neon'))
    assert.equal((await client().request('GET', '/canvas')).status, 401)
    const tab = await Tab.open(ana)
    const frameId = id()
    assert.equal((await tab.op({ k: 'c', id: frameId, o: frame(10_000_000 / 10, 1_000_000 / 10, 300, 200, { tt: 'Listé' }) })).ok, true)
    const frames = (await ana.request('GET', '/canvas/frames')).body.frames
    const listed = frames.find((entry: { id: string }) => entry.id === frameId)
    assert.equal(listed.title, 'Listé')
    assert.equal(listed.w, 300)
    assert.equal(listed.owner, ana.userId)
    const info = (await ana.request('GET', `/canvas/objects/${frameId}`)).body
    assert.equal(info.mine, true)
    assert.equal(info.type, 'f')
    tab.close()
  })
})

describe('Toile — objets en temps réel', () => {
  it('un trait créé arrive chez ceux qui regardent la zone, pas chez les autres', async () => {
    const ana = await account('Ana')
    const ben = await account('Ben')
    const far = await account('Loin')
    const [a, b, f] = await Promise.all([Tab.open(ana), Tab.open(ben), Tab.open(far)])
    b.view([-200, -200, 600, 600])
    f.view([900_000, 900_000, 901_000, 901_000])
    await b.waitFor((message) => message.t === 'objs')
    a.view([-200, -200, 600, 600])
    await a.waitFor((message) => message.t === 'objs')
    const strokeId = id()
    const ack = await a.op({ k: 'c', id: strokeId, o: stroke(10, 10) })
    assert.equal(ack.ok, true, JSON.stringify(ack))
    const received = await b.waitFor((message) => message.t === 'op' && message.id === strokeId)
    assert.equal(received.k, 'c')
    assert.equal(received.o, ana.userId)
    assert.equal(received.d.t, 's')
    assert.equal(received.v, 1)
    await f.noMessage((message) => message.t === 'op' && message.id === strokeId)
    // Un nouveau venu reçoit l'état de la case.
    const late = await Tab.open(await account('Tard'))
    late.view([0, 0, 100, 100])
    const snapshot = await late.waitFor((message) => message.t === 'objs' && message.o.some((object: { id: string }) => object.id === strokeId))
    assert.equal(snapshot.o.find((object: { id: string }) => object.id === strokeId).d.sw, 4)
    for (const tab of [a, b, f, late]) tab.close()
  })

  it('seul l’auteur modifie ou supprime son objet ; l’état réel revient au client fautif', async () => {
    const ana = await account('Ana')
    const ben = await account('Ben')
    const [a, b] = await Promise.all([Tab.open(ana), Tab.open(ben)])
    for (const tab of [a, b]) tab.view([-2000, -2000, -1000, -1000])
    await a.waitFor((message) => message.t === 'objs')
    const rectId = id()
    assert.equal((await a.op({ k: 'c', id: rectId, o: rect(-1500, -1500) })).ok, true)
    await b.waitFor((message) => message.t === 'op' && message.id === rectId)
    const stolen = await b.op({ k: 'u', id: rectId, o: rect(-1400, -1400) })
    assert.equal(stolen.ok, false)
    assert.equal(stolen.e, 'not_yours')
    assert.equal((await b.op({ k: 'd', id: rectId })).e, 'not_yours')
    // L'auteur déplace : version 2, tout le monde suit.
    b.clear()
    const moved = await a.op({ k: 'u', id: rectId, o: rect(-1450, -1450, 120, 80) })
    assert.equal(moved.ok, true)
    const update = await b.waitFor((message) => message.t === 'op' && message.id === rectId && message.k === 'u')
    assert.equal(update.v, 2)
    assert.equal(update.d.w, 120)
    // Devant / derrière : l'empilement change.
    const other = id()
    await a.op({ k: 'c', id: other, o: rect(-1500, -1500) })
    const back = await a.op({ k: 'z', id: other, to: 'back' })
    assert.equal(back.ok, true)
    const lowered = await b.waitFor((message) => message.t === 'op' && message.id === other && message.k === 'u')
    assert.ok(lowered.z < update.z)
    b.clear()
    assert.equal((await a.op({ k: 'd', id: rectId })).ok, true)
    await b.waitFor((message) => message.t === 'op' && message.k === 'd' && message.id === rectId)
    assert.equal((await a.op({ k: 'u', id: rectId, o: rect(0, 0) })).e, 'gone')
    a.close()
    b.close()
  })

  it('refuse ce qui est invalide, trop grand, déjà pris ou réservé', async () => {
    const ana = await account('Strict')
    const tab = await Tab.open(ana)
    const bad = async (o: unknown, e: string, opId = id()) => assert.equal((await tab.op({ k: 'c', id: opId, o })).e, e, JSON.stringify(o).slice(0, 80))
    await bad({ t: 'z' }, 'bad_shape')
    await bad({ ...stroke(0, 0), c: 'red' }, 'bad_color')
    await bad({ ...stroke(0, 0), p: [1, 2] }, 'bad_shape')
    await bad({ ...stroke(0, 0), p: [1, 2, Infinity] }, 'bad_shape')
    await bad({ ...stroke(0, 0), sw: 9999 }, 'bad_shape')
    await bad(rect(0, 0, 5000, 10), 'bad_shape')
    await bad({ ...stroke(0, 0), p: [0, 0, 1, 9000, 0, 1] }, 'too_big')
    await bad({ t: 'x', x: 0, y: 0, s: 20, tx: '   ', c: '#000000' }, 'bad_text')
    await bad(stroke(0, 0, { b: 'inconnu' }), 'bad_brush')
    await bad(stroke(0, 0, { b: 'neon' }), 'brush_locked')
    assert.equal((await tab.op({ k: 'c', id: 'pas-un-id', o: stroke(0, 0) })).e, 'bad_id')
    const taken = id()
    assert.equal((await tab.op({ k: 'c', id: taken, o: stroke(0, 0) })).ok, true)
    await bad(stroke(0, 0), 'id_taken', taken)
    // Le texte est nettoyé, les nombres arrondis.
    const text = id()
    assert.equal((await tab.op({ k: 'c', id: text, o: { t: 'x', x: 0.123456, y: 0, s: 20, tx: 'Salut‮', c: '#ABCDEF' } })).ok, true)
    assert.equal(world.peek(text)?.data.tx, 'Salut')
    assert.equal(world.peek(text)?.data.x, 0.12)
    assert.equal(world.peek(text)?.data.c, '#abcdef')
    // Un lot : réussites et échecs, dans l'ordre.
    const batch = await tab.ops([
      { k: 'c', id: id(), o: stroke(5, 5) },
      { k: 'c', id: id(), o: { t: 'nope' } },
    ])
    assert.equal(batch.ok, false)
    assert.equal(batch.fails.length, 1)
    tab.close()
  })

  it('curseurs : regroupés, seulement pour ceux qui voient la zone', async () => {
    const [ana, ben, far] = await Promise.all([account('Ana'), account('Ben'), account('Loin')])
    const [a, b, f] = await Promise.all([Tab.open(ana), Tab.open(ben), Tab.open(far)])
    const welcomeA = await a.waitFor((message) => message.t === 'welcome')
    a.view([5000, 5000, 6000, 6000])
    b.view([5000, 5000, 6000, 6000])
    f.view([-90_000, -90_000, -89_000, -89_000])
    await new Promise((resolve) => setTimeout(resolve, 100))
    a.send({ t: 'cur', x: 5500, y: 5500 })
    const cursors = await b.waitFor((message) => message.t === 'cur' && message.p.some((entry: number[]) => entry[0] === welcomeA.me.c))
    const mine = cursors.p.find((entry: number[]) => entry[0] === welcomeA.me.c)
    assert.deepEqual([mine[1], mine[2]], [5500, 5500])
    await f.noMessage((message) => message.t === 'cur')
    // Annonces d'arrivée et d'outil.
    a.send({ t: 'tool', tool: 'rect', ink: '#FF0000', size: 8 })
    const tool = await b.waitFor((message) => message.t === 'pt' && message.c === welcomeA.me.c)
    assert.equal(tool.tl, 'rect')
    assert.equal(tool.ic, '#ff0000')
    // Bulle et réaction : vues par ceux qui voient le curseur, pas par les autres.
    a.send({ t: 'chat', text: 'Salut tout le monde' })
    assert.equal((await b.waitFor((message) => message.t === 'chat')).text, 'Salut tout le monde')
    await f.noMessage((message) => message.t === 'chat')
    a.send({ t: 'react', e: '🔥' })
    assert.equal((await b.waitFor((message) => message.t === 'react')).e, '🔥')
    a.send({ t: 'react', e: '💣' })
    await b.noMessage((message) => message.t === 'react' && message.e === '💣')
    // Départ.
    a.close()
    await b.waitFor((message) => message.t === 'peer' && message.d === welcomeA.me.c)
    b.close()
    f.close()
  })

  it('aperçus en direct : points d’un trait et forme en cours, puis fin', async () => {
    const [ana, ben] = await Promise.all([account('Ana'), account('Ben')])
    const [a, b] = await Promise.all([Tab.open(ana), Tab.open(ben)])
    const welcome = await a.waitFor((message) => message.t === 'welcome')
    a.view([20_000, 20_000, 21_000, 21_000])
    b.view([20_000, 20_000, 21_000, 21_000])
    await new Promise((resolve) => setTimeout(resolve, 100))
    const live = id()
    a.send({ t: 'lp', id: live, st: { c: '#112233', sw: 4 }, p: [20_100, 20_100, 0.5, 20_110, 20_104, 0.5] })
    const batch = await b.waitFor((message) => message.t === 'lp' && message.id === live)
    assert.equal(batch.c, welcome.me.c)
    assert.equal(batch.p.length, 6)
    a.send({ t: 'lo', id: live + '', o: rect(20_200, 20_200) })
    await b.waitFor((message) => message.t === 'lo')
    a.send({ t: 'le', id: live })
    await b.waitFor((message) => message.t === 'le' && message.id === live)
    // Style invalide : refusé, rien n'est relayé.
    b.clear()
    a.send({ t: 'lp', id: id(), st: { c: 'rouge', sw: 4 }, p: [1, 1, 1] })
    await b.noMessage((message) => message.t === 'lp')
    a.close()
    b.close()
  })

  it('les débits : au-delà du seau, « slow_down » ; les messages absurdes coupent la connexion', async () => {
    const ana = await account('Rapide')
    const tab = await Tab.open(ana)
    tab.view([0, 0, 100, 100])
    let refused = 0
    for (let index = 0; index < 80; index += 1) {
      const ack = await tab.op({ k: 'c', id: id(), o: stroke(index, 0) })
      if (ack.e === 'slow_down') refused += 1
    }
    assert.ok(refused > 0, 'le seau se vide')
    const closed = new Promise<number>((resolve) => tab.ws.once('close', (code) => resolve(code)))
    for (let index = 0; index < 40; index += 1) tab.ws.send('{pas du json')
    assert.equal(await closed, 1008)
  })
})

describe('Toile — cadres réservés', () => {
  it('un cadre est à son auteur : les autres n’y dessinent pas, un invité si', async () => {
    const [ana, ben, caro] = await Promise.all([account('Ana'), account('Ben'), account('Caro')])
    const [a, b, c] = await Promise.all([Tab.open(ana), Tab.open(ben), Tab.open(caro)])
    const frameId = id()
    assert.equal((await a.op({ k: 'c', id: frameId, o: frame(30_000, 30_000) })).ok, true)
    // Hors cadre : libre. Dans le cadre : verrouillé.
    assert.equal((await b.op({ k: 'c', id: id(), o: rect(31_000, 30_000) })).ok, true)
    assert.equal((await b.op({ k: 'c', id: id(), o: rect(30_100, 30_100) })).e, 'frame_locked')
    // Ana invite Ben : il y dessine, Caro non ; Ben est prévenu.
    assert.equal((await a.op({ k: 'u', id: frameId, o: frame(30_000, 30_000, 400, 300, { co: [ben.userId] }) })).ok, true)
    assert.equal((await b.op({ k: 'c', id: id(), o: rect(30_100, 30_100) })).ok, true)
    assert.equal((await c.op({ k: 'c', id: id(), o: rect(30_150, 30_150) })).e, 'frame_locked')
    await new Promise((resolve) => setTimeout(resolve, 150))
    const notifications = (await ben.request('GET', '/notifications')).body.notifications
    const invite = notifications.find((notification: { type: string }) => notification.type === 'canvas_invite')
    assert.ok(invite, 'invitation reçue')
    assert.equal(invite.data.title, 'Mon cadre')
    assert.equal(invite.data.x, 30_200)
    // Seul l'auteur modifie le cadre ; il efface ce qu'on lui laisse.
    assert.equal((await b.op({ k: 'u', id: frameId, o: frame(30_000, 30_000) })).e, 'not_yours')
    const inside = id()
    await b.op({ k: 'c', id: inside, o: rect(30_200, 30_100) })
    assert.equal((await a.op({ k: 'd', id: inside })).ok, true, 'le propriétaire du cadre efface')
    for (const tab of [a, b, c]) tab.close()
  })

  it('règles des cadres : taille, chevauchement, objets d’autrui, quota', async () => {
    const [ana, ben] = await Promise.all([account('Ana'), account('Ben')])
    const [a, b] = await Promise.all([Tab.open(ana), Tab.open(ben)])
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(50_000, 50_000, 50, 50) })).e, 'bad_shape', 'trop petit')
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(50_000, 50_000, 3000, 300) })).e, 'bad_shape', 'trop grand')
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(50_000, 50_000) })).ok, true)
    assert.equal((await b.op({ k: 'c', id: id(), o: frame(50_200, 50_100) })).e, 'frame_overlap')
    // Un cadre ne peut pas avaler le dessin de quelqu'un d'autre.
    assert.equal((await b.op({ k: 'c', id: id(), o: rect(60_050, 60_050) })).ok, true)
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(60_000, 60_000) })).e, 'frame_occupied')
    // Trois cadres au plus par compte.
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(70_000, 70_000) })).ok, true)
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(80_000, 80_000) })).ok, true)
    assert.equal((await a.op({ k: 'c', id: id(), o: frame(90_000, 90_000) })).e, 'frame_quota')
    // Plus de 8 collaborateurs : refusé.
    const many = Array.from({ length: 9 }, (_, index) => `u${index}`)
    assert.equal((await b.op({ k: 'c', id: id(), o: frame(95_000, 95_000, 300, 300, { co: many }) })).e, 'bad_frame')
    a.close()
    b.close()
  })
})

describe('Toile — pinceaux, j’aime, signalements', () => {
  it('un pinceau s’achète en Poussières, puis se dessine ; sans le sou, refusé', async () => {
    const ana = await account('Peintre')
    const tab = await Tab.open(ana)
    assert.equal((await tab.op({ k: 'c', id: id(), o: stroke(0, 0, { b: 'ink' }) })).e, 'brush_locked')
    const poor = await ana.request('POST', '/canvas/brushes/ink/buy')
    assert.equal(poor.status, 409)
    assert.equal(poor.body.error.code, 'not_enough_stardust')
    await prisma.user.update({ where: { id: ana.userId }, data: { stardust: 500 } })
    const bought = await ana.request('POST', '/canvas/brushes/ink/buy')
    assert.equal(bought.status, 200, JSON.stringify(bought.body))
    assert.equal(bought.body.balance, 380)
    assert.equal(bought.body.brushes.find((brush: { id: string }) => brush.id === 'ink').owned, true)
    const refreshed = await tab.waitFor((message) => message.t === 'me' && message.brushes.includes('ink'))
    assert.equal(refreshed.draw, true)
    assert.equal((await tab.op({ k: 'c', id: id(), o: stroke(0, 0, { b: 'ink' }) })).ok, true)
    assert.equal((await ana.request('POST', '/canvas/brushes/ink/buy')).status, 409, 'déjà possédé')
    assert.equal((await ana.request('POST', '/canvas/brushes/pen/buy')).status, 409, 'offert')
    assert.equal((await ana.request('POST', '/canvas/brushes/zzz/buy')).status, 404)
    tab.close()
  })

  it('un « j’aime » rapporte une Poussière à l’auteur ; pas le sien, pas deux fois ; les seuils débloquent un pinceau', async () => {
    const ana = await account('Artiste')
    const tab = await Tab.open(ana)
    const frameId = id()
    await tab.op({ k: 'c', id: frameId, o: frame(120_000, 120_000) })
    await world.flush()
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })).stardust
    assert.equal((await ana.request('POST', `/canvas/objects/${frameId}/like`)).body.error.code, 'own_object')
    const fans = await Promise.all(Array.from({ length: 5 }, (_, index) => account(`Fan${index}`)))
    const first = await fans[0]!.request('POST', `/canvas/objects/${frameId}/like`)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.likes, 1)
    assert.equal(first.body.rewarded, true)
    assert.equal((await fans[0]!.request('POST', `/canvas/objects/${frameId}/like`)).body.error.code, 'already_liked')
    for (const fan of fans.slice(1)) assert.equal((await fan.request('POST', `/canvas/objects/${frameId}/like`)).status, 200)
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })).stardust
    assert.equal(after - before, 5)
    // Cinq « j'aime » reçus : le pinceau d'encre est débloqué, sans payer.
    const shop = (await ana.request('GET', '/canvas/brushes')).body
    assert.equal(shop.likesReceived, 5)
    assert.equal(shop.brushes.find((brush: { id: string }) => brush.id === 'ink').byLikes, true)
    const reward = (await ana.request('GET', '/notifications')).body.notifications.find((notification: { type: string }) => notification.type === 'canvas_reward')
    assert.equal(reward.data.brush, 'ink')
    // Le compteur est aussi diffusé aux spectateurs.
    const watcher = await Tab.open(await account('Spectateur'))
    watcher.view([120_000, 120_000, 121_000, 121_000])
    await watcher.waitFor((message) => message.t === 'objs')
    const extra = await account('FanDePlus')
    await extra.request('POST', `/canvas/objects/${frameId}/like`)
    assert.equal((await watcher.waitFor((message) => message.t === 'lk' && message.id === frameId)).n, 6)
    // La galerie classe par « j'aime ».
    const gallery = (await extra.request('GET', '/canvas/gallery')).body.frames
    assert.equal(gallery[0].id, frameId)
    assert.equal(gallery[0].likes, 6)
    assert.equal(gallery[0].liked, true)
    tab.close()
    watcher.close()
  })

  it('trois signalements de comptes différents masquent l’objet ; l’administrateur tranche', async () => {
    const [ana, chef] = await Promise.all([account('Auteur'), account('Chef', 'canvas-chef@example.com')])
    const [a, c] = await Promise.all([Tab.open(ana), Tab.open(chef)])
    const watcher = await account('Voisin')
    const w = await Tab.open(watcher)
    for (const tab of [a, c, w]) tab.view([200_000, 200_000, 201_000, 201_000])
    await w.waitFor((message) => message.t === 'objs')
    const bad = id()
    await a.op({ k: 'c', id: bad, o: rect(200_100, 200_100) })
    await w.waitFor((message) => message.t === 'op' && message.id === bad)
    const reporters = await Promise.all([account('R1'), account('R2'), account('R3')])
    assert.equal((await ana.request('POST', `/canvas/objects/${bad}/report`, { reason: 'spam' })).body.error.code, 'own_object')
    assert.equal((await reporters[0]!.request('POST', `/canvas/objects/${bad}/report`, { reason: 'nope' })).status, 400)
    assert.equal((await reporters[0]!.request('POST', `/canvas/objects/${bad}/report`, { reason: 'inappropriate' })).body.hidden, false)
    assert.equal((await reporters[0]!.request('POST', `/canvas/objects/${bad}/report`, { reason: 'spam' })).body.error.code, 'already_reported')
    await reporters[1]!.request('POST', `/canvas/objects/${bad}/report`, { reason: 'hate' })
    w.clear()
    c.clear()
    const third = await reporters[2]!.request('POST', `/canvas/objects/${bad}/report`, { reason: 'inappropriate' })
    assert.equal(third.status, 201)
    assert.equal(third.body.hidden, true)
    // Disparu pour les autres, visible (marqué) pour l'administrateur.
    await w.waitFor((message) => message.t === 'op' && message.k === 'd' && message.id === bad)
    assert.equal((await c.waitFor((message) => message.t === 'op' && message.id === bad)).h, 1)
    assert.equal((await ana.request('GET', '/notifications')).body.notifications.find((n: { type: string }) => n.type === 'canvas_moderated').data.action, 'hidden')
    assert.equal((await a.op({ k: 'u', id: bad, o: rect(200_100, 200_100, 90) })).e, 'hidden')
    const queue = (await chef.request('GET', '/admin/canvas')).body
    const item = queue.queue.find((entry: { id: string }) => entry.id === bad)
    assert.equal(item.reports, 3)
    assert.deepEqual(item.reasons, { inappropriate: 2, hate: 1 })
    assert.equal(item.hidden, true)
    assert.equal((await ana.request('GET', '/admin/canvas')).status, 404, 'réservé aux administrateurs')
    // Infondé : l'objet revient pour tous.
    assert.equal((await chef.request('POST', `/admin/canvas/objects/${bad}/restore`)).status, 200)
    await w.waitFor((message) => message.t === 'op' && message.id === bad && message.k === 'c')
    assert.equal((await chef.request('GET', '/admin/canvas')).body.queue.length, queue.queue.length - 1)
    // Fondé : supprimé pour de bon.
    const worse = id()
    await a.op({ k: 'c', id: worse, o: rect(200_300, 200_300) })
    assert.equal((await chef.request('POST', `/admin/canvas/objects/${worse}/remove`)).status, 200)
    await w.waitFor((message) => message.t === 'op' && message.k === 'd' && message.id === worse)
    const audit = (await chef.request('GET', '/admin/audit')).body.entries.map((entry: { action: string }) => entry.action)
    assert.ok(audit.includes('canvas_restore') && audit.includes('canvas_remove'))
    for (const tab of [a, c, w]) tab.close()
  })

  it('l’administrateur efface tout ce qu’un compte a dessiné, ou l’exclut de la toile', async () => {
    const [vandal, chef] = await Promise.all([account('Vandale'), account('Chef', 'canvas-chef2@example.com')])
    // (le second administrateur n'existe pas : seul canvas-chef@ l'est)
    assert.equal((await chef.request('POST', `/admin/canvas/users/${vandal.userId}/purge`)).status, 404)
    const boss = await account('Boss', 'canvas-chef@example.com').catch(() => null)
    const admin = boss ?? (await (async () => {
      const device = client()
      await device.request('POST', '/auth/login', { email: 'canvas-chef@example.com', password: 'motdepasse-test' })
      return device
    })())
    const tab = await Tab.open(vandal)
    for (let index = 0; index < 5; index += 1) await tab.op({ k: 'c', id: id(), o: stroke(300_000 + index * 30, 300_000) })
    tab.view([300_000, 300_000, 301_000, 301_000])
    await tab.waitFor((message) => message.t === 'objs')
    const purged = await admin.request('POST', `/admin/canvas/users/${vandal.userId}/purge`)
    assert.equal(purged.body.removed >= 5, true)
    const ban = await admin.request('POST', `/admin/canvas/users/${vandal.userId}/ban`, { reason: 'Dessins choquants' })
    assert.equal(ban.status, 200, JSON.stringify(ban.body))
    const status = await tab.waitFor((message) => message.t === 'me' && message.draw === false)
    assert.equal(status.reason, 'banned')
    assert.equal((await tab.op({ k: 'c', id: id(), o: stroke(0, 0) })).e, 'banned')
    assert.equal((await admin.request('POST', `/admin/canvas/users/${vandal.userId}/ban`, {})).body.error.code, 'already_banned')
    assert.equal((await admin.request('POST', `/admin/canvas/users/${vandal.userId}/unban`)).status, 200)
    await tab.waitFor((message) => message.t === 'me' && message.draw === true)
    assert.equal((await tab.op({ k: 'c', id: id(), o: stroke(0, 0) })).ok, true)
    tab.close()
  })

  it('un compte trop récent regarde mais ne dessine pas encore', async () => {
    const ana = await account('Jeune')
    const previous = config.canvas.minAccountAgeMs
    config.canvas.minAccountAgeMs = 3_600_000
    try {
      const tab = await Tab.open(ana)
      const welcome = await tab.waitFor((message) => message.t === 'welcome')
      assert.equal(welcome.me.draw, false)
      assert.equal(welcome.me.reason, 'young')
      assert.ok(welcome.me.wait > 0)
      assert.equal((await tab.op({ k: 'c', id: id(), o: stroke(0, 0) })).e, 'young')
      const like = await ana.request('POST', `/canvas/objects/${id()}/like`)
      assert.equal(like.status, 403)
      tab.close()
    } finally {
      config.canvas.minAccountAgeMs = previous
    }
  })
})

describe('Toile — persistance, tuiles, saisons', () => {
  it('les objets s’écrivent en base par lots et reviennent quand la case a été évacuée', async () => {
    const ana = await account('Durable')
    const tab = await Tab.open(ana)
    const keep = id()
    const gone = id()
    await tab.op({ k: 'c', id: keep, o: stroke(400_000, 400_000) })
    await tab.op({ k: 'c', id: gone, o: stroke(400_040, 400_000) })
    await tab.op({ k: 'd', id: gone })
    await world.flush()
    assert.ok(await prisma.canvasObject.findUnique({ where: { id: keep } }))
    assert.equal(await prisma.canvasObject.findUnique({ where: { id: gone } }), null)
    tab.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(world.sweep(Date.now() + 10 * 60_000) > 0, 'cases évacuées')
    assert.equal(world.peek(keep), undefined)
    const reader = await Tab.open(await account('Lecteur'))
    reader.view([400_000, 400_000, 401_000, 401_000])
    const snapshot = await reader.waitFor((message) => message.t === 'objs' && message.o.some((object: { id: string }) => object.id === keep))
    assert.equal(snapshot.o.length, 1)
    reader.close()
  })

  it('tuiles raster : une image là où l’on a dessiné, rien ailleurs, assemblée aux niveaux supérieurs', async () => {
    const ana = await account('Tuilier')
    const tab = await Tab.open(ana)
    await tab.op({ k: 'c', id: id(), o: rect(500_100, 500_100, 300, 200, { f: '#00aa00' }) })
    await tab.op({ k: 'c', id: id(), o: { t: 'x', x: 500_150, y: 500_150, s: 40, tx: 'Bonjour', c: '#000000' } })
    await tab.op({ k: 'c', id: id(), o: { t: 'b', n: [500_300, 500_300, 500_300, 500_300, 500_340, 500_260, 500_400, 500_320, 500_360, 500_380, 500_400, 500_320], c: '#0000ff', sw: 6, f: null } })
    const x = Math.floor(500_100 / 1024)
    const y = Math.floor(500_100 / 1024)
    const watcher = await Tab.open(ana)
    watcher.view([500_000, 500_000, 501_000, 501_000], { vec: 0, m: 0 })
    const fetchTile = async (level: number, tx: number, ty: number) => {
      const response = await ana.send('GET', `/canvas/tiles/${level}/${tx}/${ty}.png`)
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) }
    }
    const hit = await fetchTile(0, x, y)
    assert.equal(hit.status, 200)
    assert.deepEqual([...hit.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG')
    assert.equal((await fetchTile(0, x + 40, y)).status, 204, 'tuile vide')
    const upper = await fetchTile(3, Math.floor(x / 8), Math.floor(y / 8))
    assert.equal(upper.status, 200)
    assert.equal((await fetchTile(3, 500, 500)).status, 204)
    // Une modification prévient les clients en mode tuiles (par paquet).
    await tab.op({ k: 'c', id: id(), o: rect(500_400, 500_400, 40, 40) })
    const changed = await watcher.waitFor((message) => message.t === 'tv', 4000)
    assert.ok(changed.k.some((entry: number[]) => entry[0] === 0 && entry[1] === x && entry[2] === y))
    const bad = await ana.send('GET', '/canvas/tiles/99/0/0.png')
    assert.equal(bad.status, 400)
    tab.close()
    watcher.close()
  })

  it('une saison par mois : la clôture récompense le podium, garde l’archive et prévient les connectés', async () => {
    const [ana, ben] = await Promise.all([account('Podium'), account('Public')])
    const tab = await Tab.open(ben)
    await tab.waitFor((message) => message.t === 'welcome')
    const art = id()
    const owner = await Tab.open(ana)
    await owner.op({ k: 'c', id: art, o: frame(700_000, 700_000) })
    await owner.op({ k: 'c', id: id(), o: stroke(700_100, 700_100) })
    await world.flush()
    assert.equal((await ben.request('POST', `/canvas/objects/${art}/like`)).status, 200)
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })).stardust
    const oldKey = world.seasonKey
    assert.equal(await rolloverIfNeeded(new Date()), false, 'même mois : rien ne change')
    const next = new Date(Date.UTC(Number(oldKey.slice(0, 4)), Number(oldKey.slice(5)), 3))
    assert.equal(await rolloverIfNeeded(next), true)
    assert.notEqual(world.seasonKey, oldKey)
    const announced = await tab.waitFor((message) => message.t === 'season')
    assert.equal(announced.key, world.seasonKey)
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: ana.userId } })).stardust
    // L'autre cadre aimé du fichier de tests (6 « j'aime ») passe devant : celui-ci est deuxième.
    assert.equal(after - before, 60, 'deuxième du podium')
    assert.equal((await ana.request('GET', '/notifications')).body.notifications.find((n: { type: string }) => n.type === 'canvas_reward' && n.data.kind === 'podium').data.rank, 2)
    const seasons = (await ben.request('GET', '/canvas/seasons')).body.seasons
    const finished = seasons.find((season: { key: string }) => season.key === oldKey)
    assert.ok(finished.endedAt)
    assert.equal(finished.stats.podium[1].frameId, art)
    assert.equal(seasons.find((season: { current: boolean }) => season.current).key, world.seasonKey)
    // L'archive (image d'ensemble) est fabriquée en tâche de fond.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const archive = await ben.send('GET', `/canvas/seasons/${finished.id}/image`)
      if (archive.status === 200) {
        assert.deepEqual([...Buffer.from(await archive.arrayBuffer()).subarray(1, 4)], [0x50, 0x4e, 0x47])
        break
      }
      assert.ok(attempt < 49, 'archive fabriquée')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // Le time-lapse rejoue les objets de l'ancienne saison, dans l'ordre.
    const replay = (await ben.request('GET', `/canvas/seasons/${finished.id}/timelapse`)).body
    assert.ok(replay.items.length >= 1)
    assert.equal(replay.items[0].d.t, 's')
    // La toile du nouveau mois est vierge ; l'ancienne reste consultable.
    tab.view([700_000, 700_000, 701_000, 701_000])
    const empty = await tab.waitFor((message) => message.t === 'objs' && message.o.length === 0)
    assert.deepEqual(empty.o, [])
    assert.ok((await ben.request('GET', `/canvas/gallery?season=${finished.id}`)).body.frames.some((entry: { id: string }) => entry.id === art))
    tab.close()
    owner.close()
  })
})
