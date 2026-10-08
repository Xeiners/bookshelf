/**
 * Série 3 — « Personnages » : classement MyAnimeList (Jikan simulé), raretés selon le rang,
 * ajout des œuvres, portraits relayés et agrandis, série ouvrable dans les boosters.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
import { extraMocks, installMangadexMock, mockedHosts, prepareEnvironment, startServer } from './harness.js'

prepareEnvironment('series3')
installMangadexMock()

const PORTRAIT = await sharp({ create: { width: 225, height: 350, channels: 3, background: { r: 30, g: 120, b: 220 } } }).jpeg().toBuffer()
const calls = { pages: 0, full: 0 }
mockedHosts.add('api.jikan.moe')
mockedHosts.add('cdn.myanimelist.net')
extraMocks.push((url) => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  if (url.hostname === 'api.jikan.moe' && url.pathname === '/v4/top/characters') {
    calls.pages += 1
    const page = Number(url.searchParams.get('page'))
    // 25 personnages par page ; le 7e de chaque page n'a pas de portrait (« questionmark »).
    const data = Array.from({ length: 25 }, (_, index) => {
      const malId = (page - 1) * 25 + index + 1
      const image = index === 6 ? 'https://cdn.myanimelist.net/images/questionmark_23.gif' : `https://cdn.myanimelist.net/images/characters/1/${malId}.jpg`
      return { mal_id: malId, name: `Nom${malId}, Prénom${malId}`, favorites: 200_000 - malId, images: { jpg: { image_url: image } } }
    })
    return json({ data, pagination: { has_next_page: page < 80 } })
  }
  const full = /^\/v4\/characters\/(\d+)\/full$/.exec(url.pathname)
  if (url.hostname === 'api.jikan.moe' && full) {
    calls.full += 1
    return json({ data: { anime: [{ role: 'Supporting', anime: { title: 'Autre' } }, { role: 'Main', anime: { title: `Œuvre ${full[1]}` } }], manga: [] } })
  }
  if (url.hostname === 'cdn.myanimelist.net') return new Response(new Uint8Array(PORTRAIT), { headers: { 'Content-Type': 'image/jpeg' } })
  return undefined
})

const { close, base } = await startServer()
after(close)
const { prisma } = await import('../src/db.js')
const series3 = await import('../src/modules/cards/series3.seed.js')
const logic = await import('../src/modules/cards/boosters.logic.js')

describe('série 3 — personnages', () => {
  it('logique : rang → rareté, noms remis dans l’ordre, œuvre principale', () => {
    assert.equal(series3.SERIES_3_SIZE, 1200)
    assert.equal(series3.SERIES_3_START_NUMBER, 601)
    assert.equal(series3.rarityForRank(0), 'MYTHIC')
    assert.equal(series3.rarityForRank(39), 'MYTHIC')
    assert.equal(series3.rarityForRank(40), 'LEGENDARY')
    assert.equal(series3.rarityForRank(119), 'LEGENDARY')
    assert.equal(series3.rarityForRank(120), 'EPIC')
    assert.equal(series3.rarityForRank(640), 'COMMON')
    assert.equal(series3.displayName('Lamperouge, Lelouch'), 'Lelouch Lamperouge')
    assert.equal(series3.displayName('Saitama'), 'Saitama')
    assert.equal(series3.mainWork({ anime: [{ role: 'Supporting', anime: { title: 'B' } }, { role: 'Main', anime: { title: 'A' } }] }), 'A')
    assert.equal(series3.mainWork({ anime: [], manga: [{ role: 'Main', manga: { title: 'M' } }] }), 'M')
    assert.deepEqual(logic.CARD_SERIES, [1, 2, 3])
    assert.equal(logic.chooseSeries([1, 2, 3], 3, () => 0), 3)
  })

  it('crée les 1 200 cartes dans l’ordre du classement, sans les personnages sans portrait', async () => {
    const result = await series3.seedSeries3({ pageDelayMs: 0 })
    assert.deepEqual(result, { inserted: 1200, total: 1200 })
    const cards = await prisma.card.findMany({ where: { series: 3 }, orderBy: { number: 'asc' } })
    assert.equal(cards.length, 1200)
    assert.equal(cards[0]!.number, 601)
    assert.equal(cards.at(-1)!.number, 1800)
    assert.equal(cards[0]!.name, 'Prénom1 Nom1')
    assert.equal(cards[0]!.characterName, 'Prénom1 Nom1')
    assert.equal(cards[0]!.rarity, 'MYTHIC')
    assert.equal(cards[0]!.imageUrl, '/api/cards/art/1')
    assert.equal(cards[0]!.mangaId, 'mal-character-1')
    assert.ok(!cards.some((card) => card.mangaId === 'mal-character-7'), 'sans portrait : écarté')
    for (const rarity of logic.RARITIES) assert.equal(cards.filter((card) => card.rarity === rarity).length, series3.SERIES_3_LAYOUT[rarity], rarity)
    // Relancer ne recrée rien (identités, numéros et raretés immuables).
    const pages = calls.pages
    assert.deepEqual(await series3.seedSeries3({ pageDelayMs: 0 }), { inserted: 0, total: 1200 })
    assert.equal(calls.pages, pages, 'série complète : Jikan n’est plus appelé')
  })

  it('ajoute l’œuvre principale de chaque personnage', async () => {
    const done = await series3.enrichSeries3({ delayMs: 0, limit: 5 })
    assert.equal(done, 5)
    const first = await prisma.card.findUnique({ where: { id: 's3_1' } })
    assert.equal(first!.mangaTitle, 'Œuvre 1')
  })

  it('relaie le portrait, agrandi et en WebP ; 404 pour un personnage inconnu', async () => {
    const response = await fetch(`${base}/cards/art/1`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/webp')
    const { width } = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    assert.equal(width, 450)
    assert.equal((await fetch(`${base}/cards/art/999999`)).status, 404)
  })
})
