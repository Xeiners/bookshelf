import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_SOURCES,
  catalogOrigins,
  interleave,
  sameSources,
  sanitizeSources,
  splitSeen,
  toggleSource,
} from '../src/lib/deckSources'

describe('deck de Découverte — types cochés', () => {
  it('cocher « Romans » en plus des mangas : les deux restent, dans l’ordre du panneau', () => {
    assert.deepEqual(toggleSource(['manga'], 'novel'), ['manga', 'novel'])
    assert.deepEqual(toggleSource(['novel', 'manga'], 'manhwa'), ['manga', 'manhwa', 'novel'])
  })

  it('décocher retire ; le dernier type coché ne se décoche jamais', () => {
    assert.deepEqual(toggleSource(['manga', 'novel'], 'manga'), ['novel'])
    assert.deepEqual(toggleSource(['novel'], 'novel'), ['novel'])
  })

  it('sélection enregistrée : valeurs inconnues ignorées, vide ou illisible → sélection par défaut', () => {
    assert.deepEqual(sanitizeSources(['novel', 'isekai', 'manga', 'manga']), ['manga', 'novel'])
    assert.deepEqual(sanitizeSources([]), [...DEFAULT_SOURCES])
    assert.deepEqual(sanitizeSources('manga'), [...DEFAULT_SOURCES])
    assert.deepEqual(sanitizeSources(undefined), ['manga', 'manhwa', 'manhua'])
  })

  it('origines MangaDex d’une sélection ; comparaison sans tenir compte de l’ordre', () => {
    assert.deepEqual(catalogOrigins(['manga', 'manhua', 'novel']), ['manga', 'manhua'])
    assert.deepEqual(catalogOrigins(['novel']), [])
    assert.equal(sameSources(['manhwa', 'manga', 'manhua'], DEFAULT_SOURCES), true)
    assert.equal(sameSources(['manga', 'novel'], DEFAULT_SOURCES), false)
  })

  it('cartes déjà vues réparties par source : chaque API ne reçoit que les siennes', () => {
    assert.deepEqual(splitSeen(['11111111-1111-4111-8111-111111111111', 'ol:OL1W', 'gb:abc']), {
      catalog: ['11111111-1111-4111-8111-111111111111'],
      novel: ['ol:OL1W', 'gb:abc'],
    })
  })

  it('deck mêlé : une carte sur deux, le reste de la plus longue fournée à la fin', () => {
    assert.deepEqual(interleave(['m1', 'm2', 'm3'], ['r1']), ['m1', 'r1', 'm2', 'm3'])
    assert.deepEqual(interleave([], ['r1', 'r2']), ['r1', 'r2'])
  })
})
