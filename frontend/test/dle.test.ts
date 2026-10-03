import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clockOffset,
  displayRoomCode,
  formatClock,
  formatCountdownLong,
  formatSolveTime,
  isNewer,
  msUntil,
  normalizeQuery,
  parseRoomCode,
  podiumOrder,
  receiptAmount,
  pixelColumns,
  PIXEL_STEPS,
  roomCodeFromSearch,
  roomLink,
  searchWorks,
  verdictCounts,
  withoutRoomParam,
  zoomScale,
} from '../src/lib/dle'
import type { DleWorkOption, RoomView } from '../src/services/dleApi'

const work = (id: string, name: string, search = ''): DleWorkOption => ({ id, number: 1, name, imageUrl: `/api/covers/${id}`, rarity: 'RARE', search })

const WORKS = [
  work('a', 'Solo Leveling', 'solo leveling na honjaman level up'),
  work('b', 'The Solo Ranker', 'the solo ranker'),
  work('c', 'Kimetsu no Yaiba', 'kimetsu no yaiba demon slayer'),
  work('d', 'Absolute Sword Sense', 'absolute sword sense'),
]

describe('dle — recherche d’une œuvre', () => {
  it('début du titre, puis début d’un mot, puis n’importe où, puis titres alternatifs', () => {
    assert.deepEqual(searchWorks(WORKS, 'solo', new Set()).map((entry) => entry.id), ['a', 'b'])
    assert.deepEqual(searchWorks(WORKS, 'demon', new Set()).map((entry) => entry.id), ['c'])
    assert.deepEqual(searchWorks(WORKS, 'word', new Set()).map((entry) => entry.id), ['d'])
  })

  it('accents, casse et ponctuation ignorés ; œuvres déjà proposées écartées ; saisie vide : rien', () => {
    assert.equal(normalizeQuery('  Kimétsu-no  YAIBA! '), 'kimetsu no yaiba')
    assert.deepEqual(searchWorks(WORKS, 'KIMÉTSU', new Set()).map((entry) => entry.id), ['c'])
    assert.deepEqual(searchWorks(WORKS, 'solo', new Set(['a'])).map((entry) => entry.id), ['b'])
    assert.deepEqual(searchWorks(WORKS, '   ', new Set()), [])
    assert.equal(searchWorks(WORKS, 'o', new Set(), 2).length, 2)
  })
})

describe('dle — zoom et horloge', () => {
  it('le zoom recule à chaque erreur, jusqu’à la couverture entière', () => {
    assert.equal(zoomScale(0), 5)
    assert.ok(zoomScale(3) < zoomScale(2))
    assert.equal(zoomScale(50), 1)
    assert.equal(zoomScale(-1), 5)
  })

  it('horloge corrigée par l’avance du serveur', () => {
    const offset = clockOffset('2026-10-02T12:00:05.000Z', Date.parse('2026-10-02T12:00:00.000Z'))
    assert.equal(offset, 5000)
    assert.equal(msUntil('2026-10-02T12:01:05.000Z', offset, Date.parse('2026-10-02T12:00:00.000Z')), 60_000)
    assert.equal(msUntil('2026-10-02T11:00:00.000Z', offset, Date.parse('2026-10-02T12:00:00.000Z')), 0)
    assert.equal(msUntil(null, 0, 0), null)
  })

  it('formats : chrono, temps de résolution, compte à rebours', () => {
    assert.equal(formatClock(65_000), '1:05')
    assert.equal(formatClock(9_100), '0:10')
    assert.equal(formatSolveTime(12_400, 'fr'), '12,4 s')
    assert.equal(formatSolveTime(12_400, 'en'), '12.4 s')
    assert.equal(formatSolveTime(83_000, 'fr'), '1:23')
    assert.equal(formatCountdownLong(3_723_000), '01:02:03')
    assert.equal(formatCountdownLong(-5), '00:00:00')
  })
})

describe('dle — salons', () => {
  it('code : saisie libre, lisible, lien d’invitation aller-retour', () => {
    assert.equal(parseRoomCode(' bk7-q4m '), 'BK7Q4M')
    assert.equal(parseRoomCode('BK7Q4'), null)
    assert.equal(parseRoomCode('BK7Q4O'), null, 'pas de O : il se confond avec 0')
    assert.equal(displayRoomCode('BK7Q4M'), 'BK7·Q4M')
    const link = roomLink('BK7Q4M', 'https://bookshelf.example', '/')
    assert.equal(roomCodeFromSearch(new URL(link).search), 'BK7Q4M')
    assert.equal(roomCodeFromSearch('?dle=nope'), null)
    assert.equal(withoutRoomParam('https://bookshelf.example/?dle=BK7Q4M&u=abc#x'), '/?u=abc#x')
  })

  it('états : jamais un état plus ancien par-dessus un plus récent', () => {
    const view = (code: string, version: number) => ({ code, version }) as RoomView
    assert.equal(isNewer(view('A', 3), null), true)
    assert.equal(isNewer(view('A', 3), view('A', 4)), false)
    assert.equal(isNewer(view('A', 4), view('A', 4)), true)
    assert.equal(isNewer(view('B', 1), view('A', 9)), true)
  })

  it('podium : 2ᵉ, 1ᵉʳ, 3ᵉ ; couleurs d’un essai', () => {
    const ranks = [{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }]
    assert.deepEqual(podiumOrder(ranks).map((entry) => entry.rank), [2, 1, 3])
    assert.deepEqual(podiumOrder([{ rank: 1 }, { rank: 2 }]).map((entry) => entry.rank), [2, 1])
    assert.deepEqual(podiumOrder([{ rank: 1 }]).map((entry) => entry.rank), [1])
    assert.deepEqual(verdictCounts(['exact', 'partial', 'exact', 'wrong']), { exact: 2, partial: 1, wrong: 1 })
  })
})

describe('dle — reçus d’invité', () => {
  it('montant lisible sur l’appareil ; 0 pour un reçu illisible', () => {
    const payload = Buffer.from(JSON.stringify({ n: 'abc', a: 40, t: 1 })).toString('base64url')
    assert.equal(receiptAmount(`${payload}.signature`), 40)
    assert.equal(receiptAmount('n-importe-quoi'), 0)
    assert.equal(receiptAmount(`${Buffer.from(JSON.stringify({ a: -5 })).toString('base64url')}.x`), 0)
  })
})

describe('dle — Pixels', () => {
  it('pixels de plus en plus fins à chaque erreur ; l’image nette à la quinzième', () => {
    assert.equal(PIXEL_STEPS.length, 15)
    assert.equal(pixelColumns(0), 8)
    for (let errors = 1; errors < 15; errors += 1) assert.ok((pixelColumns(errors) ?? 0) > (pixelColumns(errors - 1) ?? 0), `cran ${errors} plus fin`)
    assert.equal(pixelColumns(15), null)
    assert.equal(pixelColumns(99), null)
    assert.equal(pixelColumns(-3), 8)
  })
})

describe('mode classique — rythme du retournement', () => {
  it('la victoire attend la dernière tuile (et l’en-tête au premier essai)', async () => {
    const { classicRevealSeconds, HEAD_REVEAL, TILE_FLIP, TILE_STAGGER } = await import('../src/lib/dle.ts')
    // Mangas : l'œuvre et huit colonnes.
    const later = classicRevealSeconds('manga', 3, false)
    assert.ok(Math.abs(later - (8 * TILE_STAGGER + TILE_FLIP)) < 1e-9)
    assert.ok(Math.abs(classicRevealSeconds('manga', 1, false) - (later + HEAD_REVEAL)) < 1e-9)
    // Personnages : six colonnes, donc plus court.
    assert.ok(classicRevealSeconds('naruto', 3, false) < later)
    assert.equal(classicRevealSeconds('manga', 3, true), 0)
  })
})
