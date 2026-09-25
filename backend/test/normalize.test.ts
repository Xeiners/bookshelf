import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeManga } from '../src/modules/manga/normalize.js'
import { BILINGUAL, ENGLISH_ONLY, NO_TRANSLATION } from './fixtures.js'

describe('normalizeManga — choix de langue et repli', () => {
  it('sert le français quand il existe, y compris depuis un titre alternatif', () => {
    const book = normalizeManga(BILINGUAL, 8.4, 'fr')
    assert.equal(book.title, 'La Voie du sabre')
    assert.equal(book.synopsis, 'Un jeune épéiste suit la voie du sabre.')
    assert.equal(book.synopsisLanguage, 'fr')
    assert.equal(book.lang, 'fr')
    assert.deepEqual(book.categories, ['Action', 'Arts martiaux'])
  })

  it('sert l’anglais pour la même œuvre quand on le demande', () => {
    const book = normalizeManga(BILINGUAL, 8.4, 'en')
    assert.equal(book.title, 'The Blade Road')
    // Markdown retiré, bloc de liens final coupé.
    assert.equal(book.synopsis, 'A young swordsman walks the blade road.')
    assert.equal(book.synopsisLanguage, 'en')
    assert.deepEqual(book.categories, ['Action', 'Martial Arts'])
  })

  it('se replie sur l’anglais en français au lieu d’afficher du vide', () => {
    const book = normalizeManga(ENGLISH_ONLY, null, 'fr')
    assert.equal(book.title, 'Only I Rise')
    assert.equal(book.synopsis, 'Hunters, gates and a strange system.')
    // Le front sait ainsi signaler un résumé non traduit.
    assert.equal(book.lang, 'fr')
    assert.equal(book.synopsisLanguage, 'en')
    // Les genres, eux, sont toujours traduits.
    assert.deepEqual(book.categories, ['Tranche de vie'])
    assert.equal(book.kind, 'manhwa')
    assert.deepEqual(book.languages, ['en'])
  })

  it('sans aucune traduction : titre romanisé, résumé vide, pas d’exception', () => {
    for (const language of ['fr', 'en'] as const) {
      const book = normalizeManga(NO_TRANSLATION, null, language)
      assert.equal(book.title, 'Mushoku no Hoshi')
      assert.equal(book.synopsis, '')
      assert.equal(book.synopsisLanguage, null)
      assert.equal(book.chapters, null)
    }
  })

  it('note bayésienne /10 → /5, auteurs sans nom natif, couverture relayée', () => {
    const book = normalizeManga(BILINGUAL, 8.4, 'fr')
    assert.equal(book.rating, 4.2)
    assert.deepEqual(book.authors, ['Auteur Test'])
    assert.match(book.cover ?? '', /^\/api\/covers\/11111111-1111-4111-8111-111111111111\/cover\.jpg\?size=512$/)
  })
})
