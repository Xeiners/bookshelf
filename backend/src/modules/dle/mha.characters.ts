import { compareOrdered, compareSets, type AttributeFeedback } from './dle.logic.js'

/*
 * Catégorie « My Hero Academia » du BookshelfDLE : élèves de Yuei, héros pros et
 * vilains du manga. Fiches rédigées à la main ; statut à la fin du manga ; type
 * d'Alter selon le classement du manga (émetteur, transformation, mutant). Les clés
 * sont traduites par le front.
 */

export const MHA_ATTRIBUTES = ['affiliation', 'quirk', 'role', 'gender', 'status', 'debut'] as const
export type MhaAttribute = (typeof MHA_ATTRIBUTES)[number]

export type MhaAffiliation =
  | 'class_1a'
  | 'class_1b'
  | 'ua'
  | 'heroes'
  | 'hpsc'
  | 'shiketsu'
  | 'league'
  | 'liberation'
  | 'hassaikai'
  | 'other'
export type MhaQuirk = 'emitter' | 'transformation' | 'mutant'
export type MhaRole = 'student' | 'hero' | 'villain' | 'civilian'

/** Arcs, dans l'ordre du manga : la première apparition se compare avec ↑ ↓. */
export const MHA_ARCS = [
  'origin',
  'usj',
  'sports_festival',
  'hero_killer',
  'final_exams',
  'kamino',
  'license',
  'overhaul',
  'school_festival',
  'pro_hero',
  'joint_training',
  'meta_liberation',
  'endeavor_agency',
  'war',
  'dark_hero',
  'final_war',
] as const
export type MhaArc = (typeof MHA_ARCS)[number]

export interface MhaCharacter {
  id: string
  name: string
  aliases?: string[]
  /** Noms sous lesquels MyAnimeList le connaît (portrait), en plus de `name`. */
  mal?: string[]
  /** Titre de sa fiche sur le wiki Fandom, s'il diffère de `name`. */
  wiki?: string
  affiliation: MhaAffiliation[]
  quirk: MhaQuirk
  role: MhaRole
  gender: 'male' | 'female'
  status: 'alive' | 'dead'
  debut: MhaArc
}

const c = (character: MhaCharacter) => character

export const MHA_CHARACTERS: MhaCharacter[] = [
  // Débuts : examen d'entrée, test d'Alter, classe 1-A.
  c({ id: 'deku', name: 'Izuku Midoriya', aliases: ['Deku', 'Izuku', 'Midoriya'], mal: ['Midoriya Izuku'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'bakugo', name: 'Katsuki Bakugo', aliases: ['Bakugo', 'Bakugou', 'Kacchan', 'Katsuki', 'Ground Zero', 'Dynamight'], mal: ['Bakugou Katsuki'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'all_might', name: 'All Might', aliases: ['Toshinori Yagi', 'Yagi'], mal: ['Yagi Toshinori'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'inko', name: 'Inko Midoriya', aliases: ['Inko'], mal: ['Midoriya Inko'], affiliation: ['other'], quirk: 'emitter', role: 'civilian', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'uraraka', name: 'Ochaco Uraraka', aliases: ['Uraraka', 'Ochaco', 'Ochako', 'Uravity'], mal: ['Uraraka Ochako', 'Uraraka Ochaco'], wiki: 'Ochaco Uraraka', affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'iida', name: 'Tenya Iida', aliases: ['Iida', 'Tenya', 'Ingenium'], mal: ['Iida Tenya'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'todoroki', name: 'Shoto Todoroki', aliases: ['Todoroki', 'Shoto', 'Shouto'], mal: ['Todoroki Shouto'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'tsuyu', name: 'Tsuyu Asui', aliases: ['Tsuyu', 'Asui', 'Froppy'], mal: ['Asui Tsuyu'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'kirishima', name: 'Eijiro Kirishima', aliases: ['Kirishima', 'Eijiro', 'Red Riot'], mal: ['Kirishima Eijirou'], affiliation: ['class_1a'], quirk: 'transformation', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'momo', name: 'Momo Yaoyorozu', aliases: ['Momo', 'Yaoyorozu', 'Creati'], mal: ['Yaoyorozu Momo'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'kaminari', name: 'Denki Kaminari', aliases: ['Kaminari', 'Denki', 'Chargebolt'], mal: ['Kaminari Denki'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'tokoyami', name: 'Fumikage Tokoyami', aliases: ['Tokoyami', 'Fumikage', 'Tsukuyomi'], mal: ['Tokoyami Fumikage'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'jiro', name: 'Kyoka Jiro', aliases: ['Jiro', 'Jirou', 'Kyoka', 'Earphone Jack'], mal: ['Jirou Kyouka'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'mina', name: 'Mina Ashido', aliases: ['Mina', 'Ashido', 'Pinky', 'Alien Queen'], mal: ['Ashido Mina'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'mineta', name: 'Minoru Mineta', aliases: ['Mineta', 'Minoru', 'Grape Juice'], mal: ['Mineta Minoru'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'sero', name: 'Hanta Sero', aliases: ['Sero', 'Hanta', 'Cellophane'], mal: ['Sero Hanta'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'aoyama', name: 'Yuga Aoyama', aliases: ['Aoyama', 'Yuga', 'Can’t Stop Twinkling'], mal: ['Aoyama Yuuga'], affiliation: ['class_1a'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'shoji', name: 'Mezo Shoji', aliases: ['Shoji', 'Shouji', 'Mezo', 'Tentacole'], mal: ['Shouji Mezou'], affiliation: ['class_1a'], quirk: 'mutant', role: 'student', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'aizawa', name: 'Shota Aizawa', aliases: ['Aizawa', 'Eraser Head', 'Eraserhead', 'Shouta'], mal: ['Aizawa Shouta'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'present_mic', name: 'Present Mic', aliases: ['Hizashi Yamada', 'Yamada'], mal: ['Yamada Hizashi'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'origin' }),
  c({ id: 'mt_lady', name: 'Mt. Lady', aliases: ['Mount Lady', 'Yu Takeyama', 'Takeyama'], mal: ['Takeyama Yuu', 'Mt. Lady'], affiliation: ['heroes'], quirk: 'transformation', role: 'hero', gender: 'female', status: 'alive', debut: 'origin' }),
  c({ id: 'kamui_woods', name: 'Kamui Woods', aliases: ['Shinji Nishiya', 'Nishiya'], mal: ['Nishiya Shinji', 'Kamui Woods'], affiliation: ['heroes'], quirk: 'transformation', role: 'hero', gender: 'male', status: 'alive', debut: 'origin' }),
  // L'USJ, le festival sportif.
  c({ id: 'shigaraki', name: 'Tomura Shigaraki', aliases: ['Shigaraki', 'Tomura', 'Tenko Shimura', 'Tenko'], mal: ['Shigaraki Tomura'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'dead', debut: 'usj' }),
  c({ id: 'kurogiri', name: 'Kurogiri', aliases: ['Oboro Shirakumo'], affiliation: ['league'], quirk: 'mutant', role: 'villain', gender: 'male', status: 'alive', debut: 'usj' }),
  c({ id: 'thirteen', name: 'Thirteen', aliases: ['13', 'Treize', 'Anan Kurose'], mal: ['Thirteen', 'Juusan'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'female', status: 'alive', debut: 'usj' }),
  c({ id: 'nezu', name: 'Nezu', aliases: ['Principal Nezu', 'Principal'], affiliation: ['ua'], quirk: 'mutant', role: 'civilian', gender: 'male', status: 'alive', debut: 'usj' }),
  c({ id: 'shinso', name: 'Hitoshi Shinso', aliases: ['Shinso', 'Shinsou', 'Hitoshi'], mal: ['Shinsou Hitoshi'], affiliation: ['ua'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'sports_festival' }),
  c({ id: 'monoma', name: 'Neito Monoma', aliases: ['Monoma', 'Neito', 'Phantom Thief'], mal: ['Monoma Neito'], affiliation: ['class_1b'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'sports_festival' }),
  c({ id: 'kendo', name: 'Itsuka Kendo', aliases: ['Kendo', 'Kendou', 'Itsuka', 'Battle Fist'], mal: ['Kendou Itsuka'], affiliation: ['class_1b'], quirk: 'transformation', role: 'student', gender: 'female', status: 'alive', debut: 'sports_festival' }),
  c({ id: 'tetsutetsu', name: 'Tetsutetsu Tetsutetsu', aliases: ['Tetsutetsu', 'Real Steel'], affiliation: ['class_1b'], quirk: 'transformation', role: 'student', gender: 'male', status: 'alive', debut: 'sports_festival' }),
  c({ id: 'midnight', name: 'Midnight', aliases: ['Nemuri Kayama', 'Kayama'], mal: ['Kayama Nemuri'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'female', status: 'dead', debut: 'sports_festival' }),
  c({ id: 'cementoss', name: 'Cementoss', aliases: ['Ken Ishiyama', 'Ishiyama'], mal: ['Ishiyama Ken', 'Cementoss'], affiliation: ['heroes', 'ua'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'sports_festival' }),
  c({ id: 'endeavor', name: 'Endeavor', aliases: ['Enji Todoroki', 'Enji'], mal: ['Todoroki Enji'], affiliation: ['heroes'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'sports_festival' }),
  // Le tueur de héros, les examens, Kamino.
  c({ id: 'stain', name: 'Stain', aliases: ['Hero Killer', 'Chizome Akaguro', 'Tueur de héros'], mal: ['Akaguro Chizome', 'Stain'], affiliation: ['other'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'alive', debut: 'hero_killer' }),
  c({ id: 'gran_torino', name: 'Gran Torino', aliases: ['Sorahiko Torino', 'Torino'], mal: ['Gran Torino', 'Torino Sorahiko'], affiliation: ['heroes'], quirk: 'mutant', role: 'hero', gender: 'male', status: 'alive', debut: 'hero_killer' }),
  c({ id: 'best_jeanist', name: 'Best Jeanist', aliases: ['Tsunagu Hakamada', 'Jeanist'], mal: ['Hakamada Tsunagu'], affiliation: ['heroes'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'alive', debut: 'hero_killer' }),
  c({ id: 'dabi', name: 'Dabi', aliases: ['Toya Todoroki', 'Touya Todoroki', 'Touya'], mal: ['Dabi', 'Todoroki Touya'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'alive', debut: 'hero_killer' }),
  c({ id: 'toga', name: 'Himiko Toga', aliases: ['Toga', 'Himiko'], mal: ['Toga Himiko'], affiliation: ['league'], quirk: 'transformation', role: 'villain', gender: 'female', status: 'dead', debut: 'hero_killer' }),
  c({ id: 'all_for_one', name: 'All For One', aliases: ['AFO', 'Un pour Tous', 'Tous pour Un'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'dead', debut: 'kamino' }),
  c({ id: 'twice', name: 'Twice', aliases: ['Jin Bubaigawara', 'Bubaigawara'], mal: ['Bubaigawara Jin', 'Twice'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'dead', debut: 'kamino' }),
  c({ id: 'spinner', name: 'Spinner', aliases: ['Shuichi Iguchi', 'Iguchi'], mal: ['Iguchi Shuuichi', 'Spinner'], affiliation: ['league'], quirk: 'mutant', role: 'villain', gender: 'male', status: 'alive', debut: 'kamino' }),
  c({ id: 'compress', name: 'Mr. Compress', aliases: ['Compress', 'Atsuhiro Sako', 'Sako'], mal: ['Sako Atsuhiro', 'Mr. Compress'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'alive', debut: 'kamino' }),
  c({ id: 'magne', name: 'Magne', aliases: ['Kenji Hikiishi', 'Big Sis Magne'], mal: ['Hikiishi Kenji', 'Magne'], affiliation: ['league'], quirk: 'emitter', role: 'villain', gender: 'female', status: 'dead', debut: 'kamino' }),
  c({ id: 'muscular', name: 'Muscular', aliases: ['Goto Imasuji'], mal: ['Imasuji Gotou', 'Muscular'], affiliation: ['league'], quirk: 'transformation', role: 'villain', gender: 'male', status: 'alive', debut: 'kamino' }),
  c({ id: 'kota', name: 'Kota Izumi', aliases: ['Kota', 'Kouta'], mal: ['Izumi Kouta'], affiliation: ['other'], quirk: 'emitter', role: 'civilian', gender: 'male', status: 'alive', debut: 'kamino' }),
  // Licence provisoire, Overhaul, festival de Yuei.
  c({ id: 'inasa', name: 'Inasa Yoarashi', aliases: ['Inasa', 'Yoarashi'], mal: ['Yoarashi Inasa'], affiliation: ['shiketsu'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'license' }),
  c({ id: 'camie', name: 'Camie Utsushimi', aliases: ['Camie', 'Utsushimi'], mal: ['Utsushimi Kemii', 'Utsushimi Camie'], affiliation: ['shiketsu'], quirk: 'emitter', role: 'student', gender: 'female', status: 'alive', debut: 'license' }),
  c({ id: 'mirio', name: 'Mirio Togata', aliases: ['Mirio', 'Togata', 'Lemillion'], mal: ['Toogata Mirio', 'Togata Mirio'], affiliation: ['ua'], quirk: 'emitter', role: 'student', gender: 'male', status: 'alive', debut: 'overhaul' }),
  c({ id: 'tamaki', name: 'Tamaki Amajiki', aliases: ['Tamaki', 'Amajiki', 'Suneater'], mal: ['Amajiki Tamaki'], affiliation: ['ua'], quirk: 'transformation', role: 'student', gender: 'male', status: 'alive', debut: 'overhaul' }),
  c({ id: 'nejire', name: 'Nejire Hado', aliases: ['Nejire', 'Hado', 'Hadou'], mal: ['Hadou Nejire'], affiliation: ['ua'], quirk: 'emitter', role: 'student', gender: 'female', status: 'alive', debut: 'overhaul' }),
  c({ id: 'nighteye', name: 'Sir Nighteye', aliases: ['Nighteye', 'Mirai Sasaki'], mal: ['Sasaki Mirai'], affiliation: ['heroes'], quirk: 'emitter', role: 'hero', gender: 'male', status: 'dead', debut: 'overhaul' }),
  c({ id: 'fat_gum', name: 'Fat Gum', aliases: ['Taishiro Toyomitsu', 'Toyomitsu'], mal: ['Toyomitsu Taishirou'], affiliation: ['heroes'], quirk: 'transformation', role: 'hero', gender: 'male', status: 'alive', debut: 'overhaul' }),
  c({ id: 'ryukyu', name: 'Ryukyu', aliases: ['Ryuko Tatsuma', 'Tatsuma'], mal: ['Tatsuma Ryuuko', 'Ryuukyuu'], affiliation: ['heroes'], quirk: 'transformation', role: 'hero', gender: 'female', status: 'alive', debut: 'overhaul' }),
  c({ id: 'overhaul', name: 'Overhaul', aliases: ['Kai Chisaki', 'Chisaki'], mal: ['Chisaki Kai'], affiliation: ['hassaikai'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'alive', debut: 'overhaul' }),
  c({ id: 'eri', name: 'Eri', affiliation: ['hassaikai', 'ua'], quirk: 'emitter', role: 'civilian', gender: 'female', status: 'alive', debut: 'overhaul' }),
  c({ id: 'gentle', name: 'Gentle Criminal', aliases: ['Gentle', 'Danjuro Tobita', 'Tobita'], mal: ['Tobita Danjuurou', 'Gentle Criminal'], affiliation: ['other'], quirk: 'emitter', role: 'villain', gender: 'male', status: 'alive', debut: 'school_festival' }),
  c({ id: 'la_brava', name: 'La Brava', aliases: ['Manami Aiba', 'Aiba'], mal: ['Aiba Manami', 'La Brava'], affiliation: ['other'], quirk: 'emitter', role: 'villain', gender: 'female', status: 'alive', debut: 'school_festival' }),
  // Héros pros, Libération, guerre et dernier combat.
  c({ id: 'hawks', name: 'Hawks', aliases: ['Keigo Takami', 'Takami'], mal: ['Takami Keigo', 'Hawks'], affiliation: ['heroes', 'hpsc'], quirk: 'mutant', role: 'hero', gender: 'male', status: 'alive', debut: 'pro_hero' }),
  c({ id: 'mirko', name: 'Mirko', aliases: ['Rumi Usagiyama', 'Usagiyama', 'Rabbit Hero'], mal: ['Usagiyama Rumi', 'Mirko'], affiliation: ['heroes'], quirk: 'mutant', role: 'hero', gender: 'female', status: 'alive', debut: 'pro_hero' }),
  c({ id: 'edgeshot', name: 'Edgeshot', aliases: ['Shinya Kamihara', 'Kamihara'], mal: ['Kamihara Shinya', 'Edgeshot'], affiliation: ['heroes'], quirk: 'transformation', role: 'hero', gender: 'male', status: 'alive', debut: 'kamino' }),
  c({ id: 're_destro', name: 'Re-Destro', aliases: ['Rikiya Yotsubashi', 'Destro'], mal: ['Yotsubashi Rikiya', 'Re-Destro'], affiliation: ['liberation'], quirk: 'transformation', role: 'villain', gender: 'male', status: 'alive', debut: 'meta_liberation' }),
  c({ id: 'gigantomachia', name: 'Gigantomachia', aliases: ['Machia'], affiliation: ['league'], quirk: 'mutant', role: 'villain', gender: 'male', status: 'alive', debut: 'meta_liberation' }),
  c({ id: 'nagant', name: 'Lady Nagant', aliases: ['Nagant', 'Kaina Tsutsumi'], mal: ['Tsutsumi Kaina', 'Lady Nagant'], affiliation: ['hpsc'], quirk: 'mutant', role: 'villain', gender: 'female', status: 'alive', debut: 'dark_hero' }),
  c({ id: 'star', name: 'Star and Stripe', aliases: ['Star & Stripe', 'Cathleen Bate'], mal: ['Cathleen Bate', 'Star and Stripe'], affiliation: ['heroes'], quirk: 'emitter', role: 'hero', gender: 'female', status: 'dead', debut: 'dark_hero' }),
]

const arcIndex = (arc: MhaArc) => MHA_ARCS.indexOf(arc)

export function compareMha(guess: MhaCharacter, answer: MhaCharacter): Record<MhaAttribute, AttributeFeedback> {
  return {
    affiliation: compareSets(guess.affiliation, answer.affiliation),
    quirk: { verdict: guess.quirk === answer.quirk ? 'exact' : 'wrong' },
    role: { verdict: guess.role === answer.role ? 'exact' : 'wrong' },
    gender: { verdict: guess.gender === answer.gender ? 'exact' : 'wrong' },
    status: { verdict: guess.status === answer.status ? 'exact' : 'wrong' },
    debut: compareOrdered(arcIndex(guess.debut), arcIndex(answer.debut), 1),
  }
}

export const mhaValues = (character: MhaCharacter): Record<MhaAttribute, string | string[]> => ({
  affiliation: character.affiliation,
  quirk: character.quirk,
  role: character.role,
  gender: character.gender,
  status: character.status,
  debut: character.debut,
})
