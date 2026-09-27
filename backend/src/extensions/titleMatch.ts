/**
 * Rapprochement par titre (« TitleResolver »), pour les sources qui
 * ne connaissent pas l'id MangaDex — fonctions pures, testées
 * (`backend/test/extensions.test.ts`).
 *
 * Deux étapes : fabriquer quelques requêtes de recherche à partir des titres
 * connus (principal, alternatifs de toutes langues, variantes nettoyées),
 * puis choisir le résultat le plus proche, avec un seuil de similarité ET un
 * garde-fou contre les suites et spin-offs : mieux vaut aucun chapitre qu'une
 * autre série affichée sous ce titre.
 */

/** Seuil de similarité (0 → 1) au-delà duquel un résultat est retenu. */
export const MATCH_THRESHOLD = 0.8

/** « L'Épée — Tome 1 ! » → « l epee tome 1 » : casse, accents et ponctuation ignorés. */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Titre débarrassé de sa ponctuation, casse conservée : « Re:Zero — Kara » → « Re Zero Kara ». */
export function cleanTitle(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Titre en alphabet latin : les sites de lecture cherchent rarement en japonais ou en coréen. */
const isLatin = (value: string) => /\p{Script=Latin}/u.test(value) && !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)

/**
 * Requêtes de recherche, dans l'ordre d'essai : titres latins d'abord (dans
 * l'ordre reçu : anglais, romanisé…), chacun suivi de sa variante nettoyée
 * si elle diffère, puis les autres écritures. Dédoublonnées après
 * normalisation, et bornées : une recherche par titre n'est pas un balayage.
 */
export function searchQueries(aliases: readonly string[], max = 4): string[] {
  // Une fois par titre normalisé (« Pick Me Up! » = « Pick Me Up »), et pas les
  // sigles (« SnK ») : trop courts pour une recherche, ils servent encore au rapprochement.
  const distinct = new Map<string, string>()
  for (const alias of aliases) {
    const key = normalizeTitle(alias)
    if (key.replace(/\s/g, '').length >= 4 && !distinct.has(key)) distinct.set(key, alias)
  }
  const unique = [...distinct.values()]
  const ordered = [...unique.filter(isLatin), ...unique.filter((alias) => !isLatin(alias))]
  const seen = new Set<string>()
  const queries: string[] = []
  for (const alias of ordered) {
    for (const query of [alias.trim(), cleanTitle(alias)]) {
      const key = query.toLowerCase()
      if (!query || seen.has(key)) continue
      seen.add(key)
      queries.push(query)
    }
  }
  return queries.slice(0, max)
}

/** Distance de Levenshtein (insertions, suppressions, substitutions), sur deux lignes de tableau. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
    }
    previous = current
  }
  return previous[b.length]!
}

/** Nombres d'un titre : « Blade Road 2 » ≠ « Blade Road », quelle que soit la similarité. */
const numbersOf = (normalized: string) => (normalized.match(/\d+/g) ?? []).map(Number).join(',')

/**
 * Similarité 0 → 1 entre deux titres, après normalisation. 0 si leurs
 * nombres diffèrent : une suite (« 2 », « Season 3 ») n'est pas l'œuvre.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a)
  const right = normalizeTitle(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (numbersOf(left) !== numbersOf(right)) return 0
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length)
}

export interface TitleMatch<T> {
  candidate: T
  /** Titre du candidat qui a le mieux correspondu, et l'alias en face. */
  title: string
  alias: string
  score: number
}

/**
 * Meilleur candidat au-dessus du seuil (tous titres du candidat × tous les
 * alias). À score égal, le premier candidat — l'ordre de pertinence de la source.
 */
export function bestTitleMatch<T>(
  candidates: readonly T[],
  aliases: readonly string[],
  titlesOf: (candidate: T) => string[],
  threshold = MATCH_THRESHOLD,
): TitleMatch<T> | null {
  let best: TitleMatch<T> | null = null
  for (const candidate of candidates) {
    for (const title of titlesOf(candidate)) {
      for (const alias of aliases) {
        const score = titleSimilarity(title, alias)
        if (score >= threshold && (!best || score > best.score)) best = { candidate, title, alias, score }
        if (best?.score === 1) return best
      }
    }
  }
  return best
}

/** Raccourci : le candidat seul. */
export function findTitleMatch<T>(
  candidates: readonly T[],
  aliases: readonly string[],
  titlesOf: (candidate: T) => string[],
  threshold = MATCH_THRESHOLD,
): T | null {
  return bestTitleMatch(candidates, aliases, titlesOf, threshold)?.candidate ?? null
}
