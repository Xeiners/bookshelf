/**
 * Romans EPUB : lecture des métadonnées embarquées (pur), fiches Open Library /
 * Google Books (normalisation, fusion, rapprochement — pur), puis l'API de
 * bout en bout : recherche, import, dédoublonnage, quota, fichier servi en
 * flux (`Range`), couverture, position synchronisée entre deux appareils,
 * correction de fiche, suppression.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { strToU8, zipSync, type Zippable, type ZippableFile } from 'fflate'
import { decideMatch } from '../src/modules/books/epub.match.js'
import { InvalidEpubError, isbnOf, languageCode, parseEpub, plainText, sniffImage } from '../src/modules/books/epub.parser.js'
import {
  fromGoogle,
  fromOpenLibrary,
  googleCover,
  mergeResults,
  openLibraryDescription,
  pickMatch,
  toBook,
  type GoogleVolume,
  type OpenLibraryDoc,
} from '../src/modules/books/metadata.normalize.js'
import { favoriteGenres, isNovelId, novelShelfQuery } from '../src/modules/books/novels.discover.js'
import { extraMocks, mockedHosts, installMangadexMock, prepareEnvironment, startServer, type TestClient } from './harness.js'

/* ---- Environnement : AVANT le chargement de l'API ----------------------------------- */

const BOOKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp', 'books-files')
rmSync(BOOKS_DIR, { recursive: true, force: true })
process.env.BOOKS_DIR = BOOKS_DIR
process.env.BOOKS_MAX_UPLOAD_MB = '1'
process.env.BOOKS_QUOTA_MB = '1'
process.env.BOOKS_METADATA_LOOKUP = 'on'

prepareEnvironment('books')
installMangadexMock()

/* ---- Fabrique d'EPUB ------------------------------------------------------------------ */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, ...new Array(64).fill(7)])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(3)])

const container = (opfPath: string) =>
  `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`

function buildEpub(options: {
  opf: string
  files?: Record<string, string | ZippableFile>
  mimetype?: string | null
  withContainer?: boolean
  opfPath?: string
}): Uint8Array {
  const { opf, files = {}, mimetype = 'application/epub+zip', withContainer = true, opfPath = 'OEBPS/content.opf' } = options
  const entries: Zippable = {}
  // `mimetype` en tête et non compressé, comme l'exige la norme.
  if (mimetype !== null) entries.mimetype = [strToU8(mimetype), { level: 0 }]
  if (withContainer) entries['META-INF/container.xml'] = strToU8(container(opfPath))
  entries[opfPath] = strToU8(opf)
  for (const [name, data] of Object.entries(files)) entries[name] = typeof data === 'string' ? strToU8(data) : data
  return zipSync(entries)
}

const CHAPTER = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Il neigeait.</p></body></html>'

/** EPUB 3 : couverture `cover-image`, rôles d'auteur par `refines`, résumé en HTML échappé. */
const EPUB3_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:isbn:978-2-7499-4105-0</dc:identifier>
    <dc:title>Un hiver pour te r&#233;sister</dc:title>
    <dc:creator id="c1">Morgane Moncomble</dc:creator>
    <meta refines="#c1" property="role" scheme="marc:relators">aut</meta>
    <dc:creator id="c2">Jeanne Illustratrice</dc:creator>
    <meta refines="#c2" property="role" scheme="marc:relators">ill</meta>
    <dc:language>fr-FR</dc:language>
    <dc:publisher>Hugo Roman</dc:publisher>
    <dc:date>2019-10-02</dc:date>
    <dc:description>&lt;p&gt;Deux &amp;amp; deux&lt;/p&gt;&lt;p&gt;Un hiver.&lt;/p&gt;</dc:description>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="Images/couverture%20hd.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`

const epub3 = (extra: Record<string, string | ZippableFile> = {}) =>
  buildEpub({ opf: EPUB3_OPF, files: { 'OEBPS/Text/ch1.xhtml': CHAPTER, 'OEBPS/Images/couverture hd.jpg': JPEG, ...extra } })

/** EPUB 2 : `<meta name="cover">`, `opf:role`, guillemets simples, préfixe `opf:` sur le paquet. */
const EPUB2_OPF = `<?xml version='1.0' encoding='utf-8'?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
  <opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title><![CDATA[It Ends with Us]]></dc:title>
    <dc:creator opf:role='aut' opf:file-as='Hoover, Colleen'>Colleen Hoover</dc:creator>
    <dc:creator opf:role='trl'>Some Translator</dc:creator>
    <dc:language>eng</dc:language>
    <dc:date opf:event='modification'>2020-05-05</dc:date>
    <dc:date opf:event='publication'>2016</dc:date>
    <opf:meta name='cover' content='cover-img'/>
  </opf:metadata>
  <opf:manifest>
    <opf:item id='cover-img' href='cover.png' media-type='image/jpeg'/>
  </opf:manifest>
</opf:package>`

/* ---- Métadonnées embarquées ------------------------------------------------------------ */

describe('EPUB — métadonnées embarquées', () => {
  it('EPUB 3 : titre (entités), auteur principal seul, langue, éditeur, année, ISBN, résumé en texte, couverture', () => {
    const meta = parseEpub(epub3())
    assert.equal(meta.title, 'Un hiver pour te résister')
    assert.equal(meta.author, 'Morgane Moncomble', 'l’illustratrice n’est pas auteure')
    assert.equal(meta.language, 'fr')
    assert.equal(meta.publisher, 'Hugo Roman')
    assert.equal(meta.year, 2019)
    assert.equal(meta.isbn, '9782749941050')
    assert.equal(meta.description, 'Deux & deux\n\nUn hiver.')
    assert.equal(meta.cover?.mediaType, 'image/jpeg')
    assert.deepEqual([...meta.cover!.data], [...JPEG], 'href encodé (%20) résolu depuis le dossier de l’OPF')
  })

  it('EPUB 2 : CDATA, `opf:role`, date de publication, couverture par `<meta name="cover">` reconnue à ses octets (PNG)', () => {
    const meta = parseEpub(buildEpub({ opf: EPUB2_OPF, opfPath: 'content.opf', files: { 'cover.png': PNG } }))
    assert.equal(meta.title, 'It Ends with Us')
    assert.equal(meta.author, 'Colleen Hoover')
    assert.equal(meta.language, 'en')
    assert.equal(meta.year, 2016, 'la date de publication, pas celle de modification')
    assert.equal(meta.cover?.mediaType, 'image/png', 'type lu dans les octets, pas dans la déclaration')
  })

  it('couverture citée par la page de couverture du guide', () => {
    const opf = `<package><metadata><dc:title>Guide</dc:title></metadata>
      <manifest><item id="p" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest>
      <guide><reference type="cover" title="Couverture" href="cover.xhtml"/></guide></package>`
    const page = '<html><body><svg><image xlink:href="../img/front.jpg"/></svg></body></html>'
    const meta = parseEpub(buildEpub({ opf, files: { 'OEBPS/cover.xhtml': page, 'img/front.jpg': JPEG } }))
    assert.equal(meta.cover?.extension, 'jpg')
  })

  it('sans `mimetype` ni container.xml : l’OPF est retrouvé quand même ; aucune couverture → null', () => {
    const opf = '<package><metadata><dc:title>Nu</dc:title></metadata><manifest/></package>'
    const meta = parseEpub(buildEpub({ opf, mimetype: null, withContainer: false, opfPath: 'book/package.opf' }))
    assert.equal(meta.title, 'Nu')
    assert.equal(meta.author, null)
    assert.equal(meta.cover, null)
  })

  it('image annoncée comme couverture mais qui n’en est pas une (octets inconnus) → ignorée', () => {
    const meta = parseEpub(epub3({ 'OEBPS/Images/couverture hd.jpg': strToU8('pas une image') }))
    assert.equal(meta.cover, null)
  })

  it('couverture démesurée (> 10 Mo décompressés) → ignorée, sans la décompresser', () => {
    const huge = new Uint8Array(11 * 1024 * 1024)
    huge.set(JPEG)
    const meta = parseEpub(epub3({ 'OEBPS/Images/couverture hd.jpg': huge }))
    assert.equal(meta.cover, null)
  })

  it('refus : pas un ZIP, ZIP qui n’est pas un EPUB, EPUB sans paquet OPF', () => {
    assert.throws(() => parseEpub(strToU8('%PDF-1.7 …')), InvalidEpubError)
    assert.throws(() => parseEpub(zipSync({ mimetype: strToU8('application/zip'), 'a.txt': strToU8('x') })), InvalidEpubError)
    assert.throws(() => parseEpub(zipSync({ mimetype: strToU8('application/epub+zip'), 'a.txt': strToU8('x') })), InvalidEpubError)
  })

  it('aides : codes de langue, ISBN, texte brut, signatures d’image', () => {
    assert.equal(languageCode('fr-CA'), 'fr')
    assert.equal(languageCode('fre'), 'fr')
    assert.equal(languageCode('English'), null)
    assert.equal(isbnOf('978-2-7499-4105-0'), '9782749941050')
    assert.equal(isbnOf('2-266-11156-X'), '226611156X')
    assert.equal(isbnOf('uuid:1234'), null)
    assert.equal(plainText('<b>Gras</b><br/>ligne&nbsp;2'), 'Gras\nligne 2')
    assert.equal(sniffImage(PNG)?.extension, 'png')
    assert.equal(sniffImage(strToU8('RIFF1234WEBPVP8 '))?.mediaType, 'image/webp')
  })
})

/* ---- Fiches en ligne : fixtures ---------------------------------------------------------- */

const OL_HIVER: OpenLibraryDoc = {
  key: '/works/OL1000W',
  title: 'Un hiver pour te résister',
  author_name: ['Morgane Moncomble'],
  first_publish_year: 2019,
  number_of_pages_median: 412,
  cover_i: 555,
  language: ['fre'],
  isbn: ['2749941050', '9782749941050'],
  publisher: ['Hugo Roman'],
}
const OL_HOOVER: OpenLibraryDoc = {
  key: '/works/OL2000W',
  title: 'It Ends with Us',
  author_name: ['Colleen Hoover'],
  first_publish_year: 2016,
  cover_i: 777,
  language: ['eng', 'fre'],
  ratings_average: 4.26,
  ratings_count: 120,
}
const OL_GERMAN: OpenLibraryDoc = { key: '/works/OL3000W', title: 'Nur auf Deutsch', author_name: ['Anon'], language: ['ger'] }

const GB_HIVER: GoogleVolume = {
  id: 'gbHiver',
  volumeInfo: {
    title: 'Un hiver pour te résister',
    authors: ['Morgane Moncomble'],
    publisher: 'Hugo Poche',
    publishedDate: '2021-01-07',
    description: '<p>Quand <b>Rose</b> rencontre Nick…</p>',
    industryIdentifiers: [
      { type: 'ISBN_10', identifier: '2755681235' },
      { type: 'ISBN_13', identifier: '9782755681230' },
    ],
    pageCount: 400,
    imageLinks: { thumbnail: 'http://books.google.com/books/content?id=gbHiver&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api' },
    language: 'fr',
    canonicalVolumeLink: 'https://books.google.com/books/about/?id=gbHiver',
  },
}
const GB_HOOVER_FR: GoogleVolume = {
  id: 'gbHooverFr',
  volumeInfo: {
    title: 'Jamais plus',
    authors: ['Colleen Hoover'],
    publishedDate: '2018',
    description: 'Lily…',
    language: 'fr',
  },
}

describe('fiches en ligne — normalisation, fusion, rapprochement', () => {
  it('Open Library : identifiant d’œuvre, couverture -L, langue voulue si l’œuvre a une édition dans cette langue', () => {
    const item = fromOpenLibrary(OL_HOOVER, 'fr')!
    assert.equal(item.id, 'ol:OL2000W')
    assert.equal(item.cover, 'https://covers.openlibrary.org/b/id/777-L.jpg')
    assert.equal(item.language, 'fr')
    assert.equal(fromOpenLibrary(OL_HOOVER, 'en')!.language, 'en')
    assert.equal(item.rating, 4.3)
    assert.equal(fromOpenLibrary({ title: 'Sans clé' }, 'fr'), null)
  })

  it('Google Books : couverture en HTTPS, sans page cornée, agrandie ; résumé sans HTML ; ISBN-13 ; année', () => {
    const item = fromGoogle(GB_HIVER)!
    const cover = new URL(item.cover!)
    assert.equal(cover.protocol, 'https:')
    assert.equal(cover.searchParams.get('edge'), null)
    assert.equal(cover.searchParams.get('fife'), 'w800-h1200')
    assert.equal(item.synopsis, 'Quand Rose rencontre Nick…')
    assert.equal(item.isbn, '9782755681230')
    assert.equal(item.year, 2021)
    assert.equal(googleCover(undefined), null)
  })

  it('description Open Library : `{ value }` accepté, sources Markdown finales retirées', () => {
    assert.equal(openLibraryDescription({ description: { value: 'Résumé.\r\n----------\r\n[source](http://x)' } }), 'Résumé.')
    assert.equal(openLibraryDescription({}), '')
    assert.equal(
      openLibraryDescription({ description: '"*It*" is a **1986** novel, see [Wikipedia](https://en.wikipedia.org/wiki/It).' }),
      '"It" is a 1986 novel, see Wikipedia.',
      'Markdown retiré',
    )
  })

  it('fusion : un même roman des deux sources → une fiche complète (résumé Google, pages Open Library, 1ʳᵉ parution)', () => {
    const merged = mergeResults(
      [[fromOpenLibrary(OL_HIVER, 'fr')!], [fromGoogle(GB_HIVER)!]],
      'un hiver pour te résister',
      'fr',
    )
    assert.equal(merged.length, 1)
    const [book] = merged
    assert.deepEqual(book!.refs, { openlibrary: 'OL1000W', google: 'gbHiver' })
    assert.equal(book!.synopsis, 'Quand Rose rencontre Nick…')
    assert.equal(book!.pages, 412)
    assert.equal(book!.year, 2019)
  })

  it('classement : la langue voulue passe devant, à pertinence de source égale', () => {
    // Google renvoie une liste par langue : chaque livre y est premier.
    const french = fromGoogle(GB_HOOVER_FR)!
    const english = { ...french, id: 'gb:en', title: 'Hoover Stories', language: 'en', refs: { google: 'en' } }
    assert.equal(mergeResults([[english], [french]], 'colleen hoover', 'fr')[0]!.id, 'gb:gbHooverFr')
    assert.equal(mergeResults([[french], [english]], 'colleen hoover', 'en')[0]!.id, 'gb:en')
  })

  it('rapprochement d’un EPUB : même titre ET même auteur, sinon rien', () => {
    const results = [fromOpenLibrary(OL_HOOVER, 'en')!, fromGoogle(GB_HIVER)!]
    assert.equal(pickMatch(results, { title: 'Un hiver pour te résister !', author: 'Morgane Moncomble' })?.id, 'gb:gbHiver')
    assert.equal(pickMatch(results, { title: 'Un hiver pour te résister', author: 'Quelqu’un d’autre' }), null)
    assert.equal(pickMatch(results, { title: 'Un été pour t’aimer', author: 'Morgane Moncomble' }), null)
  })

  it('rattachement d’un EPUB : même ISBN, ou même titre ET même auteur → d’office', () => {
    const hiver = fromGoogle(GB_HIVER)!
    const hoover = fromOpenLibrary(OL_HOOVER, 'en')!
    const byIsbn = decideMatch([fromOpenLibrary(OL_HIVER, 'fr')!, hoover], { title: 'Titre de l’éditeur', author: null, isbn: '978-2-7499-4105-0' })
    assert.equal(byIsbn.kind === 'confident' && byIsbn.item.id, 'ol:OL1000W')
    const exact = decideMatch([hoover, hiver], { title: 'Un hiver pour te résister', author: 'Morgane Moncomble', isbn: null })
    assert.equal(exact.kind === 'confident' && exact.item.id, 'gb:gbHiver')
    const noAuthor = decideMatch([hoover, hiver], { title: 'Un hiver pour te résister', author: null, isbn: null })
    assert.equal(noAuthor.kind === 'confident' && noAuthor.item.id, 'gb:gbHiver', 'titre identique et seul candidat')
  })

  it('rattachement : dans le doute on demande, sans rien → fiche tirée du fichier', () => {
    const hiver = fromGoogle(GB_HIVER)!
    const otherEdition = fromOpenLibrary({ ...OL_HIVER, isbn: [] }, 'fr')!
    const wrongAuthor = decideMatch([hiver], { title: 'Un hiver pour te résister', author: 'Quelqu’un d’autre', isbn: null })
    assert.equal(wrongAuthor.kind, 'choose', 'auteur différent : jamais d’office')
    assert.deepEqual(wrongAuthor.kind === 'choose' && wrongAuthor.candidates.map((item) => item.id), ['gb:gbHiver'])
    const twins = decideMatch([hiver, otherEdition], { title: 'Un hiver pour te résister', author: 'Morgane Moncomble', isbn: null })
    assert.equal(twins.kind, 'choose', 'deux fiches aussi probables : l’utilisateur tranche')
    assert.equal(twins.kind === 'choose' && twins.candidates.length, 2)
    assert.equal(decideMatch([fromOpenLibrary(OL_HOOVER, 'en')!], { title: 'Journal de Zoé', author: 'Zoé', isbn: null }).kind, 'none')
    assert.equal(decideMatch([], { title: 'Un hiver', author: null, isbn: null }).kind, 'none')
  })

  it('rapprochement : série en titre, vrai titre en sous-titre (fiche Open Library réelle)', () => {
    const series = fromOpenLibrary({ ...OL_HIVER, key: '/works/OL37811574W', title: 'Seasons, Tome 2', subtitle: 'Un hiver pour te résister' }, 'fr')!
    assert.equal(pickMatch([series], { title: 'Un hiver pour te résister', author: 'Morgane Moncomble' })?.id, 'ol:OL37811574W')
    assert.equal(pickMatch([series], { title: 'Seasons, Tome 3', author: 'Morgane Moncomble' }), null, 'un autre tome n’est pas ce livre')
  })

  it('Open Library : l’édition dans la langue voulue donne titre et couverture', () => {
    const doc: OpenLibraryDoc = {
      key: '/works/OL4000W',
      title: 'Il nome della rosa',
      author_name: ['Umberto Eco'],
      cover_i: 1,
      editions: { docs: [{ title: 'Le Nom de la Rose', language: ['fre'], cover_i: 976764 }] },
    }
    const french = fromOpenLibrary(doc, 'fr')!
    assert.equal(french.title, 'Le Nom de la Rose')
    assert.equal(french.cover, 'https://covers.openlibrary.org/b/id/976764-L.jpg')
    assert.equal(french.id, 'ol:OL4000W', 'l’id reste celui de l’œuvre')
    assert.equal(fromOpenLibrary(doc, 'en')!.title, 'Il nome della rosa', 'pas d’édition anglaise : titre de l’œuvre')
  })

  it('au format `Book` du catalogue : type « book », langue du résumé', () => {
    const book = toBook(fromGoogle(GB_HIVER)!, 'fr')
    assert.equal(book.kind, 'book')
    assert.equal(book.synopsisLanguage, 'fr')
    assert.deepEqual(book.languages, ['fr'])
  })
})

describe('deck « Romans » — étagères', () => {
  const liked = (id: string, ...categories: string[]) => ({ id, categories })

  it('étagère thématique : sujet Open Library, langue voulue, triée par popularité', () => {
    assert.deepEqual(novelShelfQuery('romance', 'fr'), { q: 'subject:romance language:fre', sort: 'readinglog' })
    assert.deepEqual(novelShelfQuery('science-fiction', 'en'), { q: 'subject:"science fiction" language:eng', sort: 'readinglog' })
    assert.deepEqual(novelShelfQuery('tendances', 'fr'), { q: 'subject:fiction language:fre', sort: 'readinglog' })
  })

  it('« Pour toi » : les genres des romans gardés (les mangas ne comptent pas) ; sans historique, les mieux notés', () => {
    const history = [
      liked('ol:OL1W', 'Romance', 'Fiction, romance, contemporary'),
      liked('gb:abc', 'Fiction / Romance / General'),
      liked('ol:OL2W', 'Fantasy fiction', 'Magic'),
      liked('11111111-1111-4111-8111-111111111111', 'Horror', 'Horror'),
    ]
    assert.deepEqual(favoriteGenres(history), ['romance', 'fantasy'])
    assert.deepEqual(novelShelfQuery('pour-toi', 'fr', history), { q: '(subject:romance OR subject:fantasy) language:fre', sort: 'rating' })
    assert.deepEqual(novelShelfQuery('pour-toi', 'fr', []), { q: 'subject:fiction language:fre', sort: 'rating' })
    assert.equal(isNovelId('ol:OL1W'), true)
    assert.equal(isNovelId('11111111-1111-4111-8111-111111111111'), false)
  })
})

/* ---- API --------------------------------------------------------------------------------- */

const mock = { google: 200 as number, openLibrary: 200 as number, calls: [] as string[], lastSearch: null as URLSearchParams | null }
mockedHosts.add('openlibrary.org')
mockedHosts.add('www.googleapis.com')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
extraMocks.push((url) => {
  if (url.hostname === 'openlibrary.org') {
    mock.calls.push(`ol${url.pathname}`)
    if (mock.openLibrary !== 200) return json({}, mock.openLibrary)
    if (url.pathname === '/search.json') {
      mock.lastSearch = url.searchParams
      return json({ docs: [OL_GERMAN, OL_HOOVER, OL_HIVER], numFound: 3 })
    }
    if (url.pathname === '/works/OL2000W.json') return json({ description: 'Lily Bloom arrive à Boston.' })
    return json({}, 404)
  }
  if (url.hostname === 'www.googleapis.com') {
    mock.calls.push(`gb:${url.searchParams.get('langRestrict')}`)
    if (mock.google !== 200) return json({ error: { code: mock.google } }, mock.google)
    return json({ items: url.searchParams.get('langRestrict') === 'fr' ? [GB_HIVER, GB_HOOVER_FR] : [] })
  }
  return undefined
})

const { client, close } = await startServer()
const { resetMetadataState } = await import('../src/modules/books/metadata.service.js')
after(async () => {
  await close()
  rmSync(BOOKS_DIR, { recursive: true, force: true })
})

beforeEach(() => {
  mock.google = 200
  mock.openLibrary = 200
  mock.calls.length = 0
  resetMetadataState()
})

/** Corps JSON d'une réponse brute. */
const jsonOf = async (response: Response) => (await response.json()) as any

const upload = (who: TestClient, data: Uint8Array, name = 'Un_hiver.epub', type = 'application/epub+zip') =>
  who.send('POST', '/books/upload?lang=fr', {
    body: data,
    headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
  })

describe('GET /api/books/search', () => {
  it('fiches des deux sources, fusionnées, en français d’abord ; les langues hors FR/EN écartées ; résumés hydratés', async () => {
    const response = await client().request('GET', '/books/search?q=hiver&lang=fr')
    assert.equal(response.status, 200)
    const ids = response.body.results.map((book: { id: string }) => book.id)
    assert.ok(!ids.includes('ol:OL3000W'), 'œuvre allemande écartée')
    const hiver = response.body.results.find((book: { title: string }) => book.title === 'Un hiver pour te résister')
    assert.equal(hiver.kind, 'book')
    assert.equal(hiver.pages, 412)
    const hoover = response.body.results.find((book: { id: string }) => book.id === 'ol:OL2000W')
    assert.equal(hoover.synopsis, 'Lily Bloom arrive à Boston.', 'résumé Open Library hydraté')
    assert.ok(mock.calls.includes('gb:fr') && mock.calls.includes('gb:en'), 'Google interrogé en FR puis en EN')
  })

  it('Google Books en quota dépassé (429) → Open Library répond seule', async () => {
    mock.google = 429
    const response = await client().request('GET', '/books/search?q=hoover&lang=en')
    assert.equal(response.status, 200)
    assert.ok(response.body.results.length > 0)
    assert.ok(response.body.results.every((book: { id: string }) => book.id.startsWith('ol:')))
  })

  it('les deux sources en panne → 502 ; requête trop courte → 400', async () => {
    mock.google = 500
    mock.openLibrary = 503
    assert.equal((await client().request('GET', '/books/search?q=zzz&lang=fr')).status, 502)
    assert.equal((await client().request('GET', '/books/search?q=a')).status, 400)
  })
})

describe('POST /api/books/discover — deck « Romans »', () => {
  it('fournée de fiches `Book` avec couverture, sans compte ; requête de l’étagère transmise à Open Library', async () => {
    const response = await client().request('POST', '/books/discover', { shelf: 'romance', lang: 'fr', limit: 10 })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.books.map((book: { id: string }) => book.id), ['ol:OL2000W', 'ol:OL1000W'], 'sans couverture : écartée')
    assert.ok(response.body.books.every((book: { kind: string }) => book.kind === 'book'))
    assert.equal(response.body.hasMore, false)
    assert.equal(mock.lastSearch?.get('q'), 'subject:romance language:fre')
    assert.equal(mock.lastSearch?.get('sort'), 'readinglog')
    assert.equal(mock.lastSearch?.get('lang'), 'fr')
  })

  it('titres déjà passés, gardés ou dans la file : jamais reproposés ; « Nouvelle sélection » avance dans le classement', async () => {
    const response = await client().request('POST', '/books/discover', {
      shelf: 'romance',
      lang: 'fr',
      skipped: ['ol:OL2000W'],
      liked: [{ id: 'ol:OL1000W', categories: ['Romance'], rating: null, favorite: false, userRating: null }],
    })
    assert.deepEqual(response.body.books, [])
    await client().request('POST', '/books/discover', { shelf: 'thriller', lang: 'en', round: 2 })
    assert.equal(mock.lastSearch?.get('offset'), '80')
  })

  it('étagère inconnue → 400 ; résumé d’un roman du deck ; id invalide → 400', async () => {
    assert.equal((await client().request('POST', '/books/discover', { shelf: 'isekai' })).status, 400)
    const summary = await client().request('GET', '/books/summary/ol:OL2000W')
    assert.equal(summary.body.synopsis, 'Lily Bloom arrive à Boston.')
    assert.equal((await client().request('GET', '/books/summary/gb:abc')).status, 400)
  })
})

describe('bibliothèque de romans (compte)', () => {
  const email = 'lectrice@example.com'
  const password = 'motdepasse-solide'
  let phone: TestClient
  let computer: TestClient
  let bookId: string
  let fileBytes: Uint8Array

  before(async () => {
    phone = client()
    assert.equal((await phone.signUp({ email, password })).status, 201)
    computer = client()
    assert.equal((await computer.request('POST', '/auth/login', { email, password })).status, 200)
  })

  it('sans compte : 401', async () => {
    assert.equal((await upload(client(), epub3())).status, 401)
    assert.equal((await client().request('GET', '/books')).status, 401)
  })

  it('type refusé (415), fichier trop gros annoncé (413), ZIP qui n’est pas un EPUB (422), corps vide (400)', async () => {
    assert.equal((await upload(phone, epub3(), 'x.pdf', 'application/pdf')).status, 415)
    const big = await upload(phone, new Uint8Array(1024 * 1024 + 1))
    assert.equal(big.status, 413)
    assert.equal((await jsonOf(big)).error.code, 'file_too_large')
    const notEpub = await upload(phone, zipSync({ 'a.txt': strToU8('bonjour') }))
    assert.equal(notEpub.status, 422)
    assert.equal((await jsonOf(notEpub)).error.code, 'invalid_epub')
    assert.equal((await upload(phone, new Uint8Array(0))).status, 400)
  })

  it('import : métadonnées du fichier + fiche en ligne (résumé, pagination), couverture du fichier servie par l’API', async () => {
    // Le fichier n'a pas de résumé : il vient de la fiche en ligne.
    fileBytes = buildEpub({
      opf: EPUB3_OPF.replace(/<dc:description>[\s\S]*?<\/dc:description>/, ''),
      files: { 'OEBPS/Text/ch1.xhtml': CHAPTER, 'OEBPS/Images/couverture hd.jpg': JPEG },
    })
    const response = await upload(phone, fileBytes, 'Un_hiver pour te résister.epub')
    assert.equal(response.status, 201)
    const { book, duplicate } = await jsonOf(response)
    bookId = book.id
    assert.equal(duplicate, false)
    assert.equal(book.title, 'Un hiver pour te résister')
    assert.equal(book.author, 'Morgane Moncomble')
    assert.equal(book.language, 'fr')
    assert.equal(book.format, 'EPUB')
    assert.equal(book.fileSize, fileBytes.length)
    assert.equal(book.originalName, 'Un_hiver pour te résister.epub')
    assert.equal(book.synopsis, 'Quand Rose rencontre Nick…', 'résumé de la fiche Google Books')
    assert.equal(book.pages, 412, 'pagination de la fiche fusionnée')
    assert.match(book.coverUrl, new RegExp(`^/api/books/${bookId}/cover\\?v=`))
    assert.equal(book.progressPercent, 0)
    assert.equal(book.lastCfi, null)

    const cover = await phone.send('GET', `/books/${bookId}/cover`)
    assert.equal(cover.status, 200)
    assert.equal(cover.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(new Uint8Array(await cover.arrayBuffer()), JPEG)
  })

  it('le même fichier importé une 2ᵉ fois (autre appareil) → la fiche existante, rien de stocké en double', async () => {
    const response = await upload(computer, fileBytes, 'copie.epub')
    assert.equal(response.status, 200)
    const { book, duplicate } = await jsonOf(response)
    assert.equal(duplicate, true)
    assert.equal(book.id, bookId)
    const list = await computer.request('GET', '/books')
    assert.equal(list.body.books.length, 1)
  })

  it('fichier servi en entier, puis par plages (`Range` → 206), plage impossible → 416', async () => {
    const full = await computer.send('GET', `/books/${bookId}/file`)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'application/epub+zip')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.match(full.headers.get('content-disposition') ?? '', /filename\*=UTF-8''Un_hiver%20pour%20te%20r%C3%A9sister\.epub/)
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), fileBytes)

    const part = await computer.send('GET', `/books/${bookId}/file`, { headers: { Range: 'bytes=0-99' } })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), `bytes 0-99/${fileBytes.length}`)
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), fileBytes.subarray(0, 100))

    const tail = await computer.send('GET', `/books/${bookId}/file`, { headers: { Range: 'bytes=-10' } })
    assert.equal(tail.status, 206)
    assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), fileBytes.subarray(fileBytes.length - 10))

    const beyond = await computer.send('GET', `/books/${bookId}/file`, { headers: { Range: `bytes=${fileBytes.length + 10}-` } })
    assert.equal(beyond.status, 416)
    assert.equal(beyond.headers.get('content-range'), `bytes */${fileBytes.length}`)
  })

  it('position : écrite par le téléphone, relue par l’ordinateur (même phrase, même %)', async () => {
    const cfi = 'epubcfi(/6/4!/4/2/1:120)'
    const saved = await phone.request('PATCH', `/books/${bookId}/progress`, { cfi, percent: 42.5, at: Date.now() - 1000 })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.applied, true)

    const read = await computer.request('GET', `/books/${bookId}`)
    assert.equal(read.body.book.lastCfi, cfi)
    assert.equal(read.body.book.progressPercent, 42.5)
    assert.ok(read.body.book.progressAt <= Date.now())
  })

  it('une position plus ancienne (appareil resté hors-ligne) ne remplace pas la plus récente', async () => {
    const stale = await computer.request('PATCH', `/books/${bookId}/progress`, {
      cfi: 'epubcfi(/6/2!/4/2/1:0)',
      percent: 3,
      at: Date.now() - 60 * 60 * 1000,
    })
    assert.equal(stale.status, 200)
    assert.equal(stale.body.applied, false)
    assert.equal(stale.body.book.lastCfi, 'epubcfi(/6/4!/4/2/1:120)', 'la réponse porte la position qui fait foi')
  })

  it('horloge en avance : position acceptée mais datée de « maintenant », elle ne fige pas les autres appareils', async () => {
    const future = await phone.request('PATCH', `/books/${bookId}/progress`, { cfi: 'epubcfi(/6/6!/4/2/1:5)', percent: 50, at: Date.now() + 86_400_000 })
    assert.equal(future.body.applied, true)
    assert.ok(future.body.book.progressAt <= Date.now())
    const next = await computer.request('PATCH', `/books/${bookId}/progress`, { cfi: 'epubcfi(/6/8!/4/2/1:0)', percent: 55, at: Date.now() + 5 })
    assert.equal(next.body.applied, true)
  })

  it('position invalide → 400', async () => {
    assert.equal((await phone.request('PATCH', `/books/${bookId}/progress`, { cfi: '/6/4', percent: 10, at: Date.now() })).status, 400)
    assert.equal((await phone.request('PATCH', `/books/${bookId}/progress`, { cfi: 'epubcfi(/6/4!/2)', percent: 140, at: Date.now() })).status, 400)
  })

  it('fiche corrigée : couverture Open Library / Google acceptée, autre hôte refusé, `null` → retour à celle du fichier', async () => {
    const chosen = await phone.request('PATCH', `/books/${bookId}`, {
      title: 'Un hiver pour te résister (poche)',
      coverUrl: 'https://covers.openlibrary.org/b/id/555-L.jpg',
      year: 2021,
    })
    assert.equal(chosen.status, 200)
    assert.equal(chosen.body.book.coverUrl, 'https://covers.openlibrary.org/b/id/555-L.jpg')
    assert.equal(chosen.body.book.year, 2021)

    assert.equal((await phone.request('PATCH', `/books/${bookId}`, { coverUrl: 'https://evil.example/pixel.gif' })).status, 400)
    assert.equal((await phone.request('PATCH', `/books/${bookId}`, { lastCfi: 'x' })).status, 400, 'champ inconnu refusé')

    const reverted = await phone.request('PATCH', `/books/${bookId}`, { coverUrl: null })
    assert.match(reverted.body.book.coverUrl, /^\/api\/books\/.+\/cover\?v=/)
  })

  it('un autre compte ne voit rien : 404 partout, jamais 403', async () => {
    const stranger = client()
    assert.equal((await stranger.signUp({ email: 'autre@example.com', password })).status, 201)
    assert.equal((await stranger.request('GET', `/books/${bookId}`)).status, 404)
    assert.equal((await stranger.send('GET', `/books/${bookId}/file`)).status, 404)
    assert.equal((await stranger.send('GET', `/books/${bookId}/cover`)).status, 404)
    assert.equal((await stranger.request('PATCH', `/books/${bookId}/progress`, { cfi: 'epubcfi(/6/4!/2)', percent: 1, at: Date.now() })).status, 404)
    assert.equal((await stranger.request('DELETE', `/books/${bookId}`)).status, 404)
    assert.deepEqual((await stranger.request('GET', '/books')).body.books, [])
  })

  it('quota du compte : un import qui le dépasserait est refusé (413 `quota_exceeded`)', async () => {
    // Deux EPUB de ~0,7 Mo incompressibles (quota de test : 1 Mo).
    const heavy = () => buildEpub({ opf: EPUB2_OPF, opfPath: 'content.opf', files: { 'cover.png': PNG, 'blob.bin': [randomBytes(700 * 1024), { level: 0 }] } })
    assert.equal((await upload(phone, heavy(), 'a.epub')).status, 201)
    const second = await upload(phone, heavy(), 'b.epub')
    assert.equal(second.status, 413)
    assert.equal((await jsonOf(second)).error.code, 'quota_exceeded')
  })

  it('suppression : 204, fichiers effacés du disque, livre introuvable ensuite', async () => {
    const { prisma } = await import('../src/db.js')
    const row = await prisma.userBook.findUniqueOrThrow({ where: { id: bookId } })
    const stored = [row.filePath, row.coverPath!].map((file) => path.join(BOOKS_DIR, file))
    assert.ok(stored.every((file) => existsSync(file)))

    assert.equal((await phone.request('DELETE', `/books/${bookId}`)).status, 204)
    assert.ok(stored.every((file) => !existsSync(file)), 'EPUB et couverture effacés')
    assert.equal((await computer.request('GET', `/books/${bookId}`)).status, 404)
    assert.deepEqual(readdirSync(path.join(BOOKS_DIR, '.tmp')), [], 'aucun envoi temporaire oublié')
  })
})

describe('rattachement EPUB ↔ fiche de roman', () => {
  let reader: TestClient
  let hiverId: string
  let hiverWork: string

  /** EPUB minimal, unique à chaque appel (empreinte différente). */
  const novelEpub = (title: string, author: string | null, isbn: string | null) =>
    buildEpub({
      opf: EPUB3_OPF.replace(/<dc:identifier id="uid">[^<]*<\/dc:identifier>/, `<dc:identifier id="uid">${isbn ? `urn:isbn:${isbn}` : 'urn:uuid:x'}</dc:identifier>`)
        .replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${title}</dc:title>`)
        .replace(/<dc:creator id="c1">[^<]*<\/dc:creator>/, author ? `<dc:creator id="c1">${author}</dc:creator>` : '')
        .replace(/<item id="img"[^>]*\/>/, ''),
      files: { 'OEBPS/Text/ch1.xhtml': CHAPTER.replace('Il neigeait.', `Il neigeait. ${randomBytes(6).toString('hex')}`) },
    })

  const uploadTo = (workId: string | null, data: Uint8Array) =>
    reader.send('POST', `/books/upload?lang=fr${workId ? `&workId=${encodeURIComponent(workId)}` : ''}`, {
      body: data,
      headers: { 'Content-Type': 'application/epub+zip', 'X-File-Name': 'livre.epub' },
    })

  before(async () => {
    reader = client()
    assert.equal((await reader.signUp({ email: 'rattachement@example.com', password: 'motdepasse-solide' })).status, 201)
  })

  it('titre exact « Un hiver pour te résister » (ISBN du fichier) : rattaché d’office à sa fiche en ligne', async () => {
    const response = await uploadTo(null, novelEpub('Un hiver pour te r&#233;sister', 'Morgane Moncomble', '978-2-7499-4105-0'))
    assert.equal(response.status, 201)
    const { book, match } = await jsonOf(response)
    assert.equal(match.status, 'linked')
    assert.match(match.record.id, /^(ol|gb):/)
    assert.equal(match.record.title, 'Un hiver pour te résister')
    assert.equal(match.record.kind, 'book')
    assert.equal(book.workId, match.record.id)
    hiverId = book.id
    hiverWork = book.workId
  })

  it('la position EPUB se garde sans perte sur le livre rattaché', async () => {
    const cfi = 'epubcfi(/6/4!/4/2/1:120)'
    const saved = await reader.request('PATCH', `/books/${hiverId}/progress`, { cfi, percent: 42.5, at: Date.now() })
    assert.equal(saved.status, 200)
    const again = await reader.request('GET', `/books/${hiverId}`)
    assert.equal(again.body.book.lastCfi, cfi)
    assert.equal(again.body.book.progressPercent, 42.5)
    assert.equal(again.body.book.workId, hiverWork, 'le rattachement survit à la lecture')
  })

  it('doute (même titre, autre auteur) : fiches proposées, puis rattachement au choix', async () => {
    const response = await uploadTo(null, novelEpub('Un hiver pour te r&#233;sister', 'Autre Autrice', null))
    assert.equal(response.status, 201)
    const { book, match } = await jsonOf(response)
    assert.equal(match.status, 'choose')
    assert.ok(match.candidates.length > 0 && match.candidates.every((item: { kind: string }) => item.kind === 'book'))
    assert.equal(book.workId, null, 'pas rattaché tant que rien n’est choisi')

    // La fiche déjà dotée d'un fichier ne peut pas en recevoir un second.
    const taken = match.candidates.find((item: { id: string }) => item.id === hiverWork)
    if (taken) {
      const refused = await reader.request('POST', `/books/${book.id}/link`, { record: taken })
      assert.equal(refused.status, 409)
      assert.equal(refused.body.error.code, 'work_already_linked')
    }

    const own = await reader.request('POST', `/books/${book.id}/link`, { own: true })
    assert.equal(own.status, 200)
    assert.equal(own.body.book.workId, `novel:${book.id}`)
    assert.equal(own.body.record.id, `novel:${book.id}`)
    assert.equal(own.body.record.authors[0], 'Autre Autrice')
  })

  it('aucune fiche approchante : fiche créée depuis le fichier (titre, auteur, couverture)', async () => {
    const response = await uploadTo(null, novelEpub('Journal intime de Zoé', 'Zoé Martin', null))
    assert.equal(response.status, 201)
    const { book, match } = await jsonOf(response)
    assert.equal(match.status, 'created')
    assert.equal(book.workId, `novel:${book.id}`)
    assert.equal(match.record.title, 'Journal intime de Zoé')
    assert.deepEqual(match.record.authors, ['Zoé Martin'])
  })

  it('depuis la fiche d’un roman : rattaché d’office ; fiche qui a déjà un fichier → 409 sans rien stocker', async () => {
    const response = await uploadTo('gb:gbAutreRoman', novelEpub('Un tout autre roman', 'Quelqu’un', null))
    assert.equal(response.status, 201)
    const { book, match } = await jsonOf(response)
    assert.deepEqual(match, { status: 'linked', record: null })
    assert.equal(book.workId, 'gb:gbAutreRoman')

    const before = (await reader.request('GET', '/books')).body.books.length
    const refused = await uploadTo(hiverWork, novelEpub('Encore un', null, null))
    assert.equal(refused.status, 409)
    assert.equal((await jsonOf(refused)).error.code, 'work_already_linked')
    assert.equal((await reader.request('GET', '/books')).body.books.length, before)

    assert.equal((await uploadTo('mangadex-uuid', novelEpub('x', null, null))).status, 400, 'fiche de roman seulement')
  })

  it('rattachement choisi : fiche de roman en ligne uniquement', async () => {
    const response = await uploadTo(null, novelEpub('Un hiver pour te r&#233;sister', 'Encore Une Autre', null))
    const { book } = await jsonOf(response)
    const manga = { ...toBook(fromGoogle(GB_HIVER)!, 'fr'), id: '11111111-1111-4111-8111-111111111111', kind: 'manga' }
    assert.equal((await reader.request('POST', `/books/${book.id}/link`, { record: manga })).status, 400)
    assert.equal((await reader.request('POST', `/books/${book.id}/link`, { record: { title: 'sans id' } })).status, 400)
  })

  it('import d’avant le rattachement : rapproché sans question (`auto`)', async () => {
    const { prisma } = await import('../src/db.js')
    const response = await uploadTo(null, novelEpub('Un hiver pour te r&#233;sister', 'Dernière Autrice', null))
    const { book } = await jsonOf(response)
    await prisma.userBook.update({ where: { id: book.id }, data: { workId: null } })

    const matched = await reader.request('POST', `/books/${book.id}/match`, { lang: 'fr', mode: 'auto' })
    assert.equal(matched.status, 200)
    assert.notEqual(matched.body.match.status, 'choose', 'jamais de question en mode automatique')
    assert.ok(matched.body.book.workId)
  })
})
