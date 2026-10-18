/**
 * Page Stack — salons multijoueur : salon d'attente (code, 2 à 4 joueurs, hôte), versus (piles
 * séparées, gestes relayés, meilleur score), coop (une pile, tour par tour), coupures, revanche ;
 * puis de bout en bout par WebSocket (compte et invité).
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import WebSocket from 'ws'
import { installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('stack-rooms')
installMangadexMock()
const { client, close, port } = await startServer()
after(close)

const rooms = await import('../src/modules/stack/stack.rooms.js')

type Participant = { id: string; guest: { name: string } | null }
type Message = { t: string; [key: string]: unknown }

const guest = (name: string): Participant => ({ id: `guest_${name.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`, guest: { name } })

/** Un joueur de test : un canal qui garde ce qu'il reçoit. */
function seat(participant: Participant) {
  const inbox: Message[] = []
  let closed = false
  const link = { send: (message: Message) => void inbox.push(message), close: () => void (closed = true) }
  return {
    participant,
    inbox,
    link: link as never,
    get closed() {
      return closed
    },
    rooms: () => inbox.filter((message) => message.t === 'room').map((message) => message.room as { phase: string; players: { id: string; connected: boolean; over: boolean; score: number; pages: number }[]; turn: string | null; results: { winnerIds: string[]; ranking: { id: string; score: number; placed: number }[]; team: { score: number } | null } | null; hostId: string; mode: string; covers: number[]; seed: number }),
    events: (kind?: string) => inbox.filter((message) => message.t === 'ev' && (!kind || (message.e as { k: string }).k === kind)).map((message) => message.e as Record<string, unknown>),
    last: () => inbox.filter((message) => message.t === 'room').at(-1)!.room as ReturnType<typeof rooms.stackRoomView> & object,
  }
}

const wait = async (condition: () => boolean, ms = 3000) => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Salon prêt : `names` rejoignent le premier, l'hôte lance, on attend le départ. */
async function started(mode: 'versus' | 'coop', names: string[]) {
  const seats = names.map((name) => seat(guest(name)))
  const created = await rooms.createStackRoom(seats[0]!.participant, mode, seats[0]!.link)
  for (const other of seats.slice(1)) await rooms.joinStackRoom(other.participant, created.code, other.link)
  await rooms.startStackRoom(seats[0]!.participant.id)
  await wait(() => seats[0]!.last().phase === 'playing')
  return { seats, code: created.code }
}

describe('Page Stack — salon d’attente', () => {
  it('créer, rejoindre avec le code (en minuscules, avec des espaces), hôte, plein à quatre', async () => {
    const [a, b, c, d, e] = ['Ana', 'Bob', 'Cleo', 'Dan', 'Eve'].map((name) => seat(guest(name))) as ReturnType<typeof seat>[]
    const created = await rooms.createStackRoom(a!.participant, 'versus', a!.link)
    assert.match(created.code, /^[A-Z0-9]{6}$/)
    assert.equal(created.hostId, a!.participant.id)
    assert.equal(created.players.length, 1)

    const joined = await rooms.joinStackRoom(b!.participant, ` ${created.code.slice(0, 3).toLowerCase()} ${created.code.slice(3).toLowerCase()} `, b!.link)
    assert.equal(joined.players.length, 2)
    assert.equal(a!.last().players.length, 2, 'l’hôte voit arriver le joueur')
    await rooms.joinStackRoom(c!.participant, created.code, c!.link)
    await rooms.joinStackRoom(d!.participant, created.code, d!.link)
    await assert.rejects(rooms.joinStackRoom(e!.participant, created.code, e!.link), { code: 'room_full' })
    await assert.rejects(rooms.joinStackRoom(e!.participant, 'ZZZZZZ', e!.link), { status: 404 })
    await assert.rejects(rooms.joinStackRoom(e!.participant, 'bad', e!.link), { status: 404 })

    // Le départ d'un joueur libère sa place ; l'hôte parti passe la main.
    rooms.leaveStackRoom(a!.participant.id)
    assert.equal(b!.last().players.length, 3)
    assert.equal(b!.last().hostId, b!.participant.id)
    await rooms.joinStackRoom(e!.participant, created.code, e!.link)
  })

  it('seul l’hôte lance et change de mode ; il faut deux joueurs', async () => {
    const a = seat(guest('Ana'))
    const b = seat(guest('Bob'))
    const created = await rooms.createStackRoom(a.participant, 'versus', a.link)
    await assert.rejects(rooms.startStackRoom(a.participant.id), { code: 'not_enough_players' })
    await rooms.joinStackRoom(b.participant, created.code, b.link)
    await assert.rejects(rooms.startStackRoom(b.participant.id), { code: 'not_host' })
    assert.throws(() => rooms.setStackMode(b.participant.id, 'coop'), { code: 'not_host' })
    assert.equal(rooms.setStackMode(a.participant.id, 'coop').mode, 'coop')
    assert.equal(b.last().mode, 'coop', 'le changement est annoncé')
    const view = await rooms.startStackRoom(a.participant.id)
    assert.equal(view.phase, 'countdown')
    assert.ok(view.startsAt && view.startsAt > Date.now() - 50)
    await assert.rejects(rooms.startStackRoom(a.participant.id), { code: 'room_started' })
    const late = seat(guest('Late'))
    await assert.rejects(rooms.joinStackRoom(late.participant, created.code, late.link), { code: 'room_started' })
    // Un joueur déjà dans le salon peut y revenir (autre onglet) : son canal est remplacé.
    const again = seat(a.participant)
    await rooms.joinStackRoom(a.participant, created.code, again.link)
    assert.equal(a.closed, true)
    assert.ok(again.last())
  })

  it('un joueur n’est que dans un salon à la fois', async () => {
    const a = seat(guest('Ana'))
    const b = seat(guest('Bob'))
    const first = await rooms.createStackRoom(a.participant, 'versus', a.link)
    await rooms.joinStackRoom(b.participant, first.code, b.link)
    const second = await rooms.createStackRoom(b.participant, 'coop', b.link)
    assert.notEqual(second.code, first.code)
    assert.equal(a.last().players.length, 1, 'il a quitté le premier')
    assert.equal(rooms.currentStackRoom(b.participant.id), second.code)
  })
})

describe('Page Stack — salon d’attente : coupure de connexion', () => {
  it('l’hôte qui quitte l’appli (connexion coupée) retrouve son salon à son retour', async () => {
    const a = seat(guest('Ana'))
    const created = await rooms.createStackRoom(a.participant, 'versus', a.link)
    rooms.disconnectStack(a.participant.id, a.link)
    assert.ok(rooms.stackRoomView(created.code), 'le salon existe toujours')
    assert.equal(rooms.stackRoomView(created.code)?.players[0]?.connected, false)
    // Un ami qui arrive avec le lien trouve le salon, l’hôte reste hôte.
    const b = seat(guest('Bob'))
    await rooms.joinStackRoom(b.participant, created.code, b.link)
    assert.equal(b.last().hostId, a.participant.id)
    // L’hôte revient : même place, plus de départ différé.
    const back = seat(a.participant)
    await rooms.joinStackRoom(a.participant, created.code, back.link)
    assert.equal(back.last().players.every((player) => player.connected), true)
    await new Promise((resolve) => setTimeout(resolve, rooms.LOBBY_GRACE_MS + 80))
    assert.equal(rooms.stackRoomView(created.code)?.players.length, 2)
    rooms.leaveStackRoom(a.participant.id)
    rooms.leaveStackRoom(b.participant.id)
  })

  it('sans retour passé le délai de grâce : la place est libérée, le salon vide disparaît', async () => {
    const a = seat(guest('Ana'))
    const b = seat(guest('Bob'))
    const created = await rooms.createStackRoom(a.participant, 'coop', a.link)
    await rooms.joinStackRoom(b.participant, created.code, b.link)
    rooms.disconnectStack(a.participant.id, a.link)
    await wait(() => b.last().players.length === 1)
    assert.equal(b.last().hostId, b.participant.id, 'l’hôte absent passe la main')
    rooms.disconnectStack(b.participant.id, b.link)
    await wait(() => rooms.stackRoomView(created.code) === null)
  })

  it('au lancement, un joueur resté hors ligne n’est pas de la partie', async () => {
    const [a, b, c] = ['Ana', 'Bob', 'Cleo'].map((name) => seat(guest(name))) as [ReturnType<typeof seat>, ReturnType<typeof seat>, ReturnType<typeof seat>]
    const created = await rooms.createStackRoom(a.participant, 'versus', a.link)
    await rooms.joinStackRoom(b.participant, created.code, b.link)
    await rooms.joinStackRoom(c.participant, created.code, c.link)
    rooms.disconnectStack(c.participant.id, c.link)
    await rooms.startStackRoom(a.participant.id)
    assert.deepEqual(a.last().players.map((player) => player.id).sort(), [a.participant.id, b.participant.id].sort())
    assert.equal(rooms.currentStackRoom(c.participant.id), null)
    rooms.leaveStackRoom(a.participant.id)
    rooms.leaveStackRoom(b.participant.id)
  })
})

describe('Page Stack — versus', () => {
  it('chacun sa pile : les gestes sont relayés aux autres (pas à soi), mêmes affiches pour tous', async () => {
    const { seats } = await started('versus', ['Ana', 'Bob', 'Cleo'])
    const [a, b, c] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>, ReturnType<typeof seat>]
    const seed = a.last().seed
    assert.deepEqual([b.last().seed, c.last().seed], [seed, seed])
    rooms.stackTick(a.participant.id, 0.42, 1, 30)
    rooms.stackTap(a.participant.id, 0.5)
    for (const other of [b, c]) {
      assert.deepEqual(other.events().map((event) => event.k), ['tk', 'tp'])
      assert.deepEqual(other.events('tk')[0], { k: 'tk', p: a.participant.id, x: 0.42, d: 1, s: 30 })
    }
    assert.equal(a.events().length, 0, 'jamais son propre geste')
    // L'heure d'émission est relayée (bornée à l'heure du serveur) pour que les autres compensent le trajet.
    const sent = Date.now() - 80
    rooms.stackTick(a.participant.id, 0.44, 1, 30, sent)
    rooms.stackTick(a.participant.id, 0.45, 1, 30, Date.now() + 60_000)
    const stamped = b.events('tk').slice(-2)
    assert.equal(stamped[0]!.a, sent)
    assert.ok(stamped[1]!.a! <= Date.now())
    // Un autre joueur peut jouer en même temps (pas de tour).
    rooms.stackTap(b.participant.id, 0.61)
    assert.equal(a.events('tp').length, 1)
    assert.equal(c.events('tp').length, 2)
  })

  it('les valeurs absurdes sont ramenées dans des bornes ; hors partie, tout est ignoré', async () => {
    const a = seat(guest('Ana'))
    const b = seat(guest('Bob'))
    const created = await rooms.createStackRoom(a.participant, 'versus', a.link)
    await rooms.joinStackRoom(b.participant, created.code, b.link)
    rooms.stackTap(a.participant.id, 0.5)
    assert.equal(b.events().length, 0, 'pas encore de partie')
    await rooms.startStackRoom(a.participant.id)
    await wait(() => a.last().phase === 'playing')
    rooms.stackTick(a.participant.id, 999, 1, -50)
    assert.deepEqual(b.events('tk')[0], { k: 'tk', p: a.participant.id, x: 1.6, d: 1, s: 0 })
  })

  it('la partie finit quand tout le monde est tombé : le meilleur score gagne, égalité partagée', async () => {
    const { seats } = await started('versus', ['Ana', 'Bob', 'Cleo'])
    const [a, b, c] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>, ReturnType<typeof seat>]
    rooms.stackOver(a.participant.id, { score: 300, pages: 20, perfects: 5, combo: 3 })
    assert.equal(b.events('over').length, 1)
    assert.equal(a.last().phase, 'playing', 'les autres continuent')
    assert.deepEqual(a.last().players.find((player) => player.id === a.participant.id)?.over, true)
    // Une pile déjà tombée ne rejoue pas.
    rooms.stackTap(a.participant.id, 0.5)
    assert.equal(b.events('tp').length, 0)
    rooms.stackOver(b.participant.id, { score: 450, pages: 30, perfects: 9, combo: 4 })
    rooms.stackOver(c.participant.id, { score: 450, pages: 25, perfects: 1, combo: 1 })
    const results = a.last().results!
    assert.equal(a.last().phase, 'over')
    assert.deepEqual(results.ranking.map((entry) => entry.id), [b.participant.id, c.participant.id, a.participant.id], 'à score égal, la pile la plus haute devant')
    assert.deepEqual(results.winnerIds.sort(), [b.participant.id, c.participant.id].sort(), 'égalité : deux vainqueurs')
  })

  it('un joueur qui se déconnecte est éliminé avec son dernier score ; revanche : retour au salon', async () => {
    const { seats } = await started('versus', ['Ana', 'Bob'])
    const [a, b] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>]
    rooms.stackTick(a.participant.id, 0.5, 1, 120)
    rooms.disconnectStack(a.participant.id, a.link)
    assert.equal(b.events('over')[0]?.score, 120)
    rooms.stackOver(b.participant.id, { score: 80, pages: 8, perfects: 0, combo: 0 })
    const results = b.last().results!
    assert.equal(b.last().phase, 'over')
    assert.deepEqual(results.winnerIds, [a.participant.id], 'avec 120 contre 80')

    assert.equal(b.last().hostId, b.participant.id, 'l’hôte parti passe la main')
    assert.throws(() => rooms.rematchStackRoom(a.participant.id), { code: 'not_host' })
    const view = rooms.rematchStackRoom(b.participant.id)
    assert.equal(view.phase, 'lobby')
    assert.equal(view.results, null)
    assert.deepEqual(view.players.map((player) => player.id), [b.participant.id], 'le joueur parti n’est pas gardé')
  })

  it('la partie versus s’arrête quand le temps imparti est écoulé', async () => {
    const { VERSUS_LIMIT_MS } = rooms
    assert.ok(VERSUS_LIMIT_MS >= 60_000 && VERSUS_LIMIT_MS <= 10 * 60_000)
  })
})

describe('Page Stack — coop', () => {
  it('une pile, chacun son tour : l’ordre d’arrivée, ceux qui ne sont pas au tour sont ignorés', async () => {
    const { seats } = await started('coop', ['Ana', 'Bob', 'Cleo'])
    const [a, b, c] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>, ReturnType<typeof seat>]
    assert.equal(a.last().turn, a.participant.id)
    // Hors tour : ni geste ni position.
    rooms.stackTick(b.participant.id, 0.3, 1, 0)
    rooms.stackTap(b.participant.id, 0.3)
    assert.equal(a.events().length + c.events().length, 0)
    rooms.stackTick(a.participant.id, 0.4, -1, 10)
    assert.equal(b.events('tk').length, 1)
    rooms.stackTap(a.participant.id, 0.5)
    assert.deepEqual(a.events('turn'), [{ k: 'turn', p: b.participant.id }], 'celui qui pose apprend à qui le tour')
    assert.deepEqual(b.events('tp')[0], { k: 'tp', p: a.participant.id, x: 0.5, next: b.participant.id })
    assert.deepEqual(c.events('tp')[0], { k: 'tp', p: a.participant.id, x: 0.5, next: b.participant.id })
    rooms.stackTap(b.participant.id, 0.5)
    rooms.stackTap(c.participant.id, 0.5)
    // Retour au premier.
    assert.equal(c.events('tp').at(-1)?.next, c.participant.id, 'Bob a posé : c’est à Cleo')
    assert.equal(a.events('tp').at(-1)?.next, a.participant.id, 'Cleo a posé : retour à Ana')
  })

  it('celui dont c’est le tour qui part passe la main ; la pile qui tombe termine pour tous avec le score commun', async () => {
    const { seats } = await started('coop', ['Ana', 'Bob', 'Cleo'])
    const [a, b, c] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>, ReturnType<typeof seat>]
    rooms.stackTap(a.participant.id, 0.5)
    // Le tour est à Bob, qui se déconnecte : Cleo reprend.
    rooms.disconnectStack(b.participant.id, b.link)
    assert.equal(c.last().turn, c.participant.id)
    rooms.stackTap(c.participant.id, 0.5)
    assert.equal(a.events('tp').at(-1)?.next, a.participant.id, 'Bob est sauté')
    // Hors tour, personne ne peut faire tomber la pile.
    rooms.stackOver(c.participant.id, { score: 1, pages: 1, perfects: 0, combo: 0 })
    assert.equal(a.last().phase, 'playing')
    rooms.stackOver(a.participant.id, { score: 640, pages: 31, perfects: 12, combo: 6 })
    const last = a.last()
    assert.equal(last.phase, 'over')
    assert.equal(last.results?.team?.score, 640)
    assert.equal(last.results?.mode, 'coop')
    assert.equal(last.results?.ranking.find((entry) => entry.id === a.participant.id)?.placed, 1)
    assert.equal(last.results?.winnerIds.length, 3, 'en coop, tout le monde gagne ensemble')
    assert.ok(last.players.every((player) => player.score === 640), 'le score affiché est celui de l’équipe')
  })

  it('tous les joueurs partis : le salon se ferme', async () => {
    const { seats, code } = await started('coop', ['Ana', 'Bob'])
    const [a, b] = seats as [ReturnType<typeof seat>, ReturnType<typeof seat>]
    rooms.disconnectStack(a.participant.id, a.link)
    rooms.disconnectStack(b.participant.id, b.link)
    assert.equal(rooms.stackRoomView(code)?.phase, 'over')
    // Un salon terminé que plus personne n'occupe disparaît au départ du dernier.
    rooms.leaveStackRoom(a.participant.id)
    rooms.leaveStackRoom(b.participant.id)
    assert.equal(rooms.stackRoomView(code), null)
  })
})

/* ---- WebSocket ----------------------------------------------------------------------- */

class Socket {
  readonly inbox: Message[] = []
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.inbox.push(JSON.parse(raw.toString()) as Message))
  }
  static async open(cookie: string): Promise<Socket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/stack/ws`, { headers: { Cookie: cookie } })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
      ws.once('unexpected-response', (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)))
    })
    return new Socket(ws)
  }
  send(message: Message) {
    this.ws.send(JSON.stringify(message))
  }
  async next(match: (message: Message) => boolean, ms = 3000): Promise<Message> {
    const start = Date.now()
    for (;;) {
      const found = this.inbox.find(match)
      if (found) return found
      if (Date.now() - start > ms) throw new Error(`message attendu : ${JSON.stringify(this.inbox.slice(-3))}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

describe('Page Stack — WebSocket', () => {
  it('un compte et un invité jouent ensemble : création, invitation, départ, gestes relayés, fin', async () => {
    const account: TestClient = client()
    const signed = await account.signUp({ email: `ws-${Date.now()}@example.com`, password: 'motdepasse-test', displayName: 'Lia' })
    assert.equal(signed.status, 201, JSON.stringify(signed.body))
    const visitor = client()
    assert.equal((await visitor.request('POST', '/dle/guest', { name: 'Visiteur' })).status, 200)

    const host = await Socket.open(account.cookie())
    const friend = await Socket.open(visitor.cookie())
    host.send({ t: 'create', mode: 'versus' })
    const created = (await host.next((message) => message.t === 'room')).room as { code: string; players: { name: string }[] }
    assert.equal(created.players[0]?.name, 'Lia')
    friend.send({ t: 'join', code: created.code })
    await host.next((message) => message.t === 'room' && (message.room as { players: unknown[] }).players.length === 2)
    host.send({ t: 'start' })
    await friend.next((message) => message.t === 'room' && (message.room as { phase: string }).phase === 'playing')

    host.send({ t: 'tk', x: 0.4, d: 1, s: 20 })
    host.send({ t: 'tp', x: 0.5 })
    const tk = await friend.next((message) => message.t === 'ev' && (message.e as { k: string }).k === 'tk')
    assert.equal((tk.e as { x: number }).x, 0.4)
    await friend.next((message) => message.t === 'ev' && (message.e as { k: string }).k === 'tp')

    friend.send({ t: 'over', score: 10, pages: 1, perfects: 0, combo: 0 })
    host.send({ t: 'over', score: 90, pages: 9, perfects: 1, combo: 1 })
    const end = await host.next((message) => message.t === 'room' && (message.room as { phase: string }).phase === 'over')
    assert.equal((end.room as { results: { winnerIds: string[] } }).results.winnerIds.length, 1)

    // Message illisible ou erreur métier : répondu, sans fermer le canal.
    friend.send({ t: 'join', code: 'ZZZZZZ' })
    const err = await friend.next((message) => message.t === 'err')
    assert.equal(err.code, 'not_found')
    host.ws.close()
    friend.ws.close()
  })

  it('sans identité : refusé', async () => {
    await assert.rejects(Socket.open(''), /401/)
  })
})
