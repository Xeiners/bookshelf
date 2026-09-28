import { prisma } from '../../db.js'
import { getPool, loadDocuments, type CatalogItem } from '../../services/catalog.service.js'
import { normalizeManga } from '../manga/normalize.js'
import { SET_LAYOUT, SET_SIZE, assignRarities, prestige, remainingQuotas, type Rarity } from './boosters.logic.js'

export const SERIES_2 = 2
export const SERIES_2_START_NUMBER = SET_SIZE + 1
export const TOTAL_CARD_COUNT = SET_SIZE * 2

const ORIGIN_SHARES: [country: string, share: number][] = [
  ['JP', 0.6],
  ['KR', 0.3],
  ['CN', 0.1],
]

const POWER_BASE: Record<Rarity, number> = {
  COMMON: 20,
  RARE: 40,
  EPIC: 60,
  LEGENDARY: 80,
  MYTHIC: 100,
}

/** Identifiant stable et court : relancer le seed retrouve exactement la carte. */
export const series2CardId = (mangaId: string): string => `s2_${mangaId.replaceAll('-', '')}`

/** Sélection populaire, équilibrée entre mangas, manhwas et manhuas. */
function selectWorks(items: readonly CatalogItem[], count: number, excluded: ReadonlySet<string>): CatalogItem[] {
  const available = [...items]
    .filter((item) => !excluded.has(item.mangadexId))
    .sort((a, b) => b.popularity - a.popularity || a.mangadexId.localeCompare(b.mangadexId))
  const selected = new Map<string, CatalogItem>()

  for (const [country, share] of ORIGIN_SHARES) {
    const quota = Math.round(count * share)
    for (const item of available.filter((candidate) => candidate.country === country).slice(0, quota)) {
      selected.set(item.mangadexId, item)
    }
  }
  for (const item of available) {
    if (selected.size >= count) break
    selected.set(item.mangadexId, item)
  }
  return [...selected.values()]
}

export interface Series2SeedResult {
  inserted: number
  total: number
  byRarity: Record<Rarity, number>
}

/**
 * Ajoute uniquement les places manquantes de la Série 2. Les cartes existantes
 * gardent leur id, leur numéro et leur rareté ; les possessions ne sont donc
 * jamais invalidées. Le catalogue doit contenir 300 œuvres inédites avec une
 * couverture avant que l'insertion commence.
 */
export async function seedSeries2(): Promise<Series2SeedResult> {
  const [allCards, existing] = await Promise.all([
    prisma.card.findMany({ select: { mangaId: true } }),
    prisma.card.findMany({ where: { series: SERIES_2 }, select: { number: true, rarity: true } }),
  ])
  const existingRarities = existing.map((card) => card.rarity).filter((rarity): rarity is Rarity => rarity in SET_LAYOUT)
  const quotas = remainingQuotas(existingRarities, SET_LAYOUT)
  const missing = Object.values(quotas).reduce((sum, count) => sum + count, 0)
  if (missing === 0) {
    return { inserted: 0, total: existing.length, byRarity: { ...SET_LAYOUT } }
  }

  const { items, byId } = await getPool()
  const excluded = new Set(allCards.map((card) => card.mangaId))
  // Une marge absorbe les rares fiches sans couverture exploitable.
  const selected = selectWorks(items, Math.min(items.length, missing + 120), excluded)
  const documents = await loadDocuments(selected)
  const usable = selected.flatMap((item) => {
    const document = documents.get(item.mangadexId)
    if (!document) return []
    const book = normalizeManga(document, item.rating, 'en')
    return book.cover ? [{ item, book, cover: book.cover }] : []
  })
  if (usable.length < missing) {
    throw new Error(`Série 2 incomplète : ${usable.length}/${missing} nouvelles œuvres illustrées disponibles.`)
  }

  const assigned = assignRarities(
    usable.map(({ item }) => ({ mangaId: item.mangadexId, popularity: item.popularity, rating: item.rating })),
    quotas,
  )
  const usableById = new Map(usable.map((entry) => [entry.item.mangadexId, entry]))
  const occupied = new Set(existing.map((card) => card.number))
  const numbers = Array.from({ length: SET_SIZE }, (_, index) => SERIES_2_START_NUMBER + index).filter((number) => !occupied.has(number))

  const rows = assigned.map(({ mangaId, rarity }, index) => {
    const entry = usableById.get(mangaId)!
    const item = byId.get(mangaId) ?? entry.item
    const title = entry.book.title
    return {
      id: series2CardId(mangaId),
      number: numbers[index]!,
      series: SERIES_2,
      name: title,
      mangaTitle: title,
      title,
      characterName: null,
      description: entry.book.synopsis || `${title} rejoint la collection Bookshelf — Série 2.`,
      power: POWER_BASE[rarity] + Math.min(9, Math.max(0, Math.round(prestige({ mangaId, popularity: item.popularity, rating: item.rating })) - 6)),
      imageUrl: entry.cover,
      rarity,
      mangaId,
    }
  })

  await prisma.$transaction(
    rows.map((row) =>
      prisma.card.upsert({
        where: { mangaId: row.mangaId },
        create: row,
        // Identité, numéro, série et rareté restent immuables après publication.
        update: {
          name: row.name,
          mangaTitle: row.mangaTitle,
          title: row.title,
          characterName: row.characterName,
          description: row.description,
          power: row.power,
          imageUrl: row.imageUrl,
        },
      }),
    ),
  )

  const final = await prisma.card.findMany({ where: { series: SERIES_2 }, select: { rarity: true } })
  const byRarity = Object.fromEntries(
    Object.keys(SET_LAYOUT).map((rarity) => [rarity, final.filter((card) => card.rarity === rarity).length]),
  ) as Record<Rarity, number>
  return { inserted: rows.length, total: final.length, byRarity }
}
