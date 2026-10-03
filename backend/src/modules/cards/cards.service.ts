import { config } from '../../config.js'
import { prisma } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { HttpError, conflict, notFound } from '../../lib/errors.js'
import { getPool, loadDocuments, type CatalogItem } from '../../services/catalog.service.js'
import { normalizeManga } from '../manga/normalize.js'
import {
  BOOSTER_INTERVAL_MS,
  CARD_SERIES,
  MAX_BOOSTERS,
  RARITIES,
  SET_LAYOUT,
  SET_SIZE,
  assignRarities,
  chooseSeries,
  consume,
  drawPack,
  hasReachedHardPity,
  initialState,
  isRarity,
  nextPityCount,
  numberSet,
  prestige,
  remainingQuotas,
  regenerate,
  secondsUntilNext,
  type BoosterState,
  type Rarity,
  type SeriesChoice,
} from './boosters.logic.js'
import { GUEST_BOOSTERS, readGuestPacks, signGuestPack, type GuestPack } from './guestPacks.js'
import { SERIES_2, seedSeries2 } from './series2.seed.js'

/*
 * Collection de cartes et boosters. Le serveur est l'unique horloge : le
 * client affiche un compte à rebours, mais seul `now` côté serveur décide
 * qu'un booster est prêt (changer l'heure du téléphone n'y change rien).
 */

/* ---- Set de cartes ------------------------------------------------------------ */

/** Répartition des origines dans le set : surtout du manga, mais du manhwa et du manhua aussi. */
const ORIGIN_QUOTAS: [country: string, share: number][] = [
  ['JP', 0.6],
  ['KR', 0.3],
  ['CN', 0.1],
]

/**
 * Nouvelles œuvres pour atteindre `size` cartes : les plus suivies de chaque
 * origine, selon les quotas du set ENTIER (les cartes déjà au set comptent
 * dans le quota de leur origine), complétées au besoin par les plus suivies.
 */
export function pickSetWorks(
  items: readonly CatalogItem[],
  size = SET_SIZE,
  existing: ReadonlySet<string> = new Set(),
  excluded: ReadonlySet<string> = existing,
): CatalogItem[] {
  const need = size - existing.size
  if (need <= 0) return []
  const byPopularity = [...items]
    .filter((item) => !excluded.has(item.mangadexId))
    .sort((a, b) => b.popularity - a.popularity || a.mangadexId.localeCompare(b.mangadexId))
  const already = (country: string) => items.filter((item) => item.country === country && existing.has(item.mangadexId)).length
  const chosen = new Set<CatalogItem>()
  for (const [country, share] of ORIGIN_QUOTAS) {
    const quota = Math.max(0, Math.round(size * share) - already(country))
    for (const item of byPopularity.filter((work) => work.country === country).slice(0, quota)) chosen.add(item)
  }
  // Une origine trop maigre : les places restantes vont aux plus suivies, toutes origines confondues.
  for (const item of byPopularity) {
    if (chosen.size >= need) break
    chosen.add(item)
  }
  return [...chosen].slice(0, need)
}

let generating: Promise<void> | null = null

/** La collection n'est pas prête : catalogue encore en cours d'indexation. */
const notReady = () => new HttpError(503, 'collection_not_ready', 'La collection se prépare, réessaie dans quelques minutes.')

/**
 * Crée ou agrandit le set jusqu'à `layout` (par défaut `SET_LAYOUT`).
 * Rien n'est jamais retiré ni changé de rareté : les cartes existantes (et
 * donc les collections) restent intactes. Les nouvelles cartes comblent les
 * quotas manquants de chaque rareté, par prestige ; puis tout l'album est
 * renuméroté, des plus rares aux plus communes.
 */
export async function growCardSet(layout: Record<Rarity, number> = SET_LAYOUT): Promise<void> {
  const size = Object.values(layout).reduce((sum, count) => sum + count, 0)
  const [existing, allCards] = await Promise.all([
    prisma.card.findMany({ where: { series: 1 }, select: { id: true, mangaId: true, rarity: true } }),
    prisma.card.findMany({ select: { mangaId: true } }),
  ])
  if (existing.length >= size) return
  const { items, byId } = await getPool()
  // Premier set : il faut un catalogue assez fourni. Agrandissement : on fait avec ce qu'il y a.
  if (existing.length === 0 && items.length < size) throw notReady()

  const works = pickSetWorks(
    items,
    size,
    new Set(existing.map((card) => card.mangaId)),
    new Set(allCards.map((card) => card.mangaId)),
  )
  const documents = await loadDocuments(works)
  const quotas = remainingQuotas(existing.map((card) => card.rarity).filter(isRarity), layout)
  const assigned = assignRarities(works.map((work) => ({ mangaId: work.mangadexId, popularity: work.popularity, rating: work.rating })), quotas)
  const rows = assigned.flatMap(({ mangaId, rarity }) => {
    const manga = documents.get(mangaId)
    const work = byId.get(mangaId)
    if (!manga || !work) return []
    // Titre anglais (ou romanisé) : il reste lisible dans les deux langues de l'interface.
    const book = normalizeManga(manga, work.rating, 'en')
    return book.cover
      ? [{
          series: 1,
          name: book.title,
          mangaTitle: book.title,
          title: book.title,
          imageUrl: book.cover,
          rarity,
          mangaId,
          characterName: null,
          description: book.synopsis || `${book.title}, carte fondatrice de la Série 1.`,
          power: ({ COMMON: 20, RARE: 40, EPIC: 60, LEGENDARY: 80, MYTHIC: 100 } as const)[rarity],
        }]
      : []
  })
  if (rows.length === 0) {
    if (existing.length === 0) throw notReady()
    return
  }

  const prestigeOf = (mangaId: string) => {
    const work = byId.get(mangaId)
    return work ? prestige({ mangaId, popularity: work.popularity, rating: work.rating }) : 0
  }
  const numbers = new Map(
    numberSet([
      ...existing.filter((card) => isRarity(card.rarity)).map((card) => ({ mangaId: card.mangaId, rarity: card.rarity as Rarity, prestige: prestigeOf(card.mangaId) })),
      ...rows.map((row) => ({ mangaId: row.mangaId, rarity: row.rarity, prestige: prestigeOf(row.mangaId) })),
    ]).map((entry) => [entry.mangaId, entry.number]),
  )
  await prisma.$transaction(async (tx) => {
    // Numéros uniques : les anciens sont d'abord écartés (négatifs), puis l'ordre final est posé.
    for (const [index, card] of existing.entries()) await tx.card.update({ where: { id: card.id }, data: { number: -(index + 1) } })
    for (const card of existing) await tx.card.update({ where: { id: card.id }, data: { number: numbers.get(card.mangaId) ?? 0 } })
    await tx.card.createMany({ data: rows.map((row) => ({ ...row, number: numbers.get(row.mangaId) ?? 0 })) })
  })
  console.log(`[cartes] set ${existing.length === 0 ? 'généré' : 'agrandi'} : ${existing.length + rows.length} cartes (+${rows.length})`)
}

/** Dernier agrandissement resté incomplet (catalogue trop maigre) : pas de nouvel essai avant un moment. */
let stalled: { count: number; at: number } | null = null
const RETRY_GROWTH_MS = 10 * 60 * 1000

/**
 * Set prêt, créé ou agrandi au premier besoin, puis renvoyé. Un agrandissement
 * qui échoue n'empêche jamais d'ouvrir un booster avec le set actuel.
 */
export async function ensureCardSet(): Promise<{ id: string; rarity: string; series: number }[]> {
  const count = await prisma.card.count({ where: { series: 1 } })
  // La pause ne vaut que pour un agrandissement : un premier set est toujours retenté.
  const recentlyStalled = count > 0 && stalled !== null && stalled.count === count && Date.now() - stalled.at < RETRY_GROWTH_MS
  if (count < SET_SIZE && !recentlyStalled) {
    generating ??= growCardSet().finally(() => (generating = null))
    try {
      await generating
    } catch (error) {
      if (count === 0) throw error
      console.warn('[cartes] agrandissement du set impossible pour l’instant :', error instanceof Error ? error.message : error)
    }
    const after = await prisma.card.count({ where: { series: 1 } })
    stalled = after < SET_SIZE ? { count: after, at: Date.now() } : null
  }
  const [series1Count, series2Count] = await Promise.all([
    prisma.card.count({ where: { series: 1 } }),
    prisma.card.count({ where: { series: SERIES_2 } }),
  ])
  if (series1Count >= SET_SIZE && series2Count < SET_SIZE) {
    const total = series1Count + series2Count
    const recentlyStalledSeries2 = stalled !== null && stalled.count === total && Date.now() - stalled.at < RETRY_GROWTH_MS
    if (!recentlyStalledSeries2) {
      generating ??= seedSeries2().then(() => undefined).finally(() => (generating = null))
      try {
        await generating
        stalled = null
      } catch (error) {
        stalled = { count: total, at: Date.now() }
        console.warn('[cartes] Série 2 en attente :', error instanceof Error ? error.message : error)
      }
    }
  }
  return prisma.card.findMany({ select: { id: true, rarity: true, series: true } })
}

/** Les cartes d'une série (choisie, ou tirée à la roulette) ; 503 si aucune carte n'est prête. */
function seriesCards<C extends { series: number }>(set: readonly C[], choice: SeriesChoice, random: () => number): { series: number; cards: C[] } {
  const series = chooseSeries([...new Set(set.map((card) => card.series))], choice, random)
  if (series === null) throw notReady()
  return { series, cards: set.filter((card) => card.series === series) }
}

/* ---- Vitrine des séries -------------------------------------------------------------- */

export interface SeriesShowcase {
  series: number
  /** Cartes de la série. */
  size: number
  /** Couvertures pour l'illustration du paquet : les cartes les plus rares d'abord. */
  covers: string[]
}

const SHOWCASE_COVERS = 12
let showcase: { at: number; value: SeriesShowcase[] } | null = null

/** Les séries prêtes et de quoi illustrer leurs boosters (mis en cache 10 min). */
export async function seriesShowcase(now = Date.now()): Promise<SeriesShowcase[]> {
  if (showcase && now - showcase.at < 10 * 60 * 1000) return showcase.value
  const cards = await prisma.card.findMany({ select: { series: true, rarity: true, imageUrl: true, number: true }, orderBy: { number: 'asc' } })
  const rank = (rarity: string) => (isRarity(rarity) ? RARITIES.indexOf(rarity) : -1)
  const value = CARD_SERIES.flatMap((series) => {
    const own = cards.filter((card) => card.series === series)
    if (own.length === 0) return []
    const covers = [...own].sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.number - b.number).slice(0, SHOWCASE_COVERS).map((card) => card.imageUrl)
    return [{ series, size: own.length, covers }]
  })
  showcase = { at: now, value }
  return value
}

/* ---- Stock de boosters ----------------------------------------------------------- */

export interface BoosterStatus {
  /** Prêts à ouvrir : le stock qui se régénère, plus les boosters offerts. */
  available: number
  /** Dont boosters offerts par un administrateur (hors plafond, jamais perdus). */
  gifted: number
  max: number
  /** Secondes avant le prochain booster ; `null` quand le stock est plein. */
  secondsUntilNext: number | null
  nextBoosterAt: string | null
  intervalSeconds: number
  /** Heure du serveur au moment de la réponse. */
  serverTime: string
  /** Mode recette (`BOOSTER_UNLIMITED_MODE`) : ni stock ni minuteur. */
  unlimited: boolean
}

const toState = (row: { availableBoosters: number; nextBoosterAt: Date | null; lastClaimedAt: Date | null } | null): BoosterState =>
  row ? { available: row.availableBoosters, nextBoosterAt: row.nextBoosterAt, lastClaimedAt: row.lastClaimedAt } : initialState()

function statusOf(state: BoosterState, now: Date, unlimited = false, gifted = 0): BoosterStatus {
  const current = unlimited ? { ...initialState() } : regenerate(state, now)
  const bonus = unlimited ? 0 : Math.max(0, gifted)
  return {
    available: current.available + bonus,
    gifted: bonus,
    max: MAX_BOOSTERS,
    secondsUntilNext: secondsUntilNext(current, now),
    nextBoosterAt: current.nextBoosterAt?.toISOString() ?? null,
    intervalSeconds: BOOSTER_INTERVAL_MS / 1000,
    serverTime: now.toISOString(),
    unlimited,
  }
}

export async function boosterStatus(userId: string, now = new Date(), unlimited = config.cards.unlimited): Promise<BoosterStatus> {
  const row = await prisma.userBooster.findUnique({ where: { userId } })
  return statusOf(toState(row), now, unlimited, row?.giftedBoosters ?? 0)
}

/* ---- Ouverture ----------------------------------------------------------------------- */

export interface PulledCard {
  card: CardDto
  /** Première fois que ce compte obtient cette carte. */
  isNew: boolean
  /** Exemplaires possédés après ce booster. */
  count: number
}

export interface CardDto {
  id: string
  number: number
  series: number
  name: string
  mangaTitle: string
  title: string
  character: string | null
  characterName: string | null
  description: string
  power: number
  imageUrl: string
  rarity: Rarity
  mangaId: string
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002'

/**
 * Consomme un booster, de façon atomique : l'écriture n'aboutit que si le
 * stock lu n'a pas changé entre-temps (deux ouvertures simultanées ne
 * dépensent jamais le même booster). `(available, nextBoosterAt)` change à
 * chaque consommation : c'est la clé de ce verrou optimiste.
 */
interface SpentBooster {
  state: BoosterState
  boostersSinceLastMythic: number
  /** Boosters offerts restants après cette ouverture. */
  gifted: number
}

async function spendBooster(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<SpentBooster> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await tx.userBooster.findUnique({ where: { userId } })
    const gifted = row?.giftedBoosters ?? 0
    const next = consume(toState(row), now)
    if (!next) {
      // Stock normal vide : un booster offert, s'il en reste. Le stock normal passe d'abord,
      // pour que son minuteur reparte au plus tôt ; les cadeaux, eux, ne se perdent jamais.
      if (row && gifted > 0) {
        const { count } = await tx.userBooster.updateMany({
          where: { userId, giftedBoosters: gifted, boostersSinceLastMythic: row.boostersSinceLastMythic },
          data: { giftedBoosters: { decrement: 1 } },
        })
        if (count === 1) return { state: regenerate(toState(row), now), boostersSinceLastMythic: row.boostersSinceLastMythic, gifted: gifted - 1 }
        continue
      }
      const status = statusOf(toState(row), now)
      throw new HttpError(409, 'no_booster', 'Aucun booster disponible pour le moment.', {
        secondsUntilNext: status.secondsUntilNext,
      })
    }
    const data = { availableBoosters: next.available, nextBoosterAt: next.nextBoosterAt, lastClaimedAt: next.lastClaimedAt }
    if (!row) {
      try {
        await tx.userBooster.create({ data: { userId, ...data } })
        return { state: next, boostersSinceLastMythic: 0, gifted: 0 }
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }
    const { count } = await tx.userBooster.updateMany({
      where: {
        userId,
        availableBoosters: row.availableBoosters,
        nextBoosterAt: row.nextBoosterAt,
        boostersSinceLastMythic: row.boostersSinceLastMythic,
      },
      data,
    })
    if (count === 1) return { state: next, boostersSinceLastMythic: row.boostersSinceLastMythic, gifted }
  }
  throw conflict('Ouverture déjà en cours, réessaie.', 'booster_busy')
}

export async function openBooster(
  userId: string,
  options: { now?: Date; random?: () => number; unlimited?: boolean; series?: SeriesChoice } = {},
): Promise<{ cards: PulledCard[]; status: BoosterStatus; series: number }> {
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random
  // Recette : aucun booster n'est dépensé, le stock enregistré reste intact.
  const unlimited = options.unlimited ?? config.cards.unlimited
  // Le set d'abord : si la collection n'est pas prête, aucun booster n'est dépensé.
  const set = await ensureCardSet()
  // Jamais un booster dépensé sans cartes à tirer.
  if (set.length === 0) throw notReady()
  const { series, cards: pool } = seriesCards(set, options.series ?? 'random', random)
  // Dépense et cartes ensemble : un booster n'est jamais dépensé sans ses cartes.
  return prisma.$transaction(async (tx) => {
    const spent = unlimited
      ? { state: initialState(), boostersSinceLastMythic: 0, gifted: 0 }
      : await spendBooster(tx, userId, now)
    const drawn = drawPack(pool, random, {
      forceMythic: !unlimited && hasReachedHardPity(spent.boostersSinceLastMythic),
    })
    const cards: PulledCard[] = []
    for (const { id } of drawn) {
      const key = { userId_cardId: { userId, cardId: id } }
      const existing = await tx.userCard.findUnique({ where: key, select: { count: true } })
      const owned = await tx.userCard.upsert({
        where: key,
        create: { userId, cardId: id, obtainedAt: now },
        update: { count: { increment: 1 } },
        include: { card: true },
      })
      cards.push({ card: toCardDto(owned.card), isNew: existing === null, count: owned.count })
    }
    // Statistique du profil : compte aussi les ouvertures de recette.
    await tx.user.update({ where: { id: userId }, data: { boostersOpened: { increment: 1 } } })
    if (!unlimited) {
      await tx.userBooster.update({
        where: { userId },
        data: {
          boostersSinceLastMythic: nextPityCount(
            spent.boostersSinceLastMythic,
            drawn.map((card) => card.rarity),
          ),
        },
      })
    }
    return { cards, status: statusOf(spent.state, now, unlimited, spent.gifted), series }
  })
}

export const toCardDto = (card: { id: string; number: number; series: number; name: string; mangaTitle: string; title: string; characterName: string | null; description: string; power: number; imageUrl: string; rarity: string; mangaId: string }): CardDto => ({
  id: card.id,
  number: card.number,
  series: card.series,
  name: card.name || card.title,
  mangaTitle: card.mangaTitle || card.title,
  title: card.title,
  character: card.characterName,
  characterName: card.characterName,
  description: card.description,
  power: card.power,
  imageUrl: card.imageUrl,
  rarity: card.rarity as Rarity,
  mangaId: card.mangaId,
})

/* ---- Collection ------------------------------------------------------------------------- */

export interface CollectionEntry extends CardDto {
  owned: boolean
  count: number
  isFavorite: boolean
  obtainedAt: string | null
}

export interface Collection {
  total: number
  owned: number
  /** Nombre de cartes du set par rareté, et possédées. */
  byRarity: Record<Rarity, { total: number; owned: number }>
  cards: CollectionEntry[]
}

interface Owned {
  count: number
  isFavorite: boolean
  obtainedAt: Date
}

export async function collectionOf(userId: string): Promise<Collection> {
  await ensureCardSet()
  const owned = await prisma.userCard.findMany({ where: { userId } })
  return buildCollection(new Map(owned.map((entry) => [entry.cardId, entry])))
}

/** Tout le set, dans l'ordre de l'album, avec ce qui est possédé. */
async function buildCollection(mine: ReadonlyMap<string, Owned>): Promise<Collection> {
  const cards = await prisma.card.findMany({ orderBy: { number: 'asc' } })
  const byRarity = Object.fromEntries(Object.keys(SET_LAYOUT).map((rarity) => [rarity, { total: 0, owned: 0 }])) as Collection['byRarity']
  const entries = cards.map((card): CollectionEntry => {
    const entry = mine.get(card.id)
    const dto = toCardDto(card)
    const tally = byRarity[dto.rarity]
    if (tally) {
      tally.total += 1
      if (entry) tally.owned += 1
    }
    return {
      ...dto,
      owned: entry !== undefined,
      count: entry?.count ?? 0,
      isFavorite: entry?.isFavorite ?? false,
      obtainedAt: entry?.obtainedAt.toISOString() ?? null,
    }
  })
  return { total: cards.length, owned: entries.filter((entry) => entry.owned).length, byRarity, cards: entries }
}

export async function setFavorite(userId: string, cardId: string, isFavorite: boolean): Promise<void> {
  const { count } = await prisma.userCard.updateMany({ where: { userId, cardId }, data: { isFavorite } })
  if (count === 0) throw notFound('Carte absente de ta collection.')
}

/* ---- Invités : boosters d'essai (cf. `guestPacks.ts`) -------------------------------------- */

/** Cartes des reçus d'un invité : exemplaires et date du premier tirage. */
function guestOwnership(packs: readonly GuestPack[]): Map<string, Owned> {
  const owned = new Map<string, Owned>()
  for (const pack of packs) {
    for (const cardId of pack.cardIds) {
      const entry = owned.get(cardId)
      if (entry) entry.count += 1
      else owned.set(cardId, { count: 1, isFavorite: false, obtainedAt: pack.issuedAt })
    }
  }
  return owned
}

/**
 * Booster d'essai : tiré comme pour un compte, mais rien n'est enregistré. Le
 * tirage revient avec son reçu signé. `receipts` : ceux que l'invité possède
 * déjà (limite d'essai, cartes nouvelles ou en double).
 */
export async function openGuestBooster(
  receipts: readonly string[],
  options: { now?: Date; random?: () => number; series?: SeriesChoice } = {},
): Promise<{ cards: PulledCard[]; receipt: string; remaining: number; series: number }> {
  const packs = readGuestPacks(receipts)
  if (packs.length >= GUEST_BOOSTERS) {
    throw new HttpError(409, 'guest_limit', 'Crée un compte pour ouvrir d’autres boosters.')
  }
  const set = await ensureCardSet()
  if (set.length === 0) throw notReady()
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random
  const { series, cards: pool } = seriesCards(set, options.series ?? 'random', random)
  const drawn = drawPack(pool, random).map((card) => card.id)
  const rows = new Map((await prisma.card.findMany({ where: { id: { in: drawn } } })).map((card) => [card.id, card]))
  const owned = guestOwnership(packs)
  const cards = drawn.flatMap((id): PulledCard[] => {
    const card = rows.get(id)
    if (!card) return []
    const before = owned.get(id)?.count ?? 0
    owned.set(id, { count: before + 1, isFavorite: false, obtainedAt: now })
    return [{ card: toCardDto(card), isNew: before === 0, count: before + 1 }]
  })
  return { cards, receipt: signGuestPack(drawn, now), remaining: GUEST_BOOSTERS - packs.length - 1, series }
}

/** Album d'un invité, reconstitué depuis ses reçus. */
export async function guestCollection(receipts: readonly string[]): Promise<Collection> {
  await ensureCardSet()
  return buildCollection(guestOwnership(readGuestPacks(receipts)))
}

/**
 * Inscription : les cartes des boosters d'essai rejoignent le nouveau compte.
 * Renvoie le nombre de cartes ajoutées.
 */
export async function claimGuestPacks(userId: string, receipts: readonly string[]): Promise<number> {
  const packs = readGuestPacks(receipts)
  const owned = guestOwnership(packs)
  if (owned.size === 0) return 0
  // Seules les cartes du set comptent (par prudence : le set ne perd jamais de carte).
  const known = await prisma.card.findMany({ where: { id: { in: [...owned.keys()] } }, select: { id: true } })
  let claimed = 0
  await prisma.$transaction(async (tx) => {
    for (const { id } of known) {
      const entry = owned.get(id)!
      await tx.userCard.upsert({
        where: { userId_cardId: { userId, cardId: id } },
        create: { userId, cardId: id, count: entry.count, obtainedAt: entry.obtainedAt },
        update: { count: { increment: entry.count } },
      })
      claimed += entry.count
    }
    // Les boosters d'essai comptent dans les statistiques du profil.
    await tx.user.update({ where: { id: userId }, data: { boostersOpened: { increment: packs.length } } })
  })
  return claimed
}
