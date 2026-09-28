/**
 * Boosters et collection côté client — fonctions pures, testées
 * (`frontend/test/boosters.test.ts`).
 *
 * Le serveur est la seule horloge qui compte : il renvoie un délai en
 * secondes, que le client décompte sur une horloge MONOTONE
 * (`performance.now()`), jamais sur `Date.now()`. Avancer l'heure du
 * téléphone ne fait donc rien apparaître : au pire l'affichage dit « prêt »,
 * et c'est le serveur qui tranche à l'ouverture.
 */

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const
export type Rarity = (typeof RARITIES)[number]

/** Boosters d'essai sans compte (miroir de `GUEST_BOOSTERS` côté serveur, qui fait foi). */
export const GUEST_BOOSTERS = 2

export interface BoosterStatus {
  available: number
  max: number
  /** Secondes avant le prochain booster à l'instant de la réponse ; `null` : stock plein. */
  secondsUntilNext: number | null
  nextBoosterAt: string | null
  intervalSeconds: number
  serverTime: string
  /** Mode recette côté serveur (`BOOSTER_UNLIMITED_MODE`) : ni stock ni minuteur. */
  unlimited?: boolean
}

/**
 * Secondes restantes, décomptées depuis la synchronisation avec le serveur.
 * `syncedAt` et `now` viennent de `performance.now()` (millisecondes).
 */
export function remainingSeconds(secondsAtSync: number | null, syncedAt: number, now: number): number | null {
  if (secondsAtSync === null) return null
  return Math.max(0, Math.ceil(secondsAtSync - (now - syncedAt) / 1000))
}

/** Avancement du minuteur (0 → 1) pour une jauge ; 1 quand le stock est plein. */
export function refillProgress(remaining: number | null, intervalSeconds: number): number {
  if (remaining === null || intervalSeconds <= 0) return 1
  return Math.min(1, Math.max(0, 1 - remaining / intervalSeconds))
}

/* ---- Raretés ------------------------------------------------------------------ */

export interface RarityStyle {
  /** Couleur de cadre et de halo. */
  color: string
  /** Reflet holographique au survol / à l'inclinaison. */
  holo: boolean
  /** Révélation dramatique : ralenti, lueur intense, particules, vibration. */
  dramatic: boolean
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  COMMON: { color: '#9d9aab', holo: false, dramatic: false },
  RARE: { color: '#4cc9f0', holo: false, dramatic: false },
  EPIC: { color: '#b46cff', holo: true, dramatic: false },
  LEGENDARY: { color: '#ffc46b', holo: true, dramatic: true },
  MYTHIC: { color: '#ff5ec4', holo: true, dramatic: true },
}

export const rarityRank = (rarity: Rarity) => RARITIES.indexOf(rarity)

/** La plus rare d'une série de cartes (couleur du booster ouvert, par exemple). */
export function bestRarity(rarities: readonly Rarity[]): Rarity {
  return rarities.reduce<Rarity>((best, rarity) => (rarityRank(rarity) > rarityRank(best) ? rarity : best), 'COMMON')
}

/* ---- Recette : taux observés -------------------------------------------------------- */

export interface DropTally {
  packs: number
  cards: Record<Rarity, number>
}

export const emptyTally = (): DropTally => ({ packs: 0, cards: { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0, MYTHIC: 0 } })

/** Ajoute un booster ouvert au relevé (copie, l'entrée est intacte). */
export function addToTally(tally: DropTally, rarities: readonly Rarity[]): DropTally {
  const cards = { ...tally.cards }
  for (const rarity of rarities) cards[rarity] += 1
  return { packs: tally.packs + 1, cards }
}

/** Part observée d'une rareté, en pourcentage à une décimale. */
export function observedRate(tally: DropTally, rarity: Rarity): number {
  const total = RARITIES.reduce((sum, key) => sum + tally.cards[key], 0)
  return total === 0 ? 0 : Math.round((tally.cards[rarity] / total) * 1000) / 10
}

/* ---- Album ------------------------------------------------------------------------ */

export interface CollectionCard {
  id: string
  number: number
  title: string
  characterName: string | null
  imageUrl: string
  rarity: Rarity
  mangaId: string
  owned: boolean
  count: number
  isFavorite: boolean
  obtainedAt: string | null
}

export type Ownership = 'all' | 'owned' | 'missing'

export interface CollectionFilter {
  rarity: Rarity | 'all'
  ownership: Ownership
  /** Texte libre sur le titre de l'œuvre. */
  query: string
}

export const DEFAULT_FILTER: CollectionFilter = { rarity: 'all', ownership: 'all', query: '' }

/** « Kimetsu no Yaiba » ≈ « kimetsu » : minuscules, sans accents ni ponctuation. */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Cartes de l'album retenues par les filtres, dans l'ordre de l'album. */
export function filterCollection<C extends CollectionCard>(cards: readonly C[], filter: CollectionFilter): C[] {
  const query = normalize(filter.query)
  return cards.filter(
    (card) =>
      (filter.rarity === 'all' || card.rarity === filter.rarity) &&
      (filter.ownership === 'all' || (filter.ownership === 'owned') === card.owned) &&
      (!query || normalize(card.title).includes(query)),
  )
}

/** Progression de l'album, en pourcentage entier (0 → 100). */
export const completion = (owned: number, total: number) => (total > 0 ? Math.floor((owned / total) * 100) : 0)
