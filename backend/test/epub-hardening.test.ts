import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { InvalidEpubError, parseEpub, plainText } from '../src/modules/books/epub/epub.parser.js'
import { parseEpubSandboxed } from '../src/modules/books/epub/epub.sandbox.js'

const container = '<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'
const epubWith = (opf: string) =>
  zipSync({ mimetype: strToU8('application/epub+zip'), 'META-INF/container.xml': strToU8(container), 'c.opf': strToU8(opf) })

describe('EPUB piégés', () => {
  it('balises jamais fermées : analyse en temps linéaire (pas de ReDoS)', () => {
    const opf = `<package><metadata>${'<dc:creator>'.repeat(170_000)}</metadata></package>`
    const started = Date.now()
    parseEpub(epubWith(opf))
    assert.ok(Date.now() - started < 3_000, 'trop lent')
  })

  it('résumé plein de « < » sans « > » : texte brut en temps linéaire', () => {
    const started = Date.now()
    plainText('<'.repeat(400_000) + '<![CDATA['.repeat(40_000))
    assert.ok(Date.now() - started < 3_000, 'trop lent')
  })

  it('le fil jetable rend les mêmes métadonnées et refuse un EPUB invalide', async () => {
    const opf = '<package><metadata><dc:title>Le Livre</dc:title><dc:creator>Moi</dc:creator></metadata></package>'
    const meta = await parseEpubSandboxed(epubWith(opf))
    assert.equal(meta.title, 'Le Livre')
    assert.equal(meta.author, 'Moi')
    await assert.rejects(parseEpubSandboxed(strToU8('%PDF-1.7')), InvalidEpubError)
  })
})
