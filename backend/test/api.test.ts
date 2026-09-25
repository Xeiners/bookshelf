import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { installMangadexMock, prepareEnvironment, startServer, upstreamCalls, type TestClient } from './harness.js'

prepareEnvironment('api')
installMangadexMock()

const { client, close } = await startServer()
after(close)

const BILINGUAL_ID = '11111111-1111-4111-8111-111111111111'
const ENGLISH_ONLY_ID = '22222222-2222-4222-8222-222222222222'

describe('catalogue — paramètre lang', () => {
  const guest = client()

  it('renvoie la même étagère en français puis en anglais, sans rappeler MangaDex', async () => {
    const fr = await guest.request('GET', '/manga/shelves/action?page=1&limit=10&lang=fr')
    assert.equal(fr.status, 200)
    const callsAfterFrench = upstreamCalls.filter((call) => call.startsWith('/manga?')).length

    const en = await guest.request('GET', '/manga/shelves/action?page=1&limit=10&lang=en')
    assert.equal(en.status, 200)
    const callsAfterEnglish = upstreamCalls.filter((call) => call.startsWith('/manga?')).length

    assert.equal(callsAfterEnglish, callsAfterFrench, 'le cache brut doit servir les deux langues')
    assert.deepEqual(
      fr.body.books.map((book: { id: string }) => book.id),
      en.body.books.map((book: { id: string }) => book.id),
    )

    const frBook = fr.body.books.find((book: { id: string }) => book.id === BILINGUAL_ID)
    const enBook = en.body.books.find((book: { id: string }) => book.id === BILINGUAL_ID)
    assert.equal(frBook.title, 'La Voie du sabre')
    assert.equal(enBook.title, 'The Blade Road')
  })

  it('la requête MangaDex demande les chapitres fr ET en (repli garanti)', () => {
    const shelfCall = upstreamCalls.find((call) => call.startsWith('/manga?') && call.includes('includedTags'))
    assert.ok(shelfCall)
    const params = new URLSearchParams(shelfCall.split('?')[1])
    assert.deepEqual(params.getAll('availableTranslatedLanguage[]').sort(), ['en', 'fr'])
  })

  it('une langue absente ou inconnue retombe sur le français (rétrocompatibilité)', async () => {
    for (const query of ['', '&lang=de', '&lang=']) {
      const response = await guest.request('GET', `/manga/${ENGLISH_ONLY_ID}?x=1${query}`)
      assert.equal(response.status, 200)
      assert.equal(response.body.book.lang, 'fr')
      // Pas de français pour cette œuvre : repli sur l'anglais, jamais de vide.
      assert.equal(response.body.book.synopsisLanguage, 'en')
      assert.ok(response.body.book.synopsis.length > 0)
    }
  })

  it('les libellés d’étagères suivent la langue', async () => {
    const fr = await guest.request('GET', '/manga/shelves?lang=fr')
    const en = await guest.request('GET', '/manga/shelves?lang=en')
    const label = (body: { shelves: { id: string; label: string }[] }, id: string) =>
      body.shelves.find((shelf) => shelf.id === id)?.label
    assert.equal(label(fr.body, 'tranche-de-vie'), 'Tranche de vie')
    assert.equal(label(en.body, 'tranche-de-vie'), 'Slice of life')
  })

  it('recherche paginée localisée, avec hasMore', async () => {
    const response = await guest.request('GET', '/manga/search?q=blade&page=1&limit=2&lang=en')
    assert.equal(response.status, 200)
    assert.equal(response.body.books.length, 2)
    assert.equal(response.body.hasMore, true)
    assert.ok(response.body.books.every((book: { lang: string }) => book.lang === 'en'))
  })

  it('batch : traduit une liste d’ids, ignore les inconnus, valide le format', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999'
    const ok = await guest.request('GET', `/manga/batch?ids=${BILINGUAL_ID},${unknown}&lang=en`)
    assert.equal(ok.status, 200)
    assert.deepEqual(
      ok.body.books.map((book: { title: string }) => book.title),
      ['The Blade Road'],
    )

    const invalid = await guest.request('GET', '/manga/batch?ids=not-a-uuid&lang=en')
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error.code, 'validation_error')
  })
})

describe('compte — preferredLanguage', () => {
  let device: TestClient
  const email = `lang-${Date.now()}@example.com`

  before(() => {
    device = client()
  })

  it('l’inscription enregistre la langue choisie en invité', async () => {
    const response = await device.request('POST', '/auth/register', {
      email,
      password: 'motdepasse-test',
      preferredLanguage: 'en',
    })
    assert.equal(response.status, 201)
    assert.equal(response.body.user.preferredLanguage, 'en')
  })

  it('sans langue fournie, le compte est en français (rétrocompatibilité)', async () => {
    const response = await client().request('POST', '/auth/register', {
      email: `default-${Date.now()}@example.com`,
      password: 'motdepasse-test',
    })
    assert.equal(response.status, 201)
    assert.equal(response.body.user.preferredLanguage, 'fr')
  })

  it('PATCH /auth/me change la langue, /auth/me la relit', async () => {
    const patched = await device.request('PATCH', '/auth/me', { preferredLanguage: 'fr' })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.user.preferredLanguage, 'fr')

    const me = await device.request('GET', '/auth/me')
    assert.equal(me.body.user.preferredLanguage, 'fr')
  })

  it('refuse une langue non prise en charge', async () => {
    const response = await device.request('PATCH', '/auth/me', { preferredLanguage: 'de' })
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'validation_error')
  })

  it('un autre appareil retrouve la préférence à la connexion', async () => {
    const other = client()
    const response = await other.request('POST', '/auth/login', { email, password: 'motdepasse-test' })
    assert.equal(response.status, 200)
    assert.equal(response.body.user.preferredLanguage, 'fr')
  })

  it('codes d’erreur stables, traduisibles côté front', async () => {
    const wrong = await client().request('POST', '/auth/login', { email, password: 'mauvais' })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.body.error.code, 'invalid_credentials')

    const taken = await client().request('POST', '/auth/register', { email, password: 'motdepasse-test' })
    assert.equal(taken.status, 409)
    assert.equal(taken.body.error.code, 'email_taken')

    const anonymous = await client().request('PATCH', '/auth/me', { preferredLanguage: 'en' })
    assert.equal(anonymous.status, 401)
    assert.equal(anonymous.body.error.code, 'unauthorized')
  })
})

describe('bibliothèque — instantanés multilingues', () => {
  it('accepte et restitue les champs lang / synopsisLanguage', async () => {
    const device = client()
    await device.request('POST', '/auth/register', {
      email: `snap-${Date.now()}@example.com`,
      password: 'motdepasse-test',
    })
    const book = (await device.request('GET', `/manga/${ENGLISH_ONLY_ID}?lang=fr`)).body.book
    const swipe = await device.request('POST', '/library/swipe', { mangaId: book.id, action: 'wishlist', book })
    assert.equal(swipe.status, 200)

    const library = await device.request('GET', '/library')
    assert.equal(library.body.entries[0].book.lang, 'fr')
    assert.equal(library.body.entries[0].book.synopsisLanguage, 'en')
  })
})

describe('bibliothèque — annulation d’un choix du deck', () => {
  it('supprimer une œuvre oublie aussi son « skip » : elle redevient neuve', async () => {
    const device = client()
    await device.request('POST', '/auth/register', {
      email: `undo-${Date.now()}@example.com`,
      password: 'motdepasse-test',
    })

    // « Passer », puis « Retour ».
    await device.request('POST', '/library/swipe', { mangaId: BILINGUAL_ID, action: 'skipped' })
    assert.deepEqual((await device.request('GET', '/library')).body.skipped, [BILINGUAL_ID])
    assert.equal((await device.request('DELETE', `/library/${BILINGUAL_ID}`)).status, 204)
    assert.deepEqual((await device.request('GET', '/library')).body.skipped, [])

    // « Wishlist », puis « Retour ».
    const book = (await device.request('GET', `/manga/${BILINGUAL_ID}?lang=fr`)).body.book
    await device.request('POST', '/library/swipe', { mangaId: book.id, action: 'wishlist', book })
    assert.equal((await device.request('DELETE', `/library/${BILINGUAL_ID}`)).status, 204)
    const library = (await device.request('GET', '/library')).body
    assert.equal(library.entries.length, 0)
    assert.deepEqual(library.skipped, [])
  })
})
