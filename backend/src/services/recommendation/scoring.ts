/**
 * Moteur de recommandation — logique pure (aucun accès réseau ni base).
 *
 * Un profil de goûts est un score par genre et par tag, nourri par les swipes :
 * aimer (wishlist / lu / en cours) ajoute `LIKE_DELTA`, passer ajoute
 * `SKIP_DELTA`. Les tags AniList portent une pertinence (0-100 %) : un tag
 * « Revenge » à 95 % compte presque plein, un tag anecdotique à 40 % compte peu.
 *
 * La compatibilité d'un titre (0-100 %) combine :
 *  - l'affinité : moyenne des scores de ses genres, moyenne pondérée (par
 *    pertinence) de ses tags, écrasée par `tanh` pour rester bornée ;
 *  - la qualité : sa note moyenne AniList, en léger bonus / malus.
 * Sans profil (premier lancement), seule la qualité départage : 45-65 %.
 */

export interface TagWeight {
  name: string
  /** Pertinence du tag pour l'œuvre, en % (AniList). */
  rank: number
}

/** Ce que le moteur sait d'une œuvre. */
export interface WorkFeatures {
  genres: string[]
  tags: TagWeight[]
  /** Note moyenne sur 100, si connue. */
  meanScore: number | null
}

export interface TasteProfile {
  genres: Record<string, number>
  tags: Record<string, number>
}

export const emptyProfile = (): TasteProfile => ({ genres: {}, tags: {} })

/** Wishlist, lu, en cours. */
export const LIKE_DELTA = 3
/** Un coup de cœur pèse davantage qu'un simple ajout. */
export const FAVORITE_BONUS = 2
/** Par étoile d'écart à 3★ : 5★ → +4, 1★ → -4 (un titre lu et détesté éloigne ses genres). */
export const RATING_STEP = 2

/**
 * Poids d'un titre en bibliothèque dans le profil : 3 de base, +2 s'il est en
 * favori, ±2 par étoile d'écart à la note neutre (3★). 5★ favori → 9 ; 1★ → -1.
 */
export function likeWeight(entry: { favorite?: boolean; userRating?: number | null }): number {
  const rating = typeof entry.userRating === 'number' ? (entry.userRating - 3) * RATING_STEP : 0
  return LIKE_DELTA + (entry.favorite ? FAVORITE_BONUS : 0) + rating
}
/** Swipe gauche. */
export const SKIP_DELTA = -2
/** Un score ne s'emballe pas au-delà : dix swipes de plus ne changent plus grand-chose. */
export const SCORE_LIMIT = 60
/** En dessous de cette pertinence, un tag est trop anecdotique pour compter. */
export const MIN_TAG_RANK = 40
/** Au-delà de cette valeur absolue, un genre est considéré comme « exploré ». */
export const EXPLORED_THRESHOLD = 3
/** Note minimale (sur 100) d'une carte « découverte » (ratio 80/20). */
export const DISCOVERY_MIN_SCORE = 80
/** Une carte sur `DISCOVERY_EVERY` vient d'un genre peu exploré. */
export const DISCOVERY_EVERY = 5

/** Échelle de l'affinité : un score moyen de 4,5 (≈ deux « j'aime ») donne tanh(1) ≈ 0,76. */
const AFFINITY_SCALE = 4.5
const GENRE_WEIGHT = 0.6
const TAG_WEIGHT = 0.4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Score d'une clé du profil. `Object.hasOwn` : un tag nommé « constructor » ou
 * « toString » ne doit jamais lire le prototype d'`Object`.
 */
const scoreOf = (record: Record<string, number>, key: string): number =>
  Object.hasOwn(record, key) ? (record[key] ?? 0) : 0

/** Ajoute `delta` à une clé ; un score revenu à zéro disparaît (profil compact). */
function bump(record: Record<string, number>, key: string, delta: number): void {
  const next = round2(clamp(scoreOf(record, key) + delta, -SCORE_LIMIT, SCORE_LIMIT))
  if (next === 0) delete record[key]
  else record[key] = next
}

/**
 * Applique un swipe EN PLACE. Réservé aux profils fraîchement créés (calcul
 * d'un historique entier) : copier le profil à chaque swipe y serait quadratique.
 */
export function accumulateFeedback(profile: TasteProfile, features: WorkFeatures, delta: number): void {
  const { genres } = features
  for (let index = 0; index < genres.length; index += 1) {
    const genre = genres[index]!
    if (genres.indexOf(genre) === index) bump(profile.genres, genre, delta)
  }
  for (const tag of features.tags) {
    if (tag.rank >= MIN_TAG_RANK) bump(profile.tags, tag.name, (delta * tag.rank) / 100)
  }
}

/** Nouveau profil après un swipe (le profil d'origine n'est pas modifié). */
export function applyFeedback(profile: TasteProfile, features: WorkFeatures, delta: number): TasteProfile {
  const next = { genres: { ...profile.genres }, tags: { ...profile.tags } }
  accumulateFeedback(next, features, delta)
  return next
}

/**
 * Affinité d'un profil pour une œuvre, dans ]-1, 1[. 0 = aucun signal.
 * Appelée pour chaque œuvre du catalogue à chaque deck : boucles sans allocation.
 */
export function affinity(profile: TasteProfile, features: WorkFeatures): number {
  const { genres } = features
  let genreSum = 0
  let genreCount = 0
  for (let index = 0; index < genres.length; index += 1) {
    const genre = genres[index]!
    if (genres.indexOf(genre) !== index) continue
    genreSum += scoreOf(profile.genres, genre)
    genreCount += 1
  }
  const genreSignal = genreCount > 0 ? genreSum / genreCount : null

  let tagSum = 0
  let totalRank = 0
  for (const tag of features.tags) {
    if (tag.rank < MIN_TAG_RANK) continue
    totalRank += tag.rank
    tagSum += tag.rank * scoreOf(profile.tags, tag.name)
  }
  const tagSignal = totalRank > 0 ? tagSum / totalRank : null

  const raw =
    genreSignal !== null && tagSignal !== null
      ? GENRE_WEIGHT * genreSignal + TAG_WEIGHT * tagSignal
      : (genreSignal ?? tagSignal ?? 0)

  return Math.tanh(raw / AFFINITY_SCALE)
}

/** Compatibilité affichée sur la carte, en % entier (0-100). */
export function matchPercentage(profile: TasteProfile, features: WorkFeatures): number {
  const quality = features.meanScore === null ? 0 : clamp((features.meanScore - 70) / 20, -1, 1)
  return Math.round(clamp(55 + 38 * affinity(profile, features) + 7 * quality, 0, 100))
}

/** Aucun des genres de l'œuvre n'a encore vraiment été jugé par l'utilisateur. */
export function isUnexplored(profile: TasteProfile, features: WorkFeatures): boolean {
  return features.genres.every((genre) => Math.abs(scoreOf(profile.genres, genre)) < EXPLORED_THRESHOLD)
}

/* ---- Composition du deck --------------------------------------------------- */

export interface Candidate {
  /** Clé unique du catalogue (dédoublonnage). */
  key: number
  /** Tous les identifiants sous lesquels l'œuvre a pu être enregistrée (MangaDex, AniList). */
  ids: string[]
  features: WorkFeatures
  popularity: number
}

export interface RankedCandidate<C extends Candidate> {
  candidate: C
  matchPercentage: number
  /** Carte « découverte » : genre peu exploré, très bien noté. */
  discovery: boolean
}

export interface RankOptions {
  /** Ids déjà en bibliothèque, passés, ou déjà dans la file du front. */
  excluded: ReadonlySet<string>
  limit: number
  /** Source d'aléa (injectable pour les tests) : varie l'ordre à qualité égale. */
  random?: () => number
  /** `popularity` : l'étagère Tendances pèse d'abord la popularité. */
  sort?: 'match' | 'popularity'
}

/** Filtre anti-répétition : une œuvre déjà vue sous N'IMPORTE LEQUEL de ses ids est écartée. */
export function isExcluded(candidate: Pick<Candidate, 'ids'>, excluded: ReadonlySet<string>): boolean {
  return candidate.ids.some((id) => excluded.has(id))
}

/** log10(popularité) ramené à [0, 1] (AniList : jusqu'à ~300 000 membres). */
const popularityNorm = (popularity: number) => clamp(Math.log10(popularity + 1) / 5.5, 0, 1)

/**
 * Classe les candidats pour un profil et compose la page du deck :
 * 4 cartes sur 5 suivent la compatibilité, la 5ᵉ vient d'un genre peu exploré
 * mais très bien noté (> 80 %), pour élargir les goûts au lieu de les enfermer.
 */
export function rankDeck<C extends Candidate>(
  candidates: readonly C[],
  profile: TasteProfile,
  options: RankOptions,
): RankedCandidate<C>[] {
  const random = options.random ?? Math.random
  // Une œuvre vue sous un id l'est sous tous : ses doublons de source sont écartés aussi.
  const excludedKeys = new Set(
    candidates.filter((candidate) => isExcluded(candidate, options.excluded)).map((candidate) => candidate.key),
  )
  const seen = new Set<number>()

  interface Scored {
    candidate: C
    match: number
    sortKey: number
    /** Candidate au ratio 80/20 : genre peu exploré ET très bien noté. */
    discoverable: boolean
  }
  const scored: Scored[] = []
  for (const candidate of candidates) {
    // Doublons dans la source elle-même : une seule carte par œuvre.
    if (seen.has(candidate.key) || excludedKeys.has(candidate.key)) continue
    seen.add(candidate.key)
    const match = matchPercentage(profile, candidate.features)
    const jitter = (random() - 0.5) * 8
    const popularity = popularityNorm(candidate.popularity)
    const sortKey =
      options.sort === 'popularity' ? 60 * popularity + 0.4 * match + jitter : match + 3 * popularity + jitter
    const discoverable =
      (candidate.features.meanScore ?? 0) > DISCOVERY_MIN_SCORE && isUnexplored(profile, candidate.features)
    scored.push({ candidate, match, sortKey, discoverable })
  }

  const main = [...scored].sort((a, b) => b.sortKey - a.sortKey)
  const explore = scored
    .filter((item) => item.discoverable)
    .map((item) => ({ item, key: (item.candidate.features.meanScore ?? 0) + (random() - 0.5) * 6 }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item)

  const used = new Set<number>()
  const result: RankedCandidate<C>[] = []
  let mainIndex = 0
  let exploreIndex = 0

  const nextFrom = (list: typeof scored, index: number) => {
    let cursor = index
    while (cursor < list.length && used.has(list[cursor]!.candidate.key)) cursor += 1
    return cursor
  }

  while (result.length < options.limit) {
    const discoverySlot = (result.length + 1) % DISCOVERY_EVERY === 0
    if (discoverySlot) {
      exploreIndex = nextFrom(explore, exploreIndex)
      const pick = explore[exploreIndex]
      if (pick) {
        used.add(pick.candidate.key)
        result.push({ candidate: pick.candidate, matchPercentage: pick.match, discovery: true })
        continue
      }
    }
    mainIndex = nextFrom(main, mainIndex)
    const pick = main[mainIndex]
    if (!pick) break
    used.add(pick.candidate.key)
    result.push({ candidate: pick.candidate, matchPercentage: pick.match, discovery: false })
  }

  return result
}
