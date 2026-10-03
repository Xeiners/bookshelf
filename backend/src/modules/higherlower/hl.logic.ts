/*
 * Higher or Lower : logique pure (sans base ni réseau), testée à part.
 *
 * Une partie enchaîne des duels dans UNE métrique : la carte B devient la référence
 * du duel suivant. La difficulté se règle par l'écart de RANG entre les deux valeurs
 * (0 : voisines, 1 : extrêmes opposés) — la même règle convient aux primes (de 1 000
 * à 5 milliards) comme aux notes (de 7,6 à 9,5), là où un rapport de valeurs non.
 */

export interface HlValued {
  id: string
  value: number
}

/** Chances : erreurs pardonnées dans une partie ; la suivante y met fin. */
export const HL_LIVES = 2

/** Paliers de série et Poussières gagnées (le palier le plus haut atteint). */
export const HL_TIERS = [
  { streak: 3, reward: 5 },
  { streak: 5, reward: 15 },
  { streak: 10, reward: 40 },
  { streak: 15, reward: 70 },
  { streak: 20, reward: 100 },
  { streak: 30, reward: 150 },
] as const

/** Poussières du Higher or Lower par jour (heure de Paris), toutes parties confondues. */
export const HL_DAILY_CAP = 200

export const rewardFor = (streak: number): number => HL_TIERS.filter((tier) => streak >= tier.streak).at(-1)?.reward ?? 0

export const nextTier = (streak: number): (typeof HL_TIERS)[number] | null => HL_TIERS.find((tier) => tier.streak > streak) ?? null

/** Ce que rapporte une série, dans la limite de ce qui reste du plafond du jour. */
export const cappedReward = (streak: number, earnedToday: number): number => Math.min(rewardFor(streak), Math.max(0, HL_DAILY_CAP - earnedToday))

/**
 * Écart de rang visé pour le duel qui suit `streak` bonnes réponses : très éloigné au
 * début (évident), de plus en plus serré ensuite.
 */
export function gapBand(streak: number): { min: number; max: number } {
  if (streak <= 5) return { min: 0.35, max: 1 }
  if (streak <= 10) return { min: 0.18, max: 0.5 }
  if (streak <= 15) return { min: 0.08, max: 0.3 }
  if (streak <= 25) return { min: 0.03, max: 0.18 }
  return { min: 0, max: 0.1 }
}

/** Rang de chaque valeur parmi les valeurs DISTINCTES de la liste, ramené entre 0 et 1. */
export function rankOf(pool: readonly HlValued[]): (value: number) => number {
  const distinct = [...new Set(pool.map((entry) => entry.value))].sort((a, b) => a - b)
  const index = new Map(distinct.map((value, position) => [value, position]))
  const span = Math.max(1, distinct.length - 1)
  return (value) => (index.get(value) ?? 0) / span
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T

/**
 * Le challenger de `current` : une autre carte, de valeur DIFFÉRENTE (jamais
 * d'égalité à trancher), pas vue récemment, à l'écart de rang voulu. `recent` (cette
 * partie) écarte strictement ; `stale` (les parties précédentes du joueur) n'est
 * qu'une préférence : à chaque palier, les cartes jamais vues passent d'abord. Faute
 * de candidat, la contrainte s'assouplit : écart minimal, puis maximal, puis les
 * cartes récentes reviennent. `null` seulement si toutes les cartes ont la même valeur.
 */
export function pickChallenger<T extends HlValued>(
  pool: readonly T[],
  current: HlValued,
  streak: number,
  recent: ReadonlySet<string>,
  random: () => number,
  stale: ReadonlySet<string> = new Set(),
): T | null {
  const rank = rankOf(pool)
  const from = rank(current.value)
  const valid = pool.filter((entry) => entry.id !== current.id && entry.value !== current.value)
  const fresh = valid.filter((entry) => !recent.has(entry.id))
  const unseen = fresh.filter((entry) => !stale.has(entry.id))
  const band = gapBand(streak)
  const within = (list: readonly T[], min: number, max: number) =>
    list.filter((entry) => {
      const gap = Math.abs(rank(entry.value) - from)
      return gap >= min && gap <= max
    })
  for (const candidates of [
    within(unseen, band.min, band.max),
    within(fresh, band.min, band.max),
    within(unseen, 0, band.max),
    within(fresh, 0, band.max),
    within(unseen, band.min, 1),
    within(fresh, band.min, 1),
    unseen,
    fresh,
    within(valid, band.min, band.max),
    valid,
  ]) {
    if (candidates.length > 0) return pick(candidates, random)
  }
  return null
}

/** Première carte d'une partie : n'importe laquelle qui a au moins un challenger, de préférence pas vue aux parties précédentes. */
export function pickOpening<T extends HlValued>(pool: readonly T[], random: () => number, stale: ReadonlySet<string> = new Set()): T | null {
  const values = new Set(pool.map((entry) => entry.value))
  if (values.size < 2) return null
  const unseen = pool.filter((entry) => !stale.has(entry.id))
  return pick(unseen.length > 0 ? unseen : pool, random)
}

/** La réponse est-elle juste ? (`next` ne vaut jamais `current`, cf. `pickChallenger`.) */
export const isCorrect = (choice: 'higher' | 'lower', current: number, next: number): boolean =>
  choice === 'higher' ? next > current : next < current

/** Cartes écartées du tirage dans une partie : les dernières vues, la moitié de la métrique. */
export const recentWindow = (poolSize: number): number => Math.max(2, Math.floor(poolSize / 2))

/**
 * Cartes mémorisées d'une partie à l'autre (par joueur et par métrique) : les trois
 * quarts de la métrique. Il reste toujours un quart de cartes « neuves », et une carte
 * ne revient qu'après que la plupart des autres sont passées.
 */
export const historyWindow = (poolSize: number): number => Math.max(1, Math.floor((poolSize * 3) / 4))

/** Ajoute les cartes vues à l'historique (la plus récente en dernier, sans doublon), tronqué à `size`. */
export function remember(history: readonly string[], seen: readonly string[], size: number): string[] {
  const fresh = new Set(seen)
  return [...history.filter((id) => !fresh.has(id)), ...fresh].slice(-size)
}
