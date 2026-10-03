import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « One Piece » du BookshelfDLE : les personnages de One Piece. Fiches
 * rédigées à la main ; primes connues les plus récentes (`null` : pas de prime,
 * ou inconnue). Les clés sont traduites par le front.
 */

export const ONEPIECE_ATTRIBUTES = ['affiliation', 'fruit', 'haki', 'bounty', 'origin', 'debut'] as const
export type OnePieceAttribute = (typeof ONEPIECE_ATTRIBUTES)[number]

export type Affiliation =
  | 'straw_hat'
  | 'roger'
  | 'red_hair'
  | 'whitebeard'
  | 'blackbeard'
  | 'beasts'
  | 'big_mom'
  | 'heart'
  | 'kid'
  | 'cross_guild'
  | 'warlord'
  | 'marine'
  | 'revolutionary'
  | 'world_gov'
  | 'baroque'
  | 'wano'
  | 'kuja'
  | 'fishman'
  | 'other'
export type Fruit = 'paramecia' | 'zoan' | 'logia'
export type Haki = 'observation' | 'armament' | 'conqueror'
export type Origin = 'east_blue' | 'west_blue' | 'north_blue' | 'south_blue' | 'grand_line' | 'new_world' | 'sky' | 'unknown'

/** Arcs, dans l'ordre du récit : la première apparition se compare avec ↑ ↓. */
export const ONEPIECE_ARCS = [
  'romance_dawn',
  'orange_town',
  'syrup',
  'baratie',
  'arlong',
  'loguetown',
  'alabasta',
  'skypiea',
  'water7',
  'thriller_bark',
  'sabaody',
  'marineford',
  'fishman_island',
  'dressrosa',
  'whole_cake',
  'wano',
  'egghead',
] as const
export type OnePieceArc = (typeof ONEPIECE_ARCS)[number]

export interface OnePieceCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: Affiliation[]
  /** Types de fruits du démon mangés (Barbe Noire en a deux) ; vide : aucun. */
  fruit: Fruit[]
  haki: Haki[]
  /** Prime en berrys ; `null` : aucune, ou inconnue. */
  bounty: number | null
  origin: Origin
  debut: OnePieceArc
}

const c = (character: OnePieceCharacter) => character
const M = 1_000_000

export const ONEPIECE_CHARACTERS: OnePieceCharacter[] = [
  // Équipage du Chapeau de paille.
  c({ id: 'luffy', name: 'Monkey D. Luffy', aliases: ['Luffy', 'Chapeau de paille'], mal: ['Monkey D. Luffy', 'Luffy Monkey D.'], affiliation: ['straw_hat'], fruit: ['zoan'], haki: ['observation', 'armament', 'conqueror'], bounty: 3000 * M, origin: 'east_blue', debut: 'romance_dawn' }),
  c({ id: 'zoro', name: 'Roronoa Zoro', aliases: ['Zoro'], affiliation: ['straw_hat'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: 1111 * M, origin: 'east_blue', debut: 'romance_dawn' }),
  c({ id: 'nami', name: 'Nami', affiliation: ['straw_hat'], fruit: [], haki: [], bounty: 366 * M, origin: 'east_blue', debut: 'orange_town' }),
  c({ id: 'usopp', name: 'Usopp', affiliation: ['straw_hat'], fruit: [], haki: ['observation'], bounty: 500 * M, origin: 'east_blue', debut: 'syrup' }),
  c({ id: 'sanji', name: 'Sanji', aliases: ['Vinsmoke Sanji'], mal: ['Vinsmoke Sanji'], affiliation: ['straw_hat'], fruit: [], haki: ['observation', 'armament'], bounty: 1032 * M, origin: 'north_blue', debut: 'baratie' }),
  c({ id: 'chopper', name: 'Tony Tony Chopper', aliases: ['Chopper'], affiliation: ['straw_hat'], fruit: ['zoan'], haki: [], bounty: 1000, origin: 'grand_line', debut: 'alabasta' }),
  c({ id: 'robin', name: 'Nico Robin', aliases: ['Robin'], affiliation: ['straw_hat', 'baroque'], fruit: ['paramecia'], haki: [], bounty: 930 * M, origin: 'west_blue', debut: 'alabasta' }),
  c({ id: 'franky', name: 'Franky', affiliation: ['straw_hat'], fruit: [], haki: [], bounty: 394 * M, origin: 'south_blue', debut: 'water7' }),
  c({ id: 'brook', name: 'Brook', affiliation: ['straw_hat'], fruit: ['paramecia'], haki: [], bounty: 383 * M, origin: 'west_blue', debut: 'thriller_bark' }),
  c({ id: 'jinbe', name: 'Jinbe', aliases: ['Jimbei', 'Jinbei'], mal: ['Jinbei', 'Jinbe'], affiliation: ['straw_hat', 'fishman', 'warlord'], fruit: [], haki: ['observation', 'armament'], bounty: 1100 * M, origin: 'grand_line', debut: 'marineford' }),
  // Empereurs, anciens et nouveaux.
  c({ id: 'shanks', name: 'Shanks', aliases: ['Le Roux', 'Red-Haired Shanks'], affiliation: ['red_hair', 'roger'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: 4048.9 * M, origin: 'west_blue', debut: 'romance_dawn' }),
  c({ id: 'whitebeard', name: 'Edward Newgate', aliases: ['Barbe Blanche', 'Whitebeard'], affiliation: ['whitebeard'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 5046 * M, origin: 'new_world', debut: 'water7' }),
  c({ id: 'blackbeard', name: 'Marshall D. Teach', aliases: ['Barbe Noire', 'Blackbeard', 'Teach'], mal: ['Marshall D. Teach', 'Teach Marshall D.'], affiliation: ['blackbeard', 'whitebeard', 'warlord'], fruit: ['logia', 'paramecia'], haki: ['armament'], bounty: 3996 * M, origin: 'unknown', debut: 'skypiea' }),
  c({ id: 'kaido', name: 'Kaido', aliases: ['Kaidou'], mal: ['Kaidou'], affiliation: ['beasts'], fruit: ['zoan'], haki: ['observation', 'armament', 'conqueror'], bounty: 4611.1 * M, origin: 'grand_line', debut: 'whole_cake' }),
  c({ id: 'big-mom', name: 'Charlotte Linlin', aliases: ['Big Mom'], affiliation: ['big_mom'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 4388 * M, origin: 'new_world', debut: 'fishman_island' }),
  c({ id: 'buggy', name: 'Buggy', aliases: ['Baggy', 'Buggy le Clown'], affiliation: ['cross_guild', 'roger', 'warlord'], fruit: ['paramecia'], haki: [], bounty: 3189 * M, origin: 'unknown', debut: 'orange_town' }),
  c({ id: 'roger', name: 'Gol D. Roger', aliases: ['Gold Roger', 'Roi des pirates'], mal: ['Gol D. Roger', 'Roger Gol D.'], affiliation: ['roger'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: 5564.8 * M, origin: 'east_blue', debut: 'romance_dawn' }),
  // Supernovas et pirates.
  c({ id: 'law', name: 'Trafalgar D. Water Law', aliases: ['Law', 'Trafalgar Law'], mal: ['Trafalgar Law'], affiliation: ['heart', 'warlord'], fruit: ['paramecia'], haki: ['observation', 'armament'], bounty: 3000 * M, origin: 'north_blue', debut: 'sabaody' }),
  c({ id: 'kid', name: 'Eustass Kid', aliases: ['Kid'], mal: ['Eustass Kid', 'Kid Eustass'], affiliation: ['kid'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 3000 * M, origin: 'south_blue', debut: 'sabaody' }),
  c({ id: 'ace', name: 'Portgas D. Ace', aliases: ['Ace'], mal: ['Portgas D. Ace', 'Ace Portgas D.'], affiliation: ['whitebeard'], fruit: ['logia'], haki: ['observation', 'armament', 'conqueror'], bounty: 550 * M, origin: 'south_blue', debut: 'alabasta' }),
  c({ id: 'sabo', name: 'Sabo', affiliation: ['revolutionary'], fruit: ['logia'], haki: ['observation', 'armament'], bounty: 602 * M, origin: 'east_blue', debut: 'dressrosa' }),
  c({ id: 'marco', name: 'Marco', aliases: ['Marco le Phénix'], affiliation: ['whitebeard'], fruit: ['zoan'], haki: ['observation', 'armament'], bounty: 1374 * M, origin: 'unknown', debut: 'water7' }),
  c({ id: 'katakuri', name: 'Charlotte Katakuri', aliases: ['Katakuri'], affiliation: ['big_mom'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 1057 * M, origin: 'new_world', debut: 'whole_cake' }),
  c({ id: 'arlong', name: 'Arlong', affiliation: ['fishman'], fruit: [], haki: [], bounty: 20 * M, origin: 'grand_line', debut: 'arlong' }),
  c({ id: 'kuro', name: 'Kuro', aliases: ['Capitaine Kuro'], affiliation: ['other'], fruit: [], haki: [], bounty: 16 * M, origin: 'east_blue', debut: 'syrup' }),
  c({ id: 'bartolomeo', name: 'Bartolomeo', affiliation: ['other'], fruit: ['paramecia'], haki: [], bounty: 200 * M, origin: 'east_blue', debut: 'dressrosa' }),
  c({ id: 'carrot', name: 'Carrot', affiliation: ['other'], fruit: [], haki: ['observation'], bounty: null, origin: 'new_world', debut: 'whole_cake' }),
  // Grands corsaires.
  c({ id: 'mihawk', name: 'Dracule Mihawk', aliases: ['Mihawk', 'Œil de Faucon'], mal: ['Dracule Mihawk', 'Mihawk Dracule'], affiliation: ['cross_guild', 'warlord'], fruit: [], haki: ['observation', 'armament'], bounty: 3590 * M, origin: 'unknown', debut: 'baratie' }),
  c({ id: 'crocodile', name: 'Crocodile', aliases: ['Sir Crocodile', 'Mr. 0'], affiliation: ['cross_guild', 'baroque', 'warlord'], fruit: ['logia'], haki: [], bounty: 1965 * M, origin: 'unknown', debut: 'alabasta' }),
  c({ id: 'hancock', name: 'Boa Hancock', aliases: ['Hancock'], affiliation: ['kuja', 'warlord'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 1659 * M, origin: 'grand_line', debut: 'marineford' }),
  c({ id: 'doflamingo', name: 'Donquixote Doflamingo', aliases: ['Doflamingo', 'Joker'], mal: ['Donquixote Doflamingo', 'Doflamingo Donquixote'], affiliation: ['warlord'], fruit: ['paramecia'], haki: ['observation', 'armament', 'conqueror'], bounty: 340 * M, origin: 'north_blue', debut: 'skypiea' }),
  c({ id: 'moria', name: 'Gecko Moria', aliases: ['Moria'], affiliation: ['warlord'], fruit: ['paramecia'], haki: [], bounty: 320 * M, origin: 'west_blue', debut: 'thriller_bark' }),
  c({ id: 'kuma', name: 'Bartholomew Kuma', aliases: ['Kuma'], affiliation: ['warlord', 'revolutionary'], fruit: ['paramecia'], haki: [], bounty: 296 * M, origin: 'south_blue', debut: 'thriller_bark' }),
  // Marine et gouvernement.
  c({ id: 'garp', name: 'Monkey D. Garp', aliases: ['Garp'], mal: ['Monkey D. Garp', 'Garp Monkey D.'], affiliation: ['marine'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: null, origin: 'east_blue', debut: 'water7' }),
  c({ id: 'akainu', name: 'Sakazuki', aliases: ['Akainu', 'Amiral en chef'], affiliation: ['marine'], fruit: ['logia'], haki: ['observation', 'armament'], bounty: null, origin: 'unknown', debut: 'water7' }),
  c({ id: 'aokiji', name: 'Kuzan', aliases: ['Aokiji'], affiliation: ['marine', 'blackbeard'], fruit: ['logia'], haki: ['observation', 'armament'], bounty: null, origin: 'unknown', debut: 'water7' }),
  c({ id: 'kizaru', name: 'Borsalino', aliases: ['Kizaru'], affiliation: ['marine'], fruit: ['logia'], haki: ['observation', 'armament'], bounty: null, origin: 'unknown', debut: 'sabaody' }),
  c({ id: 'smoker', name: 'Smoker', affiliation: ['marine'], fruit: ['logia'], haki: ['armament'], bounty: null, origin: 'east_blue', debut: 'loguetown' }),
  c({ id: 'tashigi', name: 'Tashigi', affiliation: ['marine'], fruit: [], haki: ['armament'], bounty: null, origin: 'east_blue', debut: 'loguetown' }),
  c({ id: 'koby', name: 'Koby', aliases: ['Coby'], mal: ['Koby', 'Coby'], affiliation: ['marine'], fruit: [], haki: ['observation', 'armament'], bounty: null, origin: 'east_blue', debut: 'romance_dawn' }),
  c({ id: 'lucci', name: 'Rob Lucci', aliases: ['Lucci'], affiliation: ['world_gov'], fruit: ['zoan'], haki: ['observation', 'armament'], bounty: null, origin: 'unknown', debut: 'water7' }),
  c({ id: 'vegapunk', name: 'Vegapunk', aliases: ['Dr. Vegapunk'], affiliation: ['world_gov'], fruit: ['paramecia'], haki: [], bounty: null, origin: 'south_blue', debut: 'egghead' }),
  // Révolutionnaires.
  c({ id: 'dragon', name: 'Monkey D. Dragon', aliases: ['Dragon'], mal: ['Monkey D. Dragon', 'Dragon Monkey D.'], affiliation: ['revolutionary'], fruit: [], haki: [], bounty: null, origin: 'east_blue', debut: 'loguetown' }),
  c({ id: 'ivankov', name: 'Emporio Ivankov', aliases: ['Ivankov', 'Iva'], affiliation: ['revolutionary'], fruit: ['paramecia'], haki: [], bounty: null, origin: 'unknown', debut: 'marineford' }),
  // Alliés et ennemis marquants.
  c({ id: 'rayleigh', name: 'Silvers Rayleigh', aliases: ['Rayleigh'], affiliation: ['roger'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: null, origin: 'unknown', debut: 'sabaody' }),
  c({ id: 'vivi', name: 'Nefertari Vivi', aliases: ['Vivi'], affiliation: ['baroque'], fruit: [], haki: [], bounty: null, origin: 'grand_line', debut: 'alabasta' }),
  c({ id: 'bon-clay', name: 'Bon Clay', aliases: ['Mr. 2', 'Bentham'], affiliation: ['baroque'], fruit: ['paramecia'], haki: [], bounty: 32 * M, origin: 'grand_line', debut: 'alabasta' }),
  c({ id: 'enel', name: 'Enel', aliases: ['Eneru'], mal: ['Enel', 'Eneru'], affiliation: ['other'], fruit: ['logia'], haki: ['observation'], bounty: null, origin: 'sky', debut: 'skypiea' }),
  c({ id: 'perona', name: 'Perona', affiliation: ['other'], fruit: ['paramecia'], haki: [], bounty: null, origin: 'west_blue', debut: 'thriller_bark' }),
  c({ id: 'shirahoshi', name: 'Shirahoshi', affiliation: ['fishman'], fruit: [], haki: [], bounty: null, origin: 'grand_line', debut: 'fishman_island' }),
  c({ id: 'caesar', name: 'Caesar Clown', aliases: ['Caesar'], affiliation: ['other'], fruit: ['logia'], haki: [], bounty: 300 * M, origin: 'unknown', debut: 'dressrosa' }),
  c({ id: 'kinemon', name: "Kin'emon", aliases: ['Kinemon'], mal: ['Kinemon', "Kin'emon"], affiliation: ['wano'], fruit: ['paramecia'], haki: ['armament'], bounty: null, origin: 'new_world', debut: 'dressrosa' }),
  c({ id: 'momonosuke', name: 'Kozuki Momonosuke', aliases: ['Momonosuke', 'Momo'], mal: ['Kouzuki Momonosuke'], affiliation: ['wano'], fruit: ['zoan'], haki: [], bounty: null, origin: 'new_world', debut: 'dressrosa' }),
  c({ id: 'oden', name: 'Kozuki Oden', aliases: ['Oden'], mal: ['Kouzuki Oden'], affiliation: ['wano', 'whitebeard', 'roger'], fruit: [], haki: ['observation', 'armament', 'conqueror'], bounty: null, origin: 'new_world', debut: 'wano' }),
  c({ id: 'yamato', name: 'Yamato', affiliation: ['wano', 'beasts'], fruit: ['zoan'], haki: ['observation', 'armament', 'conqueror'], bounty: null, origin: 'new_world', debut: 'wano' }),
]

const arcIndex = (arc: OnePieceArc) => ONEPIECE_ARCS.indexOf(arc)

/** Paliers de prime : aucune, < 100 M, < 500 M, < 1 Md, < 3 Md, 3 Md et plus. */
export function bountyTier(bounty: number | null): number {
  if (bounty === null) return 0
  return 1 + [100 * M, 500 * M, 1000 * M, 3000 * M].filter((bound) => bounty >= bound).length
}

export function compareOnePiece(guess: OnePieceCharacter, answer: OnePieceCharacter): Record<OnePieceAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    fruit: compareSets(guess.fruit, answer.fruit),
    haki: compareSets(guess.haki, answer.haki),
    bounty: compareOrdered(bountyTier(guess.bounty), bountyTier(answer.bounty), 1),
    origin: { verdict: guess.origin === answer.origin ? 'exact' : 'wrong' },
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const onePieceValues = (character: OnePieceCharacter): Record<OnePieceAttribute, string | string[] | number | null> => ({
  affiliation: character.affiliation,
  fruit: character.fruit,
  haki: character.haki,
  bounty: character.bounty,
  origin: character.origin,
  debut: character.debut,
})
