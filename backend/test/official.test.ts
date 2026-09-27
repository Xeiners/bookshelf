/**
 * Plateformes de lecture officielles : normalisation pure (liens officiels de
 * la fiche MangaDex), puis les routes de bout en bout avec MangaDex simulé.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { buildOfficialPlatforms, platformName, safeUrl } from '../src/modules/chapters/official.normalize.js'
import { BILINGUAL } from './fixtures.js'
import { extraMocks, installMangadexMock, prepareEnvironment, startServer, upstreamCalls } from './harness.js'

prepareEnvironment('official')
installMangadexMock()
const { client, close } = await startServer()
after(close)

describe('plateformes officielles — normalisation', () => {
  it('éditeur d’origine (`raw`) et édition anglaise (`engtl`), nommés d’après la plateforme', () => {
    const platforms = buildOfficialPlatforms(
      { mangadexLinks: { raw: 'https://page.kakao.com/content/50866481', engtl: 'https://www.tappytoon.com/en/book/solo-leveling-official' }, originalLanguage: 'ko' },
      'fr',
    )
    assert.deepEqual(platforms, [
      { name: 'Tappytoon', url: 'https://www.tappytoon.com/en/book/solo-leveling-official', language: 'en' },
      { name: 'KakaoPage', url: 'https://page.kakao.com/content/50866481', language: 'ko' },
    ])
  })

  it('les autres liens MangaDex (boutiques, bases de données) sont ignorés', () => {
    const platforms = buildOfficialPlatforms(
      {
        mangadexLinks: {
          raw: 'https://pocket.shonenmagazine.com/episode/139',
          amz: 'https://www.amazon.co.jp/dp/B0000',
          mu: 'https://www.mangaupdates.com/series/abc',
          mal: '12345',
        },
        originalLanguage: 'ja',
      },
      'fr',
    )
    assert.deepEqual(platforms, [{ name: 'Pocket Magazine', url: 'https://pocket.shonenmagazine.com/episode/139', language: 'ja' }])
  })

  it('même page écrite deux fois (« / » final, www.) : une seule plateforme', () => {
    const platforms = buildOfficialPlatforms(
      { mangadexLinks: { raw: 'https://www.viz.com/solo/', engtl: 'https://viz.com/solo' }, originalLanguage: 'en' },
      'en',
    )
    assert.equal(platforms.length, 1)
  })

  it('liens non https ou piégés écartés', () => {
    const platforms = buildOfficialPlatforms(
      { mangadexLinks: { raw: 'javascript:alert(1)', engtl: 'http://insecure.example.com/x' }, originalLanguage: 'ja' },
      'fr',
    )
    assert.deepEqual(platforms, [])
  })

  it('sans lien : liste vide', () => {
    assert.deepEqual(buildOfficialPlatforms({ mangadexLinks: null, originalLanguage: null }, 'fr'), [])
  })

  it('outils', () => {
    assert.equal(safeUrl('javascript:alert(1)'), null)
    assert.equal(safeUrl('https://user:pw@example.com'), null)
    assert.equal(platformName('https://mangaplus.shueisha.co.jp/titles/100020'), 'MANGA Plus')
    assert.equal(platformName('https://www.unknown-site.example/x'), 'unknown-site.example')
  })
})

/* ---- Routes, de bout en bout -------------------------------------------------------------- */

const LICENSED = '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0'
const NO_LINKS = '44444444-4444-4444-8444-444444444444'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const manga = (id: string, links: Record<string, string>, originalLanguage: string) => ({
  ...BILINGUAL,
  id,
  attributes: { ...BILINGUAL.attributes, links, originalLanguage },
})

extraMocks.push((url) => {
  if (url.hostname !== 'api.mangadex.org') return undefined
  if (url.pathname === `/manga/${LICENSED}`) {
    return json({ result: 'ok', data: manga(LICENSED, { raw: 'https://page.kakao.com/content/50866481', engtl: 'https://www.tappytoon.com/en/book/solo' }, 'ko') })
  }
  if (url.pathname === `/manga/${NO_LINKS}`) return json({ result: 'ok', data: manga(NO_LINKS, {}, 'ja') })
  // Titre sous licence : aucun chapitre hébergé.
  if (/^\/manga\/[\w-]+\/feed$/.test(url.pathname)) return json({ result: 'ok', data: [], total: 0 })
  return undefined
})

describe('GET /api/manga/:id/platforms', () => {
  it('titre sous licence : les plateformes officielles, dans l’ordre utile à la langue demandée', async () => {
    const res = await client().request('GET', `/manga/${LICENSED}/platforms?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.platforms.map((platform: { name: string }) => platform.name), ['Tappytoon', 'KakaoPage'])
    assert.ok(res.body.platforms.every((platform: { url: string }) => platform.url.startsWith('https://')))
  })

  it('mis en cache : l’autre langue ne rappelle pas MangaDex, et aucun service tiers n’est appelé', async () => {
    const before = upstreamCalls.length
    const res = await client().request('GET', `/manga/${LICENSED}/platforms?lang=en`)
    assert.equal(res.body.platforms[0].language, 'en')
    assert.equal(upstreamCalls.length, before)
    assert.equal(upstreamCalls.some((call) => call.includes('anilist')), false)
  })

  it('sans lien officiel : liste vide, pas d’erreur', async () => {
    const res = await client().request('GET', `/manga/${NO_LINKS}/platforms?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.platforms, [])
  })

  it('identifiant invalide (ancien id AniList compris) → 400', async () => {
    assert.equal((await client().request('GET', '/manga/nope/platforms')).status, 400)
    assert.equal((await client().request('GET', '/manga/al-105398/platforms')).status, 400)
  })
})

describe('GET /api/manga/:id/chapters — titre sous licence', () => {
  it('0 chapitre, mais les plateformes officielles dans la réponse', async () => {
    const res = await client().request('GET', `/manga/${LICENSED}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.chapters, [])
    assert.equal(res.body.officialPlatforms[0].name, 'Tappytoon')
  })
})
