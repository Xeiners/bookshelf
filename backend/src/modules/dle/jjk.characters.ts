import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « Jujutsu Kaisen » du BookshelfDLE : les exorcistes, fléaux et
 * réincarnés du manga (Jujutsu Kaisen 0 compris). Fiches rédigées à la main ;
 * statut à la fin du manga. Les clés sont traduites par le front.
 */

export const JJK_ATTRIBUTES = ['affiliation', 'grade', 'species', 'gender', 'status', 'debut'] as const
export type JjkAttribute = (typeof JJK_ATTRIBUTES)[number]

export type JjkAffiliation =
  | 'tokyo'
  | 'kyoto'
  | 'zenin'
  | 'gojo'
  | 'kamo'
  | 'curses'
  | 'kenjaku'
  | 'curse_users'
  | 'culling'
  | 'sukuna'
  | 'other'
/** Grades d'exorciste (et de fléau), du plus bas au plus haut : se comparent avec ↑ ↓. */
export const JJK_GRADES = ['none', '4', '3', '2', 'semi1', '1', 'special'] as const
export type JjkGrade = (typeof JJK_GRADES)[number]
export type JjkSpecies = 'human' | 'curse' | 'hybrid' | 'cursed_corpse' | 'incarnated'

/** Arcs, dans l'ordre de publication (Jujutsu Kaisen 0 d'abord) : la première apparition se compare avec ↑ ↓. */
export const JJK_ARCS = [
  'jjk0',
  'introduction',
  'cursed_womb',
  'vs_mahito',
  'kyoto_goodwill',
  'death_painting',
  'gojo_past',
  'shibuya',
  'perfect_preparation',
  'culling_game',
  'shinjuku',
] as const
export type JjkArc = (typeof JJK_ARCS)[number]

export interface JjkCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: JjkAffiliation[]
  grade: JjkGrade
  species: JjkSpecies
  gender: 'male' | 'female'
  status: 'alive' | 'dead'
  debut: JjkArc
}

const c = (character: JjkCharacter) => character

export const JJK_CHARACTERS: JjkCharacter[] = [
  // Jujutsu Kaisen 0.
  c({ id: 'yuta', name: 'Yuta Okkotsu', aliases: ['Yuta'], mal: ['Okkotsu Yuuta'], affiliation: ['tokyo'], grade: 'special', species: 'human', gender: 'male', status: 'alive', debut: 'jjk0' }),
  c({ id: 'maki', name: "Maki Zen'in", aliases: ['Maki', 'Maki Zenin'], mal: ["Zen'in Maki", 'Zenin Maki'], wiki: 'Maki Zenin', affiliation: ['tokyo', 'zenin'], grade: '4', species: 'human', gender: 'female', status: 'alive', debut: 'jjk0' }),
  c({ id: 'inumaki', name: 'Toge Inumaki', aliases: ['Inumaki', 'Toge'], affiliation: ['tokyo'], grade: 'semi1', species: 'human', gender: 'male', status: 'alive', debut: 'jjk0' }),
  c({ id: 'panda', name: 'Panda', affiliation: ['tokyo'], grade: '2', species: 'cursed_corpse', gender: 'male', status: 'alive', debut: 'jjk0' }),
  c({ id: 'geto', name: 'Suguru Geto', aliases: ['Geto', 'Getou'], mal: ['Getou Suguru'], affiliation: ['curse_users', 'tokyo'], grade: 'special', species: 'human', gender: 'male', status: 'dead', debut: 'jjk0' }),
  // Introduction et Utérus maudit.
  c({ id: 'yuji', name: 'Yuji Itadori', aliases: ['Itadori', 'Yuji'], mal: ['Itadori Yuuji'], affiliation: ['tokyo'], grade: '1', species: 'human', gender: 'male', status: 'alive', debut: 'introduction' }),
  c({ id: 'megumi', name: 'Megumi Fushiguro', aliases: ['Megumi', 'Fushiguro'], affiliation: ['tokyo', 'zenin'], grade: '2', species: 'human', gender: 'male', status: 'alive', debut: 'introduction' }),
  c({ id: 'gojo', name: 'Satoru Gojo', aliases: ['Gojo', 'Gojou'], mal: ['Gojou Satoru'], affiliation: ['tokyo', 'gojo'], grade: 'special', species: 'human', gender: 'male', status: 'dead', debut: 'introduction' }),
  c({ id: 'sukuna', name: 'Ryomen Sukuna', aliases: ['Sukuna'], mal: ['Ryoumen Sukuna'], affiliation: ['sukuna'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'introduction' }),
  c({ id: 'nobara', name: 'Nobara Kugisaki', aliases: ['Nobara', 'Kugisaki'], affiliation: ['tokyo'], grade: '3', species: 'human', gender: 'female', status: 'alive', debut: 'introduction' }),
  c({ id: 'yaga', name: 'Masamichi Yaga', aliases: ['Yaga'], affiliation: ['tokyo'], grade: '1', species: 'human', gender: 'male', status: 'dead', debut: 'introduction' }),
  c({ id: 'ijichi', name: 'Kiyotaka Ijichi', aliases: ['Ijichi'], affiliation: ['tokyo'], grade: 'none', species: 'human', gender: 'male', status: 'alive', debut: 'introduction' }),
  c({ id: 'shoko', name: 'Shoko Ieiri', aliases: ['Shoko', 'Ieiri'], mal: ['Ieiri Shouko'], affiliation: ['tokyo'], grade: 'none', species: 'human', gender: 'female', status: 'alive', debut: 'cursed_womb' }),
  c({ id: 'jogo', name: 'Jogo', aliases: ['Jougo'], mal: ['Jougo'], affiliation: ['curses'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'cursed_womb' }),
  c({ id: 'hanami', name: 'Hanami', affiliation: ['curses'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'cursed_womb' }),
  // Contre Mahito.
  c({ id: 'nanami', name: 'Kento Nanami', aliases: ['Nanami'], affiliation: ['tokyo'], grade: '1', species: 'human', gender: 'male', status: 'dead', debut: 'vs_mahito' }),
  c({ id: 'mahito', name: 'Mahito', affiliation: ['curses'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'vs_mahito' }),
  c({ id: 'junpei', name: 'Junpei Yoshino', aliases: ['Junpei'], affiliation: ['other'], grade: 'none', species: 'human', gender: 'male', status: 'dead', debut: 'vs_mahito' }),
  // Rencontre d'échange avec Kyoto.
  c({ id: 'todo', name: 'Aoi Todo', aliases: ['Todo', 'Toudou'], mal: ['Toudou Aoi'], affiliation: ['kyoto'], grade: '1', species: 'human', gender: 'male', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'mai', name: "Mai Zen'in", aliases: ['Mai', 'Mai Zenin'], mal: ["Zen'in Mai", 'Zenin Mai'], wiki: 'Mai Zenin', affiliation: ['kyoto', 'zenin'], grade: '3', species: 'human', gender: 'female', status: 'dead', debut: 'kyoto_goodwill' }),
  c({ id: 'noritoshi', name: 'Noritoshi Kamo', aliases: ['Kamo'], affiliation: ['kyoto', 'kamo'], grade: 'semi1', species: 'human', gender: 'male', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'momo', name: 'Momo Nishimiya', aliases: ['Momo'], affiliation: ['kyoto'], grade: '2', species: 'human', gender: 'female', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'miwa', name: 'Kasumi Miwa', aliases: ['Miwa'], affiliation: ['kyoto'], grade: '3', species: 'human', gender: 'female', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'mechamaru', name: 'Kokichi Muta', aliases: ['Mechamaru'], mal: ['Mechamaru', 'Muta Kokichi'], affiliation: ['kyoto'], grade: 'semi1', species: 'human', gender: 'male', status: 'dead', debut: 'kyoto_goodwill' }),
  c({ id: 'utahime', name: 'Utahime Iori', aliases: ['Utahime'], affiliation: ['kyoto'], grade: 'semi1', species: 'human', gender: 'female', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'mei-mei', name: 'Mei Mei', affiliation: ['other'], grade: '1', species: 'human', gender: 'female', status: 'alive', debut: 'kyoto_goodwill' }),
  c({ id: 'kenjaku', name: 'Kenjaku', aliases: ['Faux Geto', 'Pseudo-Geto'], affiliation: ['kenjaku'], grade: 'special', species: 'human', gender: 'male', status: 'dead', debut: 'kyoto_goodwill' }),
  // Peintures de mort, passé de Gojo.
  c({ id: 'choso', name: 'Choso', aliases: ['Chousou'], mal: ['Chousou'], affiliation: ['kenjaku', 'tokyo'], grade: 'special', species: 'hybrid', gender: 'male', status: 'dead', debut: 'death_painting' }),
  c({ id: 'toji', name: 'Toji Fushiguro', aliases: ['Toji', 'Touji', 'Toji Zenin'], mal: ['Fushiguro Touji'], affiliation: ['zenin'], grade: 'none', species: 'human', gender: 'male', status: 'dead', debut: 'gojo_past' }),
  c({ id: 'riko', name: 'Riko Amanai', aliases: ['Riko'], affiliation: ['other'], grade: 'none', species: 'human', gender: 'female', status: 'dead', debut: 'gojo_past' }),
  // Incident de Shibuya.
  c({ id: 'dagon', name: 'Dagon', affiliation: ['curses'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'shibuya' }),
  c({ id: 'naobito', name: "Naobito Zen'in", aliases: ['Naobito', 'Naobito Zenin'], mal: ["Zen'in Naobito"], wiki: 'Naobito Zenin', affiliation: ['zenin'], grade: 'special', species: 'human', gender: 'male', status: 'dead', debut: 'shibuya' }),
  c({ id: 'kusakabe', name: 'Atsuya Kusakabe', aliases: ['Kusakabe'], affiliation: ['tokyo'], grade: '1', species: 'human', gender: 'male', status: 'alive', debut: 'shibuya' }),
  c({ id: 'ino', name: 'Takuma Ino', aliases: ['Ino'], affiliation: ['tokyo'], grade: '2', species: 'human', gender: 'male', status: 'alive', debut: 'shibuya' }),
  c({ id: 'yuki', name: 'Yuki Tsukumo', aliases: ['Yuki'], affiliation: ['other'], grade: 'special', species: 'human', gender: 'female', status: 'dead', debut: 'shibuya' }),
  // Après Shibuya : préparatifs et Jeu d'extermination.
  c({ id: 'naoya', name: "Naoya Zen'in", aliases: ['Naoya', 'Naoya Zenin'], mal: ["Zen'in Naoya"], wiki: 'Naoya Zenin', affiliation: ['zenin'], grade: 'special', species: 'curse', gender: 'male', status: 'dead', debut: 'perfect_preparation' }),
  c({ id: 'hakari', name: 'Kinji Hakari', aliases: ['Hakari'], affiliation: ['tokyo', 'culling'], grade: 'none', species: 'human', gender: 'male', status: 'alive', debut: 'culling_game' }),
  c({ id: 'kirara', name: 'Kirara Hoshi', aliases: ['Kirara'], affiliation: ['tokyo'], grade: 'none', species: 'human', gender: 'male', status: 'alive', debut: 'culling_game' }),
  c({ id: 'higuruma', name: 'Hiromi Higuruma', aliases: ['Higuruma'], affiliation: ['culling'], grade: 'none', species: 'human', gender: 'male', status: 'dead', debut: 'culling_game' }),
  c({ id: 'takaba', name: 'Fumihiko Takaba', aliases: ['Takaba'], affiliation: ['culling'], grade: 'none', species: 'human', gender: 'male', status: 'alive', debut: 'culling_game' }),
  c({ id: 'kashimo', name: 'Hajime Kashimo', aliases: ['Kashimo'], affiliation: ['culling'], grade: 'none', species: 'incarnated', gender: 'male', status: 'dead', debut: 'culling_game' }),
  c({ id: 'hana', name: 'Hana Kurusu', aliases: ['Angel', 'Ange'], affiliation: ['culling'], grade: 'none', species: 'incarnated', gender: 'female', status: 'alive', debut: 'culling_game' }),
  c({ id: 'ryu', name: 'Ryu Ishigori', aliases: ['Ishigori'], mal: ['Ishigori Ryuu'], affiliation: ['culling'], grade: 'none', species: 'incarnated', gender: 'male', status: 'dead', debut: 'culling_game' }),
  c({ id: 'uro', name: 'Takako Uro', aliases: ['Uro'], affiliation: ['culling'], grade: 'none', species: 'incarnated', gender: 'female', status: 'dead', debut: 'culling_game' }),
  c({ id: 'yorozu', name: 'Yorozu', affiliation: ['culling', 'sukuna'], grade: 'none', species: 'incarnated', gender: 'female', status: 'dead', debut: 'culling_game' }),
]

const gradeIndex = (grade: JjkGrade) => JJK_GRADES.indexOf(grade)
const arcIndex = (arc: JjkArc) => JJK_ARCS.indexOf(arc)

export function compareJjk(guess: JjkCharacter, answer: JjkCharacter): Record<JjkAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    grade: compareOrdered(gradeIndex(guess.grade), gradeIndex(answer.grade), 1),
    species: { verdict: guess.species === answer.species ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const jjkValues = (character: JjkCharacter): Record<JjkAttribute, string | string[]> => ({
  affiliation: character.affiliation,
  grade: character.grade,
  species: character.species,
  gender: character.gender,
  status: character.status,
  debut: character.debut,
})
