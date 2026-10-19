import { badRequest, conflict, notFound } from '../../lib/errors.js'
import type { CachedImage } from '../manga/manga.routes.js'
import { record, type Admin } from '../admin/admin.service.js'
import { prisma } from '../../db.js'
import { REVIEW_UNIVERSES } from './dle.games.js'
import { reviewKey, type PortraitCharacter, type PortraitSource } from './dle.jikan.js'
import { countsOf, isBanned, isReviewed, reviewsReady, setReview, type ReviewStatus } from './dle.review.store.js'

/*
 * Revue des images d'énigme (administration) : pour chaque univers, l'administrateur passe en revue
 * les images candidates de chaque personnage — valider (elle reste dans le tirage, et n'est plus
 * proposée) ou bannir (elle n'est plus jamais tirée). Les décisions vivent dans `DleImageReview` ;
 * le tirage les lit en mémoire (`dle.review.store.ts`). Les bannissements et leurs annulations
 * sont inscrits au journal de l'administration.
 */

export interface ReviewUniverse {
  label: string
  portraits: PortraitSource
  characters: readonly PortraitCharacter[]
}

export interface UniverseOverview {
  category: string
  label: string
  characters: number
  /** Les images candidates sont chargées (sinon : quelques minutes après un démarrage). */
  ready: boolean
  /** Images candidates connues, et ce qu'il reste à revoir. */
  images: number
  remaining: number
  approved: number
  banned: number
}

export interface ReviewItem {
  characterId: string
  name: string
  key: string
}

export type ReviewDecision = 'approve' | 'ban' | 'clear'

const STATUS_OF: Record<ReviewDecision, ReviewStatus | null> = { approve: 'APPROVED', ban: 'BANNED', clear: null }

/** `universes` : les univers revus ; remplaçable pour les tests. */
export function createDleReview(universes: Record<string, ReviewUniverse>) {
  const universeOf = (category: string): ReviewUniverse => {
    const universe = universes[category]
    if (!universe) throw notFound('Univers introuvable.')
    return universe
  }
  const characterOf = (universe: ReviewUniverse, id: string): PortraitCharacter => {
    const character = universe.characters.find((entry) => entry.id === id)
    if (!character) throw notFound('Personnage introuvable.')
    return character
  }

  /** Les images encore à revoir, dans l'ordre des personnages. */
  const pending = (category: string, images: ReadonlyMap<string, readonly string[]>): ReviewItem[] => {
    const universe = universeOf(category)
    const items: ReviewItem[] = []
    for (const character of universe.characters) {
      const seen = new Set<string>()
      for (const url of images.get(character.id) ?? []) {
        const key = reviewKey(url)
        if (seen.has(key)) continue
        seen.add(key)
        if (!isReviewed(category, character.id, key)) items.push({ characterId: character.id, name: character.name, key })
      }
    }
    return items
  }

  return {
    /** Les univers, leur avancement ; ne déclenche aucun chargement. */
    async overview(): Promise<UniverseOverview[]> {
      await reviewsReady()
      return Object.entries(universes).map(([category, universe]) => {
        const known = universe.portraits.peekCandidates()
        const counts = countsOf(category)
        return {
          category,
          label: universe.label,
          characters: universe.characters.length,
          ready: known !== null,
          images: known ? [...known.values()].reduce((sum, urls) => sum + new Set(urls.map(reviewKey)).size, 0) : 0,
          remaining: known ? pending(category, known).length : 0,
          approved: counts.approved,
          banned: counts.banned,
        }
      })
    },

    /** Les prochaines images à revoir ; `ready: false` tant que les images se chargent. */
    async queue(category: string, limit: number): Promise<{ ready: boolean; remaining: number; items: ReviewItem[] }> {
      const universe = universeOf(category)
      await reviewsReady()
      const { ready, images } = await universe.portraits.candidates()
      if (!ready) return { ready: false, remaining: 0, items: [] }
      const all = pending(category, images)
      return { ready: true, remaining: all.length, items: all.slice(0, limit) }
    },

    async image(category: string, characterId: string, key: string): Promise<CachedImage> {
      const universe = universeOf(category)
      characterOf(universe, characterId)
      return universe.portraits.candidateImage(characterId, key)
    },

    async portrait(category: string, characterId: string): Promise<CachedImage> {
      const universe = universeOf(category)
      return universe.portraits.portraitImage(characterOf(universe, characterId))
    },

    /** Valide, bannit ou efface la décision sur une image. Renvoie le nombre d'images restant à revoir. */
    async decide(admin: Admin, category: string, characterId: string, key: string, decision: ReviewDecision): Promise<{ remaining: number }> {
      const universe = universeOf(category)
      const character = characterOf(universe, characterId)
      await reviewsReady()
      const known = universe.portraits.peekCandidates()
      if (decision !== 'clear') {
        // Seules les images candidates se jugent : jamais une clé inventée.
        if (!known) throw conflict('Les images de cet univers se chargent encore : réessaie dans un instant.', 'not_ready')
        if (!(known.get(characterId) ?? []).some((url) => reviewKey(url) === key)) throw badRequest('Cette image n’est plus candidate.', 'image_unknown')
      }
      const wasBanned = isBanned(category, characterId, key)
      const status = STATUS_OF[decision]
      await setReview(category, characterId, key, status, admin.id)
      if (status === 'BANNED' || wasBanned) await record(prisma, admin, status === 'BANNED' ? 'dle_image_ban' : 'dle_image_restore', null, { category, characterId, character: character.name, key })
      return { remaining: known ? pending(category, known).length : 0 }
    },
  }
}

export const dleReview = createDleReview(REVIEW_UNIVERSES)
