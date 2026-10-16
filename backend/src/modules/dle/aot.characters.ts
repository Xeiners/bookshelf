import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « L'Attaque des Titans » du BookshelfDLE : soldats, Titans-métamorphes, Marleyens et
 * Eldiens du manga et de l'anime. Fiches rédigées à la main ; les tailles sont celles des
 * guides officiels (arrondies pour les personnages secondaires) ; le statut est celui de la
 * fin du manga ; les clés sont traduites par le front.
 */

export const AOT_ATTRIBUTES = ['affiliation', 'titan', 'role', 'gender', 'hair', 'height', 'status', 'debut'] as const
export type AotAttribute = (typeof AOT_ATTRIBUTES)[number]

export type AotAffiliation =
  | 'survey'
  | 'garrison'
  | 'mp'
  | 'training'
  | 'warriors'
  | 'marley_army'
  | 'yeagerists'
  | 'volunteers'
  | 'royal'
  | 'hizuru'
  | 'other'

/** Pouvoirs de Titan détenus à un moment du récit ; `pure` : a été un Titan pur. Vide : aucun. */
export type AotTitan = 'attack' | 'founding' | 'armored' | 'colossal' | 'female' | 'beast' | 'jaw' | 'cart' | 'warhammer' | 'pure'
export type AotRole = 'soldier' | 'officer' | 'warrior' | 'civilian' | 'noble'
/** Couleurs de cheveux ; `none` : chauve, casque. */
export type AotHair = 'black' | 'brown' | 'blond' | 'red' | 'grey' | 'white' | 'none'

/** Arcs, dans l'ordre : la première apparition se compare avec ↑ ↓. */
export const AOT_ARCS = [
  'shiganshina',
  'training',
  'trost',
  'trial',
  'female_titan',
  'stohess',
  'utgard',
  'uprising',
  'reclamation',
  'marley',
  'paradis',
] as const
export type AotArc = (typeof AOT_ARCS)[number]

export interface AotCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: AotAffiliation[]
  titan: AotTitan[]
  role: AotRole
  gender: 'male' | 'female'
  hair: AotHair[]
  /** Taille officielle (cm). */
  height: number
  status: 'alive' | 'dead'
  debut: AotArc
}

const c = (character: AotCharacter) => character

export const AOT_CHARACTERS: AotCharacter[] = [
  // La chute de Shiganshina.
  c({ id: 'eren', name: 'Eren Yeager', aliases: ['Eren', 'Yeager', 'Jaeger', 'Eren Jäger', 'Jäger'], affiliation: ['survey', 'training', 'yeagerists'], titan: ['attack', 'founding'], role: 'soldier', gender: 'male', hair: ['brown'], height: 170, status: 'dead', debut: 'shiganshina' }),
  c({ id: 'mikasa', name: 'Mikasa Ackerman', aliases: ['Mikasa', 'Ackerman'], affiliation: ['survey', 'training'], titan: [], role: 'soldier', gender: 'female', hair: ['black'], height: 170, status: 'alive', debut: 'shiganshina' }),
  c({ id: 'armin', name: 'Armin Arlert', aliases: ['Armin', 'Arlert', 'Arlelt'], affiliation: ['survey', 'training'], titan: ['colossal'], role: 'soldier', gender: 'male', hair: ['blond'], height: 163, status: 'alive', debut: 'shiganshina' }),
  c({ id: 'carla', name: 'Carla Yeager', aliases: ['Carla', 'Carla Jäger'], affiliation: ['other'], titan: [], role: 'civilian', gender: 'female', hair: ['brown'], height: 160, status: 'dead', debut: 'shiganshina' }),
  c({ id: 'grisha', name: 'Grisha Yeager', aliases: ['Grisha', 'Grisha Jäger'], affiliation: ['volunteers', 'other'], titan: ['attack', 'founding'], role: 'civilian', gender: 'male', hair: ['black'], height: 183, status: 'dead', debut: 'shiganshina' }),
  c({ id: 'hannes', name: 'Hannes', aliases: ['Hannes de la Garnison'], affiliation: ['garrison'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 190, status: 'dead', debut: 'shiganshina' }),
  c({ id: 'dina', name: 'Dina Fritz', aliases: ['Dina', 'Titan souriant', 'Smiling Titan'], affiliation: ['other'], titan: ['pure'], role: 'civilian', gender: 'female', hair: ['brown'], height: 165, status: 'dead', debut: 'shiganshina' }),
  // L'école des cadets, la 104e promotion.
  c({ id: 'jean', name: 'Jean Kirstein', aliases: ['Jean', 'Kirstein', 'Kirschtein'], mal: ['Jean Kirschtein'], affiliation: ['survey', 'training'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 175, status: 'alive', debut: 'training' }),
  c({ id: 'connie', name: 'Connie Springer', aliases: ['Connie', 'Springer', 'Conny'], affiliation: ['survey', 'training'], titan: ['pure'], role: 'soldier', gender: 'male', hair: ['black'], height: 158, status: 'alive', debut: 'training' }),
  c({ id: 'sasha', name: 'Sasha Blouse', aliases: ['Sasha', 'Braus', 'Sasha Braus', 'Blouse'], mal: ['Sasha Braus'], affiliation: ['survey', 'training'], titan: [], role: 'soldier', gender: 'female', hair: ['brown'], height: 168, status: 'dead', debut: 'training' }),
  c({ id: 'reiner', name: 'Reiner Braun', aliases: ['Reiner', 'Braun', 'Titan cuirassé'], affiliation: ['warriors', 'survey', 'training'], titan: ['armored'], role: 'warrior', gender: 'male', hair: ['blond'], height: 185, status: 'alive', debut: 'training' }),
  c({ id: 'bertholdt', name: 'Bertholdt Hoover', aliases: ['Bertholdt', 'Bertolt', 'Hoover', 'Berthold', 'Titan colossal'], mal: ['Bertolt Hoover'], affiliation: ['warriors', 'survey', 'training'], titan: ['colossal'], role: 'warrior', gender: 'male', hair: ['black'], height: 192, status: 'dead', debut: 'training' }),
  c({ id: 'annie', name: 'Annie Leonhart', aliases: ['Annie', 'Leonhart', 'Leonhardt', 'Titan féminin'], affiliation: ['warriors', 'mp', 'training'], titan: ['female'], role: 'warrior', gender: 'female', hair: ['blond'], height: 153, status: 'alive', debut: 'training' }),
  c({ id: 'historia', name: 'Historia Reiss', aliases: ['Historia', 'Krista', 'Krista Lenz', 'Reiss', 'Christa'], mal: ['Krista Lenz'], affiliation: ['survey', 'training', 'royal'], titan: [], role: 'noble', gender: 'female', hair: ['blond'], height: 145, status: 'alive', debut: 'training' }),
  c({ id: 'ymir', name: 'Ymir', aliases: ['Ymir la rousse'], mal: ['Ymir'], affiliation: ['survey', 'training'], titan: ['jaw'], role: 'soldier', gender: 'female', hair: ['brown'], height: 169, status: 'dead', debut: 'training' }),
  c({ id: 'marco', name: 'Marco Bott', aliases: ['Marco', 'Bott', 'Marco Bodt'], mal: ['Marco Bott'], affiliation: ['training'], titan: [], role: 'soldier', gender: 'male', hair: ['black'], height: 175, status: 'dead', debut: 'training' }),
  c({ id: 'thomas', name: 'Thomas Wagner', aliases: ['Thomas', 'Wagner'], affiliation: ['training', 'survey'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 172, status: 'dead', debut: 'training' }),
  c({ id: 'mina', name: 'Mina Carolina', aliases: ['Mina', 'Carolina'], affiliation: ['training'], titan: [], role: 'soldier', gender: 'female', hair: ['black'], height: 160, status: 'dead', debut: 'training' }),
  c({ id: 'franz', name: 'Franz Kefka', aliases: ['Franz', 'Kefka'], affiliation: ['training', 'garrison'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 171, status: 'dead', debut: 'training' }),
  c({ id: 'hannah', name: 'Hannah Diamant', aliases: ['Hannah', 'Diamant'], affiliation: ['training', 'garrison'], titan: [], role: 'soldier', gender: 'female', hair: ['blond'], height: 160, status: 'dead', debut: 'training' }),
  c({ id: 'daz', name: 'Daz', aliases: ['Daz le cadet'], affiliation: ['training', 'garrison'], titan: [], role: 'soldier', gender: 'male', hair: ['blond'], height: 175, status: 'dead', debut: 'training' }),
  c({ id: 'shadis', name: 'Keith Shadis', aliases: ['Shadis', 'Keith', 'Instructeur Shadis'], affiliation: ['training', 'survey'], titan: [], role: 'officer', gender: 'male', hair: ['none'], height: 185, status: 'dead', debut: 'training' }),
  // La bataille de Trost.
  c({ id: 'pixis', name: 'Dot Pixis', aliases: ['Pixis', 'Dot', 'Commandant Pixis'], affiliation: ['garrison'], titan: [], role: 'officer', gender: 'male', hair: ['none'], height: 195, status: 'alive', debut: 'trost' }),
  c({ id: 'rico', name: 'Rico Brzenska', aliases: ['Rico', 'Brzenska'], affiliation: ['garrison'], titan: [], role: 'officer', gender: 'female', hair: ['brown'], height: 168, status: 'dead', debut: 'trost' }),
  c({ id: 'ian', name: 'Ian Dietrich', aliases: ['Ian', 'Dietrich'], affiliation: ['garrison'], titan: [], role: 'officer', gender: 'male', hair: ['blond'], height: 178, status: 'dead', debut: 'trost' }),
  c({ id: 'floch', name: 'Floch Forster', aliases: ['Floch', 'Forster'], affiliation: ['survey', 'yeagerists', 'training'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 177, status: 'dead', debut: 'trost' }),
  // Le procès d'Eren et le Bataillon d'exploration.
  c({ id: 'levi', name: 'Levi Ackerman', aliases: ['Levi', 'Livaï', 'Livai', 'Rivaille', 'Ackerman'], affiliation: ['survey'], titan: [], role: 'officer', gender: 'male', hair: ['black'], height: 160, status: 'alive', debut: 'trial' }),
  c({ id: 'erwin', name: 'Erwin Smith', aliases: ['Erwin', 'Smith', 'Commandant Erwin'], affiliation: ['survey'], titan: [], role: 'officer', gender: 'male', hair: ['blond'], height: 188, status: 'dead', debut: 'trial' }),
  c({ id: 'hange', name: 'Hange Zoë', aliases: ['Hange', 'Hanji', 'Hansi', 'Zoe', 'Hange Zoe', 'Hanji Zoe'], mal: ['Hange Zoe', 'Hanji Zoe'], affiliation: ['survey'], titan: [], role: 'officer', gender: 'female', hair: ['brown'], height: 170, status: 'dead', debut: 'trial' }),
  c({ id: 'mike', name: 'Mike Zacharias', aliases: ['Mike', 'Zacharias', 'Zacharius'], mal: ['Mike Zacharius'], affiliation: ['survey'], titan: [], role: 'officer', gender: 'male', hair: ['blond'], height: 191, status: 'dead', debut: 'trial' }),
  c({ id: 'nanaba', name: 'Nanaba', aliases: ['Nanaba du Bataillon'], affiliation: ['survey'], titan: [], role: 'officer', gender: 'female', hair: ['blond'], height: 177, status: 'dead', debut: 'trial' }),
  c({ id: 'moblit', name: 'Moblit Berner', aliases: ['Moblit', 'Berner'], affiliation: ['survey'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 181, status: 'dead', debut: 'trial' }),
  c({ id: 'nile', name: 'Nile Dok', aliases: ['Nile', 'Dok', 'Nile Dawk', 'Dawk'], affiliation: ['mp'], titan: [], role: 'officer', gender: 'male', hair: ['brown'], height: 182, status: 'alive', debut: 'trial' }),
  c({ id: 'zackly', name: 'Darius Zackly', aliases: ['Zackly', 'Darius', 'Commandant en chef'], affiliation: ['royal', 'garrison'], titan: [], role: 'officer', gender: 'male', hair: ['grey'], height: 175, status: 'alive', debut: 'trial' }),
  // La 57e expédition hors les murs.
  c({ id: 'petra', name: 'Petra Ral', aliases: ['Petra', 'Ral'], affiliation: ['survey'], titan: [], role: 'soldier', gender: 'female', hair: ['brown'], height: 155, status: 'dead', debut: 'female_titan' }),
  c({ id: 'oluo', name: 'Oluo Bozado', aliases: ['Oluo', 'Bozado', 'Olvo'], affiliation: ['survey'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 168, status: 'dead', debut: 'female_titan' }),
  c({ id: 'erd', name: 'Erd Gin', aliases: ['Erd', 'Gin', 'Eld Jinn', 'Eld'], affiliation: ['survey'], titan: [], role: 'soldier', gender: 'male', hair: ['blond'], height: 183, status: 'dead', debut: 'female_titan' }),
  c({ id: 'gunther', name: 'Gunther Schultz', aliases: ['Gunther', 'Schultz', 'Günther'], affiliation: ['survey'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 182, status: 'dead', debut: 'female_titan' }),
  // Stohess, le Titan colossal et le Titan cuirassé.
  c({ id: 'hitch', name: 'Hitch Dreyse', aliases: ['Hitch', 'Dreyse'], affiliation: ['mp'], titan: [], role: 'soldier', gender: 'female', hair: ['brown'], height: 167, status: 'alive', debut: 'stohess' }),
  c({ id: 'marlo', name: 'Marlo Freudenberg', aliases: ['Marlo', 'Freudenberg'], affiliation: ['mp', 'training'], titan: [], role: 'soldier', gender: 'male', hair: ['brown'], height: 170, status: 'alive', debut: 'stohess' }),
  // Utgard, Ymir et la découverte du Titan bestial.
  c({ id: 'zeke', name: 'Zeke Yeager', aliases: ['Zeke', 'Zeke Jäger', 'Titan bestial', 'Beast Titan'], affiliation: ['warriors', 'marley_army', 'yeagerists'], titan: ['beast'], role: 'warrior', gender: 'male', hair: ['blond'], height: 186, status: 'dead', debut: 'utgard' }),
  c({ id: 'frieda', name: 'Frieda Reiss', aliases: ['Frieda', 'Reiss'], affiliation: ['royal'], titan: ['founding'], role: 'noble', gender: 'female', hair: ['blond'], height: 165, status: 'dead', debut: 'utgard' }),
  // Le coup d'État contre le roi.
  c({ id: 'kenny', name: 'Kenny Ackerman', aliases: ['Kenny', 'Kenny l’Éventreur', 'Kenny the Ripper'], affiliation: ['mp'], titan: [], role: 'officer', gender: 'male', hair: ['black'], height: 175, status: 'dead', debut: 'uprising' }),
  c({ id: 'rod', name: 'Rod Reiss', aliases: ['Rod', 'Roi Reiss'], affiliation: ['royal'], titan: ['pure'], role: 'noble', gender: 'male', hair: ['grey'], height: 170, status: 'dead', debut: 'uprising' }),
  c({ id: 'uri', name: 'Uri Reiss', aliases: ['Uri', 'Roi Uri'], affiliation: ['royal'], titan: ['founding'], role: 'noble', gender: 'male', hair: ['blond'], height: 175, status: 'dead', debut: 'uprising' }),
  c({ id: 'dimo', name: 'Dimo Reeve', aliases: ['Dimo', 'Reeve', 'Reeves'], affiliation: ['other'], titan: [], role: 'civilian', gender: 'male', hair: ['grey'], height: 172, status: 'dead', debut: 'uprising' }),
  // La reprise de Wall Maria, la cave et les souvenirs de Grisha.
  c({ id: 'kruger', name: 'Eren Kruger', aliases: ['Kruger', 'Krueger', 'Eren Krüger'], affiliation: ['volunteers'], titan: ['attack'], role: 'civilian', gender: 'male', hair: ['black'], height: 178, status: 'dead', debut: 'reclamation' }),
  c({ id: 'sannes', name: 'Sannes', aliases: ['Sannes de Shiganshina'], affiliation: ['garrison'], titan: [], role: 'soldier', gender: 'male', hair: ['none'], height: 178, status: 'dead', debut: 'reclamation' }),
  // Marley.
  c({ id: 'pieck', name: 'Pieck Finger', aliases: ['Pieck', 'Finger', 'Pieck Fingers', 'Titan charrette'], affiliation: ['warriors', 'marley_army', 'yeagerists'], titan: ['cart'], role: 'warrior', gender: 'female', hair: ['black'], height: 159, status: 'alive', debut: 'marley' }),
  c({ id: 'porco', name: 'Porco Galliard', aliases: ['Porco', 'Galliard', 'Titan Mâchoire'], affiliation: ['warriors', 'marley_army'], titan: ['jaw'], role: 'warrior', gender: 'male', hair: ['black'], height: 182, status: 'dead', debut: 'marley' }),
  c({ id: 'marcel', name: 'Marcel Galliard', aliases: ['Marcel'], affiliation: ['warriors', 'marley_army'], titan: ['jaw'], role: 'warrior', gender: 'male', hair: ['black'], height: 177, status: 'dead', debut: 'marley' }),
  c({ id: 'falco', name: 'Falco Grice', aliases: ['Falco', 'Grice'], affiliation: ['warriors', 'marley_army', 'yeagerists'], titan: ['jaw'], role: 'warrior', gender: 'male', hair: ['black'], height: 143, status: 'alive', debut: 'marley' }),
  c({ id: 'gabi', name: 'Gabi Braun', aliases: ['Gabi', 'Braun'], affiliation: ['warriors', 'marley_army'], titan: [], role: 'warrior', gender: 'female', hair: ['brown'], height: 157, status: 'alive', debut: 'marley' }),
  c({ id: 'colt', name: 'Colt Grice', aliases: ['Colt', 'Grice'], affiliation: ['warriors', 'marley_army'], titan: [], role: 'warrior', gender: 'male', hair: ['black'], height: 180, status: 'dead', debut: 'marley' }),
  c({ id: 'zofia', name: 'Zofia', aliases: ['Zofia de Marley'], affiliation: ['warriors', 'marley_army'], titan: [], role: 'warrior', gender: 'female', hair: ['black'], height: 150, status: 'dead', debut: 'marley' }),
  c({ id: 'udo', name: 'Udo', aliases: ['Udo de Marley'], affiliation: ['warriors', 'marley_army'], titan: [], role: 'warrior', gender: 'male', hair: ['brown'], height: 170, status: 'dead', debut: 'marley' }),
  c({ id: 'magath', name: 'Theo Magath', aliases: ['Magath', 'Theo', 'Général Magath'], affiliation: ['marley_army'], titan: [], role: 'officer', gender: 'male', hair: ['brown'], height: 187, status: 'dead', debut: 'marley' }),
  c({ id: 'willy', name: 'Willy Tybur', aliases: ['Willy', 'Tybur', 'Titan Marteau de guerre'], affiliation: ['marley_army', 'other'], titan: ['warhammer'], role: 'noble', gender: 'male', hair: ['brown'], height: 173, status: 'dead', debut: 'marley' }),
  c({ id: 'lara', name: 'Lara Tybur', aliases: ['Lara', 'Tybur'], affiliation: ['marley_army', 'other'], titan: ['warhammer'], role: 'noble', gender: 'female', hair: ['brown'], height: 162, status: 'dead', debut: 'marley' }),
  // Paradis : les Jaegeristes, Hizuru et l'Alliance.
  c({ id: 'yelena', name: 'Yelena', aliases: ['Yelena la volontaire'], affiliation: ['volunteers', 'yeagerists'], titan: [], role: 'officer', gender: 'female', hair: ['blond'], height: 175, status: 'dead', debut: 'paradis' }),
  c({ id: 'onyankopon', name: 'Onyankopon', aliases: ['Onyankopon d’Afrique', 'Onyakopon'], affiliation: ['volunteers', 'yeagerists'], titan: [], role: 'civilian', gender: 'male', hair: ['black'], height: 185, status: 'alive', debut: 'paradis' }),
  c({ id: 'kiyomi', name: 'Kiyomi Azumabito', aliases: ['Kiyomi', 'Azumabito'], affiliation: ['hizuru'], titan: [], role: 'noble', gender: 'female', hair: ['black'], height: 158, status: 'alive', debut: 'paradis' }),
]

/** Taille à 5 cm près : orange, avec la flèche. */
const HEIGHT_TOLERANCE = 5

const arcIndex = (arc: AotArc) => AOT_ARCS.indexOf(arc)

export function compareAot(guess: AotCharacter, answer: AotCharacter): Record<AotAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    titan: compareSets(guess.titan, answer.titan),
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    hair: compareSets(guess.hair, answer.hair),
    height: compareOrdered(guess.height, answer.height, HEIGHT_TOLERANCE),
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const aotValues = (character: AotCharacter): Record<AotAttribute, string | string[] | number> => ({
  affiliation: character.affiliation,
  titan: character.titan,
  role: character.role,
  gender: character.gender,
  hair: character.hair,
  height: character.height,
  status: character.status,
  debut: character.debut,
})
