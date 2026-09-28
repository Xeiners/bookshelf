import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FONT_ORDER, FONT_STACKS, THEMES, THEME_ORDER, fontFaceRules, readerCss } from '../src/lib/reader/epubStyle'
import { novelAsBook, patchFromRecord, hasExternalCover } from '../src/lib/novels'
import type { Book } from '../src/types/book'
import type { CloudBook } from '../src/types/novel'
import type { TextSettings } from '../src/types/reader'

const settings = (change: Partial<TextSettings> = {}): TextSettings => ({
  fontSize: 110,
  font: 'serif',
  lineHeight: 1.7,
  margin: 16,
  theme: 'dark',
  ...change,
})

describe('thèmes et polices du lecteur de romans', () => {
  it('les trois thèmes demandés : sombre #09090b, sépia papier #f4ecd8, OLED noir pur #000000', () => {
    assert.equal(THEMES.dark.background, '#09090b')
    assert.equal(THEMES.sepia.background, '#f4ecd8')
    assert.equal(THEMES.black.background, '#000000')
    assert.equal(THEMES.sepia.dark, false, 'commandes en foncé sur le papier')
    assert.deepEqual([...THEME_ORDER].sort(), Object.keys(THEMES).sort(), 'chaque thème est proposé')
  })

  it('Merriweather, Inter, Roboto et OpenDyslexic proposés, chacun avec une pile de repli', () => {
    for (const font of ['merriweather', 'inter', 'roboto', 'dyslexic'] as const) assert.ok(FONT_ORDER.includes(font))
    assert.match(FONT_STACKS.merriweather, /^'Merriweather', .*serif$/)
    assert.match(FONT_STACKS.inter, /^'Inter', .*sans-serif$/)
    assert.match(FONT_STACKS.roboto, /^'Roboto', .*sans-serif$/)
    assert.match(FONT_STACKS.dyslexic, /^'OpenDyslexic'/)
  })

  it('feuille injectée : fond et texte du thème, police, taille, interlignage — prioritaires sur le livre', () => {
    const css = readerCss(settings({ theme: 'sepia', font: 'merriweather', fontSize: 130, lineHeight: 1.9 }), '')
    assert.match(css, /background: #f4ecd8 !important/)
    assert.match(css, /color: #5b4636 !important/)
    assert.match(css, /font-size: 130% !important/)
    assert.match(css, /line-height: 1\.9 !important/)
    assert.ok(css.includes(`font-family: ${FONT_STACKS.merriweather} !important`))
    assert.match(css, /-webkit-user-select: none !important/)
    assert.match(css, /user-select: none !important/)
    assert.match(css, /-webkit-touch-callout: none !important/)
  })

  it('réglage inconnu (préférences d’une autre version) → thème sombre et police serif par défaut', () => {
    const css = readerCss({ ...settings(), theme: 'bogus' as never, font: 'bogus' as never }, '')
    assert.match(css, /background: #09090b/)
    assert.ok(css.includes(FONT_STACKS.serif))
  })

  it('@font-face en URL ABSOLUES (le chapitre vit dans une iframe `about:srcdoc`)', () => {
    const rules = fontFaceRules(
      [{ family: 'Inter', faces: [{ weight: 400, style: 'italic', url: '/assets/inter-400-italic.woff2' }] }],
      'https://bookshelf.findi.cc/library',
    )
    assert.equal(
      rules,
      "@font-face { font-family: 'Inter'; font-style: italic; font-weight: 400; font-display: swap; src: url('https://bookshelf.findi.cc/assets/inter-400-italic.woff2') format('woff2'); }",
    )
    assert.ok(readerCss(settings(), rules).includes(rules))
  })
})

const cloudBook: CloudBook = {
  id: 'b1',
  title: 'Un hiver pour te résister',
  author: 'Morgane Moncomble, Autre Auteur',
  coverUrl: '/api/books/b1/cover?v=abc',
  synopsis: '',
  language: 'fr',
  publisher: null,
  year: 2019,
  pages: null,
  format: 'EPUB',
  fileSize: 1000,
  originalName: 'hiver.epub',
  progressPercent: 0,
  lastCfi: null,
  progressAt: null,
  workId: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
}

describe('fiches des romans du compte', () => {
  it('vu comme un `Book` : auteurs séparés, couverture du fichier, type « book »', () => {
    const book = novelAsBook(cloudBook)
    assert.deepEqual(book.authors, ['Morgane Moncomble', 'Autre Auteur'])
    assert.equal(book.cover, '/api/books/b1/cover?v=abc')
    assert.equal(book.kind, 'book')
    assert.equal(hasExternalCover(cloudBook), false)
    assert.equal(hasExternalCover({ ...cloudBook, coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }), true)
  })

  it('fiche choisie → correction : champs repris, couverture seulement si l’API l’accepte', () => {
    const record = {
      ...novelAsBook(cloudBook),
      id: 'gb:1',
      title: 'Un hiver pour te résister (poche)',
      authors: ['Morgane Moncomble'],
      synopsis: 'Rose rencontre Nick.',
      cover: 'https://books.google.com/books/content?id=1&img=1',
      pages: 400,
      publisher: 'Hugo',
    } satisfies Book
    assert.deepEqual(patchFromRecord(record), {
      title: 'Un hiver pour te résister (poche)',
      author: 'Morgane Moncomble',
      synopsis: 'Rose rencontre Nick.',
      coverUrl: 'https://books.google.com/books/content?id=1&img=1',
      publisher: 'Hugo',
      year: 2019,
      pages: 400,
    })
    assert.equal(patchFromRecord({ ...record, cover: 'https://evil.example/x.jpg' }).coverUrl, undefined)
    assert.equal(patchFromRecord({ ...record, cover: 'http://covers.openlibrary.org/b/id/1-L.jpg' }).coverUrl, undefined, 'HTTP refusé')
  })
})
