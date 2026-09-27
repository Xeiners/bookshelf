import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readingOrder } from '../src/lib/reader/navigation'
import {
  applySourcePreference,
  chapterSources,
  creditedSources,
  ensureChapter,
  findChapter,
  isExtensionSource,
  isMultiSource,
  sourceOf,
  versionFrom,
} from '../src/lib/reader/sources'
import type { ReaderChapter, SourceStatus } from '../src/types/reader'

const MD = { id: 'mangadex', name: 'MangaDex' }
const CS = { id: 'consumet', name: 'Consumet' }
const OC = { id: 'opencomic', name: 'Source FR' }

const make = (id: string, number: string | null, source = MD, alternates: ReaderChapter[] = []): ReaderChapter => ({
  id,
  number,
  volume: null,
  title: null,
  language: 'fr',
  pages: 10,
  groups: [],
  publishedAt: '2024',
  source,
  alternates,
})

// Liste telle que l'API la fusionne : MangaDex principal, Consumet en repli sur 1 et 2 ; le 3 n'existe que chez Consumet.
const cs1 = make('cs-1', '1', CS)
const cs2 = make('cs-2', '2', CS)
const oc2 = make('oc-2', '2', OC)
const LIST = [make('md-1', '1', MD, [cs1]), make('md-2', '2', MD, [oc2, cs2]), make('cs-3', '3', CS)]

describe('sources — préférence de l’utilisateur', () => {
  it('sans préférence : la liste de l’API telle quelle', () => {
    assert.deepEqual(applySourcePreference(LIST, null), LIST)
  })

  it('source préférée : ses versions prennent la place principale, l’ancienne devient une alternative', () => {
    const preferred = applySourcePreference(LIST, 'consumet')
    assert.deepEqual(preferred.map((chapter) => chapter.id), ['cs-1', 'cs-2', 'cs-3'])
    assert.deepEqual(preferred[1]?.alternates?.map((alt) => alt.id), ['md-2', 'oc-2'])
    // L'alternative promue ne garde pas de copie d'elle-même.
    assert.equal(preferred[0]?.alternates?.some((alt) => alt.id === 'cs-1'), false)
  })

  it('chapitre absent de la source préférée : la version principale reste', () => {
    assert.deepEqual(applySourcePreference(LIST, 'opencomic').map((chapter) => chapter.id), ['md-1', 'oc-2', 'cs-3'])
  })

  it('plusieurs versions principales (équipes) partageant une alternative : promue une seule fois', () => {
    const shared = make('cs-5', '5', CS)
    const teams = [make('md-5a', '5', MD, [shared]), make('md-5b', '5', MD, [shared])]
    assert.deepEqual(applySourcePreference(teams, 'consumet').map((chapter) => chapter.id), ['cs-5'])
  })
})

describe('sources — chapitre ouvert chez une autre source', () => {
  it('retrouve une alternative par son id, avec les autres versions comme alternatives', () => {
    const found = findChapter(LIST, 'oc-2')
    assert.equal(found?.id, 'oc-2')
    assert.deepEqual(found?.alternates?.map((alt) => alt.id), ['md-2', 'cs-2'])
    assert.equal(findChapter(LIST, 'inconnu'), undefined)
    assert.equal(findChapter(LIST, null), undefined)
  })

  it('l’insère à la place de sa version principale : l’ordre de lecture le garde', () => {
    const withOpened = ensureChapter(LIST, 'oc-2')
    assert.deepEqual(withOpened.map((chapter) => chapter.id), ['md-1', 'md-2', 'oc-2', 'cs-3'])
    const order = readingOrder(withOpened, [], 'oc-2')
    assert.deepEqual(order.map((chapter) => chapter.id), ['md-1', 'oc-2', 'cs-3'])
    // Déjà version principale, ou inconnu : rien n'est inséré.
    assert.deepEqual(ensureChapter(LIST, 'md-1').map((chapter) => chapter.id), ['md-1', 'md-2', 'cs-3'])
    assert.deepEqual(ensureChapter(LIST, 'inconnu').map((chapter) => chapter.id), ['md-1', 'md-2', 'cs-3'])
  })
})

describe('sources — sélecteur et badges', () => {
  it('sources d’un chapitre, la sienne en premier, sans doublon', () => {
    assert.deepEqual(chapterSources(LIST[1]).map((source) => source.id), ['mangadex', 'opencomic', 'consumet'])
    assert.deepEqual(chapterSources(LIST[2]).map((source) => source.id), ['consumet'])
    assert.deepEqual(chapterSources(undefined), [])
  })

  it('version d’un chapitre chez une source donnée', () => {
    assert.equal(versionFrom(LIST[1]!, 'consumet')?.id, 'cs-2')
    assert.equal(versionFrom(LIST[1]!, 'mangadex')?.id, 'md-2')
    assert.equal(versionFrom(LIST[2]!, 'mangadex'), undefined)
  })

  it('copie hors-ligne d’avant les sources multiples : MangaDex par défaut', () => {
    const legacy = { ...make('old', '1'), source: undefined, alternates: undefined }
    assert.deepEqual(sourceOf(legacy), MD)
    assert.deepEqual(chapterSources(legacy), [MD])
  })

  it('badge seulement si plusieurs sources ont fourni des chapitres ; crédits en conséquence', () => {
    const status = (id: string, name: string, state: SourceStatus['status'], chapters: number): SourceStatus => ({ id, name, status: state, chapters })
    const single = [status('mangadex', 'MangaDex', 'ok', 12), status('consumet', 'Consumet', 'failed', 0)]
    const multi = [status('mangadex', 'MangaDex', 'ok', 12), status('consumet', 'Consumet', 'ok', 3)]
    assert.equal(isMultiSource(single), false)
    assert.equal(isMultiSource(multi), true)
    assert.equal(isMultiSource(undefined), false)
    assert.deepEqual(creditedSources(single), ['MangaDex'])
    assert.deepEqual(creditedSources(multi), ['MangaDex', 'Consumet'])
    assert.deepEqual(creditedSources(undefined), ['MangaDex'])
  })
})

describe('sources — sites des extensions Tachiyomi', () => {
  const ASURA = { id: 'tachiyomi:1001', name: 'Asura Scans' }
  const FLAME = { id: 'tachiyomi:3003', name: 'Flame Comics' }
  const list = [make('md-1', '1', MD, [make('as-1', '1', ASURA)]), make('fl-2', '2', FLAME, [make('as-2', '2', ASURA)])]
  const statuses: SourceStatus[] = [
    { id: 'mangadex', name: 'MangaDex', status: 'ok', chapters: 1 },
    { id: 'tachiyomi', name: 'Tachiyomi', status: 'ok', chapters: 3 },
  ]

  it('reconnaît le site d’une extension, pas les autres sources', () => {
    assert.equal(isExtensionSource(ASURA), true)
    assert.equal(isExtensionSource(MD), false)
    assert.equal(isExtensionSource({ id: 'tachiyomi', name: 'Tachiyomi' }), false)
  })

  it('crédite les sites présents dans la liste, pas le fournisseur « Tachiyomi »', () => {
    assert.deepEqual(creditedSources(statuses, list), ['MangaDex', 'Asura Scans', 'Flame Comics'])
    // Sans la liste (copie ancienne) : le nom du fournisseur, comme avant.
    assert.deepEqual(creditedSources(statuses), ['MangaDex', 'Tachiyomi'])
  })

  it('chaque site est une source à part : sélecteur et préférence par site', () => {
    assert.deepEqual(chapterSources(list[1]).map((source) => source.name), ['Flame Comics', 'Asura Scans'])
    const preferAsura = applySourcePreference(list, ASURA.id)
    assert.deepEqual(preferAsura.map((chapter) => chapter.id), ['as-1', 'as-2'])
    assert.equal(versionFrom(list[1]!, ASURA.id)?.id, 'as-2')
  })
})
