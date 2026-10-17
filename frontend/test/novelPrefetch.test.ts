/** Préchargement des romans du compte : ordre (récents d'abord, terminés en dernier) et budget. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CachedCloudBook } from '../src/lib/reader/cloudBooks'
import { PREFETCH_MAX_FILE_BYTES, planNovelDownloads } from '../src/lib/reader/novelPrefetch'
import type { CloudBook } from '../src/types/novel'

const MB = 1024 * 1024
const entry = (id: string, over: Partial<CloudBook> = {}, local: Partial<CachedCloudBook> = {}): CachedCloudBook => ({
  id,
  userId: 'u',
  position: null,
  pending: false,
  downloaded: false,
  book: {
    id,
    title: id,
    author: null,
    coverUrl: null,
    synopsis: '',
    language: null,
    publisher: null,
    year: null,
    pages: null,
    format: 'EPUB',
    fileSize: 5 * MB,
    originalName: `${id}.epub`,
    progressPercent: 0,
    lastCfi: null,
    progressAt: null,
    workId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  },
  ...local,
})

describe('planNovelDownloads', () => {
  it('ne retélécharge pas ce qui est déjà sur l’appareil', () => {
    const plan = planNovelDownloads([entry('a'), entry('b')], new Set(['a']))
    assert.deepEqual(plan.map((item) => item.id), ['b'])
  })

  it('commence par la lecture la plus récente, les livres terminés en dernier', () => {
    const plan = planNovelDownloads(
      [
        entry('vieux', { updatedAt: '2026-01-01T00:00:00.000Z' }),
        entry('fini', { updatedAt: '2026-09-01T00:00:00.000Z', progressPercent: 100 }),
        entry('recent', { updatedAt: '2026-08-01T00:00:00.000Z', progressAt: Date.parse('2026-10-01T00:00:00.000Z') }),
      ],
      new Set(),
    )
    assert.deepEqual(plan.map((item) => item.id), ['recent', 'vieux', 'fini'])
  })

  it('respecte le budget d’octets et saute ce qui ne tient pas', () => {
    const plan = planNovelDownloads(
      [entry('gros', { fileSize: 90 * MB, progressAt: 3 }), entry('moyen', { fileSize: 60 * MB, progressAt: 2 }), entry('petit', { fileSize: 8 * MB, progressAt: 1 })],
      new Set(),
      100 * MB,
    )
    assert.deepEqual(plan.map((item) => item.id), ['gros', 'petit'])
  })

  it('laisse à la demande un fichier démesuré ou sans taille connue', () => {
    const plan = planNovelDownloads([entry('titan', { fileSize: PREFETCH_MAX_FILE_BYTES + 1 }), entry('vide', { fileSize: 0 })], new Set())
    assert.deepEqual(plan, [])
  })
})
