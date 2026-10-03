import { notFound } from '../../lib/errors.js'
import { normalizeText } from '../../services/catalog.service.js'
import type { Rarity } from '../cards/boosters.logic.js'
import { TtlCache } from '../../lib/cache.js'
import { mangadexGet, type MdCollection } from '../manga/mangadex.client.js'
import { loadCover, type CachedImage } from '../manga/manga.routes.js'
import { portraitSource, seedIndex, type PortraitCharacter, type PortraitSource } from './dle.jikan.js'
import { ATTRIBUTES, compareWorks, isImageMode, valuesOf, type AttributeFeedback, type DleCategory, type DleMode, type DleWork } from './dle.logic.js'
import { dleWorks } from './dle.works.js'
import { NARUTO_ATTRIBUTES, NARUTO_CHARACTERS, characterValues, compareCharacters } from './naruto.characters.js'
import { JJK_ATTRIBUTES, JJK_CHARACTERS, compareJjk, jjkValues } from './jjk.characters.js'
import { JOJO_ATTRIBUTES, JOJO_CHARACTERS, compareJojo, jojoValues } from './jojo.characters.js'
import { ONEPIECE_ATTRIBUTES, ONEPIECE_CHARACTERS, compareOnePiece, onePieceValues } from './onepiece.characters.js'

/*
 * Une catégorie du BookshelfDLE, vue par l'énigme du jour et les salons : ce
 * qu'on devine (œuvres, personnages), comment on compare deux propositions, ce
 * qu'on montre d'une proposition, et l'image du format zoom (couverture, portrait).
 */

/** Ce qu'on devine : une œuvre du set de cartes, un personnage… */
export interface DleEntity {
  id: string
  name: string
  /** Vignette de la saisie et du plateau. */
  imageUrl: string
}

/** Ce qu'on montre d'une proposition (ou de la réponse, une fois trouvée). */
export interface EntitySummary {
  id: string
  name: string
  imageUrl: string
  /** Œuvre : sa carte (rareté, numéro d'album). Personnage : `null`. */
  rarity: Rarity | null
  number: number | null
}

export interface DlePool {
  list: DleEntity[]
  byId: Map<string, DleEntity>
  /** Texte de recherche (autres titres, autres noms), minuscules sans accents. */
  search: Map<string, string>
}

export interface DleGame {
  category: DleCategory
  /** Colonnes du mode classique, dans l'ordre. */
  attributes: readonly string[]
  pool: () => Promise<DlePool>
  /**
   * Jouables dans les formats à image. `pick` : celles qu'on peut TIRER (une image
   * d'énigme différente de leur vignette) ; `any` : celles qu'on peut encore servir
   * (une énigme déjà tirée reste jouable même si sa galerie a changé depuis).
   */
  zoomPool: (scope?: 'pick' | 'any') => Promise<DleEntity[]>
  compare: (guess: DleEntity, answer: DleEntity) => Record<string, AttributeFeedback>
  values: (entity: DleEntity) => Record<string, unknown>
  summary: (entity: DleEntity) => EntitySummary
  /**
   * Image d'énigme des formats à image, servie sans jamais révéler son adresse : une
   * AUTRE image que la vignette de la saisie (autre tome, autre portrait), choisie par
   * `seed` — la même pour tous les joueurs d'une énigme.
   */
  image: (entity: DleEntity, seed: string) => Promise<CachedImage>
}

/* ---- Mangas et manhwas ---------------------------------------------------------- */

const mangaGame: DleGame = {
  category: 'manga',
  attributes: ATTRIBUTES,
  pool: () => dleWorks(),
  zoomPool: async () => (await dleWorks()).list,
  compare: (guess, answer) => compareWorks(guess as DleWork, answer as DleWork),
  values: (entity) => ({ ...valuesOf(entity as DleWork) }),
  summary: (entity) => {
    const work = entity as DleWork
    return { id: work.id, name: work.name, imageUrl: work.imageUrl, rarity: work.rarity, number: work.number }
  },
  image: async (entity, seed) => {
    // `/api/covers/<mangaId>/<fichier>?size=512` → les octets, sans renvoyer l'adresse.
    const match = /^\/api\/covers\/([^/]+)\/([^/?]+)/.exec(entity.imageUrl)
    if (!match) throw notFound('Couverture indisponible.')
    const [, mangaId, fileName] = match as unknown as [string, string, string]
    // Une autre couverture de l'œuvre (un autre tome) : la vignette de la saisie ne trahit rien.
    const others = (await otherCovers(mangaId).catch(() => [])).filter((file) => file !== fileName)
    if (others.length > 0) {
      const chosen = others[seedIndex(seed, others.length)] as string
      try {
        return await loadCover(mangaId, chosen, 512)
      } catch {
        // Couverture introuvable : celle de la carte, plutôt qu'une énigme sans image.
      }
    }
    return loadCover(mangaId, fileName, 512)
  },
}

interface MdCover {
  attributes?: { fileName?: string }
}

const coversCache = new TtlCache<string[]>({ maxEntries: 400, ttlMs: 24 * 60 * 60 * 1000 })

/** Les couvertures d'une œuvre sur MangaDex (un fichier par tome), lues une fois par jour. */
function otherCovers(mangaId: string): Promise<string[]> {
  return coversCache.getOrLoad(mangaId, async () => {
    const payload = await mangadexGet<MdCollection<MdCover>>('/cover', { 'manga[]': [mangaId], 'limit': 40, 'order[volume]': 'asc' })
    return payload.data.map((cover) => cover.attributes?.fileName).filter((file): file is string => typeof file === 'string')
  })
}

/* ---- Univers de personnages (Naruto, One Piece) ------------------------------------- */

/** Vignette d'un personnage : relayée par l'API (cf. `dle.jikan.ts`). */
export const characterImageUrl = (category: DleCategory, id: string) =>
  `/api/dle/characters/${category}/${encodeURIComponent(id)}/image`

interface CharacterUniverse<C extends PortraitCharacter> {
  category: DleCategory
  attributes: readonly string[]
  characters: readonly C[]
  compare: (guess: C, answer: C) => Record<string, AttributeFeedback>
  values: (character: C) => Record<string, unknown>
  portraits: PortraitSource
}

/** Une catégorie de personnages : fiches rédigées à la main, portraits MyAnimeList. */
function characterGame<C extends PortraitCharacter>(
  universe: CharacterUniverse<C>,
): DleGame & { character: (id: string) => (C & DleEntity) | undefined; thumbnail: (entity: DleEntity) => Promise<CachedImage> } {
  type Entity = C & DleEntity
  const list: Entity[] = universe.characters.map((character) => ({ ...character, imageUrl: characterImageUrl(universe.category, character.id) }))
  const pool: DlePool = {
    list,
    byId: new Map(list.map((entity) => [entity.id, entity])),
    search: new Map(list.map((entity) => [entity.id, normalizeText([...(entity.aliases ?? []), ...(entity.mal ?? [])].join(' '))])),
  }
  return {
    category: universe.category,
    attributes: universe.attributes,
    pool: async () => pool,
    zoomPool: async (scope = 'pick') => {
      const playable = scope === 'pick' ? await universe.portraits.charactersWithPuzzleImage() : await universe.portraits.charactersWithPortrait()
      return list.filter((entity) => playable.has(entity.id))
    },
    compare: (guess, answer) => universe.compare(guess as Entity, answer as Entity),
    values: (entity) => universe.values(entity as Entity),
    summary: (entity) => ({ id: entity.id, name: entity.name, imageUrl: entity.imageUrl, rarity: null, number: null }),
    image: (entity, seed) => universe.portraits.puzzleImage(entity as Entity, seed),
    thumbnail: (entity: DleEntity) => universe.portraits.portraitImage(entity as Entity),
    character: (id) => pool.byId.get(id) as Entity | undefined,
  }
}

/** Les séries de chaque univers sur MyAnimeList (Jikan) et Kitsu, et son wiki Fandom. */
export const narutoPortraits = portraitSource('Naruto', [20, 1735], [11, 1555], 'naruto.fandom.com', NARUTO_CHARACTERS)
export const onePiecePortraits = portraitSource('One Piece', [21], [12], 'onepiece.fandom.com', ONEPIECE_CHARACTERS)
/** JoJo : les six saisons de l'anime (parties 1 à 6) ; au-delà, la recherche par nom. */
export const jojoPortraits = portraitSource('JoJo', [14719, 20899, 26055, 31933, 37991, 48661], [7158, 8063, 8739, 11459, 41410, 44294], 'jojo.fandom.com', JOJO_CHARACTERS)
/** Jujutsu Kaisen : les deux saisons de l'anime et le film Jujutsu Kaisen 0. */
export const jjkPortraits = portraitSource('Jujutsu Kaisen', [40748, 51009, 48561], [42765, 45857, 44212], 'jujutsu-kaisen.fandom.com', JJK_CHARACTERS)

const narutoGame = characterGame({
  category: 'naruto',
  attributes: NARUTO_ATTRIBUTES,
  characters: NARUTO_CHARACTERS,
  compare: compareCharacters,
  values: characterValues,
  portraits: narutoPortraits,
})

const onePieceGame = characterGame({
  category: 'onepiece',
  attributes: ONEPIECE_ATTRIBUTES,
  characters: ONEPIECE_CHARACTERS,
  compare: compareOnePiece,
  values: onePieceValues,
  portraits: onePiecePortraits,
})

const jojoGame = characterGame({
  category: 'jojo',
  attributes: JOJO_ATTRIBUTES,
  characters: JOJO_CHARACTERS,
  compare: compareJojo,
  values: jojoValues,
  portraits: jojoPortraits,
})

const jjkGame = characterGame({
  category: 'jjk',
  attributes: JJK_ATTRIBUTES,
  characters: JJK_CHARACTERS,
  compare: compareJjk,
  values: jjkValues,
  portraits: jjkPortraits,
})

const CHARACTER_GAMES = { naruto: narutoGame, onepiece: onePieceGame, jojo: jojoGame, jjk: jjkGame } satisfies Record<Exclude<DleCategory, 'manga'>, unknown>

/** Un personnage d'une catégorie de personnages, et son portrait ; `undefined` sinon. */
export function characterOf(category: DleCategory, id: string): { character: PortraitCharacter; image: () => Promise<CachedImage> } | undefined {
  const game = category === 'manga' ? null : CHARACTER_GAMES[category]
  const character = game?.character(id)
  if (!game || !character) return undefined
  // La vignette (saisie, plateau) : le portrait principal, jamais une image d'énigme.
  return { character, image: () => game.thumbnail(character) }
}

const GAMES: Record<DleCategory, DleGame> = { manga: mangaGame, ...CHARACTER_GAMES }

export const gameOf = (category: DleCategory): DleGame => GAMES[category]

/**
 * Pool d'un format : tout pour le classique ; pour les formats à image, ce qu'on peut tirer
 * (`pick`) ou ce qu'on peut encore servir (`any`, une énigme déjà tirée).
 */
export const poolFor = async (game: DleGame, mode: DleMode, scope: 'pick' | 'any' = 'pick'): Promise<DleEntity[]> =>
  isImageMode(mode) ? game.zoomPool(scope) : (await game.pool()).list

/* ---- Essais ------------------------------------------------------------------------- */

/** Un essai, tel que le joueur le revoit. */
export interface GuessResult {
  work: EntitySummary
  correct: boolean
  /** Mode classique : verdict de chaque attribut, et les valeurs de la proposition. */
  feedback: Record<string, AttributeFeedback> | null
  values: Record<string, unknown> | null
}

export function guessResult(game: DleGame, mode: DleMode, guess: DleEntity, answer: DleEntity): GuessResult {
  return {
    work: game.summary(guess),
    correct: guess.id === answer.id,
    feedback: mode === 'classic' ? game.compare(guess, answer) : null,
    values: mode === 'classic' ? game.values(guess) : null,
  }
}
