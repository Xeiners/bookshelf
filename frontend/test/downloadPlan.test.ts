import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextUnread } from '../src/lib/reader/downloadPlan'
import type { ReaderChapter } from '../src/types/reader'

const chapter = (number: string | null, id = `ch-${number}`): ReaderChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'fr',
  pages: 20,
  groups: [],
  publishedAt: '2024-01-01T00:00:00Z',
})

describe('téléchargements — les N prochains non lus', () => {
  const order = [chapter('1'), chapter('2'), chapter('2.5'), chapter('3'), chapter('4'), chapter('5')]

  it('part du premier chapitre non lu, dans l’ordre de lecture', () => {
    assert.deepEqual(
      nextUnread(order, 2, () => false, 3).map((entry) => entry.number),
      ['2.5', '3', '4'],
    )
  })

  it('saute ceux déjà téléchargés ou en route, et s’arrête à la fin', () => {
    const taken = new Set(['ch-3'])
    assert.deepEqual(
      nextUnread(order, 2, (id) => taken.has(id), 10).map((entry) => entry.number),
      ['2.5', '4', '5'],
    )
  })

  it('un one-shot (sans numéro) n’est jamais compté comme lu', () => {
    assert.deepEqual(
      nextUnread([chapter(null, 'oneshot'), ...order], 99, () => false, 5).map((entry) => entry.id),
      ['oneshot'],
    )
  })
})
