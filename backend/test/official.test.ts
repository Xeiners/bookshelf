/**
 * Plateformes de lecture officielles : normalisation pure (données au format
 * réel d'AniList / MangaDex, relevées sur Solo Leveling et L'Attaque des
 * Titans), puis les routes de bout en bout avec AniList et MangaDex simulés.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import {
  buildOfficialPlatforms,
  languageCode,
  MAX_PLATFORMS,
  platformName,
  safeUrl,
  type ExternalLinkInput,
} from '../src/modules/chapters/official.normalize.js'
import { BILINGUAL } from './fixtures.js'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('official')
installMangadexMock()
mockedHosts.add('graphql.anilist.co')
const { client, close } = await startServer()
after(close)

const link = (site: string, url: string, language: string | null, extra: Partial<ExternalLinkInput> = {}): ExternalLinkInput => ({
  url,
  site,
  type: 'STREAMING',
  language,
  icon: `https://s4.anilist.co/file/anilistcdn/link/icon/${site.replace(/\W/g, '')}.png`,
  color: '#123456',
  isDisabled: false,
  ...extra,
})

// Relevé réel (AniList 105398), abrégé.
const SOLO_LEVELING: ExternalLinkInput[] = [
  link('KakaoPage', 'https://page.kakao.com/content/50866481', 'Korean'),
  link('Webnovel', 'https://www.webnovel.com/comic/15227640605485101', 'English'),
  link('Tappytoon', 'https://www.tappytoon.com/en/book/solo-leveling-official', 'English'),
  link('Piccoma', 'https://piccoma.com/web/product/5523?etype=episode', 'Japanese'),
  link('Kakao Webtoon', 'https://th.kakaowebtoon.com/content/solo_leveling/48', 'Thai'),
  link('Lezhin', 'https://www.delitoon.de/detail/dad_4100014', 'German'),
  link('Yen Press', 'https://yenpress.com/series/solo-leveling-comic', 'English', { type: 'INFO' }),
  link('Lezhin', 'https://www.delitoon.com/detail/daf_4100080', 'French'),
  link('ONO', 'https://www.ono.live/webtoon/solo-leveling', 'French', { color: '#FDFDFD' }),
]

describe('plateformes officielles — normalisation', () => {
  it('ne garde que les plateformes de lecture (STREAMING), actives, en https', () => {
    const platforms = buildOfficialPlatforms(
      {
        anilist: [
          ...SOLO_LEVELING,
          link('Disabled', 'https://old.example.com/x', 'English', { isDisabled: true }),
          link('Piège', 'javascript:alert(1)', 'English'),
          link('HTTP', 'http://insecure.example.com/x', 'English'),
        ],
        mangadexLinks: null,
        originalLanguage: 'ko',
      },
      'fr',
    )
    const names = platforms.map((platform) => platform.name)
    assert.ok(!names.includes('Yen Press'), 'page éditeur (INFO) écartée')
    assert.ok(!names.some((name) => ['Disabled', 'Piège', 'HTTP'].includes(name)))
    assert.ok(platforms.every((platform) => platform.url.startsWith('https://')))
  })

  it('ordre utile : langue de l’interface, puis l’autre (fr / en), puis l’originale ; autres langues écartées', () => {
    const sources = { anilist: SOLO_LEVELING, mangadexLinks: null, originalLanguage: 'ko' }
    const fr = buildOfficialPlatforms(sources, 'fr')
    assert.deepEqual(
      fr.map((platform) => [platform.name, platform.language]),
      [['Lezhin', 'fr'], ['ONO', 'fr'], ['Webnovel', 'en'], ['Tappytoon', 'en'], ['KakaoPage', 'ko']],
    )
    // Thaï, allemand, et japonais (qui n'est pas la langue d'origine d'un manhwa) : absents.
    assert.equal(fr.some((platform) => ['th', 'de', 'ja'].includes(platform.language ?? '')), false)
    assert.deepEqual(buildOfficialPlatforms(sources, 'en').slice(0, 2).map((platform) => platform.name), ['Webnovel', 'Tappytoon'])
  })

  it('logo et couleur conservés s’ils sont valides', () => {
    const [first] = buildOfficialPlatforms(
      { anilist: [link('K MANGA', 'https://kmanga.kodansha.com/title/10136', 'English', { color: 'red', icon: 'http://x/icon.png' })], mangadexLinks: null, originalLanguage: 'ja' },
      'en',
    )
    assert.equal(first?.color, undefined, 'couleur non hexadécimale écartée')
    assert.equal(first?.logo, undefined, 'icône non https écartée')
  })

  it('MangaDex complète AniList (éditeur d’origine, édition anglaise), sans doublon', () => {
    const platforms = buildOfficialPlatforms(
      {
        anilist: [link('KakaoPage', 'https://page.kakao.com/content/50866481', 'Korean')],
        // Même page que le lien AniList, écrite avec un « / » final : une seule fois.
        mangadexLinks: { al: '105398', raw: 'https://page.kakao.com/content/50866481/', engtl: 'https://www.viz.com/solo' },
        originalLanguage: 'ko',
      },
      'fr',
    )
    assert.deepEqual(platforms.map((platform) => [platform.name, platform.language]), [['VIZ', 'en'], ['KakaoPage', 'ko']])
  })

  it('sans AniList : les liens MangaDex seuls, nommés d’après la plateforme', () => {
    const platforms = buildOfficialPlatforms(
      { anilist: [], mangadexLinks: { raw: 'https://pocket.shonenmagazine.com/episode/139' }, originalLanguage: 'ja' },
      'fr',
    )
    assert.deepEqual(platforms, [{ name: 'Pocket Magazine', url: 'https://pocket.shonenmagazine.com/episode/139', language: 'ja' }])
  })

  it('borné à MAX_PLATFORMS', () => {
    const many = Array.from({ length: 20 }, (_, index) => link(`P${index}`, `https://p${index}.example.com/`, 'English'))
    assert.equal(buildOfficialPlatforms({ anilist: many, mangadexLinks: null, originalLanguage: 'ja' }, 'en').length, MAX_PLATFORMS)
  })

  it('outils', () => {
    assert.equal(languageCode('French'), 'fr')
    assert.equal(languageCode('Klingon'), null)
    assert.equal(safeUrl('javascript:alert(1)'), null)
    assert.equal(safeUrl('https://user:pw@example.com'), null)
    assert.equal(platformName('https://mangaplus.shueisha.co.jp/titles/100020'), 'MANGA Plus')
    assert.equal(platformName('https://www.unknown-site.example/x'), 'unknown-site.example')
  })
})

/* ---- Routes, de bout en bout -------------------------------------------------------------- */

const LICENSED = '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0'
const NO_ANILIST = '44444444-4444-4444-8444-444444444444'
let anilistCalls = 0

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const manga = (id: string, links: Record<string, string>, originalLanguage: string) => ({
  ...BILINGUAL,
  id,
  attributes: { ...BILINGUAL.attributes, links, originalLanguage },
})

extraMocks.push((url, init) => {
  if (url.hostname === 'graphql.anilist.co') {
    anilistCalls += 1
    const { variables } = JSON.parse(String(init?.body)) as { variables: { id: number } }
    return variables.id === 105398
      ? json({ data: { Media: { externalLinks: SOLO_LEVELING } } })
      : json({ data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] }, 404)
  }
  if (url.hostname !== 'api.mangadex.org') return undefined
  if (url.pathname === `/manga/${LICENSED}`) return json({ result: 'ok', data: manga(LICENSED, { al: '105398', raw: 'https://page.kakao.com/content/50866481' }, 'ko') })
  if (url.pathname === `/manga/${NO_ANILIST}`) return json({ result: 'ok', data: manga(NO_ANILIST, { raw: 'https://mangaplus.shueisha.co.jp/titles/100020' }, 'ja') })
  // Titre sous licence : aucun chapitre hébergé.
  if (/^\/manga\/[\w-]+\/feed$/.test(url.pathname)) return json({ result: 'ok', data: [], total: 0 })
  return undefined
})

describe('GET /api/manga/:id/platforms', () => {
  it('titre sous licence : les plateformes officielles, dans la langue demandée', async () => {
    const res = await client().request('GET', `/manga/${LICENSED}/platforms?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.platforms.slice(0, 2).map((platform: { name: string }) => platform.name), ['Lezhin', 'ONO'])
    assert.ok(res.body.platforms.every((platform: { url: string }) => platform.url.startsWith('https://')))
  })

  it('mis en cache : l’autre langue ne rappelle pas AniList', async () => {
    const before = anilistCalls
    const res = await client().request('GET', `/manga/${LICENSED}/platforms?lang=en`)
    assert.equal(res.body.platforms[0].language, 'en')
    assert.equal(anilistCalls, before)
  })

  it('œuvre AniList seule (al-<id>) acceptée', async () => {
    const res = await client().request('GET', '/manga/al-105398/platforms?lang=en')
    assert.equal(res.status, 200)
    assert.ok(res.body.platforms.length > 0)
  })

  it('sans lien AniList : repli sur les liens MangaDex', async () => {
    const res = await client().request('GET', `/manga/${NO_ANILIST}/platforms?lang=fr`)
    assert.deepEqual(res.body.platforms, [{ name: 'MANGA Plus', url: 'https://mangaplus.shueisha.co.jp/titles/100020', language: 'ja' }])
  })

  it('identifiant invalide → 400 ; AniList inconnu → liste vide, pas d’erreur', async () => {
    assert.equal((await client().request('GET', '/manga/nope/platforms')).status, 400)
    const res = await client().request('GET', '/manga/al-1/platforms')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.platforms, [])
  })
})

describe('GET /api/manga/:id/chapters — titre sous licence', () => {
  it('0 chapitre, mais les plateformes officielles dans la réponse', async () => {
    const res = await client().request('GET', `/manga/${LICENSED}/chapters?lang=fr`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.chapters, [])
    assert.equal(res.body.officialPlatforms[0].name, 'Lezhin')
  })
})
