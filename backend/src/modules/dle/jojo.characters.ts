import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « JoJo's Bizarre Adventure » du BookshelfDLE : les personnages des
 * parties 1 à 8. Fiches rédigées à la main ; le statut est celui de la dernière
 * apparition du personnage. Les clés sont traduites par le front.
 */

export const JOJO_ATTRIBUTES = ['power', 'stand', 'role', 'nationality', 'status', 'debut'] as const
export type JojoAttribute = (typeof JOJO_ATTRIBUTES)[number]

/** Pouvoirs : Stand, Onde (Hamon), vampire, Homme du Pilier, Rotation (Spin). */
export type Power = 'stand' | 'hamon' | 'vampire' | 'pillar' | 'spin'
/** Type de Stand : courte portée, longue portée, automatique, lié (objet, corps) ; `none` : pas de Stand. */
export type StandType = 'close' | 'long' | 'automatic' | 'bound' | 'none'
export type Role = 'jojo' | 'ally' | 'villain'
export type Nationality = 'japan' | 'uk' | 'usa' | 'italy' | 'egypt' | 'france' | 'germany' | 'other'

export interface JojoCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  power: Power[]
  stand: StandType
  role: Role
  nationality: Nationality
  status: 'alive' | 'dead'
  /** Partie de la première apparition (1 : Phantom Blood … 8 : JoJolion). */
  debut: number
}

const c = (character: JojoCharacter) => character

export const JOJO_CHARACTERS: JojoCharacter[] = [
  // Partie 1 — Phantom Blood.
  c({ id: 'jonathan', name: 'Jonathan Joestar', aliases: ['Jojo'], power: ['hamon'], stand: 'none', role: 'jojo', nationality: 'uk', status: 'dead', debut: 1 }),
  c({ id: 'dio', name: 'Dio Brando', aliases: ['DIO'], power: ['vampire', 'stand'], stand: 'close', role: 'villain', nationality: 'uk', status: 'dead', debut: 1 }),
  c({ id: 'zeppeli', name: 'Will A. Zeppeli', aliases: ['William Anthonio Zeppeli'], mal: ['Zeppeli Will Anthonio', 'Zeppeli William Anthonio'], power: ['hamon'], stand: 'none', role: 'ally', nationality: 'italy', status: 'dead', debut: 1 }),
  c({ id: 'speedwagon', name: 'Robert E. O. Speedwagon', aliases: ['Speedwagon'], power: [], stand: 'none', role: 'ally', nationality: 'uk', status: 'alive', debut: 1 }),
  c({ id: 'erina', name: 'Erina Pendleton', aliases: ['Erina Joestar'], power: [], stand: 'none', role: 'ally', nationality: 'uk', status: 'alive', debut: 1 }),
  // Partie 2 — Battle Tendency.
  c({ id: 'joseph', name: 'Joseph Joestar', power: ['hamon', 'stand'], stand: 'bound', role: 'jojo', nationality: 'uk', status: 'alive', debut: 2 }),
  c({ id: 'caesar', name: 'Caesar Zeppeli', aliases: ['Caesar Anthonio Zeppeli'], mal: ['Zeppeli Caesar Anthonio', 'Zeppeli Caesar'], power: ['hamon'], stand: 'none', role: 'ally', nationality: 'italy', status: 'dead', debut: 2 }),
  c({ id: 'lisa-lisa', name: 'Lisa Lisa', aliases: ['Elizabeth Joestar'], power: ['hamon'], stand: 'none', role: 'ally', nationality: 'uk', status: 'alive', debut: 2 }),
  c({ id: 'stroheim', name: 'Rudol von Stroheim', aliases: ['Stroheim'], power: [], stand: 'none', role: 'ally', nationality: 'germany', status: 'alive', debut: 2 }),
  c({ id: 'straizo', name: 'Straizo', power: ['hamon', 'vampire'], stand: 'none', role: 'villain', nationality: 'uk', status: 'dead', debut: 2 }),
  c({ id: 'esidisi', name: 'Esidisi', aliases: ['Esidese', 'Ecidisi'], power: ['pillar'], stand: 'none', role: 'villain', nationality: 'other', status: 'dead', debut: 2 }),
  c({ id: 'wamuu', name: 'Wamuu', power: ['pillar'], stand: 'none', role: 'villain', nationality: 'other', status: 'dead', debut: 2 }),
  c({ id: 'kars', name: 'Kars', aliases: ['Cars'], power: ['pillar'], stand: 'none', role: 'villain', nationality: 'other', status: 'alive', debut: 2 }),
  // Partie 3 — Stardust Crusaders.
  c({ id: 'jotaro', name: 'Jotaro Kujo', aliases: ['Jotaro'], mal: ['Kuujou Joutarou'], power: ['stand'], stand: 'close', role: 'jojo', nationality: 'japan', status: 'dead', debut: 3 }),
  c({ id: 'avdol', name: 'Muhammad Avdol', aliases: ['Avdol', 'Abdul'], mal: ['Abdul Muhammad', 'Avdol Muhammad', 'Avdol Mohammed'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'egypt', status: 'dead', debut: 3 }),
  c({ id: 'kakyoin', name: 'Noriaki Kakyoin', aliases: ['Kakyoin'], mal: ['Kakyouin Noriaki'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'japan', status: 'dead', debut: 3 }),
  c({ id: 'polnareff', name: 'Jean Pierre Polnareff', aliases: ['Polnareff'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'france', status: 'dead', debut: 3 }),
  c({ id: 'iggy', name: 'Iggy', power: ['stand'], stand: 'close', role: 'ally', nationality: 'usa', status: 'dead', debut: 3 }),
  c({ id: 'hol-horse', name: 'Hol Horse', power: ['stand'], stand: 'bound', role: 'villain', nationality: 'usa', status: 'alive', debut: 3 }),
  c({ id: 'enya', name: 'Enya Geil', aliases: ['Enya'], mal: ['Enya', 'Enya Geil'], power: ['stand'], stand: 'long', role: 'villain', nationality: 'other', status: 'dead', debut: 3 }),
  c({ id: 'ndoul', name: "N'Doul", aliases: ['Ndoul'], power: ['stand'], stand: 'long', role: 'villain', nationality: 'egypt', status: 'dead', debut: 3 }),
  c({ id: 'darby', name: 'Daniel J. D’Arby', aliases: ['D’Arby', "D'Arby"], mal: ["D'Arby Daniel J.", 'Darby Daniel J'], wiki: "Daniel J. D'Arby", power: ['stand'], stand: 'close', role: 'villain', nationality: 'other', status: 'alive', debut: 3 }),
  c({ id: 'vanilla-ice', name: 'Vanilla Ice', power: ['stand', 'vampire'], stand: 'close', role: 'villain', nationality: 'other', status: 'dead', debut: 3 }),
  // Partie 4 — Diamond is Unbreakable.
  c({ id: 'josuke', name: 'Josuke Higashikata', mal: ['Higashikata Jousuke'], power: ['stand'], stand: 'close', role: 'jojo', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'okuyasu', name: 'Okuyasu Nijimura', aliases: ['Okuyasu'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'koichi', name: 'Koichi Hirose', aliases: ['Koichi'], mal: ['Hirose Kouichi'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'rohan', name: 'Rohan Kishibe', aliases: ['Rohan'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'kira', name: 'Yoshikage Kira', aliases: ['Kira'], power: ['stand'], stand: 'close', role: 'villain', nationality: 'japan', status: 'dead', debut: 4 }),
  c({ id: 'shigechi', name: 'Shigekiyo Yangu', aliases: ['Shigechi'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'japan', status: 'dead', debut: 4 }),
  c({ id: 'yukako', name: 'Yukako Yamagishi', aliases: ['Yukako'], power: ['stand'], stand: 'bound', role: 'ally', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'tonio', name: 'Tonio Trussardi', aliases: ['Tonio'], power: ['stand'], stand: 'bound', role: 'ally', nationality: 'italy', status: 'alive', debut: 4 }),
  c({ id: 'reimi', name: 'Reimi Sugimoto', aliases: ['Reimi'], power: [], stand: 'none', role: 'ally', nationality: 'japan', status: 'dead', debut: 4 }),
  c({ id: 'akira', name: 'Akira Otoishi', aliases: ['Akira'], power: ['stand'], stand: 'long', role: 'villain', nationality: 'japan', status: 'alive', debut: 4 }),
  c({ id: 'hayato', name: 'Hayato Kawajiri', aliases: ['Hayato'], power: [], stand: 'none', role: 'ally', nationality: 'japan', status: 'alive', debut: 4 }),
  // Partie 5 — Golden Wind.
  c({ id: 'giorno', name: 'Giorno Giovanna', aliases: ['Giorno', 'Haruno Shiobana'], power: ['stand'], stand: 'close', role: 'jojo', nationality: 'italy', status: 'alive', debut: 5 }),
  c({ id: 'bucciarati', name: 'Bruno Bucciarati', aliases: ['Bucciarati', 'Buccellati'], mal: ['Bucciarati Bruno', 'Buccellati Bruno'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'abbacchio', name: 'Leone Abbacchio', aliases: ['Abbacchio'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'mista', name: 'Guido Mista', aliases: ['Mista'], power: ['stand'], stand: 'bound', role: 'ally', nationality: 'italy', status: 'alive', debut: 5 }),
  c({ id: 'narancia', name: 'Narancia Ghirga', aliases: ['Narancia'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'fugo', name: 'Pannacotta Fugo', aliases: ['Fugo'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'italy', status: 'alive', debut: 5 }),
  c({ id: 'trish', name: 'Trish Una', aliases: ['Trish'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'italy', status: 'alive', debut: 5 }),
  c({ id: 'diavolo', name: 'Diavolo', aliases: ['Doppio', 'Le Boss'], power: ['stand'], stand: 'close', role: 'villain', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'risotto', name: 'Risotto Nero', aliases: ['Risotto'], power: ['stand'], stand: 'close', role: 'villain', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'prosciutto', name: 'Prosciutto', power: ['stand'], stand: 'long', role: 'villain', nationality: 'italy', status: 'dead', debut: 5 }),
  c({ id: 'ghiaccio', name: 'Ghiaccio', power: ['stand'], stand: 'bound', role: 'villain', nationality: 'italy', status: 'dead', debut: 5 }),
  // Partie 6 — Stone Ocean.
  c({ id: 'jolyne', name: 'Jolyne Cujoh', aliases: ['Jolyne', 'Jolyne Kujo'], mal: ['Kujo Jolyne', 'Kuujou Jolyne', 'Cujoh Jolyne'], power: ['stand'], stand: 'close', role: 'jojo', nationality: 'usa', status: 'dead', debut: 6 }),
  c({ id: 'ermes', name: 'Ermes Costello', aliases: ['Ermes'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'usa', status: 'dead', debut: 6 }),
  c({ id: 'foo-fighters', name: 'Foo Fighters', aliases: ['F.F.', 'FF'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'usa', status: 'dead', debut: 6 }),
  c({ id: 'weather-report', name: 'Weather Report', power: ['stand'], stand: 'long', role: 'ally', nationality: 'usa', status: 'dead', debut: 6 }),
  c({ id: 'anasui', name: 'Narciso Anasui', aliases: ['Anasui'], power: ['stand'], stand: 'close', role: 'ally', nationality: 'usa', status: 'dead', debut: 6 }),
  c({ id: 'emporio', name: 'Emporio Alniño', aliases: ['Emporio'], mal: ['Alnino Emporio', 'Alniño Emporio'], power: ['stand'], stand: 'bound', role: 'ally', nationality: 'usa', status: 'alive', debut: 6 }),
  c({ id: 'pucci', name: 'Enrico Pucci', aliases: ['Pucci'], power: ['stand'], stand: 'close', role: 'villain', nationality: 'usa', status: 'dead', debut: 6 }),
  // Partie 7 — Steel Ball Run.
  c({ id: 'johnny', name: 'Johnny Joestar', power: ['stand', 'spin'], stand: 'long', role: 'jojo', nationality: 'usa', status: 'alive', debut: 7 }),
  c({ id: 'gyro', name: 'Gyro Zeppeli', aliases: ['Gyro'], power: ['stand', 'spin'], stand: 'bound', role: 'ally', nationality: 'italy', status: 'dead', debut: 7 }),
  c({ id: 'valentine', name: 'Funny Valentine', aliases: ['Valentine'], power: ['stand'], stand: 'close', role: 'villain', nationality: 'usa', status: 'dead', debut: 7 }),
  c({ id: 'diego', name: 'Diego Brando', aliases: ['Dio (Steel Ball Run)'], power: ['stand'], stand: 'bound', role: 'villain', nationality: 'uk', status: 'dead', debut: 7 }),
  c({ id: 'hot-pants', name: 'Hot Pants', power: ['stand'], stand: 'bound', role: 'ally', nationality: 'usa', status: 'dead', debut: 7 }),
  // Partie 8 — JoJolion (le Josuke de JoJolion n'est pas celui de la partie 4).
  c({ id: 'gappy', name: 'Josuke Higashikata (JoJolion)', aliases: ['Gappy', 'Josuke 8'], mal: ['Gappy'], power: ['stand'], stand: 'close', role: 'jojo', nationality: 'japan', status: 'alive', debut: 8 }),
  c({ id: 'yasuho', name: 'Yasuho Hirose', aliases: ['Yasuho'], power: ['stand'], stand: 'long', role: 'ally', nationality: 'japan', status: 'alive', debut: 8 }),
  c({ id: 'tooru', name: 'Toru', aliases: ['Tooru'], mal: ['Tooru'], power: ['stand'], stand: 'automatic', role: 'villain', nationality: 'japan', status: 'dead', debut: 8 }),
]

export function compareJojo(guess: JojoCharacter, answer: JojoCharacter): Record<JojoAttribute, AttributeFeedback> {
  return {
    power: compareSets(guess.power, answer.power),
    stand: { verdict: guess.stand === answer.stand ? 'exact' : 'wrong' },
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    nationality: { verdict: guess.nationality === answer.nationality ? 'exact' : 'wrong' },
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    debut: compareOrdered(guess.debut, answer.debut, 1),
  }
}

export const jojoValues = (character: JojoCharacter): Record<JojoAttribute, string | string[] | number> => ({
  power: character.power,
  stand: character.stand,
  role: character.role,
  nationality: character.nationality,
  status: character.status,
  debut: character.debut,
})
