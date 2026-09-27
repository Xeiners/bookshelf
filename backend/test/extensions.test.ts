/**
 * Architecture des sources (src/extensions/) — tests unitaires, sans serveur :
 * moteur de fusion, disjoncteur, agrégateur (isolation des pannes, repli),
 * identifiants publics, rapprochement par titre et garde-fous du relais.
 * Aucun de ces modules ne lit `config` : importables tels quels.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SourceAggregatorService, type AggregatorOptions } from '../src/extensions/aggregator.js'
import { decodeChapterKey, encodeChapterKey, isChapterKey } from '../src/extensions/chapterKey.js'
import { CircuitBreaker } from '../src/extensions/circuitBreaker.js'
import { canonicalNumber, mergeChapters } from '../src/extensions/merge.js'
import { createConsumetProvider, normalizeConsumetChapter } from '../src/extensions/providers/consumet.provider.js'
import { normalizeOpenComicChapter, OpenComicChapterSchema } from '../src/extensions/providers/openComicStream.provider.js'
import { SourceRegistry } from '../src/extensions/registry.js'
import {
  bestTitleMatch,
  cleanTitle,
  findTitleMatch,
  levenshtein,
  MATCH_THRESHOLD,
  normalizeTitle,
  searchQueries,
  titleSimilarity,
} from '../src/extensions/titleMatch.js'
import type { NormalizedChapter, NormalizedPage, SourcedChapter, SourceProvider } from '../src/extensions/types.js'
import { notFound, upstreamError } from '../src/lib/errors.js'
import { assertPublicUrl, isPrivateAddress, network, upstreamHeaders } from '../src/modules/proxy/proxy.fetch.js'

/* ---- Fabriques ------------------------------------------------------------------ */

const chapter = (id: string, number: string | null, extra: Partial<NormalizedChapter> = {}): NormalizedChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'fr',
  pages: 10,
  groups: [],
  publishedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
})

const sourced = (sourceId: string, id: string, number: string | null, extra: Partial<NormalizedChapter> = {}): SourcedChapter => ({
  ...chapter(id, number, extra),
  source: { id: sourceId, name: sourceId },
})

const PRIORITY: Record<string, number> = { mangadex: 100, opencomic: 50, consumet: 30, twin: 30 }
const priorityOf = (id: string) => PRIORITY[id] ?? 0

const pagesOf = (count: number, prefix = 'https://img.example.test/p'): NormalizedPage[] =>
  Array.from({ length: count }, (_, index) => ({ index, url: `${prefix}${index}.jpg`, headers: { Referer: 'https://src.example.test/' } }))

function provider(id: string, overrides: Partial<SourceProvider> = {}): SourceProvider {
  return {
    id,
    name: id.toUpperCase(),
    baseUrl: `https://${id}.example.test`,
    supportedLanguages: ['fr', 'en'],
    priority: priorityOf(id),
    timeoutMs: 200,
    fetchChapterList: async () => [],
    fetchPageUrls: async () => pagesOf(2),
    ...overrides,
  }
}

function aggregator(providers: SourceProvider[], options: Partial<AggregatorOptions> = {}) {
  const registry = new SourceRegistry()
  for (const item of providers) registry.register(item)
  return new SourceAggregatorService(registry, {
    relayUrl: (key, index, { count, alternates }) => `/relay/${key}/${index}?n=${count}&alt=${alternates.join(',')}`,
    breaker: { failureThreshold: 2, cooldownMs: 60_000 },
    ...options,
  })
}

const UUID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/* ---- Moteur de fusion ------------------------------------------------------------ */

describe('fusion — dédoublonnage par numéro et langue', () => {
  it('un chapitre publié par deux sources : la plus prioritaire fournit la version, l’autre devient une alternative', () => {
    const merged = mergeChapters([sourced('consumet', 'c-5', '5'), sourced('mangadex', 'm-5', '5')], priorityOf)
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.source.id, 'mangadex')
    assert.deepEqual(merged[0]?.alternates.map((alt) => alt.id), ['c-5'])
  })

  it('même numéro, langues différentes : jamais fusionnés', () => {
    const merged = mergeChapters([sourced('mangadex', 'fr-1', '1'), sourced('consumet', 'en-1', '1', { language: 'en' })], priorityOf)
    assert.equal(merged.length, 2)
    assert.ok(merged.every((item) => item.alternates.length === 0))
  })

  it('numéros écrits différemment (« 012 », « 12.0 », « 12.50 ») : même clé', () => {
    assert.equal(canonicalNumber('012'), '12')
    assert.equal(canonicalNumber(' 12.50 '), '12.5')
    assert.equal(canonicalNumber('Extra'), 'Extra')
    assert.equal(canonicalNumber('  '), null)
    const merged = mergeChapters([sourced('mangadex', 'm', '12'), sourced('consumet', 'c', '012'), sourced('opencomic', 'o', '12.0')], priorityOf)
    assert.equal(merged.length, 1)
    assert.deepEqual(merged[0]?.alternates.map((alt) => alt.source.id), ['opencomic', 'consumet'])
  })

  it('la source gagnante garde toutes ses versions (plusieurs équipes), chacune avec les alternatives', () => {
    const merged = mergeChapters(
      [
        sourced('mangadex', 'team-a', '3', { groups: [{ id: 'a', name: 'A' }] }),
        sourced('mangadex', 'team-b', '3', { groups: [{ id: 'b', name: 'B' }] }),
        sourced('consumet', 'c-3', '3'),
        sourced('consumet', 'c-3-bis', '3', { pages: 0 }),
      ],
      priorityOf,
    )
    assert.deepEqual(merged.map((item) => item.id).sort(), ['team-a', 'team-b'])
    // Une seule alternative par source : sa version la plus complète.
    for (const item of merged) assert.deepEqual(item.alternates.map((alt) => alt.id), ['c-3'])
  })

  it('à priorité égale, la version la plus complète l’emporte (pages connues, équipe, titre)', () => {
    const merged = mergeChapters(
      [sourced('consumet', 'poor', '7', { pages: 0 }), sourced('twin', 'rich', '7', { groups: [{ id: 'g', name: 'G' }], title: 'Titre' })],
      priorityOf,
    )
    assert.equal(merged[0]?.id, 'rich')
  })

  it('les one-shots (sans numéro) ne sont jamais fusionnés entre eux', () => {
    const merged = mergeChapters([sourced('mangadex', 'os-1', null), sourced('consumet', 'os-2', null)], priorityOf)
    assert.equal(merged.length, 2)
  })

  it('tri déterministe : l’ordre d’arrivée des réponses ne change rien', () => {
    const input = [
      sourced('consumet', 'c-2', '2'),
      sourced('mangadex', 'm-10', '10'),
      sourced('opencomic', 'o-1', '1'),
      sourced('mangadex', 'm-2', '2'),
      sourced('consumet', 'c-9', '9'),
      sourced('opencomic', 'o-os', null),
      sourced('twin', 't-9', '9'),
    ]
    const expected = mergeChapters(input, priorityOf)
    assert.deepEqual(expected.map((item) => item.number), [null, '1', '2', '9', '10'])
    for (let shift = 1; shift < input.length; shift += 1) {
      const rotated = [...input.slice(shift), ...input.slice(0, shift)]
      assert.deepEqual(mergeChapters(rotated, priorityOf), expected)
      assert.deepEqual(mergeChapters([...rotated].reverse(), priorityOf), expected)
    }
  })
})

/* ---- Disjoncteur ---------------------------------------------------------------------- */

describe('disjoncteur (circuit breaker)', () => {
  it('s’ouvre après N échecs consécutifs, puis laisse passer UN essai après le délai', () => {
    let now = 0
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1_000, now: () => now })
    assert.equal(breaker.tryAcquire(), true)
    breaker.recordFailure()
    assert.equal(breaker.state, 'closed')
    breaker.recordFailure()
    assert.equal(breaker.state, 'open')
    assert.equal(breaker.tryAcquire(), false)

    now = 1_000
    assert.equal(breaker.state, 'half-open')
    assert.equal(breaker.tryAcquire(), true)
    assert.equal(breaker.tryAcquire(), false, 'un seul essai à la fois en demi-ouvert')
  })

  it('essai réussi → refermé ; essai raté → rouvert pour un nouveau délai', () => {
    let now = 0
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, now: () => now })
    breaker.recordFailure()
    now = 1_000
    breaker.tryAcquire()
    breaker.recordFailure()
    assert.equal(breaker.state, 'open')
    now = 2_000
    breaker.tryAcquire()
    breaker.recordSuccess()
    assert.equal(breaker.state, 'closed')
  })

  it('un succès remet le compteur d’échecs à zéro', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 })
    breaker.recordFailure()
    breaker.recordSuccess()
    breaker.recordFailure()
    assert.equal(breaker.state, 'closed')
  })
})

/* ---- Agrégateur : liste des chapitres --------------------------------------------------------- */

describe('agrégateur — isolation des pannes', () => {
  it('une source qui plante, une qui change de format, une qui répond : le catalogue reste servi', async () => {
    const service = aggregator([
      provider('mangadex', { selfRelayed: true, fetchChapterList: async () => [chapter(UUID(1), '1')] }),
      provider('opencomic', {
        fetchChapterList: async () => {
          throw new TypeError('Cannot read properties of undefined')
        },
      }),
      provider('consumet', {
        fetchChapterList: async () => {
          throw upstreamError('Consumet : format de réponse inattendu')
        },
      }),
    ])
    const result = await service.fetchChapterList('manga')
    assert.deepEqual(result.chapters.map((item) => item.id), [UUID(1)])
    assert.deepEqual(
      result.sources.map((source) => [source.id, source.status, source.chapters]),
      [['mangadex', 'ok', 1], ['opencomic', 'failed', 0], ['consumet', 'failed', 0]],
    )
    assert.equal(result.partial, true)
  })

  it('une source qui ne répond jamais est abandonnée à son délai, sans bloquer les autres', async () => {
    const service = aggregator([
      provider('mangadex', { selfRelayed: true, fetchChapterList: async () => [chapter(UUID(1), '1')] }),
      provider('consumet', { timeoutMs: 50, fetchChapterList: () => new Promise(() => {}) }),
    ])
    const started = Date.now()
    const result = await service.fetchChapterList('manga')
    assert.ok(Date.now() - started < 1_000)
    const consumet = result.sources.find((source) => source.id === 'consumet')
    // Distinct d'une erreur : la métadonnée dit « timeout », avec la durée et la raison.
    assert.equal(consumet?.status, 'timeout')
    assert.ok((consumet?.durationMs ?? 0) >= 40)
    assert.match(consumet?.error ?? '', /délai/)
    assert.equal(result.chapters.length, 1)
  })

  it('toutes les sources en échec : l’erreur de la source principale remonte (404 compris)', async () => {
    const lost = aggregator([
      provider('mangadex', { selfRelayed: true, fetchChapterList: async () => Promise.reject(notFound('Titre introuvable')) }),
      provider('consumet', { fetchChapterList: async () => Promise.reject(new Error('boom')) }),
    ])
    await assert.rejects(lost.fetchChapterList('x'), { status: 404 })

    const down = aggregator([provider('consumet', { fetchChapterList: async () => Promise.reject(new Error('boom')) })])
    await assert.rejects(down.fetchChapterList('x'), { status: 502 })
  })

  it('circuit ouvert après des échecs répétés : la source n’est plus appelée (statut « skipped »)', async () => {
    let calls = 0
    const service = aggregator([
      provider('mangadex', { selfRelayed: true, fetchChapterList: async () => [chapter(UUID(1), '1')] }),
      provider('consumet', {
        fetchChapterList: async () => {
          calls += 1
          throw new Error('panne')
        },
      }),
    ])
    await service.fetchChapterList('a')
    await service.fetchChapterList('b')
    const third = await service.fetchChapterList('c')
    assert.equal(calls, 2)
    assert.equal(third.sources.find((source) => source.id === 'consumet')?.status, 'skipped')
  })

  it('un 404 (titre absent de la source) n’ouvre pas le circuit', async () => {
    let calls = 0
    const service = aggregator([
      provider('mangadex', { selfRelayed: true, fetchChapterList: async () => [chapter(UUID(1), '1')] }),
      provider('consumet', {
        fetchChapterList: async () => {
          calls += 1
          throw notFound()
        },
      }),
    ])
    for (const id of ['a', 'b', 'c']) await service.fetchChapterList(id)
    assert.equal(calls, 3)
  })

  it('alias résolus une seule fois, et seulement si une source cherche par titre', async () => {
    let resolutions = 0
    const received: string[][] = []
    const resolveAliases = async () => {
      resolutions += 1
      return ['The Blade Road']
    }
    const byTitle = (id: string) =>
      provider(id, {
        usesAliases: true,
        fetchChapterList: async (_mangaId, aliases) => {
          received.push(aliases)
          return []
        },
      })

    await aggregator([provider('mangadex', { selfRelayed: true })], { resolveAliases }).fetchChapterList('m')
    assert.equal(resolutions, 0)

    await aggregator([byTitle('opencomic'), byTitle('consumet')], { resolveAliases }).fetchChapterList('m')
    assert.equal(resolutions, 1)
    assert.deepEqual(received, [['The Blade Road'], ['The Blade Road']])
  })

  it('alias introuvables : les sources par titre reçoivent une liste vide, sans échec', async () => {
    const service = aggregator(
      [provider('consumet', { usesAliases: true, fetchChapterList: async (_id, aliases) => aliases.map((alias) => chapter(alias, '1')) })],
      { resolveAliases: () => Promise.reject(new Error('MangaDex en panne')) },
    )
    const result = await service.fetchChapterList('m')
    assert.equal(result.sources[0]?.status, 'ok')
    assert.equal(result.chapters.length, 0)
  })

  it('identifiants publics et provenance ; langues hors contrat écartées', async () => {
    const service = aggregator([
      provider('consumet', {
        supportedLanguages: ['en'],
        fetchChapterList: async () => [
          chapter('series/chapter-1', '1', { language: 'en' }),
          chapter('fr-hors-contrat', '2', { language: 'fr' }),
          chapter('', '3', { language: 'en' }),
        ],
      }),
    ])
    const { chapters } = await service.fetchChapterList('m')
    assert.equal(chapters.length, 1)
    assert.equal(chapters[0]?.id, encodeChapterKey('consumet', 'series/chapter-1'))
    assert.deepEqual(chapters[0]?.source, { id: 'consumet', name: 'CONSUMET' })
  })
})

/* ---- Agrégateur : pages et repli ---------------------------------------------------------------- */

describe('agrégateur — pages et repli automatique', () => {
  const OC = encodeChapterKey('opencomic', 'oc-1')
  const CS = encodeChapterKey('consumet', 'cs-1')

  it('source principale en panne : la version d’une autre source est servie (fallback)', async () => {
    const service = aggregator([
      provider('opencomic', { fetchPageUrls: async () => Promise.reject(new Error('timeout')) }),
      provider('consumet', { fetchPageUrls: async () => pagesOf(3) }),
    ])
    const served = await service.fetchPages(OC, 'data', [CS])
    assert.equal(served.chapterId, CS)
    assert.equal(served.fallback, true)
    assert.deepEqual(served.source, { id: 'consumet', name: 'CONSUMET' })
    // URL relayées, jamais l'URL amont ; le compte de pages voyage avec.
    assert.equal(served.pages[0]?.url, `/relay/${CS}/0?n=3&alt=${OC}`)
    assert.equal(served.pages[0]?.fallbackUrl, null)
  })

  it('chapitre vide chez la source (flux partiel) : repli aussi', async () => {
    const service = aggregator([
      provider('opencomic', { fetchPageUrls: async () => [] }),
      provider('consumet', { fetchPageUrls: async () => pagesOf(1) }),
    ])
    assert.equal((await service.fetchPages(OC, 'data', [CS])).chapterId, CS)
  })

  it('source qui relaie ses pages (MangaDex) : URL et repli qualité transmis tels quels', async () => {
    const service = aggregator([
      provider('mangadex', {
        selfRelayed: true,
        fetchPageUrls: async (id, { quality }) => [{ index: 0, url: `/api/chapters/${id}/image/${quality}/a.png`, fallbackUrl: '/saver.jpg' }],
      }),
    ])
    const served = await service.fetchPages(UUID(4), 'data-saver')
    assert.deepEqual(served.pages, [{ index: 0, url: `/api/chapters/${UUID(4)}/image/data-saver/a.png`, fallbackUrl: '/saver.jpg' }])
    assert.equal(served.fallback, false)
  })

  it('aucune version disponible : erreur explicite ; source inconnue : 404', async () => {
    const service = aggregator([provider('opencomic', { fetchPageUrls: async () => Promise.reject(new Error('down')) })])
    await assert.rejects(service.fetchPages(OC, 'data', [CS]), { status: 502 })
    await assert.rejects(service.fetchPages(encodeChapterKey('inconnue', 'x'), 'data'), { status: 404 })
  })

  it('le relais retrouve la page amont sans rappeler la source, et oublie sur demande', async () => {
    let calls = 0
    const service = aggregator([
      provider('opencomic', {
        fetchPageUrls: async () => {
          calls += 1
          return pagesOf(2)
        },
      }),
    ])
    await service.fetchPages(OC, 'data')
    const resolved = await service.resolvePage(OC, 1)
    assert.equal(resolved.page.url, 'https://img.example.test/p1.jpg')
    assert.equal(resolved.count, 2)
    assert.equal(calls, 1)
    service.forgetPages(OC)
    await service.resolvePage(OC, 0)
    assert.equal(calls, 2)
    await assert.rejects(service.resolvePage(OC, 9), { status: 404 })
  })

  it('le relais générique refuse les sources qui relaient elles-mêmes', async () => {
    const service = aggregator([provider('mangadex', { selfRelayed: true })])
    await assert.rejects(service.resolvePage(UUID(1), 0), { status: 404 })
  })
})

describe('registre des sources', () => {
  it('refuse un identifiant invalide, un doublon, et un faux « mangadex »', () => {
    const registry = new SourceRegistry().register(provider('consumet'))
    assert.throws(() => registry.register(provider('consumet')))
    assert.throws(() => registry.register(provider('Bad_Id')))
    assert.throws(() => registry.register(provider('mangadex')))
  })

  it('liste par priorité décroissante', () => {
    const registry = new SourceRegistry()
      .register(provider('consumet'))
      .register(provider('mangadex', { selfRelayed: true }))
      .register(provider('opencomic'))
    assert.deepEqual(registry.list().map((item) => item.id), ['mangadex', 'opencomic', 'consumet'])
  })
})

/* ---- Identifiants publics ---------------------------------------------------------------------------- */

describe('identifiants de chapitre publics', () => {
  it('MangaDex garde son UUID nu (positions et caches existants intacts)', () => {
    assert.equal(encodeChapterKey('mangadex', UUID(1)), UUID(1))
    assert.deepEqual(decodeChapterKey(UUID(1)), { sourceId: 'mangadex', rawId: UUID(1) })
  })

  it('autres sources : aller-retour exact, même avec des « / » et des accents', () => {
    const raw = 'séries/one-piece/chapitre-1?x=1'
    const key = encodeChapterKey('consumet', raw)
    assert.match(key, /^consumet~[\w-]+$/)
    assert.deepEqual(decodeChapterKey(key), { sourceId: 'consumet', rawId: raw })
  })

  it('refuse le reste', () => {
    for (const value of ['', 'nope', 'mangadex~YWJj', 'x~YWJj', 'consumet~', 'consumet~a/b', '../etc/passwd']) {
      assert.equal(isChapterKey(value), false, value)
    }
  })
})

/* ---- Rapprochement par titre ---------------------------------------------------------------------------- */

describe('rapprochement par titre', () => {
  it('ignore casse, accents et ponctuation', () => {
    assert.equal(normalizeTitle('  L’Épée — du  Roi ! '), 'l epee du roi')
    assert.equal(cleanTitle('Re:Zero — Starting Life'), 'Re Zero Starting Life')
  })

  it('requêtes multi-noms : latins d’abord, variante nettoyée, sans doublon, bornées', () => {
    const queries = searchQueries(['進撃の巨人', 'Attack on Titan', 'Shingeki no Kyojin', "L'Attaque des Titans", 'attack on titan'], 5)
    assert.deepEqual(queries, ['Attack on Titan', 'Shingeki no Kyojin', "L'Attaque des Titans", 'L Attaque des Titans', '進撃の巨人'])
    assert.equal(searchQueries(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echoes']).length, 4)
    // Même titre à la ponctuation près : une seule fois ; sigle trop court : jamais cherché.
    assert.deepEqual(searchQueries(['Pick Me Up', 'Pick Me Up!', 'SnK', 'Pick Me Up, Infinite Gacha']), ['Pick Me Up', 'Pick Me Up, Infinite Gacha', 'Pick Me Up Infinite Gacha'])
    assert.deepEqual(searchQueries([]), [])
  })

  it('Levenshtein', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3)
    assert.equal(levenshtein('', 'abc'), 3)
    assert.equal(levenshtein('same', 'same'), 0)
  })

  it('similarité floue : variantes d’écriture acceptées (≥ 80 %)', () => {
    assert.equal(titleSimilarity('Attack on Titan', 'ATTACK ON TITAN!'), 1)
    assert.ok(titleSimilarity('Shingeki no Kyojin', 'Shingeki no Kyoujin') >= MATCH_THRESHOLD)
    assert.ok(titleSimilarity('Pick Me Up', 'Pick Me Up!!') >= MATCH_THRESHOLD)
    assert.ok(titleSimilarity('Solo Leveling', 'Sollo Leveling') >= MATCH_THRESHOLD)
  })

  it('suites et spin-offs refusés : nombres différents, ou titre trop éloigné', () => {
    assert.equal(titleSimilarity('The Blade Road', 'The Blade Road 2'), 0)
    assert.equal(titleSimilarity('Kingdom Season 3', 'Kingdom Season 4'), 0)
    assert.ok(titleSimilarity('Solo Leveling', 'Solo Leveling: Ragnarok') < MATCH_THRESHOLD)
    assert.ok(titleSimilarity('Pick Me Up', 'Pick Me Up, Infinite Gacha') < MATCH_THRESHOLD)
  })

  it('meilleur candidat au-dessus du seuil ; l’exact l’emporte sur le proche', () => {
    const results = [{ title: 'Solo Leveling: Ragnarok' }, { title: 'Sollo Leveling' }, { title: 'solo leveling' }]
    const match = bestTitleMatch(results, ['Solo Leveling'], (item) => [item.title])
    assert.equal(match?.candidate, results[2])
    assert.equal(match?.score, 1)
    assert.equal(findTitleMatch(results.slice(0, 2), ['Solo Leveling'], (item) => [item.title]), results[1])
    assert.equal(findTitleMatch([results[0]!], ['Solo Leveling'], (item) => [item.title]), null)
    assert.equal(findTitleMatch(results, [], (item) => [item.title]), null)
  })
})

describe('Consumet — recherche multi-noms et journaux', () => {
  it('essaie les titres suivants, retient un résultat proche, ignore la suite, et journalise chaque étape', async () => {
    const calls: string[] = []
    const logs: string[] = []
    const realFetch = globalThis.fetch
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      calls.push(decodeURIComponent(url.pathname + url.search))
      if (url.pathname.endsWith('/info')) return reply({ chapters: [{ id: 'aot/1', chapterNumber: '1' }, { id: 'aot/2', title: 'Chapter 2' }] })
      // 1ʳᵉ recherche : rien ; 2ᵉ : la suite AVANT l'œuvre, écrite un peu autrement.
      if (decodeURIComponent(url.pathname).endsWith('/Attack on Titan')) return reply({ results: [] })
      return reply({ results: [{ id: 'aot-2', title: 'Shingeki no Kyojin 2' }, { id: 'aot', title: 'Shingeki no Kyoujin' }] })
    }
    try {
      const provider = createConsumetProvider({
        baseUrl: 'https://consumet.example.test',
        provider: 'mangapill',
        language: 'en',
        userAgent: 'Bookshelf-test',
        log: (message) => logs.push(message),
      })
      const chapters = await provider.fetchChapterList('manga-aot', ['Attack on Titan', 'Shingeki no Kyojin'])
      assert.deepEqual(chapters.map((chapter) => chapter.number), ['1', '2'])
      assert.deepEqual(calls, ['/manga/mangapill/Attack on Titan', '/manga/mangapill/Shingeki no Kyojin', '/manga/mangapill/info?id=aot'])
      assert.match(logs[0] ?? '', /Search query: "Attack on Titan" -> 0 résultat/)
      assert.match(logs[1] ?? '', /Search query: "Shingeki no Kyojin" -> 2 résultat\(s\), retenu « Shingeki no Kyoujin »/)
      assert.match(logs[2] ?? '', /2 chapitre/)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('HTTP 403 : journalisé avec la route en cause, et la source passe en échec', async () => {
    const logs: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('blocked', { status: 403, statusText: 'Forbidden' })
    try {
      const provider = createConsumetProvider({
        baseUrl: 'https://consumet.example.test',
        provider: 'mangapill',
        language: 'en',
        userAgent: 'Bookshelf-test',
        log: (message) => logs.push(message),
      })
      await assert.rejects(provider.fetchChapterList('manga-x', ['Pick Me Up']), { status: 502 })
      assert.deepEqual(logs, ['HTTP 403 Forbidden sur search'])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

/* ---- Normalisation des sources externes ------------------------------------------------------------------ */

describe('normalisation Consumet / OpenComicStream', () => {
  it('Consumet : numéro déduit du titre, titre redondant retiré, date invalide neutralisée', () => {
    const normalized = normalizeConsumetChapter({ id: 's/c-12', title: 'Chapter 12.5', releaseDate: 'hier' }, 'en')
    assert.equal(normalized.number, '12.5')
    assert.equal(normalized.title, null)
    assert.equal(normalized.publishedAt, new Date(0).toISOString())
    assert.equal(normalizeConsumetChapter({ id: 'x', chapterNumber: '3', title: 'Le retour du roi' }, 'fr').title, 'Le retour du roi')
  })

  it('OpenComicStream : langue ramenée à fr / en, autres langues écartées, équipes normalisées', () => {
    const parse = (raw: unknown) => normalizeOpenComicChapter(OpenComicChapterSchema.parse(raw))
    const normalized = parse({ id: 7, number: 2, language: 'fr-FR', groups: ['Team', { name: 'Autre' }] })
    assert.equal(normalized?.id, '7')
    assert.equal(normalized?.number, '2')
    assert.equal(normalized?.language, 'fr')
    assert.deepEqual(normalized?.groups, [{ id: 'Team', name: 'Team' }, { id: 'Autre', name: 'Autre' }])
    assert.equal(parse({ id: 'x', language: 'de' }), null)
    assert.throws(() => parse({ number: 1, language: 'fr' }), 'identifiant manquant : format rejeté')
  })
})

/* ---- Garde-fous du relais d'images ------------------------------------------------------------------------ */

describe('relais d’images — garde-fous', () => {
  it('reconnaît les adresses internes, IPv4 et IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      assert.equal(isPrivateAddress(address), true, address)
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:5db8:d822']) {
      assert.equal(isPrivateAddress(address), false, address)
    }
  })

  it('refuse protocoles exotiques, identifiants, hôtes internes et noms qui résolvent en interne', async () => {
    const realLookup = network.lookup
    network.lookup = async (host) => (host === 'rebind.example.test' ? ['10.0.0.8'] : ['93.184.216.34'])
    try {
      for (const url of [
        'file:///etc/passwd',
        'ftp://img.example.test/a.jpg',
        'https://user:pass@img.example.test/a.jpg',
        'http://localhost/a.jpg',
        'http://bookshelf-api:5000/api/health',
        'http://127.0.0.1/a.jpg',
        'http://[::1]/a.jpg',
        'http://169.254.169.254/latest/meta-data',
        'https://printer.local/a.jpg',
        'https://rebind.example.test/a.jpg',
      ]) {
        await assert.rejects(assertPublicUrl(url), undefined, url)
      }
      assert.equal((await assertPublicUrl('https://img.example.test/a.jpg')).hostname, 'img.example.test')
    } finally {
      network.lookup = realLookup
    }
  })

  it('ne transmet que les en-têtes de provenance', () => {
    const headers = upstreamHeaders(
      { referer: 'https://src.example.test/', 'User-Agent': 'Custom/1.0', Cookie: 'session=1', Authorization: 'Bearer x', Origin: 'https://evil\r\nX-Injected: 1' },
      'Bookshelf/0.1',
    )
    assert.equal(headers.Referer, 'https://src.example.test/')
    assert.equal(headers['User-Agent'], 'Custom/1.0')
    assert.equal(headers.Origin, undefined)
    assert.equal(Object.keys(headers).some((name) => /cookie|authorization/i.test(name)), false)
  })
})
