/**
 * Boosters et tirage de cartes — logique pure (ni réseau ni base), testée
 * (`backend/test/cards.test.ts`). L'heure et le hasard sont injectés : le
 * serveur est la seule horloge qui compte, et les tests sont déterministes.
 */

/** Stock maximal de boosters en attente. */
export const MAX_BOOSTERS = 2
/** Un booster se régénère toutes les 3 heures. */
export const BOOSTER_INTERVAL_MS = 3 * 60 * 60 * 1000
/** Cartes par booster. */
export const CARDS_PER_PACK = 3

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const
export type Rarity = (typeof RARITIES)[number]

export const isRarity = (value: string): value is Rarity => (RARITIES as readonly string[]).includes(value)

/**
 * Probabilités de rareté d'un emplacement (somme = 1). La dernière carte d'un
 * booster est garantie Rare ou mieux : les Communes y sont retirées et les
 * autres raretés gardent leurs proportions (`GUARANTEED_RATES`).
 */
export const DROP_RATES: Record<Rarity, number> = {
  COMMON: 0.6,
  RARE: 0.25,
  EPIC: 0.1,
  LEGENDARY: 0.04,
  MYTHIC: 0.01,
}

export const GUARANTEED_RATES: Record<Rarity, number> = {
  COMMON: 0,
  RARE: DROP_RATES.RARE / (1 - DROP_RATES.COMMON),
  EPIC: DROP_RATES.EPIC / (1 - DROP_RATES.COMMON),
  LEGENDARY: DROP_RATES.LEGENDARY / (1 - DROP_RATES.COMMON),
  MYTHIC: DROP_RATES.MYTHIC / (1 - DROP_RATES.COMMON),
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
export function drawRarity(random: () => number, rates: Record<Rarity, number> = DROP_RATES): Rarity {
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
 * Tire les cartes d'un booster : une rareté par emplacement (la dernière
 * garantie Rare+), puis une carte au hasard dans cette rareté. Pas deux fois
 * la même carte dans un booster tant que le set le permet.
 */
export function drawPack<C extends { id: string; rarity: string }>(
  cards: readonly C[],
  random: () => number,
  size = CARDS_PER_PACK,
): C[] {
  const byRarity = new Map<Rarity, C[]>(RARITIES.map((rarity) => [rarity, []]))
  for (const card of cards) if (isRarity(card.rarity)) byRarity.get(card.rarity)!.push(card)

  const picked: C[] = []
  const used = new Set<string>()
  for (let slot = 0; slot < size; slot += 1) {
    const wanted = drawRarity(random, slot === size - 1 ? GUARANTEED_RATES : DROP_RATES)
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
