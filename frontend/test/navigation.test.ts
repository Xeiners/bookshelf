import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSpreads,
  keyAction,
  naturalCompare,
  neighbours,
  readingOrder,
  spreadIndexOf,
  swipeAction,
  tapAction,
} from '../src/lib/reader/navigation'
import type { ReaderChapter } from '../src/types/reader'

describe('planches (simple / double page)', () => {
  it('simple page : une page par planche', () => {
    assert.deepEqual(buildSpreads(3, false), [[0], [1], [2]])
  })

  it('double page : couverture seule, puis pages en vis-à-vis', () => {
    assert.deepEqual(buildSpreads(6, true), [[0], [1, 2], [3, 4], [5]])
    assert.deepEqual(buildSpreads(5, true), [[0], [1, 2], [3, 4]])
    assert.deepEqual(buildSpreads(4, true, false), [[0, 1], [2, 3]])
    assert.deepEqual(buildSpreads(0, true), [])
  })

  it('retrouve la planche d’une page (passage simple ⇄ double sans perdre sa place)', () => {
    const spreads = buildSpreads(6, true)
    assert.equal(spreadIndexOf(spreads, 4), 2)
    assert.equal(spreadIndexOf(spreads, 0), 0)
    assert.equal(spreadIndexOf(spreads, 99), 3)
    assert.equal(spreadIndexOf(spreads, -1), 0)
  })
})

describe('commandes de lecture', () => {
  it('tap : centre = commandes ; bords = pages, inversés en sens japonais', () => {
    assert.equal(tapAction(150, 300, 'ltr'), 'menu')
    assert.equal(tapAction(290, 300, 'ltr'), 'next')
    assert.equal(tapAction(10, 300, 'ltr'), 'prev')
    assert.equal(tapAction(10, 300, 'rtl'), 'next')
    assert.equal(tapAction(290, 300, 'rtl'), 'prev')
  })

  it('clavier : les flèches suivent le sens de lecture, Espace avance', () => {
    assert.equal(keyAction('ArrowRight', 'ltr'), 'next')
    assert.equal(keyAction('ArrowRight', 'rtl'), 'prev')
    assert.equal(keyAction('ArrowLeft', 'rtl'), 'next')
    assert.equal(keyAction(' ', 'rtl'), 'next')
    assert.equal(keyAction(' ', 'ltr', true), 'prev')
    assert.equal(keyAction('PageDown', 'rtl'), 'next')
    assert.equal(keyAction('a', 'ltr'), null)
  })

  it('swipe : pousser vers la gauche avance en LTR, recule en RTL', () => {
    assert.equal(swipeAction(-120, 'ltr'), 'next')
    assert.equal(swipeAction(120, 'ltr'), 'prev')
    assert.equal(swipeAction(-120, 'rtl'), 'prev')
    assert.equal(swipeAction(120, 'rtl'), 'next')
  })

  it('swipe : un geste trop court est ignoré, sauf s’il est vif', () => {
    assert.equal(swipeAction(-30, 'ltr'), null)
    assert.equal(swipeAction(-30, 'ltr', -900), 'next')
    assert.equal(swipeAction(-10, 'ltr', -2000), null)
  })
})

const chapter = (id: string, number: string | null, groups: string[] = [], pages = 20): ReaderChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'fr',
  pages,
  groups: groups.map((group) => ({ id: group, name: group })),
  publishedAt: '2024-01-01',
})

describe('ordre de lecture (une version par chapitre)', () => {
  const chapters = [
    chapter('1a', '1', ['team-a']),
    chapter('1b', '1', ['team-b'], 25),
    chapter('2b', '2', ['team-b']),
    chapter('2a', '2', ['team-a']),
    chapter('extra-1', null),
    chapter('extra-2', null),
  ]

  it('sans préférence : la version la plus complète, sinon la première', () => {
    assert.deepEqual(readingOrder(chapters).map((item) => item.id), ['1b', '2b', 'extra-1', 'extra-2'])
  })

  it('reste avec l’équipe qu’on lit', () => {
    assert.deepEqual(readingOrder(chapters, ['team-a']).map((item) => item.id), ['1a', '2a', 'extra-1', 'extra-2'])
  })

  it('garde la version ouverte, même si une autre serait préférée', () => {
    assert.deepEqual(readingOrder(chapters, ['team-a'], '2b').map((item) => item.id), ['1a', '2b', 'extra-1', 'extra-2'])
  })

  it('chapitres voisins', () => {
    const order = readingOrder(chapters)
    const { index, prev, next } = neighbours(order, '2b')
    assert.equal(index, 1)
    assert.equal(prev?.id, '1b')
    assert.equal(next?.id, 'extra-1')
    assert.equal(neighbours(order, 'inconnu').next, undefined)
    assert.equal(neighbours(order, '1b').prev, undefined)
  })
})

describe('tri des pages d’une archive', () => {
  it('ordre naturel : page2 avant page10', () => {
    const names = ['page10.jpg', 'page2.jpg', 'Page1.jpg', 'page3.png']
    assert.deepEqual([...names].sort(naturalCompare), ['Page1.jpg', 'page2.jpg', 'page3.png', 'page10.jpg'])
  })
})
