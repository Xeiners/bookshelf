import { compareOrdered, compareSets, type AttributeFeedback } from '../dle.logic.js'

/*
 * Catégorie « Fire Force » du BookshelfDLE : la Compagnie 8, les autres Compagnies spéciales de
 * pompiers, le Temple du Soleil Sacré et les Vêtus de Blanc. Fiches rédigées à la main d'après les
 * wikis de l'œuvre ; la génération de pyrokinésiste est celle de la fiche officielle (`none` : aucun
 * pouvoir de feu) ; l'apparition se compte par saison de l'anime. Les clés sont traduites par le front.
 */

export const FIREFORCE_ATTRIBUTES = ['affiliation', 'power', 'role', 'gender', 'hair', 'debut'] as const
export type FireForceAttribute = (typeof FIREFORCE_ATTRIBUTES)[number]

export type FireForceAffiliation = 'company_8' | 'fire_force' | 'academy' | 'holy_sol' | 'white_clad' | 'haijima' | 'empire'

/** Génération de pyrokinésiste : seconde (manipule les flammes), troisième (les produit aussi) ; `none` : aucun pouvoir de feu. */
export type FireForcePower = 'second' | 'third' | 'none'
export type FireForceRole = 'firefighter' | 'captain' | 'villain' | 'scientist' | 'clergy'
/** Couleurs de cheveux ; `none` : chauve, capuche, casque. */
export type FireForceHair = 'black' | 'brown' | 'blond' | 'red' | 'white' | 'blue' | 'pink' | 'none'

/** Saisons de l'anime, dans l'ordre : la première apparition se compare avec ↑ ↓. */
export const FIREFORCE_ARCS = ['season_1', 'season_2', 'season_3'] as const
export type FireForceArc = (typeof FIREFORCE_ARCS)[number]

export interface FireForceCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: FireForceAffiliation[]
  power: FireForcePower
  role: FireForceRole
  gender: 'male' | 'female'
  hair: FireForceHair[]
  debut: FireForceArc
}

const c = (character: FireForceCharacter) => character

export const FIREFORCE_CHARACTERS: FireForceCharacter[] = [
  // La Compagnie 8.
  c({ id: 'shinra', name: 'Shinra Kusakabe', aliases: ['Shinra', 'Kusakabe', 'Pas du Diable', 'Devil’s Footprints'], mal: ['Kusakabe Shinra', 'Shinra Kusakabe'], affiliation: ['company_8', 'academy'], power: 'third', role: 'firefighter', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'arthur', name: 'Arthur Boyle', aliases: ['Arthur', 'Boyle', 'Excalibur', 'Le chevalier'], mal: ['Arthur Boyle'], affiliation: ['company_8', 'academy'], power: 'third', role: 'firefighter', gender: 'male', hair: ['blond'], debut: 'season_1' }),
  c({ id: 'maki', name: 'Maki Oze', aliases: ['Maki', 'Oze'], mal: ['Oze Maki', 'Maki Oze'], affiliation: ['company_8', 'academy'], power: 'second', role: 'firefighter', gender: 'female', hair: ['black'], debut: 'season_1' }),
  c({ id: 'tamaki', name: 'Tamaki Kotatsu', aliases: ['Tamaki', 'Kotatsu', 'Nekomata', 'Lucky Lewd'], mal: ['Kotatsu Tamaki', 'Tamaki Kotatsu'], affiliation: ['company_8', 'academy'], power: 'third', role: 'firefighter', gender: 'female', hair: ['black'], debut: 'season_1' }),
  c({ id: 'iris', name: 'Iris', aliases: ['Sœur Iris', 'Sister Iris'], mal: ['Iris'], affiliation: ['company_8', 'holy_sol'], power: 'none', role: 'clergy', gender: 'female', hair: ['blond'], debut: 'season_1' }),
  c({ id: 'hinawa', name: 'Takehisa Hinawa', aliases: ['Hinawa', 'Takehisa', 'Lieutenant Hinawa'], mal: ['Hinawa Takehisa', 'Takehisa Hinawa'], affiliation: ['company_8'], power: 'second', role: 'firefighter', gender: 'male', hair: ['brown'], debut: 'season_1' }),
  c({ id: 'obi', name: 'Akitaru Obi', aliases: ['Obi', 'Oubi', 'Akitaru', 'Capitaine Obi'], mal: ['Ōbi Akitaru', 'Akitaru Obi', 'Obi Akitaru'], affiliation: ['company_8'], power: 'none', role: 'captain', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'vulcan', name: 'Vulcan Joseph', aliases: ['Vulcan', 'Joseph', 'Dieu du feu et de la forge'], mal: ['Vulcan Joseph', 'Joseph Vulcan'], affiliation: ['company_8'], power: 'none', role: 'scientist', gender: 'male', hair: ['red'], debut: 'season_1' }),
  c({ id: 'viktor', name: 'Viktor Licht', aliases: ['Viktor', 'Victor', 'Licht', 'Victor Licht'], mal: ['Viktor Licht', 'Victor Licht'], affiliation: ['company_8', 'haijima'], power: 'none', role: 'scientist', gender: 'male', hair: ['brown'], debut: 'season_1' }),
  // Les autres Compagnies spéciales.
  c({ id: 'burns', name: 'Leonard Burns', aliases: ['Burns', 'Leonard', 'Leonardo Burns', 'Capitaine Burns'], mal: ['Leonard Burns', 'Burns Leonard'], affiliation: ['fire_force'], power: 'third', role: 'captain', gender: 'male', hair: ['white'], debut: 'season_1' }),
  c({ id: 'rekka', name: 'Rekka Hoshimiya', aliases: ['Rekka', 'Hoshimiya'], mal: ['Hoshimiya Rekka', 'Rekka Hoshimiya'], affiliation: ['fire_force'], power: 'third', role: 'firefighter', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'benimaru', name: 'Benimaru Shinmon', aliases: ['Benimaru', 'Shinmon', 'Le plus fort pompier'], mal: ['Shinmon Benimaru', 'Benimaru Shinmon'], affiliation: ['fire_force'], power: 'third', role: 'captain', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'hibana', name: 'Princesse Hibana', aliases: ['Hibana', 'Princess Hibana'], mal: ['Hibana', 'Princess Hibana'], wiki: 'Hibana', affiliation: ['fire_force', 'holy_sol', 'empire'], power: 'third', role: 'captain', gender: 'female', hair: ['pink'], debut: 'season_1' }),
  c({ id: 'ogun', name: 'Ogun Montgomery', aliases: ['Ogun', 'Montgomery'], mal: ['Montgomery Ogun', 'Ogun Montgomery'], affiliation: ['fire_force', 'academy'], power: 'third', role: 'firefighter', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'takeru', name: 'Takeru Noto', aliases: ['Takeru', 'Noto', 'Juggernaut', 'Potato Noto'], mal: ['Noto Takeru', 'Takeru Noto'], affiliation: ['fire_force'], power: 'third', role: 'firefighter', gender: 'male', hair: ['brown'], debut: 'season_1' }),
  // Le Temple du Soleil Sacré.
  c({ id: 'sumire', name: 'Sumire', aliases: ['Sœur Sumire', 'Sister Sumire'], mal: ['Sumire'], affiliation: ['holy_sol'], power: 'none', role: 'clergy', gender: 'female', hair: ['none'], debut: 'season_2' }),
  // Les Vêtus de Blanc.
  c({ id: 'haumea', name: 'Haumea', aliases: ['Seconde Colonne', 'Second Pillar'], mal: ['Haumea'], affiliation: ['white_clad'], power: 'third', role: 'villain', gender: 'female', hair: ['blond'], debut: 'season_1' }),
  c({ id: 'charon', name: 'Charon', aliases: ['Gardien de la Seconde Colonne'], mal: ['Charon'], affiliation: ['white_clad'], power: 'third', role: 'villain', gender: 'male', hair: ['white'], debut: 'season_2' }),
  c({ id: 'sho', name: 'Sho Kusakabe', aliases: ['Sho', 'Shō Kusakabe', 'Shō', 'Troisième Colonne', 'Third Pillar'], mal: ['Kusakabe Shou', 'Shō Kusakabe', 'Sho Kusakabe'], affiliation: ['white_clad'], power: 'third', role: 'villain', gender: 'male', hair: ['white'], debut: 'season_1' }),
  c({ id: 'inca', name: 'Inca Kasugatani', aliases: ['Inca', 'Kasugatani'], mal: ['Kasugatani Inca', 'Inca Kasugatani'], affiliation: ['white_clad'], power: 'second', role: 'villain', gender: 'female', hair: ['pink'], debut: 'season_2' }),
  c({ id: 'joker', name: 'Joker', aliases: ['Le Joker'], mal: ['Joker'], affiliation: ['white_clad'], power: 'third', role: 'villain', gender: 'male', hair: ['black'], debut: 'season_1' }),
  c({ id: 'ritsu', name: 'Ritsu', aliases: ['Commandante Ritsu', 'Cinquième Colonne', 'Fifth Pillar'], mal: ['Ritsu'], affiliation: ['white_clad'], power: 'second', role: 'villain', gender: 'female', hair: ['blue'], debut: 'season_2' }),
  c({ id: 'evangelist', name: 'Évangéliste', aliases: ['Evangelist', 'The Evangelist', 'L’Évangéliste', 'Evangéliste'], mal: ['Evangelist'], wiki: 'Evangelist', affiliation: ['white_clad'], power: 'third', role: 'villain', gender: 'female', hair: ['none'], debut: 'season_1' }),
]

const arcIndex = (arc: FireForceArc) => FIREFORCE_ARCS.indexOf(arc)

export function compareFireForce(guess: FireForceCharacter, answer: FireForceCharacter): Record<FireForceAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    power: { verdict: guess.power === answer.power ? 'exact' : 'wrong' },
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    hair: compareSets(guess.hair, answer.hair),
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const fireForceValues = (character: FireForceCharacter): Record<FireForceAttribute, string | string[] | number> => ({
  affiliation: character.affiliation,
  power: character.power,
  role: character.role,
  gender: character.gender,
  hair: character.hair,
  debut: character.debut,
})
