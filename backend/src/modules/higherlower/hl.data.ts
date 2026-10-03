import { ONEPIECE_CHARACTERS } from '../dle/onepiece.characters.js'

/*
 * Cartes du Higher or Lower, par métrique. Valeurs rédigées à la main :
 *  - primes : celles des fiches One Piece du BookshelfDLE (une seule source) ;
 *  - ventes : exemplaires en circulation annoncés par les éditeurs (arrondis) ;
 *  - chapitres : séries TERMINÉES seulement (un compte qui bouge chaque semaine
 *    serait faux tôt ou tard) ;
 *  - notes : note MyAnimeList du manga, relevée en 2025 (elle bouge peu).
 * À corriger au fil des retours. Les titres servent à retrouver la couverture dans
 * le catalogue MangaDex (cf. `hl.covers.ts`) : titre anglais, puis romaji.
 */

export const HL_METRICS = ['bounty', 'sales', 'chapters', 'score'] as const
export type HlMetric = (typeof HL_METRICS)[number]
export const isHlMetric = (value: string): value is HlMetric => (HL_METRICS as readonly string[]).includes(value)

export interface HlWork {
  id: string
  name: string
  /** Titres cherchés dans le catalogue (le nom d'abord). */
  titles?: string[]
  /** Exemplaires en circulation. */
  sales?: number
  /** Chapitres d'une série terminée. */
  chapters?: number
  /** Note MyAnimeList (/10). */
  score?: number
}

const M = 1_000_000

export const HL_WORKS: readonly HlWork[] = [
  { id: 'one-piece', name: 'One Piece', sales: 530 * M, score: 9.22 },
  { id: 'golgo-13', name: 'Golgo 13', sales: 300 * M },
  { id: 'detective-conan', name: 'Detective Conan', titles: ['Meitantei Conan', 'Case Closed'], sales: 270 * M },
  { id: 'dragon-ball', name: 'Dragon Ball', sales: 260 * M, chapters: 519, score: 8.42 },
  { id: 'naruto', name: 'Naruto', sales: 250 * M, chapters: 700, score: 8.07 },
  { id: 'demon-slayer', name: 'Demon Slayer', titles: ['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba'], sales: 220 * M, chapters: 205, score: 8.04 },
  { id: 'slam-dunk', name: 'Slam Dunk', sales: 170 * M, chapters: 276, score: 9.09 },
  { id: 'attack-on-titan', name: 'Attack on Titan', titles: ['Shingeki no Kyojin'], sales: 140 * M, chapters: 139, score: 8.55 },
  { id: 'bleach', name: 'Bleach', sales: 130 * M, chapters: 686, score: 7.88 },
  { id: 'jojo', name: "JoJo's Bizarre Adventure", titles: ['JoJo no Kimyou na Bouken', "JoJo's Bizarre Adventure Part 1: Phantom Blood"], sales: 120 * M },
  { id: 'kingdom', name: 'Kingdom', sales: 110 * M },
  { id: 'jujutsu-kaisen', name: 'Jujutsu Kaisen', sales: 100 * M, chapters: 271, score: 8.44 },
  { id: 'my-hero-academia', name: 'My Hero Academia', titles: ['Boku no Hero Academia'], sales: 100 * M, chapters: 430, score: 7.84 },
  { id: 'fist-of-the-north-star', name: 'Fist of the North Star', titles: ['Hokuto no Ken'], sales: 100 * M, chapters: 245, score: 8.35 },
  { id: 'hajime-no-ippo', name: 'Hajime no Ippo', sales: 100 * M },
  { id: 'captain-tsubasa', name: 'Captain Tsubasa', sales: 90 * M },
  { id: 'hunter-x-hunter', name: 'Hunter x Hunter', sales: 84 * M, score: 8.73 },
  { id: 'vagabond', name: 'Vagabond', sales: 82 * M, score: 9.27 },
  { id: 'fullmetal-alchemist', name: 'Fullmetal Alchemist', titles: ['Hagane no Renkinjutsushi'], sales: 80 * M, chapters: 108, score: 9.03 },
  { id: 'rurouni-kenshin', name: 'Rurouni Kenshin', sales: 72 * M, chapters: 255, score: 8.47 },
  { id: 'fairy-tail', name: 'Fairy Tail', sales: 72 * M, chapters: 545, score: 7.94 },
  { id: 'tokyo-revengers', name: 'Tokyo Revengers', titles: ['Tokyo Manji Revengers'], sales: 70 * M, chapters: 278, score: 7.63 },
  { id: 'haikyu', name: 'Haikyu!!', titles: ['Haikyuu!!', 'Haikyu'], sales: 65 * M, chapters: 402, score: 8.88 },
  { id: 'berserk', name: 'Berserk', sales: 60 * M, score: 9.47 },
  { id: 'gintama', name: 'Gintama', sales: 55 * M, chapters: 704, score: 8.89 },
  { id: 'seven-deadly-sins', name: 'The Seven Deadly Sins', titles: ['Nanatsu no Taizai'], sales: 55 * M, chapters: 346 },
  { id: 'yu-yu-hakusho', name: 'Yu Yu Hakusho', titles: ['YuYu Hakusho', 'Yuu Yuu Hakusho'], sales: 50 * M, chapters: 175, score: 8.49 },
  { id: 'inuyasha', name: 'Inuyasha', sales: 50 * M, chapters: 558 },
  { id: 'nana', name: 'Nana', sales: 50 * M, score: 8.8 },
  { id: 'tokyo-ghoul', name: 'Tokyo Ghoul', sales: 47 * M, chapters: 143, score: 8.46 },
  { id: 'promised-neverland', name: 'The Promised Neverland', titles: ['Yakusoku no Neverland'], sales: 41 * M, chapters: 181, score: 8.58 },
  { id: 'twentieth-century-boys', name: '20th Century Boys', titles: ['20 Seiki Shounen'], sales: 36 * M, chapters: 249, score: 8.93 },
  { id: 'spy-x-family', name: 'SPY×FAMILY', titles: ['Spy x Family'], sales: 35 * M, score: 8.61 },
  { id: 'sailor-moon', name: 'Sailor Moon', titles: ['Bishoujo Senshi Sailor Moon'], sales: 35 * M, score: 8.05 },
  { id: 'kurokos-basketball', name: "Kuroko's Basketball", titles: ['Kuroko no Basuke'], sales: 31 * M, chapters: 275 },
  { id: 'death-note', name: 'Death Note', sales: 30 * M, chapters: 108, score: 8.7 },
  { id: 'chainsaw-man', name: 'Chainsaw Man', sales: 30 * M, score: 8.65 },
  { id: 'one-punch-man', name: 'One-Punch Man', titles: ['One Punch-Man', 'Onepunch-Man'], sales: 30 * M, score: 8.75 },
  { id: 'reborn', name: 'Reborn!', titles: ['Katekyo Hitman Reborn!', 'Kateikyoushi Hitman Reborn!'], sales: 30 * M, chapters: 409 },
  { id: 'assassination-classroom', name: 'Assassination Classroom', titles: ['Ansatsu Kyoushitsu'], sales: 27 * M, chapters: 180, score: 8.33 },
  { id: 'kaguya-sama', name: 'Kaguya-sama: Love Is War', titles: ['Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen'], sales: 22 * M, chapters: 281, score: 8.87 },
  { id: 'monster', name: 'Monster', sales: 20 * M, chapters: 162, score: 9.16 },
  { id: 'soul-eater', name: 'Soul Eater', sales: 20 * M, chapters: 113 },
  { id: 'black-clover', name: 'Black Clover', sales: 20 * M, score: 7.73 },
  { id: 'dr-stone', name: 'Dr. Stone', sales: 15 * M, chapters: 232, score: 8.43 },
  { id: 'bakuman', name: 'Bakuman', sales: 15 * M, chapters: 176 },
  { id: 'vinland-saga', name: 'Vinland Saga', sales: 7 * M, score: 9.04 },
  // Séries terminées et notes seulement.
  { id: 'toriko', name: 'Toriko', chapters: 396 },
  { id: 'ranma', name: 'Ranma ½', titles: ['Ranma 1/2'], chapters: 407 },
  { id: 'golden-kamuy', name: 'Golden Kamuy', chapters: 314, score: 8.83 },
  { id: 'fire-force', name: 'Fire Force', titles: ['Enen no Shouboutai'], chapters: 304 },
  { id: 'beelzebub', name: 'Beelzebub', chapters: 240 },
  { id: 'nisekoi', name: 'Nisekoi', chapters: 229 },
  { id: 'dorohedoro', name: 'Dorohedoro', chapters: 167 },
  { id: 'akira', name: 'Akira', chapters: 120, score: 8.67 },
  { id: 'quintessential-quintuplets', name: 'The Quintessential Quintuplets', titles: ['5Toubun no Hanayome', 'Gotoubun no Hanayome'], chapters: 122 },
  { id: 'mob-psycho', name: 'Mob Psycho 100', chapters: 101, score: 8.71 },
  { id: 'pluto', name: 'Pluto', chapters: 65, score: 8.86 },
  { id: 'parasyte', name: 'Parasyte', titles: ['Kiseijuu'], chapters: 64 },
  { id: 'steel-ball-run', name: 'JoJo Part 7: Steel Ball Run', titles: ["JoJo's Bizarre Adventure Part 7: Steel Ball Run", 'Steel Ball Run'], score: 9.31 },
  { id: 'goodnight-punpun', name: 'Goodnight Punpun', titles: ['Oyasumi Punpun'], score: 9.02 },
  { id: 'frieren', name: "Frieren: Beyond Journey's End", titles: ['Sousou no Frieren', 'Frieren'], score: 9.07 },
  { id: 'made-in-abyss', name: 'Made in Abyss', score: 8.84 },
]

/** Une carte jouable : un nom, une valeur, de quoi trouver son image. */
export interface HlEntry {
  id: string
  name: string
  value: number
  /** One Piece : id du personnage (portrait relayé par le BookshelfDLE). */
  character?: string
  /** Œuvres : titres cherchés dans le catalogue. */
  titles?: readonly string[]
}

const worksWith = (key: 'sales' | 'chapters' | 'score'): HlEntry[] =>
  HL_WORKS.flatMap((work) => {
    const value = work[key]
    return value === undefined ? [] : [{ id: work.id, name: work.name, value, titles: [work.name, ...(work.titles ?? [])] }]
  })

/** Les cartes de chaque métrique. */
export const HL_ENTRIES: Record<HlMetric, readonly HlEntry[]> = {
  bounty: ONEPIECE_CHARACTERS.flatMap((character) =>
    character.bounty === null ? [] : [{ id: character.id, name: character.name, value: character.bounty, character: character.id }],
  ),
  sales: worksWith('sales'),
  chapters: worksWith('chapters'),
  score: worksWith('score'),
}
