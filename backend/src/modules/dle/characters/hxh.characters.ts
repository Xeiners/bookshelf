import { compareOrdered, compareSets, type AttributeFeedback } from '../dle.logic.js'

/*
 * Catégorie « Hunter × Hunter » du BookshelfDLE : examinateurs, Hunters, Brigade fantôme,
 * Zoldick, Fourmis-Chimères et princes de Kakin. Fiches rédigées à la main ; le type de Nen n'est
 * renseigné que lorsqu'il est établi par l'œuvre (`none` : aucun Nen, ou type jamais révélé) ; les
 * tailles sont celles du guide officiel, arrondies pour les personnages secondaires ; les clés
 * sont traduites par le front.
 */

export const HXH_ATTRIBUTES = ['affiliation', 'nen', 'role', 'gender', 'hair', 'height', 'debut'] as const
export type HxhAttribute = (typeof HXH_ATTRIBUTES)[number]

export type HxhAffiliation =
  | 'hunters'
  | 'troupe'
  | 'zoldyck'
  | 'ants'
  | 'exam'
  | 'arena'
  | 'mafia'
  | 'zodiacs'
  | 'kakin'
  | 'greed'
  | 'other'

/** Les six catégories de Nen ; `none` : aucun Nen, ou type jamais révélé. */
export type HxhNen = 'enhancer' | 'transmuter' | 'emitter' | 'conjurer' | 'manipulator' | 'specialist' | 'none'
export type HxhRole = 'hunter' | 'criminal' | 'assassin' | 'ant' | 'civilian' | 'royal'
/** Couleurs de cheveux ; `none` : chauve, pas de cheveux. */
export type HxhHair = 'black' | 'brown' | 'blond' | 'red' | 'white' | 'grey' | 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'none'

/** Arcs, dans l'ordre du manga : la première apparition se compare avec ↑ ↓. */
export const HXH_ARCS = ['hunter_exam', 'zoldyck', 'arena', 'yorknew', 'greed_island', 'chimera_ant', 'election', 'dark_continent'] as const
export type HxhArc = (typeof HXH_ARCS)[number]

export interface HxhCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: HxhAffiliation[]
  nen: HxhNen
  role: HxhRole
  gender: 'male' | 'female'
  hair: HxhHair[]
  /** Taille officielle (cm). */
  height: number
  debut: HxhArc
}

const c = (character: HxhCharacter) => character

export const HXH_CHARACTERS: HxhCharacter[] = [
  // L'examen des Hunters.
  c({ id: 'gon', name: 'Gon Freecss', aliases: ['Gon', 'Freecss'], mal: ['Gon Freecss'], affiliation: ['hunters', 'exam'], nen: 'enhancer', role: 'hunter', gender: 'male', hair: ['black'], height: 154, debut: 'hunter_exam' }),
  c({ id: 'killua', name: 'Killua Zoldyck', aliases: ['Killua', 'Kirua', 'Kirua Zaoldyeck', 'Zoldyck'], affiliation: ['zoldyck', 'hunters', 'exam'], nen: 'transmuter', role: 'assassin', gender: 'male', hair: ['white'], height: 158, debut: 'hunter_exam' }),
  c({ id: 'kurapika', name: 'Kurapika', aliases: ['Kurapica', 'Kurta'], affiliation: ['hunters', 'exam'], nen: 'conjurer', role: 'hunter', gender: 'male', hair: ['blond'], height: 171, debut: 'hunter_exam' }),
  c({ id: 'leorio', name: 'Leorio Paladiknight', aliases: ['Leorio', 'Leolio', 'Léolio', 'Paladiknight'], mal: ['Leorio Paradinight', 'Leorio Paladiknight'], affiliation: ['hunters', 'exam'], nen: 'emitter', role: 'hunter', gender: 'male', hair: ['black'], height: 193, debut: 'hunter_exam' }),
  c({ id: 'hisoka', name: 'Hisoka Morow', aliases: ['Hisoka', 'Morow', 'Hisoka Morrow'], mal: ['Hisoka Morow'], affiliation: ['troupe', 'exam'], nen: 'transmuter', role: 'criminal', gender: 'male', hair: ['red'], height: 187, debut: 'hunter_exam' }),
  c({ id: 'netero', name: 'Isaac Netero', aliases: ['Netero', 'Isaac', 'Président Netero'], mal: ['Isaac Netero'], affiliation: ['hunters'], nen: 'enhancer', role: 'hunter', gender: 'male', hair: ['none'], height: 150, debut: 'hunter_exam' }),
  c({ id: 'satotz', name: 'Satotz', aliases: ['Satotz l’examinateur', 'Satz'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['black'], height: 175, debut: 'hunter_exam' }),
  c({ id: 'menchi', name: 'Menchi', aliases: ['Menchi la gastronome', 'Menchi l’examinatrice'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'female', hair: ['green'], height: 165, debut: 'hunter_exam' }),
  c({ id: 'buhara', name: 'Buhara', aliases: ['Buhara l’examinateur'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['none'], height: 207, debut: 'hunter_exam' }),
  c({ id: 'tonpa', name: 'Tonpa', aliases: ['Tompa', 'Tonpa le vétéran', 'Tonpa Rookie Crusher'], affiliation: ['exam'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 163, debut: 'hunter_exam' }),
  c({ id: 'hanzo', name: 'Hanzo', aliases: ['Hanzo le ninja', 'Hanzou'], mal: ['Hanzo'], affiliation: ['exam', 'hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['none'], height: 181, debut: 'hunter_exam' }),
  c({ id: 'pokkle', name: 'Pokkle', aliases: ['Pokkle l’archer', 'Poculle'], affiliation: ['exam', 'hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['brown'], height: 172, debut: 'hunter_exam' }),
  c({ id: 'mito', name: 'Mito Freecss', aliases: ['Mito', 'Tante Mito', 'Mito Freecs'], affiliation: ['other'], nen: 'none', role: 'civilian', gender: 'female', hair: ['brown'], height: 165, debut: 'hunter_exam' }),
  c({ id: 'illumi', name: 'Illumi Zoldyck', aliases: ['Illumi', 'Gittarackur', 'Illumi Zaoldyeck'], affiliation: ['zoldyck', 'exam'], nen: 'manipulator', role: 'assassin', gender: 'male', hair: ['black'], height: 185, debut: 'hunter_exam' }),
  c({ id: 'ging', name: 'Ging Freecss', aliases: ['Ging', 'Freecss'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['black'], height: 189, debut: 'hunter_exam' }),
  // La famille Zoldyck.
  c({ id: 'silva', name: 'Silva Zoldyck', aliases: ['Silva', 'Silva Zaoldyeck'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'male', hair: ['grey'], height: 205, debut: 'zoldyck' }),
  c({ id: 'zeno', name: 'Zeno Zoldyck', aliases: ['Zeno', 'Grand-père Zoldyck'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'male', hair: ['white'], height: 160, debut: 'zoldyck' }),
  c({ id: 'kikyo', name: 'Kikyo Zoldyck', aliases: ['Kikyo', 'Kikyô'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'female', hair: ['black'], height: 175, debut: 'zoldyck' }),
  c({ id: 'milluki', name: 'Milluki Zoldyck', aliases: ['Milluki', 'Miruki'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'male', hair: ['black'], height: 146, debut: 'zoldyck' }),
  c({ id: 'kalluto', name: 'Kalluto Zoldyck', aliases: ['Kalluto', 'Karuto'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'male', hair: ['black'], height: 122, debut: 'zoldyck' }),
  c({ id: 'alluka', name: 'Alluka Zoldyck', aliases: ['Alluka', 'Nanika', 'Arukanatotsu'], affiliation: ['zoldyck'], nen: 'none', role: 'assassin', gender: 'female', hair: ['black'], height: 130, debut: 'zoldyck' }),
  c({ id: 'gotoh', name: 'Gotoh', aliases: ['Gotô', 'Goto', 'Gotoh le majordome'], affiliation: ['zoldyck'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 172, debut: 'zoldyck' }),
  c({ id: 'canary', name: 'Canary', aliases: ['Canary la servante'], affiliation: ['zoldyck'], nen: 'none', role: 'civilian', gender: 'female', hair: ['black'], height: 163, debut: 'zoldyck' }),
  // L'arène des Cieux.
  c({ id: 'wing', name: 'Wing', aliases: ['Wing le maître de Nen', 'Wingu'], affiliation: ['hunters', 'arena'], nen: 'manipulator', role: 'hunter', gender: 'male', hair: ['brown'], height: 177, debut: 'arena' }),
  c({ id: 'zushi', name: 'Zushi', aliases: ['Zushi le disciple', 'Zuushi'], affiliation: ['arena'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 164, debut: 'arena' }),
  c({ id: 'kastro', name: 'Kastro', aliases: ['Castro', 'Kastro le tueur'], affiliation: ['arena'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 179, debut: 'arena' }),
  c({ id: 'gido', name: 'Gido', aliases: ['Gido le combattant'], affiliation: ['arena'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 199, debut: 'arena' }),
  c({ id: 'sadaso', name: 'Sadaso', aliases: ['Sadaso le combattant'], affiliation: ['arena'], nen: 'none', role: 'civilian', gender: 'male', hair: ['none'], height: 187, debut: 'arena' }),
  // York Shin : la Brigade fantôme et la mafia.
  c({ id: 'kuroro', name: 'Chrollo Lucilfer', aliases: ['Chrollo', 'Kuroro', 'Kuroro Lucilfer', 'Lucilfer'], mal: ['Chrollo Lucilfer', 'Kuroro Lucilfer'], affiliation: ['troupe'], nen: 'specialist', role: 'criminal', gender: 'male', hair: ['black'], height: 177, debut: 'yorknew' }),
  c({ id: 'pakunoda', name: 'Pakunoda', aliases: ['Paku', 'Pakunoda de la Brigade'], affiliation: ['troupe'], nen: 'emitter', role: 'criminal', gender: 'female', hair: ['brown'], height: 177, debut: 'yorknew' }),
  c({ id: 'nobunaga', name: 'Nobunaga Hazama', aliases: ['Nobunaga', 'Hazama'], affiliation: ['troupe'], nen: 'enhancer', role: 'criminal', gender: 'male', hair: ['black'], height: 175, debut: 'yorknew' }),
  c({ id: 'uvogin', name: 'Uvogin', aliases: ['Uvo', 'Uvogin le bagarreur'], affiliation: ['troupe'], nen: 'enhancer', role: 'criminal', gender: 'male', hair: ['black'], height: 262, debut: 'yorknew' }),
  c({ id: 'machi', name: 'Machi Komacine', aliases: ['Machi', 'Komacine'], affiliation: ['troupe'], nen: 'transmuter', role: 'criminal', gender: 'female', hair: ['green'], height: 163, debut: 'yorknew' }),
  c({ id: 'feitan', name: 'Feitan Portor', aliases: ['Feitan', 'Portor'], affiliation: ['troupe'], nen: 'transmuter', role: 'criminal', gender: 'male', hair: ['black'], height: 150, debut: 'yorknew' }),
  c({ id: 'phinks', name: 'Phinks Magcub', aliases: ['Phinks', 'Magcub', 'Finkusu'], affiliation: ['troupe'], nen: 'enhancer', role: 'criminal', gender: 'male', hair: ['blond'], height: 178, debut: 'yorknew' }),
  c({ id: 'shalnark', name: 'Shalnark', aliases: ['Shalnark de la Brigade'], affiliation: ['troupe'], nen: 'manipulator', role: 'criminal', gender: 'male', hair: ['blond'], height: 183, debut: 'yorknew' }),
  c({ id: 'franklin', name: 'Franklin Bordeau', aliases: ['Franklin', 'Bordeau'], affiliation: ['troupe'], nen: 'emitter', role: 'criminal', gender: 'male', hair: ['black'], height: 215, debut: 'yorknew' }),
  c({ id: 'shizuku', name: 'Shizuku Murasaki', aliases: ['Shizuku', 'Murasaki'], affiliation: ['troupe'], nen: 'conjurer', role: 'criminal', gender: 'female', hair: ['blue'], height: 164, debut: 'yorknew' }),
  c({ id: 'bonolenov', name: 'Bonolenov', aliases: ['Bonolenov Ryuseigai', 'Bono'], affiliation: ['troupe'], nen: 'none', role: 'criminal', gender: 'male', hair: ['none'], height: 217, debut: 'yorknew' }),
  c({ id: 'kortopi', name: 'Kortopi', aliases: ['Coltopi', 'Kortopi le copieur'], affiliation: ['troupe'], nen: 'none', role: 'criminal', gender: 'male', hair: ['black'], height: 136, debut: 'yorknew' }),
  c({ id: 'neon', name: 'Neon Nostrade', aliases: ['Neon', 'Nostrade'], affiliation: ['mafia'], nen: 'none', role: 'civilian', gender: 'female', hair: ['brown'], height: 165, debut: 'yorknew' }),
  c({ id: 'senritsu', name: 'Senritsu', aliases: ['Melody', 'Senritsu la musicienne'], affiliation: ['mafia'], nen: 'none', role: 'civilian', gender: 'female', hair: ['black'], height: 167, debut: 'yorknew' }),
  c({ id: 'basho', name: 'Basho', aliases: ['Basho le garde du corps', 'Bashou'], affiliation: ['mafia'], nen: 'none', role: 'civilian', gender: 'male', hair: ['black'], height: 188, debut: 'yorknew' }),
  // Greed Island.
  c({ id: 'biscuit', name: 'Biscuit Krueger', aliases: ['Biscuit', 'Bisky', 'Biscuit Kruger'], mal: ['Biscuit Krueger', 'Bisky'], affiliation: ['hunters', 'greed'], nen: 'transmuter', role: 'hunter', gender: 'female', hair: ['blond'], height: 154, debut: 'greed_island' }),
  c({ id: 'razor', name: 'Razor', aliases: ['Razor le Hunter', 'Razor de Greed Island'], affiliation: ['greed'], nen: 'none', role: 'civilian', gender: 'male', hair: ['red'], height: 190, debut: 'greed_island' }),
  c({ id: 'genthru', name: 'Genthru', aliases: ['Gensuru', 'Genthru le bombardier'], affiliation: ['greed'], nen: 'none', role: 'criminal', gender: 'male', hair: ['none'], height: 185, debut: 'greed_island' }),
  // Les Fourmis-Chimères.
  c({ id: 'meruem', name: 'Meruem', aliases: ['Roi des Fourmis', 'Meruem le roi', 'King Meruem'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['black'], height: 270, debut: 'chimera_ant' }),
  c({ id: 'pitou', name: 'Neferpitou', aliases: ['Pitou', 'Nefelpitou', 'Neferpitou le garde'], affiliation: ['ants'], nen: 'conjurer', role: 'ant', gender: 'male', hair: ['brown'], height: 190, debut: 'chimera_ant' }),
  c({ id: 'youpi', name: 'Shaiapouf', aliases: ['Youpi', 'Shaiapouf le garde', 'Syaapouf'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['black'], height: 220, debut: 'chimera_ant' }),
  c({ id: 'pouf', name: 'Menthuthuyoupi', aliases: ['Pouf', 'Menthuthuyoupi le garde', 'Pufu'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['blond'], height: 195, debut: 'chimera_ant' }),
  c({ id: 'komugi', name: 'Komugi', aliases: ['Komugi la joueuse de gunggi', 'Komugi Gunggi'], affiliation: ['ants'], nen: 'none', role: 'civilian', gender: 'female', hair: ['brown'], height: 148, debut: 'chimera_ant' }),
  c({ id: 'welfin', name: 'Welfin', aliases: ['Welfin la fourmi', 'Wellfin'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['black'], height: 188, debut: 'chimera_ant' }),
  c({ id: 'kite', name: 'Kite', aliases: ['Kite le Hunter', 'Kaito'], affiliation: ['hunters'], nen: 'conjurer', role: 'hunter', gender: 'male', hair: ['brown'], height: 188, debut: 'chimera_ant' }),
  c({ id: 'knuckle', name: 'Knuckle Bine', aliases: ['Knuckle', 'Bine', 'Nakkuru'], mal: ['Knuckle Bine'], affiliation: ['hunters'], nen: 'enhancer', role: 'hunter', gender: 'male', hair: ['brown'], height: 190, debut: 'chimera_ant' }),
  c({ id: 'shoot', name: 'Shoot McMahon', aliases: ['Shoot', 'McMahon', 'Shuuto'], mal: ['Shoot McMahon'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['brown'], height: 189, debut: 'chimera_ant' }),
  c({ id: 'morel', name: 'Morel Mackernasey', aliases: ['Morel', 'Mackernasey', 'Moreru'], mal: ['Morel Mackernasey'], affiliation: ['hunters'], nen: 'manipulator', role: 'hunter', gender: 'male', hair: ['none'], height: 195, debut: 'chimera_ant' }),
  c({ id: 'knov', name: 'Knov', aliases: ['Knov le Hunter', 'Nobu'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['brown'], height: 182, debut: 'chimera_ant' }),
  c({ id: 'palm', name: 'Palm Siberia', aliases: ['Palm', 'Siberia', 'Pamu'], mal: ['Palm Siberia'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'female', hair: ['brown'], height: 166, debut: 'chimera_ant' }),
  c({ id: 'ikalgo', name: 'Ikalgo', aliases: ['Ikalgo le Hunter', 'Ikarugo'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['none'], height: 198, debut: 'chimera_ant' }),
  c({ id: 'gyro', name: 'Gyro', aliases: ['Gyro la fourmi', 'Giro'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['none'], height: 142, debut: 'chimera_ant' }),
  c({ id: 'rammot', name: 'Rammot', aliases: ['Rammot la fourmi', 'Ramoto'], affiliation: ['ants'], nen: 'none', role: 'ant', gender: 'male', hair: ['none'], height: 225, debut: 'chimera_ant' }),
  // L'élection du président et la mission vers le Continent Noir.
  c({ id: 'pariston', name: 'Pariston Hill', aliases: ['Pariston', 'Hill', 'Parisuton'], affiliation: ['hunters', 'zodiacs'], nen: 'none', role: 'hunter', gender: 'male', hair: ['brown'], height: 177, debut: 'election' }),
  c({ id: 'cheadle', name: 'Cheadle Yorkshire', aliases: ['Cheadle', 'Yorkshire', 'Chidoru'], affiliation: ['hunters', 'zodiacs'], nen: 'none', role: 'hunter', gender: 'female', hair: ['brown'], height: 168, debut: 'election' }),
  c({ id: 'mizaistom', name: 'Mizaistom Nana', aliases: ['Mizaistom', 'Nana', 'Mizeistom'], affiliation: ['hunters', 'zodiacs'], nen: 'none', role: 'hunter', gender: 'male', hair: ['black'], height: 192, debut: 'election' }),
  c({ id: 'tsezguerra', name: 'Tsezguerra', aliases: ['Tsezerigera', 'Tserigera', 'Tsezguerra du Zodiaque'], affiliation: ['hunters', 'zodiacs'], nen: 'none', role: 'hunter', gender: 'male', hair: ['black'], height: 178, debut: 'election' }),
  c({ id: 'beyond', name: 'Beyond Netero', aliases: ['Beyond', 'Biyondo', 'Netero Beyond'], affiliation: ['hunters'], nen: 'none', role: 'hunter', gender: 'male', hair: ['white'], height: 175, debut: 'dark_continent' }),
  c({ id: 'benjamin', name: 'Benjamin Hui Guo', aliases: ['Benjamin', 'Prince Benjamin', 'Benjamin Hui'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'male', hair: ['black'], height: 190, debut: 'dark_continent' }),
  c({ id: 'camilla', name: 'Camilla', aliases: ['Camilla Hui', 'Princesse Camilla'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'female', hair: ['black'], height: 167, debut: 'dark_continent' }),
  c({ id: 'woble', name: 'Woble', aliases: ['Woble Hui', 'Prince Woble'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'male', hair: ['brown'], height: 160, debut: 'dark_continent' }),
  c({ id: 'tserriednich', name: 'Tserriednich', aliases: ['Tserriednich Hui Guo', 'Prince Tserriednich', 'Tserriednich Hui'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'male', hair: ['black'], height: 200, debut: 'dark_continent' }),
  c({ id: 'zhang_lei', name: 'Zhang Lei', aliases: ['Zhang', 'Lei', 'Prince Zhang Lei'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'male', hair: ['black'], height: 184, debut: 'dark_continent' }),
  c({ id: 'oito', name: 'Oito', aliases: ['Oito Hui', 'Princesse Oito'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'female', hair: ['black'], height: 170, debut: 'dark_continent' }),
  c({ id: 'halkenburg', name: 'Halkenburg', aliases: ['Halkenburg Hui', 'Prince Halkenburg', 'Harukenburg'], affiliation: ['kakin'], nen: 'none', role: 'royal', gender: 'male', hair: ['black'], height: 175, debut: 'dark_continent' }),
]

/** Taille à 5 cm près : orange, avec la flèche. */
const HEIGHT_TOLERANCE = 5

const arcIndex = (arc: HxhArc) => HXH_ARCS.indexOf(arc)

export function compareHxh(guess: HxhCharacter, answer: HxhCharacter): Record<HxhAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    nen: { verdict: guess.nen === answer.nen ? 'exact' : 'wrong' },
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    hair: compareSets(guess.hair, answer.hair),
    height: compareOrdered(guess.height, answer.height, HEIGHT_TOLERANCE),
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const hxhValues = (character: HxhCharacter): Record<HxhAttribute, string | string[] | number> => ({
  affiliation: character.affiliation,
  nen: character.nen,
  role: character.role,
  gender: character.gender,
  hair: character.hair,
  height: character.height,
  debut: character.debut,
})
