import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { acceptsEpub, forgetOwnWork, moveWork, placeInLibrary, progressFor, reportProgress } from '../src/lib/novelLibrary'
import { useLibraryStore } from '../src/store/useLibraryStore'
import type { Book } from '../src/types/book'

const novel = (id: string, title = 'Un hiver pour te résister'): Book => ({
  id,
  title,
  subtitle: null,
  authors: ['Morgane Moncomble'],
  cover: null,
  synopsis: '',
  categories: [],
  rating: null,
  ratingsCount: 0,
  pages: null,
  year: 2019,
  publisher: null,
  previewLink: null,
  kind: 'book',
})

const entry = (id: string) => useLibraryStore.getState().entries[id]

describe('EPUB ↔ fiche de la bibliothèque', () => {
  beforeEach(() => useLibraryStore.setState({ entries: {}, skipped: [] }))

  it('seules les fiches de roman en ligne reçoivent un fichier depuis leur fiche', () => {
    assert.equal(acceptsEpub(novel('ol:OL1000W')), true)
    assert.equal(acceptsEpub(novel('gb:gbHiver')), true)
    assert.equal(acceptsEpub(novel('novel:abc')), false, 'fiche tirée du fichier : elle a déjà le sien')
    assert.equal(acceptsEpub({ ...novel('11111111-1111-4111-8111-111111111111'), kind: 'manga' }), false)
  })

  it('import : la fiche entre dans la bibliothèque selon l’avancement du fichier', () => {
    placeInLibrary(novel('ol:1'))
    assert.equal(entry('ol:1')?.status, 'wishlist')
    placeInLibrary(novel('ol:2'), 40)
    assert.equal(entry('ol:2')?.status, 'reading')
    assert.equal(entry('ol:2')?.progress, 0.4)
    placeInLibrary(novel('ol:3'), 99)
    assert.equal(entry('ol:3')?.status, 'read')
  })

  it('une fiche déjà dans la bibliothèque garde son statut', () => {
    useLibraryStore.getState().save(novel('ol:1'), 'read')
    placeInLibrary(novel('ol:1', 'Autre titre'))
    assert.equal(entry('ol:1')?.status, 'read')
    assert.equal(entry('ol:1')?.book.title, 'Un hiver pour te résister')
  })

  it('lecture : « En cours », puis « Lus » à 98 % ; un roman lu qu’on relit reste « Lus »', () => {
    useLibraryStore.getState().save(novel('ol:1'), 'wishlist')
    reportProgress('ol:1', 12.5)
    assert.equal(entry('ol:1')?.status, 'reading')
    assert.equal(entry('ol:1')?.progress, 0.125)
    reportProgress('ol:1', 98.4)
    assert.equal(entry('ol:1')?.status, 'read')
    assert.equal(entry('ol:1')?.progress, 1)
    reportProgress('ol:1', 3)
    assert.equal(entry('ol:1')?.status, 'read')
    reportProgress(null, 50)
    reportProgress('absente', 50)
    assert.equal(entry('absente'), undefined)
    assert.equal(progressFor(50), 0.5)
  })

  it('changement de fiche : statut et avancement suivent, la fiche tirée du fichier disparaît', () => {
    const library = useLibraryStore.getState()
    library.save(novel('novel:b1', 'titre du fichier'), 'reading')
    library.setProgress('novel:b1', 0.3)
    moveWork('novel:b1', novel('gb:gbHiver'))
    assert.equal(entry('novel:b1'), undefined)
    assert.equal(entry('gb:gbHiver')?.status, 'reading')
    assert.equal(entry('gb:gbHiver')?.progress, 0.3)
  })

  it('fichier supprimé : sa fiche propre part, une fiche en ligne reste', () => {
    const library = useLibraryStore.getState()
    library.save(novel('novel:b1'), 'reading')
    library.save(novel('ol:1'), 'reading')
    forgetOwnWork('novel:b1')
    forgetOwnWork('ol:1')
    assert.equal(entry('novel:b1'), undefined)
    assert.ok(entry('ol:1'))
  })
})
