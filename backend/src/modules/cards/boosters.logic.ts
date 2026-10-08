/**
 * Boosters et tirage de cartes — logique pure (ni réseau ni base), testée
 * (`backend/test/cards.test.ts`). L'heure et le hasard sont injectés : le
 * serveur est la seule horloge qui compte, et les tests sont déterministes.
 */

/** Stock maximal de boosters en attente. */
export const MAX_BOOSTERS = 2
/** Un booster se régénère toutes les 3 heures. */
export const BOOSTER_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Cartes par booster : deux de base, une wildcard Rare+, une Épique+ garantie. */
export const CARDS_PER_PACK = 4
/** Le 30e booster consécutif sans Mythique en garantit une sur son dernier slot. */
export const HARD_PITY_PACKS = 30

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const
export type Rarity = (typeof RARITIES)[number]

export const isRarity = (value: string): value is Rarity => (RARITIES as readonly string[]).includes(value)

/** Premiers slots (1 et 2) : cartes de base. */
export const BASE_SLOT_RATES: Record<Rarity, number> = {
  COMMON: 0.7,
  RARE: 0.25,
  EPIC: 0.05,
  LEGENDARY: 0,
  MYTHIC: 0,
}

/** Avant-dernier slot (3) : wildcard Rare+. */
export const WILDCARD_SLOT_RATES: Record<Rarity, number> = {
  COMMON: 0,
  RARE: 0.65,
  EPIC: 0.25,
  LEGENDARY: 0.09,
  MYTHIC: 0.01,
}

/** Dernier slot (4) : haute rareté garantie. */
export const HIGH_RARITY_SLOT_RATES: Record<Rarity, number> = {
  COMMON: 0,
  RARE: 0,
  EPIC: 0.7,
  LEGENDARY: 0.25,
  MYTHIC: 0.05,
}

const MYTHIC_ONLY_RATES: Record<Rarity, number> = {
  COMMON: 0,
  RARE: 0,
  EPIC: 0,
  LEGENDARY: 0,
  MYTHIC: 1,
}

/* ---- Stock ------------------------------------------------------------------ */

export interface BoosterState {
  available: number
  /** Arrivée du prochain booster ; `null` quand le stock est plein. */
  nextBoosterAt: Date | null
  lastClaimedAt: Date | null
}

/** Stock d'un compte qui n'a encore jamais ouvert de booster : plein. */
export const initialState = (): BoosterState => ({ available: MAX_BOOSTERS, nextBoosterAt: null, lastClaimedAt: null })

/**
 * Stock à l'instant `now` : chaque échéance passée ajoute un booster, jusqu'au
 * plafond. Le temps écoulé au-delà d'une échéance n'est pas perdu : la suivante
 * part de l'échéance, pas de `now`. Stock plein → plus de compte à rebours.
 */
export function regenerate(state: BoosterState, now: Date): BoosterState {
  let available = Math.min(Math.max(state.available, 0), MAX_BOOSTERS)
  let next = state.nextBoosterAt
  if (available >= MAX_BOOSTERS) return { ...state, available, nextBoosterAt: null }
  // Incohérence (stock incomplet sans échéance) : on relance le compte à rebours.
  if (!next) return { ...state, available, nextBoosterAt: new Date(now.getTime() + BOOSTER_INTERVAL_MS) }

  while (available < MAX_BOOSTERS && next.getTime() <= now.getTime()) {
    available += 1
    next = new Date(next.getTime() + BOOSTER_INTERVAL_MS)
  }
  return { ...state, available, nextBoosterAt: available >= MAX_BOOSTERS ? null : next }
}

/**
 * Ouvre un booster : stock régénéré, puis décrémenté. Si le stock était plein,
 * le compte à rebours démarre maintenant ; sinon il continue (ouvrir ne le
 * remet jamais à zéro). `null` si aucun booster n'est disponible.
 */
export function consume(state: BoosterState, now: Date): BoosterState | null {
  const current = regenerate(state, now)
  if (current.available <= 0) return null
  return {
    available: current.available - 1,
    nextBoosterAt: current.nextBoosterAt ?? new Date(now.getTime() + BOOSTER_INTERVAL_MS),
    lastClaimedAt: now,
  }
}

/** Secondes avant le prochain booster (arrondi au-dessus), `null` si le stock est plein. */
export function secondsUntilNext(state: BoosterState, now: Date): number | null {
  if (!state.nextBoosterAt) return null
  return Math.max(0, Math.ceil((state.nextBoosterAt.getTime() - now.getTime()) / 1000))
}

/* ---- Tirage ------------------------------------------------------------------ */

/** Rareté d'un emplacement : `random()` ∈ [0, 1) parcourt les probabilités cumulées. */
export function drawRarity(random: () => number, rates: Record<Rarity, number> = BASE_SLOT_RATES): Rarity {
  const roll = random()
  let cumulative = 0
  for (const rarity of RARITIES) {
    cumulative += rates[rarity]
    if (roll < cumulative) return rarity
  }
  // Arrondis flottants : la dernière rareté possible.
  return [...RARITIES].reverse().find((rarity) => rates[rarity] > 0) ?? 'COMMON'
}

/**
 * Rareté disponible la plus proche : un set sans Mythique (ou déjà épuisé en
 * doublons d'un même booster) rabat sur la rareté inférieure, puis supérieure.
 */
function nearestAvailable(rarity: Rarity, has: (rarity: Rarity) => boolean): Rarity | null {
  const index = RARITIES.indexOf(rarity)
  for (let offset = 0; offset < RARITIES.length; offset += 1) {
    const lower = RARITIES[index - offset]
    if (lower && has(lower)) return lower
    const higher = RARITIES[index + offset]
    if (higher && has(higher)) return higher
  }
  return null
}

/**
 * Table d'un slot, comptée depuis la fin du booster : le dernier est à haute
 * rareté (Mythique forcée par le hard pity), l'avant-dernier est la wildcard,
 * les autres sont de base. Changer `CARDS_PER_PACK` ne retire donc jamais les
 * deux garanties.
 */
export function slotRates(slot: number, size: number, forceMythic = false): Record<Rarity, number> {
  if (slot === size - 1) return forceMythic ? MYTHIC_ONLY_RATES : HIGH_RARITY_SLOT_RATES
  if (slot === size - 2) return WILDCARD_SLOT_RATES
  return BASE_SLOT_RATES
}

/**
 * Tire les cartes d'un booster selon la table propre à chaque slot, puis une
 * carte au hasard dans cette rareté. Pas deux fois la même carte dans un
 * booster tant que le set le permet. Le hard pity ne remplace que la table du
 * dernier slot, sans modifier les autres tirages.
 */
export function drawPack<C extends { id: string; rarity: string }>(
  cards: readonly C[],
  random: () => number,
  options: { size?: number; forceMythic?: boolean } = {},
): C[] {
  const size = options.size ?? CARDS_PER_PACK
  const byRarity = new Map<Rarity, C[]>(RARITIES.map((rarity) => [rarity, []]))
  for (const card of cards) if (isRarity(card.rarity)) byRarity.get(card.rarity)!.push(card)

  const picked: C[] = []
  const used = new Set<string>()
  for (let slot = 0; slot < size; slot += 1) {
    const wanted = drawRarity(random, slotRates(slot, size, options.forceMythic))
    const fresh = (rarity: Rarity) => byRarity.get(rarity)!.some((card) => !used.has(card.id))
    const any = (rarity: Rarity) => byRarity.get(rarity)!.length > 0
    const rarity = nearestAvailable(wanted, fresh) ?? nearestAvailable(wanted, any)
    if (!rarity) break
    const pool = byRarity.get(rarity)!.filter((card) => !used.has(card.id))
    const source = pool.length > 0 ? pool : byRarity.get(rarity)!
    const card = source[Math.floor(random() * source.length)]!
    used.add(card.id)
    picked.push(card)
  }
  return picked
}

/* ---- Séries ------------------------------------------------------------------------- */

/** Les séries du set : chaque booster appartient à l'une d'elles. */
export const CARD_SERIES = [1, 2, 3] as const
export type CardSeries = (typeof CARD_SERIES)[number]
/** Série demandée à l'ouverture : l'une d'elles, ou la roulette. */
export type SeriesChoice = CardSeries | 'random'

/**
 * Série d'un booster : celle demandée si elle a des cartes, sinon (roulette, ou série
 * pas encore prête) une série tirée au hasard parmi celles qui en ont. `null` : aucune.
 */
export function chooseSeries(available: readonly number[], choice: SeriesChoice, random: () => number): number | null {
  const ready = CARD_SERIES.filter((series) => available.includes(series))
  if (ready.length === 0) return null
  if (choice !== 'random' && ready.includes(choice)) return choice
  return ready[Math.min(ready.length - 1, Math.floor(random() * ready.length))] ?? null
}

/** Le prochain booster est le 30e de la série sèche : son dernier slot est forcé. */
export const hasReachedHardPity = (boostersSinceLastMythic: number): boolean =>
  boostersSinceLastMythic >= HARD_PITY_PACKS - 1

/** Compteur après attribution : toute Mythique le remet immédiatement à zéro. */
export function nextPityCount(boostersSinceLastMythic: number, rarities: readonly string[]): number {
  return rarities.includes('MYTHIC') ? 0 : boostersSinceLastMythic + 1
}

/* ---- Composition du set ------------------------------------------------------ */

/**
 * Taille du set et nombre de cartes par rareté (somme = taille). Agrandir
 * ces nombres agrandit le set existant sans rien retirer (cf. `growCardSet`).
 */
export const SET_LAYOUT: Record<Rarity, number> = {
  MYTHIC: 10,
  LEGENDARY: 20,
  EPIC: 50,
  RARE: 80,
  COMMON: 140,
}
export const SET_SIZE = Object.values(SET_LAYOUT).reduce((sum, count) => sum + count, 0)

export interface SetCandidate {
  mangaId: string
  /** Suivis MangaDex. */
  popularity: number
  /** Note bayésienne MangaDex (/10). */
  rating: number | null
}

/**
 * Prestige d'une œuvre : la note compte le plus (un chef-d'œuvre est rare),
 * la notoriété départage (log des suivis, ramené à [0, 1]).
 */
export function prestige(candidate: SetCandidate): number {
  const rating = candidate.rating ?? 6
  const fame = Math.min(1, Math.log10(candidate.popularity + 1) / 5.5)
  return rating + 2 * fame
}

/** Des plus rares aux plus communes : ordre des quotas et de l'album. */
const RAREST_FIRST: Rarity[] = ['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE', 'COMMON']

/** Places encore libres par rareté, une fois comptées les cartes déjà au set. */
export function remainingQuotas(existing: readonly Rarity[], layout: Record<Rarity, number> = SET_LAYOUT): Record<Rarity, number> {
  const quotas = { ...layout }
  for (const rarity of existing) quotas[rarity] = Math.max(0, quotas[rarity] - 1)
  return quotas
}

/**
 * Raretés des nouvelles cartes : les œuvres, classées par prestige
 * décroissant, reçoivent d'abord les Mythiques libres, puis les
 * Légendaires… jusqu'à épuisement des quotas.
 */
export function assignRarities(
  candidates: readonly SetCandidate[],
  quotas: Record<Rarity, number> = SET_LAYOUT,
): { mangaId: string; rarity: Rarity }[] {
  const ranked = [...candidates].sort((a, b) => prestige(b) - prestige(a) || a.mangaId.localeCompare(b.mangaId))
  const result: { mangaId: string; rarity: Rarity }[] = []
  let cursor = 0
  for (const rarity of RAREST_FIRST) {
    for (let count = 0; count < quotas[rarity] && cursor < ranked.length; count += 1) {
      result.push({ mangaId: ranked[cursor]!.mangaId, rarity })
      cursor += 1
    }
  }
  return result
}

/**
 * Numérotation de l'album (1 → taille) : des plus rares aux plus communes,
 * puis par prestige. Recalculée à chaque agrandissement, pour que les
 * nouvelles Mythiques rejoignent les anciennes en tête d'album.
 */
export function numberSet(cards: readonly { mangaId: string; rarity: Rarity; prestige: number }[]): { mangaId: string; number: number }[] {
  return [...cards]
    .sort(
      (a, b) =>
        RAREST_FIRST.indexOf(a.rarity) - RAREST_FIRST.indexOf(b.rarity) || b.prestige - a.prestige || a.mangaId.localeCompare(b.mangaId),
    )
    .map((card, index) => ({ mangaId: card.mangaId, number: index + 1 }))
}
