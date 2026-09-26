import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { imageTypeOf, isPageEntry, sniffFormat, titleFromFileName } from '../src/lib/reader/formats'

const bytes = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))
/** En-tête ZIP dont la première entrée s'appelle `name` et contient `content`. */
const zipHead = (name: string, content: string) => {
  const head = new Uint8Array(30 + name.length + content.length)
  head.set([0x50, 0x4b, 0x03, 0x04])
  head.set(bytes(name), 30)
  head.set(bytes(content), 30 + name.length)
  return head
}

describe('reconnaissance des fichiers importés', () => {
  it('PDF par sa signature, quelle que soit l’extension', () => {
    assert.deepEqual(sniffFormat('scan.bin', bytes('%PDF-1.7\n')), { format: 'pdf' })
  })

  it('EPUB : ZIP dont la première entrée déclare application/epub+zip', () => {
    assert.deepEqual(sniffFormat('roman.zip', zipHead('mimetype', 'application/epub+zip')), { format: 'epub' })
  })

  it('CBZ : tout autre ZIP, y compris un .cbr qui est en fait un ZIP renommé', () => {
    assert.deepEqual(sniffFormat('tome1.cbz', zipHead('001.jpg', '\xff\xd8')), { format: 'cbz' })
    assert.deepEqual(sniffFormat('tome1.cbr', zipHead('001.jpg', '\xff\xd8')), { format: 'cbz' })
  })

  it('vrai CBR (RAR) : refusé avec une raison précise', () => {
    assert.deepEqual(sniffFormat('tome1.cbr', bytes('Rar!\x1a\x07\x00')), { unsupported: 'cbr' })
  })

  it('format inconnu', () => {
    assert.deepEqual(sniffFormat('notes.txt', bytes('hello')), { unsupported: 'unknown' })
  })
})

describe('contenu des archives CBZ', () => {
  it('ne garde que les images, hors dossiers système et fichiers cachés', () => {
    assert.equal(isPageEntry('Tome 1/001.jpg'), true)
    assert.equal(isPageEntry('002.WEBP'), true)
    assert.equal(isPageEntry('__MACOSX/._001.jpg'), false)
    assert.equal(isPageEntry('.thumbs/001.jpg'), false)
    assert.equal(isPageEntry('ComicInfo.xml'), false)
  })

  it('type MIME d’après l’extension', () => {
    assert.equal(imageTypeOf('a.JPG'), 'image/jpeg')
    assert.equal(imageTypeOf('a.avif'), 'image/avif')
    assert.equal(imageTypeOf('a.txt'), null)
  })

  it('titre lisible depuis le nom du fichier', () => {
    assert.equal(titleFromFileName('One_Piece__v01.cbz'), 'One Piece v01')
    assert.equal(titleFromFileName('.cbz'), '.cbz')
  })
})
