import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « Dragon Ball » du BookshelfDLE : Dragon Ball, Z et Super (films de
 * Super compris ; GT et Daima à part). Fiches rédigées à la main ; les clés sont
 * traduites par le front.
 */

export const DRAGONBALL_ATTRIBUTES = ['race', 'affiliation', 'forms', 'role', 'gender', 'debut'] as const
export type DragonBallAttribute = (typeof DRAGONBALL_ATTRIBUTES)[number]

export type DragonBallRace =
  | 'saiyan'
  | 'half_saiyan'
  | 'human'
  | 'namekian'
  | 'frieza_clan'
  | 'android'
  | 'majin'
  | 'god'
  | 'angel'
  | 'alien'
  | 'animal'

export type DragonBallAffiliation =
  | 'z_fighters'
  | 'kame'
  | 'crane'
  | 'capsule_corp'
  | 'red_ribbon'
  | 'pilaf'
  | 'frieza_force'
  | 'saiyan_army'
  | 'gods'
  | 'babidi'
  | 'universe6'
  | 'pride_troopers'
  | 'galactic_patrol'
  | 'heeters'
  | 'other'

/** Transformations (et techniques qui en tiennent lieu) : se comparent comme des ensembles. */
export type DragonBallForm =
  | 'oozaru'
  | 'kaioken'
  | 'ssj'
  | 'ssj2'
  | 'ssj3'
  | 'god'
  | 'blue'
  | 'ultra_instinct'
  | 'ultra_ego'
  | 'rose'
  | 'legendary'
  | 'beast'
  | 'golden'
  | 'giant'
  | 'orange'

export type DragonBallRole = 'hero' | 'antihero' | 'villain' | 'neutral'

/** Sagas, dans l'ordre de l'histoire : la première apparition se compare avec ↑ ↓. */
export const DRAGONBALL_SAGAS = [
  'origins',
  'red_ribbon',
  'tournament',
  'piccolo',
  'saiyan',
  'namek',
  'androids',
  'buu',
  'gods',
  'universe6',
  'future_trunks',
  'power',
  'broly',
  'moro',
  'super_hero',
] as const
export type DragonBallSaga = (typeof DRAGONBALL_SAGAS)[number]

export interface DragonBallCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  race: DragonBallRace
  affiliation: DragonBallAffiliation[]
  forms: DragonBallForm[]
  role: DragonBallRole
  gender: 'male' | 'female'
  debut: DragonBallSaga
}

const c = (character: DragonBallCharacter) => character

export const DRAGONBALL_CHARACTERS: DragonBallCharacter[] = [
  // Dragon Ball : la quête des boules, le tournoi, le Ruban Rouge.
  c({ id: 'goku', name: 'Goku', aliases: ['Son Goku', 'Kakarot', 'Kakarotto', 'Sangoku'], mal: ['Son Gokuu', 'Son Goku'], affiliation: ['z_fighters', 'kame'], race: 'saiyan', forms: ['oozaru', 'kaioken', 'ssj', 'ssj2', 'ssj3', 'god', 'blue', 'ultra_instinct'], role: 'hero', gender: 'male', debut: 'origins' }),
  c({ id: 'bulma', name: 'Bulma', aliases: ['Bulma Brief'], affiliation: ['capsule_corp', 'z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'female', debut: 'origins' }),
  c({ id: 'roshi', name: 'Master Roshi', aliases: ['Kame Sennin', 'Tortue Géniale', 'Muten Roshi', 'Roshi'], mal: ['Kame-Sennin', 'Muten Roshi', 'Muten Roushi'], affiliation: ['kame', 'z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'origins' }),
  c({ id: 'yamcha', name: 'Yamcha', affiliation: ['z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'origins' }),
  c({ id: 'oolong', name: 'Oolong', affiliation: ['other'], race: 'animal', forms: [], role: 'hero', gender: 'male', debut: 'origins' }),
  c({ id: 'chichi', name: 'Chi-Chi', aliases: ['Chichi'], affiliation: ['other'], race: 'human', forms: [], role: 'hero', gender: 'female', debut: 'origins' }),
  c({ id: 'pilaf', name: 'Pilaf', aliases: ['Emperor Pilaf', 'Empereur Pilaf'], affiliation: ['pilaf'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'origins' }),
  c({ id: 'mai', name: 'Mai', affiliation: ['pilaf'], race: 'human', forms: [], role: 'neutral', gender: 'female', debut: 'origins' }),
  c({ id: 'krillin', name: 'Krillin', aliases: ['Kuririn', 'Krilin'], mal: ['Kuririn'], affiliation: ['z_fighters', 'kame'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'origins' }),
  c({ id: 'launch', name: 'Launch', aliases: ['Lunch'], mal: ['Lunch'], affiliation: ['kame'], race: 'human', forms: [], role: 'neutral', gender: 'female', debut: 'origins' }),
  c({ id: 'tao', name: 'Mercenary Tao', aliases: ['Tao Pai Pai', 'Taopaipai'], mal: ['Tao Pai Pai', 'Taopaipai'], wiki: 'Mercenary Tao', affiliation: ['crane', 'red_ribbon'], race: 'human', forms: [], role: 'villain', gender: 'male', debut: 'red_ribbon' }),
  c({ id: 'android8', name: 'Android 8', aliases: ['Eighter', 'Hatchan', 'C-8', 'C8'], mal: ['Jinzouningen 8-gou', 'Hacchan'], affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'hero', gender: 'male', debut: 'red_ribbon' }),
  c({ id: 'baba', name: 'Fortuneteller Baba', aliases: ['Baba', 'Uranai Baba'], mal: ['Uranai Baba'], affiliation: ['other'], race: 'human', forms: [], role: 'neutral', gender: 'female', debut: 'red_ribbon' }),
  c({ id: 'tien', name: 'Tien Shinhan', aliases: ['Tien', 'Tenshinhan', 'Ten Shin Han'], mal: ['Tenshinhan'], affiliation: ['crane', 'z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'tournament' }),
  c({ id: 'chiaotzu', name: 'Chiaotzu', aliases: ['Chaozu', 'Chaoz'], mal: ['Chaozu', 'Chiaotzu'], affiliation: ['crane', 'z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'tournament' }),
  c({ id: 'king_piccolo', name: 'King Piccolo', aliases: ['Piccolo Daimaô', 'Piccolo Daimao', 'Démon Piccolo'], mal: ['Piccolo Daimaou', 'Piccolo Daimao'], affiliation: ['other'], race: 'namekian', forms: ['giant'], role: 'villain', gender: 'male', debut: 'piccolo' }),
  c({ id: 'piccolo', name: 'Piccolo', aliases: ['Piccolo Jr.', 'Ma Junior'], affiliation: ['z_fighters'], race: 'namekian', forms: ['giant', 'orange'], role: 'hero', gender: 'male', debut: 'piccolo' }),
  c({ id: 'kami', name: 'Kami', aliases: ['Dieu', 'Kami-sama'], mal: ['Kami-sama'], affiliation: ['gods'], race: 'namekian', forms: [], role: 'hero', gender: 'male', debut: 'piccolo' }),
  c({ id: 'popo', name: 'Mr. Popo', aliases: ['Popo', 'Mister Popo'], affiliation: ['gods'], race: 'alien', forms: [], role: 'neutral', gender: 'male', debut: 'piccolo' }),
  c({ id: 'yajirobe', name: 'Yajirobe', affiliation: ['z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'piccolo' }),
  c({ id: 'korin', name: 'Korin', aliases: ['Karin', 'Maître Karin'], mal: ['Karin'], affiliation: ['gods'], race: 'animal', forms: [], role: 'neutral', gender: 'male', debut: 'red_ribbon' }),
  // Z : Saiyans, Namek, androïdes, Buu.
  c({ id: 'raditz', name: 'Raditz', affiliation: ['saiyan_army'], race: 'saiyan', forms: ['oozaru'], role: 'villain', gender: 'male', debut: 'saiyan' }),
  c({ id: 'gohan', name: 'Gohan', aliases: ['Son Gohan', 'Sangohan', 'Great Saiyaman'], mal: ['Son Gohan'], affiliation: ['z_fighters'], race: 'half_saiyan', forms: ['oozaru', 'ssj', 'ssj2', 'beast'], role: 'hero', gender: 'male', debut: 'saiyan' }),
  c({ id: 'nappa', name: 'Nappa', affiliation: ['saiyan_army', 'frieza_force'], race: 'saiyan', forms: ['oozaru'], role: 'villain', gender: 'male', debut: 'saiyan' }),
  c({ id: 'vegeta', name: 'Vegeta', aliases: ['Végéta', 'Prince Vegeta'], affiliation: ['saiyan_army', 'frieza_force', 'z_fighters'], race: 'saiyan', forms: ['oozaru', 'ssj', 'ssj2', 'god', 'blue', 'ultra_ego'], role: 'antihero', gender: 'male', debut: 'saiyan' }),
  c({ id: 'king_kai', name: 'King Kai', aliases: ['Kaio', 'Maître Kaio', 'Kaiô'], mal: ['Kaiou-sama', 'North Kaiou'], affiliation: ['gods'], race: 'god', forms: [], role: 'hero', gender: 'male', debut: 'saiyan' }),
  c({ id: 'frieza', name: 'Frieza', aliases: ['Freezer', 'Freeza'], mal: ['Freeza', 'Frieza'], affiliation: ['frieza_force'], race: 'frieza_clan', forms: ['golden'], role: 'villain', gender: 'male', debut: 'namek' }),
  c({ id: 'zarbon', name: 'Zarbon', aliases: ['Zabon'], mal: ['Zaabon'], affiliation: ['frieza_force'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'namek' }),
  c({ id: 'dodoria', name: 'Dodoria', affiliation: ['frieza_force'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'namek' }),
  c({ id: 'ginyu', name: 'Captain Ginyu', aliases: ['Ginyu', 'Capitaine Ginyu'], mal: ['Ginyuu', 'Ginyu'], affiliation: ['frieza_force'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'namek' }),
  c({ id: 'recoome', name: 'Recoome', aliases: ['Reacoom', 'Recoom'], mal: ['Recoome', 'Reacoom'], affiliation: ['frieza_force'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'namek' }),
  c({ id: 'dende', name: 'Dende', affiliation: ['z_fighters', 'gods'], race: 'namekian', forms: [], role: 'hero', gender: 'male', debut: 'namek' }),
  c({ id: 'bardock', name: 'Bardock', aliases: ['Baddack'], mal: ['Bardock', 'Burdock'], affiliation: ['saiyan_army', 'frieza_force'], race: 'saiyan', forms: ['oozaru'], role: 'antihero', gender: 'male', debut: 'namek' }),
  c({ id: 'trunks', name: 'Future Trunks', aliases: ['Trunks'], mal: ['Trunks'], wiki: 'Future Trunks', affiliation: ['z_fighters', 'capsule_corp'], race: 'half_saiyan', forms: ['ssj', 'ssj2'], role: 'hero', gender: 'male', debut: 'androids' }),
  c({ id: 'android17', name: 'Android 17', aliases: ['C-17', 'C17', 'Lapis'], mal: ['Jinzouningen 17-gou', 'Android 17'], affiliation: ['red_ribbon', 'z_fighters'], race: 'android', forms: [], role: 'antihero', gender: 'male', debut: 'androids' }),
  c({ id: 'android18', name: 'Android 18', aliases: ['C-18', 'C18', 'Lazuli'], mal: ['Jinzouningen 18-gou', 'Android 18'], affiliation: ['red_ribbon', 'z_fighters'], race: 'android', forms: [], role: 'antihero', gender: 'female', debut: 'androids' }),
  c({ id: 'android16', name: 'Android 16', aliases: ['C-16', 'C16'], mal: ['Jinzouningen 16-gou', 'Android 16'], affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'neutral', gender: 'male', debut: 'androids' }),
  c({ id: 'gero', name: 'Dr. Gero', aliases: ['Android 20', 'C-20', 'Gero', 'Docteur Gero'], mal: ['Dr. Gero', 'Doctor Gero', 'Jinzouningen 20-gou'], wiki: 'Dr. Gero', affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'villain', gender: 'male', debut: 'red_ribbon' }),
  c({ id: 'cell', name: 'Cell', affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'villain', gender: 'male', debut: 'androids' }),
  c({ id: 'hercule', name: 'Hercule', aliases: ['Mr. Satan', 'Mister Satan', 'Satan'], mal: ['Mr. Satan', 'Mister Satan'], wiki: 'Mr. Satan', affiliation: ['other'], race: 'human', forms: [], role: 'hero', gender: 'male', debut: 'androids' }),
  c({ id: 'videl', name: 'Videl', affiliation: ['z_fighters'], race: 'human', forms: [], role: 'hero', gender: 'female', debut: 'buu' }),
  c({ id: 'goten', name: 'Goten', aliases: ['Son Goten', 'Sangoten'], mal: ['Son Goten'], affiliation: ['z_fighters'], race: 'half_saiyan', forms: ['ssj'], role: 'hero', gender: 'male', debut: 'buu' }),
  c({ id: 'shin', name: 'Supreme Kai', aliases: ['Shin', 'Kaioshin', 'Kaiôshin'], mal: ['Shin', 'Kaioushin'], affiliation: ['gods'], race: 'god', forms: [], role: 'hero', gender: 'male', debut: 'buu' }),
  c({ id: 'babidi', name: 'Babidi', affiliation: ['babidi'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'buu' }),
  c({ id: 'dabura', name: 'Dabura', aliases: ['Dabra'], mal: ['Dabura'], affiliation: ['babidi'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'buu' }),
  c({ id: 'buu', name: 'Majin Buu', aliases: ['Buu', 'Boo', 'Bou', 'Majin Boo'], mal: ['Majin Buu', 'Majin Boo'], affiliation: ['babidi', 'z_fighters'], race: 'majin', forms: [], role: 'antihero', gender: 'male', debut: 'buu' }),
  c({ id: 'kid_buu', name: 'Kid Buu', aliases: ['Buu originel', 'Pure Buu'], mal: ['Majin Buu (Kid)', 'Kid Buu'], affiliation: ['babidi'], race: 'majin', forms: [], role: 'villain', gender: 'male', debut: 'buu' }),
  c({ id: 'vegito', name: 'Vegito', aliases: ['Vegetto', 'Végétto'], mal: ['Vegetto', 'Vegito'], affiliation: ['z_fighters'], race: 'saiyan', forms: ['ssj', 'blue'], role: 'hero', gender: 'male', debut: 'buu' }),
  // Super : dieux, univers 6, Trunks du futur, Tournoi du Pouvoir, films.
  c({ id: 'beerus', name: 'Beerus', aliases: ['Bills', 'Beerus-sama'], mal: ['Beerus', 'Bills'], affiliation: ['gods'], race: 'god', forms: [], role: 'neutral', gender: 'male', debut: 'gods' }),
  c({ id: 'whis', name: 'Whis', aliases: ['Wiss'], mal: ['Whis', 'Wiss'], affiliation: ['gods'], race: 'angel', forms: [], role: 'neutral', gender: 'male', debut: 'gods' }),
  c({ id: 'jaco', name: 'Jaco', aliases: ['Jaco Teirimentenpibosshi'], affiliation: ['galactic_patrol'], race: 'alien', forms: [], role: 'hero', gender: 'male', debut: 'gods' }),
  c({ id: 'champa', name: 'Champa', aliases: ['Shampa'], affiliation: ['universe6'], race: 'god', forms: [], role: 'neutral', gender: 'male', debut: 'universe6' }),
  c({ id: 'vados', name: 'Vados', affiliation: ['universe6'], race: 'angel', forms: [], role: 'neutral', gender: 'female', debut: 'universe6' }),
  c({ id: 'hit', name: 'Hit', affiliation: ['universe6'], race: 'alien', forms: [], role: 'antihero', gender: 'male', debut: 'universe6' }),
  c({ id: 'cabba', name: 'Cabba', aliases: ['Kyabe'], mal: ['Cabba', 'Kyabe'], affiliation: ['universe6'], race: 'saiyan', forms: ['ssj'], role: 'hero', gender: 'male', debut: 'universe6' }),
  c({ id: 'goku_black', name: 'Goku Black', aliases: ['Black', 'Black Goku'], mal: ['Goku Black', 'Gokuu Black'], affiliation: ['other'], race: 'god', forms: ['rose'], role: 'villain', gender: 'male', debut: 'future_trunks' }),
  c({ id: 'zamasu', name: 'Zamasu', aliases: ['Zamas'], mal: ['Zamasu'], affiliation: ['other'], race: 'god', forms: [], role: 'villain', gender: 'male', debut: 'future_trunks' }),
  c({ id: 'zeno', name: 'Zeno', aliases: ['Zen-Oh', 'Zeno-sama', 'Omni-King', 'Roi de Tout'], mal: ['Zen-Ou', 'Zenou'], affiliation: ['gods'], race: 'god', forms: [], role: 'neutral', gender: 'male', debut: 'future_trunks' }),
  c({ id: 'jiren', name: 'Jiren', affiliation: ['pride_troopers'], race: 'alien', forms: [], role: 'antihero', gender: 'male', debut: 'power' }),
  c({ id: 'toppo', name: 'Toppo', affiliation: ['pride_troopers'], race: 'alien', forms: [], role: 'antihero', gender: 'male', debut: 'power' }),
  c({ id: 'caulifla', name: 'Caulifla', aliases: ['Kaulifla'], mal: ['Caulifla', 'Kaulifla'], affiliation: ['universe6'], race: 'saiyan', forms: ['ssj', 'ssj2'], role: 'antihero', gender: 'female', debut: 'power' }),
  c({ id: 'kale', name: 'Kale', aliases: ['Kalé'], affiliation: ['universe6'], race: 'saiyan', forms: ['ssj', 'legendary'], role: 'antihero', gender: 'female', debut: 'power' }),
  c({ id: 'broly', name: 'Broly', aliases: ['Brolly'], mal: ['Broly', 'Brolly'], affiliation: ['frieza_force'], race: 'saiyan', forms: ['oozaru', 'ssj', 'legendary'], role: 'antihero', gender: 'male', debut: 'broly' }),
  c({ id: 'gogeta', name: 'Gogeta', affiliation: ['z_fighters'], race: 'saiyan', forms: ['ssj', 'blue'], role: 'hero', gender: 'male', debut: 'broly' }),
  c({ id: 'moro', name: 'Moro', affiliation: ['other'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'moro' }),
  c({ id: 'granolah', name: 'Granolah', affiliation: ['other'], race: 'alien', forms: [], role: 'antihero', gender: 'male', debut: 'moro' }),
  c({ id: 'gas', name: 'Gas', affiliation: ['heeters'], race: 'alien', forms: [], role: 'villain', gender: 'male', debut: 'moro' }),
  c({ id: 'gamma1', name: 'Gamma 1', aliases: ['Gamma1'], mal: ['Gamma 1', 'Gamma 1-gou'], affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'hero', gender: 'male', debut: 'super_hero' }),
  c({ id: 'gamma2', name: 'Gamma 2', aliases: ['Gamma2'], mal: ['Gamma 2', 'Gamma 2-gou'], affiliation: ['red_ribbon'], race: 'android', forms: [], role: 'hero', gender: 'male', debut: 'super_hero' }),
  c({ id: 'hedo', name: 'Dr. Hedo', aliases: ['Hedo', 'Docteur Hedo'], mal: ['Dr. Hedo', 'Hedo'], wiki: 'Dr. Hedo', affiliation: ['red_ribbon'], race: 'human', forms: [], role: 'neutral', gender: 'male', debut: 'super_hero' }),
]

const sagaIndex = (saga: DragonBallSaga) => DRAGONBALL_SAGAS.indexOf(saga)

export function compareDragonBall(guess: DragonBallCharacter, answer: DragonBallCharacter): Record<DragonBallAttribute, AttributeFeedback> {
  return {
    race: { verdict: guess.race === answer.race ? 'exact' : 'wrong' },
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    forms: compareSets(guess.forms, answer.forms),
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    debut: compareOrdered(sagaIndex(guess.debut), sagaIndex(answer.debut), 1),
  }
}

export const dragonBallValues = (character: DragonBallCharacter): Record<DragonBallAttribute, string | string[]> => ({
  race: character.race,
  affiliation: character.affiliation,
  forms: character.forms,
  role: character.role,
  gender: character.gender,
  debut: character.debut,
})
