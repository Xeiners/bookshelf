import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « Naruto » du BookshelfDLE : les personnages de Naruto et Naruto
 * Shippuden. Fiches rédigées à la main, état à la fin de Shippuden (un personnage
 * ramené par l'Edo Tensei reste « décédé »). Les clés sont traduites par le front.
 */

export const NARUTO_ATTRIBUTES = ['affiliation', 'nature', 'role', 'gender', 'status', 'debut'] as const
export type NarutoAttribute = (typeof NARUTO_ATTRIBUTES)[number]

export type Affiliation = 'konoha' | 'suna' | 'kiri' | 'kumo' | 'iwa' | 'oto' | 'ame' | 'akatsuki' | 'taka' | 'otsutsuki'
/** Natures de chakra ; `kekkei` : un Kekkei Genkai (dōjutsu, bois, glace, lave…). */
export type Nature = 'katon' | 'futon' | 'raiton' | 'suiton' | 'doton' | 'yin' | 'yang' | 'kekkei'
export type Role = 'kage' | 'sannin' | 'jonin' | 'chunin' | 'genin' | 'anbu' | 'jinchuriki' | 'criminal' | 'other'

/** Arcs, dans l'ordre du récit : la première apparition se compare avec ↑ ↓. */
export const ARCS = [
  'beginnings',
  'waves',
  'chunin',
  'invasion',
  'tsunade',
  'retrieval',
  'gaiden',
  'kazekage',
  'tenchi',
  'akatsuki',
  'hebi',
  'pain',
  'summit',
  'war',
] as const
export type Arc = (typeof ARCS)[number]

export interface NarutoCharacter {
  /** Identifiant stable (jamais affiché). */
  id: string
  /** Nom affiché, à l'occidentale. */
  name: string
  /** Autres noms pour la saisie (« Pain », « Tobi »…). */
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: Affiliation[]
  nature: Nature[]
  role: Role[]
  gender: 'male' | 'female'
  status: 'alive' | 'dead'
  debut: Arc
}

const c = (character: NarutoCharacter) => character

export const NARUTO_CHARACTERS: NarutoCharacter[] = [
  c({ id: 'naruto', name: 'Naruto Uzumaki', affiliation: ['konoha'], nature: ['futon'], role: ['genin', 'jinchuriki'], gender: 'male', status: 'alive', debut: 'beginnings' }),
  c({ id: 'sasuke', name: 'Sasuke Uchiha', affiliation: ['konoha', 'taka'], nature: ['katon', 'raiton', 'kekkei'], role: ['genin', 'criminal'], gender: 'male', status: 'alive', debut: 'beginnings' }),
  c({ id: 'sakura', name: 'Sakura Haruno', affiliation: ['konoha'], nature: ['doton'], role: ['chunin'], gender: 'female', status: 'alive', debut: 'beginnings' }),
  c({ id: 'kakashi', name: 'Kakashi Hatake', affiliation: ['konoha'], nature: ['raiton', 'doton', 'suiton'], role: ['jonin'], gender: 'male', status: 'alive', debut: 'beginnings' }),
  c({ id: 'iruka', name: 'Iruka Umino', affiliation: ['konoha'], nature: [], role: ['chunin'], gender: 'male', status: 'alive', debut: 'beginnings' }),
  c({ id: 'hiruzen', name: 'Hiruzen Sarutobi', aliases: ['Troisième Hokage', 'Third Hokage'], affiliation: ['konoha'], nature: ['katon', 'futon', 'raiton', 'suiton', 'doton'], role: ['kage'], gender: 'male', status: 'dead', debut: 'beginnings' }),
  c({ id: 'konohamaru', name: 'Konohamaru Sarutobi', affiliation: ['konoha'], nature: ['futon', 'katon'], role: ['genin'], gender: 'male', status: 'alive', debut: 'beginnings' }),
  c({ id: 'zabuza', name: 'Zabuza Momochi', affiliation: ['kiri'], nature: ['suiton'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'waves' }),
  c({ id: 'haku', name: 'Haku', affiliation: ['kiri'], nature: ['suiton', 'futon', 'kekkei'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'waves' }),
  c({ id: 'gaara', name: 'Gaara', affiliation: ['suna'], nature: ['futon', 'doton', 'kekkei'], role: ['kage', 'jinchuriki'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'temari', name: 'Temari', affiliation: ['suna'], nature: ['futon'], role: ['jonin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'kankuro', name: 'Kankuro', mal: ['Kankurou'], affiliation: ['suna'], nature: [], role: ['jonin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'rock-lee', name: 'Rock Lee', affiliation: ['konoha'], nature: [], role: ['chunin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'neji', name: 'Neji Hyuga', mal: ['Hyuuga Neji'], affiliation: ['konoha'], nature: ['kekkei'], role: ['jonin'], gender: 'male', status: 'dead', debut: 'chunin' }),
  c({ id: 'tenten', name: 'Tenten', affiliation: ['konoha'], nature: [], role: ['chunin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'guy', name: 'Might Guy', aliases: ['Gai'], mal: ['Maito Gai', 'Maito Guy'], affiliation: ['konoha'], nature: [], role: ['jonin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'hinata', name: 'Hinata Hyuga', mal: ['Hyuuga Hinata'], affiliation: ['konoha'], nature: ['kekkei'], role: ['chunin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'kiba', name: 'Kiba Inuzuka', affiliation: ['konoha'], nature: [], role: ['chunin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'shino', name: 'Shino Aburame', affiliation: ['konoha'], nature: [], role: ['chunin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'shikamaru', name: 'Shikamaru Nara', affiliation: ['konoha'], nature: ['yin'], role: ['chunin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'ino', name: 'Ino Yamanaka', affiliation: ['konoha'], nature: ['yin'], role: ['chunin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'choji', name: 'Choji Akimichi', mal: ['Akimichi Chouji'], affiliation: ['konoha'], nature: ['yang'], role: ['chunin'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'asuma', name: 'Asuma Sarutobi', affiliation: ['konoha'], nature: ['futon', 'katon'], role: ['jonin'], gender: 'male', status: 'dead', debut: 'chunin' }),
  c({ id: 'kurenai', name: 'Kurenai Yuhi', mal: ['Yuuhi Kurenai'], affiliation: ['konoha'], nature: ['yin'], role: ['jonin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'orochimaru', name: 'Orochimaru', affiliation: ['konoha', 'oto'], nature: ['futon'], role: ['sannin', 'criminal'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'kabuto', name: 'Kabuto Yakushi', affiliation: ['konoha', 'oto'], nature: ['doton'], role: ['criminal'], gender: 'male', status: 'alive', debut: 'chunin' }),
  c({ id: 'anko', name: 'Anko Mitarashi', affiliation: ['konoha'], nature: [], role: ['jonin'], gender: 'female', status: 'alive', debut: 'chunin' }),
  c({ id: 'jiraiya', name: 'Jiraiya', affiliation: ['konoha'], nature: ['katon', 'doton', 'futon'], role: ['sannin'], gender: 'male', status: 'dead', debut: 'chunin' }),
  c({ id: 'kimimaro', name: 'Kimimaro', mal: ['Kaguya Kimimaro'], affiliation: ['oto'], nature: ['kekkei'], role: ['other'], gender: 'male', status: 'dead', debut: 'retrieval' }),
  c({ id: 'tsunade', name: 'Tsunade', affiliation: ['konoha'], nature: ['doton', 'raiton', 'suiton', 'yang'], role: ['sannin', 'kage'], gender: 'female', status: 'alive', debut: 'tsunade' }),
  c({ id: 'shizune', name: 'Shizune', affiliation: ['konoha'], nature: [], role: ['jonin'], gender: 'female', status: 'alive', debut: 'tsunade' }),
  c({ id: 'itachi', name: 'Itachi Uchiha', affiliation: ['konoha', 'akatsuki'], nature: ['katon', 'suiton', 'kekkei'], role: ['anbu', 'criminal'], gender: 'male', status: 'dead', debut: 'tsunade' }),
  c({ id: 'kisame', name: 'Kisame Hoshigaki', affiliation: ['kiri', 'akatsuki'], nature: ['suiton'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'tsunade' }),
  c({ id: 'minato', name: 'Minato Namikaze', aliases: ['Quatrième Hokage', 'Fourth Hokage'], affiliation: ['konoha'], nature: ['futon'], role: ['kage'], gender: 'male', status: 'dead', debut: 'gaiden' }),
  c({ id: 'obito', name: 'Obito Uchiha', aliases: ['Tobi'], affiliation: ['konoha', 'akatsuki'], nature: ['katon', 'kekkei'], role: ['criminal', 'jinchuriki'], gender: 'male', status: 'dead', debut: 'gaiden' }),
  c({ id: 'rin', name: 'Rin Nohara', affiliation: ['konoha'], nature: ['suiton'], role: ['chunin', 'jinchuriki'], gender: 'female', status: 'dead', debut: 'gaiden' }),
  c({ id: 'deidara', name: 'Deidara', affiliation: ['iwa', 'akatsuki'], nature: ['doton', 'raiton', 'kekkei'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'kazekage' }),
  c({ id: 'sasori', name: 'Sasori', affiliation: ['suna', 'akatsuki'], nature: [], role: ['criminal'], gender: 'male', status: 'dead', debut: 'kazekage' }),
  c({ id: 'chiyo', name: 'Chiyo', affiliation: ['suna'], nature: [], role: ['other'], gender: 'female', status: 'dead', debut: 'kazekage' }),
  c({ id: 'sai', name: 'Sai', affiliation: ['konoha'], nature: [], role: ['anbu'], gender: 'male', status: 'alive', debut: 'tenchi' }),
  c({ id: 'yamato', name: 'Yamato', aliases: ['Tenzo'], affiliation: ['konoha'], nature: ['doton', 'suiton', 'kekkei'], role: ['jonin', 'anbu'], gender: 'male', status: 'alive', debut: 'tenchi' }),
  c({ id: 'danzo', name: 'Danzo Shimura', mal: ['Shimura Danzou'], affiliation: ['konoha'], nature: ['futon', 'kekkei'], role: ['anbu'], gender: 'male', status: 'dead', debut: 'tenchi' }),
  c({ id: 'hidan', name: 'Hidan', affiliation: ['akatsuki'], nature: [], role: ['criminal'], gender: 'male', status: 'alive', debut: 'akatsuki' }),
  c({ id: 'kakuzu', name: 'Kakuzu', affiliation: ['akatsuki'], nature: ['katon', 'futon', 'raiton', 'suiton', 'doton'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'akatsuki' }),
  c({ id: 'suigetsu', name: 'Suigetsu Hozuki', mal: ['Houzuki Suigetsu', 'Hoozuki Suigetsu'], affiliation: ['kiri', 'taka'], nature: ['suiton'], role: ['criminal'], gender: 'male', status: 'alive', debut: 'hebi' }),
  c({ id: 'karin', name: 'Karin', mal: ['Uzumaki Karin'], affiliation: ['taka'], nature: [], role: ['other'], gender: 'female', status: 'alive', debut: 'hebi' }),
  c({ id: 'jugo', name: 'Jugo', mal: ['Juugo'], affiliation: ['taka'], nature: ['kekkei'], role: ['other'], gender: 'male', status: 'alive', debut: 'hebi' }),
  c({ id: 'killer-b', name: 'Killer B', aliases: ['Killer Bee'], mal: ['Killer Bee', 'Bee Killer'], affiliation: ['kumo'], nature: ['raiton'], role: ['jinchuriki'], gender: 'male', status: 'alive', debut: 'hebi' }),
  c({ id: 'a', name: 'A (Raikage)', aliases: ['Raikage', 'Ay', 'Ei'], mal: ['A', 'Ay', 'Ei', 'Raikage'], wiki: 'A (Fourth Raikage)', affiliation: ['kumo'], nature: ['raiton'], role: ['kage'], gender: 'male', status: 'alive', debut: 'hebi' }),
  c({ id: 'nagato', name: 'Nagato', aliases: ['Pain', 'Pein'], mal: ['Uzumaki Nagato', 'Pain', 'Pein'], affiliation: ['ame', 'akatsuki'], nature: ['katon', 'futon', 'raiton', 'suiton', 'doton', 'kekkei'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'pain' }),
  c({ id: 'konan', name: 'Konan', affiliation: ['ame', 'akatsuki'], nature: [], role: ['criminal'], gender: 'female', status: 'dead', debut: 'pain' }),
  c({ id: 'mei', name: 'Mei Terumi', aliases: ['Mizukage'], affiliation: ['kiri'], nature: ['suiton', 'katon', 'doton', 'kekkei'], role: ['kage'], gender: 'female', status: 'alive', debut: 'summit' }),
  c({ id: 'onoki', name: 'Onoki', aliases: ['Tsuchikage'], mal: ['Oonoki', 'Ohnoki'], affiliation: ['iwa'], nature: ['doton', 'kekkei'], role: ['kage'], gender: 'male', status: 'alive', debut: 'summit' }),
  c({ id: 'madara', name: 'Madara Uchiha', affiliation: ['konoha'], nature: ['katon', 'kekkei'], role: ['criminal'], gender: 'male', status: 'dead', debut: 'war' }),
  c({ id: 'hashirama', name: 'Hashirama Senju', aliases: ['Premier Hokage', 'First Hokage'], affiliation: ['konoha'], nature: ['doton', 'suiton', 'kekkei'], role: ['kage'], gender: 'male', status: 'dead', debut: 'war' }),
  c({ id: 'tobirama', name: 'Tobirama Senju', aliases: ['Deuxième Hokage', 'Second Hokage'], affiliation: ['konoha'], nature: ['suiton'], role: ['kage'], gender: 'male', status: 'dead', debut: 'war' }),
  c({ id: 'kushina', name: 'Kushina Uzumaki', affiliation: ['konoha'], nature: [], role: ['jinchuriki'], gender: 'female', status: 'dead', debut: 'war' }),
  c({ id: 'kaguya', name: 'Kaguya Otsutsuki', mal: ['Ootsutsuki Kaguya', 'Ōtsutsuki Kaguya'], affiliation: ['otsutsuki'], nature: ['yin', 'yang', 'kekkei'], role: ['other'], gender: 'female', status: 'alive', debut: 'war' }),
]

const arcIndex = (arc: Arc) => ARCS.indexOf(arc)

/** Compare deux personnages, attribut par attribut. */
export function compareCharacters(guess: NarutoCharacter, answer: NarutoCharacter): Record<NarutoAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    nature: compareSets(guess.nature, answer.nature),
    role: compareSets(guess.role, answer.role),
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

/** Valeurs du personnage proposé, affichées dans ses tuiles (le front les traduit). */
export const characterValues = (character: NarutoCharacter): Record<NarutoAttribute, string | string[]> => ({
  affiliation: character.affiliation,
  nature: character.nature,
  role: character.role,
  gender: character.gender,
  status: character.status,
  debut: character.debut,
})
