import { titleSimilarity } from '../../extensions/titleMatch.js'
import { authorKey, type NovelMetadata } from './metadata.normalize.js'

/*
 * Rattachement d'un EPUB importé à une fiche de roman (logique pure, testée) :
 *
 *  - `confident` : même ISBN, ou titre quasi identique ET même auteur, sans
 *    rival sérieux → rattaché d'office ;
 *  - `choose`    : des fiches ressemblent, sans certitude → l'utilisateur choisit ;
 *  - `none`      : rien d'approchant → la fiche est tirée du fichier lui-même.
 *
 * Mieux vaut demander que rattacher un EPUB à un autre livre : le seuil de
 * certitude est volontairement haut.
 */

/** Titre à partir duquel une fiche est proposée au choix. */
export const CANDIDATE_SCORE = 0.6
/** Titre à partir duquel, avec le même auteur, le rattachement est automatique. */
export const CONFIDENT_SCORE = 0.9
/** Sans auteur dans le fichier : il faut un titre pratiquement identique. */
const CONFIDENT_WITHOUT_AUTHOR = 0.97
/** Écart minimal avec la 2ᵉ fiche : deux fiches aussi proches, c'est à l'utilisateur de trancher. */
const LEAD = 0.05
export const MAX_CANDIDATES = 5

export interface FileIdentity {
  title: string
  author: string | null
  isbn: string | null
}

export interface ScoredCandidate {
  item: NovelMetadata
  /** Ressemblance du titre, 0 → 1 (1 : même ISBN). */
  score: number
  /** Même auteur que le fichier ; `null` : le fichier ne nomme pas d'auteur. */
  sameAuthor: boolean | null
  sameIsbn: boolean
}

export type MatchDecision =
  | { kind: 'confident'; item: NovelMetadata }
  | { kind: 'choose'; candidates: NovelMetadata[] }
  | { kind: 'none' }

const normalizeIsbn = (value: string | null) => value?.replace(/[^\dX]/gi, '').toUpperCase() || null

/** Titres sous lesquels une fiche peut se présenter (série en titre, vrai titre en sous-titre). */
const titlesOf = (item: NovelMetadata) =>
  [item.title, item.subtitle, item.subtitle ? `${item.title} ${item.subtitle}` : null].filter((title): title is string => !!title)

/** Fiches qui ressemblent au fichier, les plus probables d'abord. */
export function scoreCandidates(results: readonly NovelMetadata[], file: FileIdentity): ScoredCandidate[] {
  const isbn = normalizeIsbn(file.isbn)
  const author = file.author ? authorKey([file.author.split(',')[0] ?? '']) : null
  return results
    .map((item) => {
      const sameIsbn = !!isbn && normalizeIsbn(item.isbn) === isbn
      const score = sameIsbn ? 1 : Math.max(0, ...titlesOf(item).map((title) => titleSimilarity(title, file.title)))
      const sameAuthor = author ? item.authors.some((name) => authorKey([name]) === author) : null
      return { item, score, sameAuthor, sameIsbn }
    })
    .filter((candidate) => candidate.sameIsbn || candidate.score >= CANDIDATE_SCORE)
    // Un auteur différent de celui du fichier recule, sans disparaître : les métadonnées d'un EPUB sont parfois fausses.
    .sort((a, b) => rank(b) - rank(a))
}

const rank = (candidate: ScoredCandidate) =>
  candidate.score + (candidate.sameIsbn ? 1 : 0) + (candidate.sameAuthor === true ? 0.1 : candidate.sameAuthor === false ? -0.2 : 0)

export function decideMatch(results: readonly NovelMetadata[], file: FileIdentity): MatchDecision {
  const scored = scoreCandidates(results, file)
  const [top, second] = scored
  if (!top) return { kind: 'none' }

  const clearLead = !second || rank(top) - rank(second) >= LEAD
  const confident =
    top.sameIsbn ||
    (clearLead &&
      (top.sameAuthor === true
        ? top.score >= CONFIDENT_SCORE
        : top.sameAuthor === null && top.score >= CONFIDENT_WITHOUT_AUTHOR))
  if (confident) return { kind: 'confident', item: top.item }
  return { kind: 'choose', candidates: scored.slice(0, MAX_CANDIDATES).map((candidate) => candidate.item) }
}
