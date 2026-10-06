import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer, type TestClient } from './harness.js'

prepareEnvironment('bomb')
installMangadexMock()
const { client, close, base } = await startServer()
const dictionary = await import('../src/modules/bomb/bomb.dictionary.js')
const logic = await import('../src/modules/bomb/bomb.logic.js')
const rooms = await import('../src/modules/bomb/bomb.rooms.js')
after(async () => {
  rooms.forgetBombRooms()
  await close()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Account = TestClient & { userId: string }
async function account(email: string, displayName: string): Promise<Account> {
  const device = client()
  const signed = await device.signUp({ email, password: 'motdepasse-test', displayName })
  assert.equal(signed.status, 201, JSON.stringify(signed.body))
  return Object.assign(device, { userId: signed.body.user.id as string })
}

/** Un mot qui marche pour la syllabe (le dictionnaire du serveur le fournit). */
async function solution(mode: 'classic' | 'manga', syllable: string, used = new Set<string>()): Promise<string> {
  const lexicon = await dictionary.lexiconOf(mode)
  const word = lexicon.example(syllable, used)
  assert.ok(word, `aucun mot pour « ${syllable} »`)
  return word
}

describe('bomb party — dictionnaires et règles', () => {
  it('normalise sans casse ni accents, et valide un mot français', async () => {
    assert.equal(dictionary.normalizeWord('Été !'), 'ete')
    assert.equal(dictionary.normalizeWord('Cœur'), 'coeur')
    const fr = await dictionary.classicLexicon()
    assert.ok(fr.size > 300_000)
    assert.deepEqual(dictionary.checkWord(fr, 'Parlons', 'par', new Set()), { ok: true, key: 'parlons', display: 'parlons' })
    assert.deepEqual(dictionary.checkWord(fr, 'truite', 'par', new Set()), { ok: false, reason: 'syllable' })
    assert.deepEqual(dictionary.checkWord(fr, 'parzouille', 'par', new Set()), { ok: false, reason: 'unknown' })
    assert.deepEqual(dictionary.checkWord(fr, 'PARLONS', 'par', new Set(['parlons'])), { ok: false, reason: 'used' })
    assert.deepEqual(dictionary.checkWord(fr, 'p', 'par', new Set()), { ok: false, reason: 'short' })
  })

  it('mode Manga : nom entier ou mot marquant, un personnage ne compte qu’une fois', () => {
    const manga = dictionary.mangaLexicon()
    const luffy = dictionary.checkWord(manga, 'Luffy', 'lu', new Set())
    assert.deepEqual(luffy, { ok: true, key: 'monkeydluffy', display: 'Monkey D. Luffy' })
    assert.deepEqual(dictionary.checkWord(manga, 'Monkey D. Luffy', 'lu', new Set(['monkeydluffy'])), { ok: false, reason: 'used' })
    assert.equal(dictionary.checkWord(manga, 'Kakashi', 'ka', new Set()).ok, true)
    assert.deepEqual(dictionary.checkWord(manga, 'the', 'th', new Set()), { ok: false, reason: 'unknown' })
    for (const difficulty of ['easy', 'medium', 'hard'] as const) assert.ok(manga.syllables[difficulty].length > 20)
  })

  it('syllabes de plus en plus rares, mèches de plus en plus courtes, Poussières plafonnées', async () => {
    const fr = await dictionary.classicLexicon()
    assert.ok(fr.syllables.easy.includes(logic.pickSyllable(fr, 0, [], () => 0.5)))
    assert.ok(fr.syllables.hard.includes(logic.pickSyllable(fr, 30, [], () => 0.1)))
    assert.ok(logic.fuseMs(0, () => 0) >= 12_000 && logic.fuseMs(0, () => 1) <= 18_000)
    assert.ok(logic.fuseMs(40, () => 1) <= 10_000)
    assert.equal(logic.soloReward(7), 14)
    assert.equal(logic.soloReward(100), logic.SOLO_REWARD_MAX)
    assert.equal(logic.versusReward(2), 20)
    assert.equal(logic.versusReward(8), logic.VERSUS_REWARD_MAX)
    assert.equal(logic.cappedReward(40, logic.BOMB_DAILY_CAP - 10), 10)
  })
})

describe('bomb party — solo', () => {
  it('le serveur arbitre : mots refusés, mot juste, explosion à SON heure, fin avec Poussières', async () => {
    const ana = await account('ana-bomb@example.com', 'Ana')
    const started = await ana.request('POST', '/bomb/solo', { mode: 'classic' })
    assert.equal(started.status, 201)
    const game = started.body
    assert.equal(game.lives, logic.LIVES)
    assert.match(game.syllable, /^[a-z]{2,3}$/)
    assert.ok(game.fuseEndsAt - game.serverTime >= 11_000)

    const refused = await ana.request('POST', `/bomb/solo/${game.id}/word`, { word: 'xqzwk' })
    assert.equal(refused.body.verdict.ok, false)
    const word = await solution('classic', game.syllable)
    const found = await ana.request('POST', `/bomb/solo/${game.id}/word`, { word: word.toUpperCase() })
    assert.equal(found.body.verdict.ok, true)
    assert.equal(found.body.view.words, 1)
    const again = await ana.request('POST', `/bomb/solo/${game.id}/word`, { word })
    assert.notEqual(again.body.verdict.reason, undefined)

    // Demander l'explosion trop tôt ne coûte rien.
    const early = await ana.request('POST', `/bomb/solo/${game.id}/explode`)
    assert.equal(early.body.lives, logic.LIVES)

    const quit = await ana.request('POST', `/bomb/solo/${game.id}/quit`)
    assert.equal(quit.body.over.words, 1)
    assert.equal(quit.body.over.reward, logic.soloReward(1))
    assert.equal(quit.body.over.record, true)
    const home = await ana.request('GET', '/bomb')
    assert.equal(home.body.records.bestClassic, 1)
    assert.equal(home.body.records.earnedToday, logic.soloReward(1))
  })

  it('mèche au bout : une vie en moins, un mot qui aurait marché, et la fin au bout de trois', async () => {
    logic.timing.fuseScale = 0.005
    logic.timing.pauseMs = 0
    try {
      const guest = client()
      await guest.request('POST', '/dle/guest', { name: 'Bombix' })
      const game = (await guest.request('POST', '/bomb/solo', { mode: 'manga' })).body
      await wait(150)
      const exploded = (await guest.request('POST', `/bomb/solo/${game.id}/explode`)).body
      assert.equal(exploded.over?.words, 0)
      assert.equal(exploded.lives, 0)
      assert.equal(exploded.missed.syllable.length >= 2, true)
      assert.ok(exploded.missed.example)
      // Invité : rien gagné, donc aucun reçu.
      assert.deepEqual(exploded.over.receipts, [])
    } finally {
      logic.timing.fuseScale = 1
      logic.timing.pauseMs = 1600
    }
  })
})

/** Lit le flux SSE d'un joueur : chaque événement `{ event, data }`. */
function listen(device: TestClient, code: string) {
  const events: { event: string; data: any }[] = []
  const controller = new AbortController()
  const ready = device.send('GET', `/bomb/rooms/${code}/stream`, { headers: { Accept: 'text/event-stream' } }).then(async (response) => {
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          buffer += decoder.decode(value, { stream: true })
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const block = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            const event = /^event: (.+)$/m.exec(block)?.[1]
            const data = /^data: (.+)$/m.exec(block)?.[1]
            if (event && data) events.push({ event, data: JSON.parse(data) })
            cut = buffer.indexOf('\n\n')
          }
        }
      } catch {
        // Flux fermé.
      }
    })()
  })
  return { events, ready, stop: () => controller.abort(), last: (event: string) => events.filter((entry) => entry.event === event).at(-1)?.data }
}

const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('délai dépassé')
    await wait(20)
  }
}

describe('bomb party — salon en temps réel', () => {
  it('frappe visible en direct, bombe passée au voisin, vies, dernier survivant', async () => {
    logic.timing.countdownMs = 50
    logic.timing.pauseMs = 0
    try {
      const host = await account('host-bomb@example.com', 'Hôte')
      const rival = client()
      await rival.request('POST', '/dle/guest', { name: 'Rival' })
      const created = await host.request('POST', '/bomb/rooms', { mode: 'classic' })
      assert.equal(created.status, 201)
      const code = created.body.code
      const joined = await rival.request('POST', `/bomb/rooms/${code}/join`)
      assert.equal(joined.body.players.length, 2)
      const rivalId = joined.body.players.find((player: { name: string }) => player.name === 'Rival').id

      const hostStream = listen(host, code)
      const rivalStream = listen(rival, code)
      await Promise.all([hostStream.ready, rivalStream.ready])
      await until(() => hostStream.last('state')?.players.every((player: { connected: boolean }) => player.connected))

      assert.equal((await rival.request('POST', `/bomb/rooms/${code}/start`)).status, 403)
      await host.request('POST', `/bomb/rooms/${code}/start`)
      await until(() => rivalStream.last('state')?.phase === 'playing')
      const state = rivalStream.last('state')
      assert.match(state.syllable, /^[a-z]{2,3}$/)
      const holder = state.turn === host.userId ? host : rival
      const other = holder === host ? rival : host
      const otherStream = holder === host ? rivalStream : hostStream

      // Ce que tape celui qui tient la bombe, les autres le voient lettre par lettre.
      await holder.request('POST', `/bomb/rooms/${code}/typing`, { text: 'pa' })
      await until(() => otherStream.last('typing')?.text === 'pa')
      // Pas son tour : ni frappe relayée, ni mot accepté.
      assert.equal((await other.request('POST', `/bomb/rooms/${code}/word`, { word: 'parler' })).body.error.code, 'not_your_turn')

      const word = await solution('classic', state.syllable)
      const played = await holder.request('POST', `/bomb/rooms/${code}/word`, { word })
      assert.equal(played.body.verdict.ok, true)
      await until(() => otherStream.last('state')?.turn !== state.turn)
      const passed = otherStream.last('state')
      assert.equal(passed.events.at(-1).kind, 'word')
      assert.equal(passed.players.find((player: { id: string }) => player.id === state.turn).words, 1)

      // Les mèches brûlent vite : chacun perd ses vies tour à tour, jusqu'au dernier survivant.
      logic.timing.fuseScale = 0.004
      const fail = await (passed.turn === host.userId ? host : rival).request('POST', `/bomb/rooms/${code}/word`, { word: 'zzzzqx' })
      assert.equal(fail.body.verdict.ok, false)
      await until(() => hostStream.last('state')?.phase === 'over' && hostStream.last('state')?.mine !== null, 20_000)
      const over = hostStream.last('state')
      assert.ok([host.userId, rivalId].includes(over.winnerId))
      assert.ok(over.events.some((event: { kind: string; example?: string }) => event.kind === 'explode' && event.example))
      const winnerReward = over.winnerId === host.userId ? over.mine.reward : rivalStream.last('state').mine.reward
      assert.equal(winnerReward, logic.versusReward(2))
      // Les reçus d'un invité ne partent qu'à lui.
      assert.deepEqual(over.mine.receipts, [])

      hostStream.stop()
      rivalStream.stop()
      rooms.leaveBombRoom(host.userId, code)
      rooms.leaveBombRoom(rivalId, code)
    } finally {
      logic.timing.countdownMs = 3000
      logic.timing.pauseMs = 1600
      logic.timing.fuseScale = 1
    }
  })

  it('réglages de l’hôte : vies, mèche minimale, syllabe gardée après une explosion, style', async () => {
    logic.timing.countdownMs = 30
    logic.timing.pauseMs = 0
    try {
      const host = await account('reglages-bomb@example.com', 'Réglages')
      const friend = client()
      await friend.request('POST', '/dle/guest', { name: 'Ami' })
      const created = await host.request('POST', '/bomb/rooms', { mode: 'classic', style: 'chibi' })
      const code = created.body.code
      assert.deepEqual(created.body.settings, { lives: logic.LIVES, minFuse: 10, keepSyllable: false, style: 'chibi' })
      await friend.request('POST', `/bomb/rooms/${code}/join`)
      assert.equal((await friend.request('POST', `/bomb/rooms/${code}/settings`, { lives: 1 })).status, 403)
      assert.equal((await host.request('POST', `/bomb/rooms/${code}/settings`, { lives: 5 })).status, 400)
      assert.equal((await host.request('POST', `/bomb/rooms/${code}/settings`, { minFuse: 7 })).status, 400)
      const set = await host.request('POST', `/bomb/rooms/${code}/settings`, { lives: 2, minFuse: 5, keepSyllable: true, style: 'talisman' })
      assert.deepEqual(set.body.settings, { lives: 2, minFuse: 5, keepSyllable: true, style: 'talisman' })
      assert.ok(set.body.players.every((player: { lives: number }) => player.lives === 2))

      // Mèche : jamais sous le minimum, jusqu'à 8 s de plus (4 s quand la partie s'emballe).
      assert.equal(logic.roomFuseMs(0, 5, () => 0), 5_000)
      assert.equal(logic.roomFuseMs(0, 5, () => 1), 13_000)
      assert.equal(logic.roomFuseMs(40, 15, () => 1), 19_000)

      const stream = listen(host, code)
      await stream.ready
      // Mèches très courtes : la première bombe explose aussitôt.
      logic.timing.fuseScale = 0.06
      await host.request('POST', `/bomb/rooms/${code}/start`)
      await until(() => stream.last('state')?.phase === 'playing')
      const first = stream.last('state')
      // Explosion : le joueur suivant hérite de la MÊME syllabe.
      const holder = first.turn === host.userId ? host : friend
      await holder.request('POST', `/bomb/rooms/${code}/word`, { word: 'zzzzqx' })
      await until(() => stream.last('state')?.events.some((event: { kind: string }) => event.kind === 'explode'), 8000)
      const after = stream.last('state')
      if (after.phase === 'playing') {
        assert.notEqual(after.turn, first.turn)
        assert.equal(after.syllable, first.syllable)
      }
      assert.equal(after.players.find((player: { id: string }) => player.id === first.turn).lives, 1)
      stream.stop()
      rooms.leaveBombRoom(host.userId, code)
    } finally {
      logic.timing.countdownMs = 3000
      logic.timing.pauseMs = 1600
      logic.timing.fuseScale = 1
    }
  })

  it('salon : code inconnu → 404, salon complet → 409, pas d’hôte pour lancer seul', async () => {
    const solo = await account('solo-bomb@example.com', 'Solo')
    assert.equal((await solo.request('POST', '/bomb/rooms/ZZZZZZ/join')).status, 404)
    const { code } = (await solo.request('POST', '/bomb/rooms', { mode: 'manga' })).body
    assert.equal((await solo.request('POST', `/bomb/rooms/${code}/start`)).body.error.code, 'not_enough_players')
    for (let index = 0; index < logic.MAX_PLAYERS - 1; index += 1) {
      const guest = client()
      await guest.request('POST', '/dle/guest', { name: `Invité ${index}` })
      assert.equal((await guest.request('POST', `/bomb/rooms/${code}/join`)).status, 200)
    }
    const late = client()
    await late.request('POST', '/dle/guest', { name: 'Retard' })
    assert.equal((await late.request('POST', `/bomb/rooms/${code}/join`)).body.error.code, 'room_full')
  })
})

describe('bomb party — portraits des répliques', () => {
  it('relaie la photo MyAnimeList du bon personnage, et refuse une réplique inconnue', async () => {
    mockedHosts.add('api.jikan.moe')
    mockedHosts.add('cdn.myanimelist.net')
    const searches: string[] = []
    extraMocks.push((url) => {
      if (url.hostname === 'api.jikan.moe' && url.pathname === '/v4/characters') {
        searches.push(url.searchParams.get('q') ?? '')
        return Response.json({
          data: [
            { mal_id: 1, name: 'Saitama, Someone', images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/characters/wrong.jpg' } } },
            { mal_id: 73935, name: 'Saitama', images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/characters/saitama.jpg' } } },
          ],
        })
      }
      if (url.hostname === 'cdn.myanimelist.net') {
        return new Response(url.pathname.endsWith('saitama.jpg') ? 'SAITAMA' : 'WRONG', { headers: { 'Content-Type': 'image/jpeg' } })
      }
      return undefined
    })
    const first = await fetch(`${base}/bomb/quotes/saitama/portrait`)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'image/jpeg')
    assert.equal(await first.text(), 'SAITAMA')
    assert.equal((await fetch(`${base}/bomb/quotes/saitama/portrait`)).status, 200)
    assert.deepEqual(searches, ['Saitama'], 'une seule recherche : le portrait est gardé en cache')
    assert.equal((await fetch(`${base}/bomb/quotes/inconnu/portrait`)).status, 404)
    assert.equal((await fetch(`${base}/bomb/quotes/__proto__/portrait`)).status, 404)
  })
})
