import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chapterNumber,
  chaptersReadAfter,
  countWords,
  initialChapterId,
  overallProgress,
  pageAtScroll,
  pagedRatio,
  remainingMinutes,
  scrollRatio,
} from '../src/lib/reader/progress'
import type { ReaderChapter, ReadingPosition } from '../src/types/reader'

const chapter = (id: string, number: string | null): ReaderChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'fr',
  pages: 20,
  groups: [],
  publishedAt: '2024-01-01',
})

const position = (chapterId: string, ratio: number, chapterLabel: string | null = null): ReadingPosition => ({
  chapterId,
  chapter: chapterLabel,
  page: 4,
  pageCount: 20,
  offset: 0.3,
  ratio,
  at: 1,
})

describe('compteur de chapitres lus', () => {
  it('prend le numéro du chapitre terminé', () => {
    assert.equal(chaptersReadAfter(0, { number: '12', orderIndex: 11 }), 12)
  })

  it('ne recule jamais (relire un vieux chapitre)', () => {
    assert.equal(chaptersReadAfter(40, { number: '3', orderIndex: 2 }), 40)
  })

  it('un chapitre bonus 12.5 compte pour 12', () => {
    assert.equal(chaptersReadAfter(11, { number: '12.5', orderIndex: 13 }), 12)
  })

  it('un one-shot compte selon sa place dans la liste', () => {
    assert.equal(chaptersReadAfter(0, { number: null, orderIndex: 0 }), 1)
    assert.equal(chapterNumber('Extra'), null)
  })
})

describe('avancement global', () => {
  it('rapport chapitres lus / chapitres parus', () => {
    assert.equal(overallProgress(25, 100, 'completed'), 0.25)
  })

  it('série terminée lue en entier : 100 %', () => {
    assert.equal(overallProgress(100, 100, 'completed'), 1)
  })

  it('série en cours rattrapée : plafonnée à 99 % (reste « En cours »)', () => {
    assert.equal(overallProgress(120, 120, 'ongoing'), 0.99)
  })

  it('nombre de chapitres inconnu : pas d’avancement calculable', () => {
    assert.equal(overallProgress(10, null, 'ongoing'), null)
    assert.equal(overallProgress(10, 0, 'completed'), null)
  })
})

describe('avancement dans un chapitre', () => {
  it('paginé : la page affichée compte comme lue', () => {
    assert.equal(pagedRatio(0, 20), 0.05)
    assert.equal(pagedRatio(19, 20), 1)
    assert.equal(pagedRatio(0, 0), 0)
  })

  it('défilement : borné entre 0 et 1, chapitre plus court que l’écran = lu', () => {
    assert.equal(scrollRatio(500, 2000, 1000), 0.5)
    assert.equal(scrollRatio(5000, 2000, 1000), 1)
    assert.equal(scrollRatio(-20, 2000, 1000), 0)
    assert.equal(scrollRatio(0, 600, 1000), 1)
  })

  it('page en haut de l’écran et part défilée de cette page (reprise au pixel)', () => {
    const tops = [0, 1000, 1800, 3000]
    const heights = [1000, 800, 1200, 900]
    assert.deepEqual(pageAtScroll(0, tops, heights), { page: 0, offset: 0 })
    assert.deepEqual(pageAtScroll(1400, tops, heights), { page: 1, offset: 0.5 })
    assert.deepEqual(pageAtScroll(3450, tops, heights), { page: 3, offset: 0.5 })
    assert.deepEqual(pageAtScroll(10, [], []), { page: 0, offset: 0 })
  })
})

describe('chapitre à l’ouverture', () => {
  const order = [chapter('a', '1'), chapter('b', '2'), chapter('c', '3')]

  it('reprend le chapitre de la dernière position', () => {
    assert.equal(initialChapterId(order, position('b', 0.4), 0), 'b')
  })

  it('chapitre terminé : ouvre le suivant', () => {
    assert.equal(initialChapterId(order, position('b', 1), 2), 'c')
  })

  it('dernier chapitre terminé : on y reste (pas de suivant)', () => {
    assert.equal(initialChapterId(order, position('c', 1), 3), 'c')
  })

  it('position dans l’autre langue : même numéro de chapitre', () => {
    assert.equal(initialChapterId(order, position('zz-en', 0.2, '2'), 0), 'b')
  })

  it('sans position : premier chapitre après le compteur, sinon le premier', () => {
    assert.equal(initialChapterId(order, null, 1), 'b')
    assert.equal(initialChapterId(order, null, 0), 'a')
    assert.equal(initialChapterId([], null, 0), null)
  })
})

describe('temps de lecture restant (mode texte)', () => {
  it('compte les mots, ponctuation exclue', () => {
    assert.equal(countWords('L’été, il pleut — beaucoup ! 42 fois.'), 6)
    assert.equal(countWords('   '), 0)
  })

  it('mots du chapitre × part non lue ÷ vitesse de lecture', () => {
    assert.equal(remainingMinutes(2300, 1, 10), 10)
    assert.equal(remainingMinutes(2300, 6, 10), 5)
    assert.equal(remainingMinutes(2300, 10, 10), 1)
    assert.equal(remainingMinutes(0, 1, 10), 0)
  })
})
