import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bombCodeFromSearch, heat, seatPosition, splitAround, tickInterval, withoutBombParam } from '../src/lib/bomb'

describe('bomb party — affichage', () => {
  it('surligne la syllabe dans le mot tapé, accents et casse compris', () => {
    assert.deepEqual(splitAround('Parlé', 'par'), [
      { text: 'Par', hit: true },
      { text: 'lé', hit: false },
    ])
    assert.deepEqual(splitAround('enTÊTE', 'ete'), [
      { text: 'enT', hit: false },
      { text: 'ÊTE', hit: true },
    ])
    assert.deepEqual(splitAround('cœur', 'oeu'), [
      { text: 'c', hit: false },
      { text: 'œu', hit: true },
      { text: 'r', hit: false },
    ])
    assert.deepEqual(splitAround('truite', 'par'), [{ text: 'truite', hit: false }])
    assert.deepEqual(splitAround('', 'par'), [])
  })

  it('la bombe chauffe et le tic-tac accélère quand la mèche raccourcit', () => {
    assert.equal(heat(0.9).stage, 'calm')
    assert.equal(heat(0.4).stage, 'warm')
    assert.equal(heat(0.1).stage, 'critical')
    assert.ok(tickInterval(1) > tickInterval(0.5) && tickInterval(0.5) > tickInterval(0))
  })

  it('le joueur de l’appareil est assis en bas, les autres autour', () => {
    const me = seatPosition(2, 4, 2)
    assert.equal(Math.round(me.x), 50)
    assert.ok(me.y > 80)
    const opposite = seatPosition(0, 4, 2)
    assert.ok(opposite.y < 20)
  })

  it('lien d’invitation', () => {
    assert.equal(bombCodeFromSearch('?bomb=abc-def'), 'ABCDEF')
    assert.equal(bombCodeFromSearch('?x=1'), null)
    assert.equal(withoutBombParam('https://a.b/?bomb=ABCDEF&u=1'), '/?u=1')
  })
})

describe('bomb party — répliques de défaite', async () => {
  const { BOMB_QUOTES, pickQuote, quotePortrait } = await import('../src/lib/bombQuotes')
  const { fr } = await import('../src/i18n/fr')
  const { en } = await import('../src/i18n/en')

  it('jamais deux fois la même réplique d’affilée', () => {
    let previous = pickQuote(() => 0)
    for (let index = 0; index < 50; index += 1) {
      const next = pickQuote(() => 0)
      assert.notEqual(next.id, previous.id)
      previous = next
    }
  })

  it('chaque réplique existe en français et en anglais, portrait relayé par l’API', () => {
    for (const quote of BOMB_QUOTES) {
      assert.ok(fr.bomb.quotes[quote.id].text && en.bomb.quotes[quote.id].text, quote.id)
      if (quote.portrait) assert.match(quotePortrait(quote) ?? '', /^\/api\/dle\/characters\/\w+\/[\w-]+\/image$/)
    }
  })
})
