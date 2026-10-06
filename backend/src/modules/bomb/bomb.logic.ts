import type { Difficulty, Lexicon } from './bomb.dictionary.js'

/*
 * Règles de l'Anime Bomb Party, sans état (testables seules).
 *
 * Une syllabe de 2 ou 3 lettres, une bombe dont la mèche brûle une durée tirée au sort :
 * un mot valide qui contient la syllabe la désamorce (solo) ou la passe au joueur suivant
 * (salon). Si elle explose, on perd une vie (3 au départ). Plus la partie avance, plus
 * les syllabes sont rares et les mèches courtes.
 */

export const LIVES = 3
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8
/**
 * Rythme du jeu. Modifiable par les tests seulement (`fuseScale` raccourcit les mèches).
 * - `countdownMs` : décompte avant la première bombe d'un salon ;
 * - `pauseMs` : l'explosion à l'écran, avant la bombe suivante.
 */
export const timing = { countdownMs: 3000, pauseMs: 1600, fuseScale: 1 }
/** Mot le plus long qu'on accepte (et frappe en direct la plus longue relayée). */
export const MAX_WORD_LENGTH = 40

/** Poussières : un mot = 2 ✦ en solo (60 au plus), une victoire en salon = 15 + 5 par adversaire (40 au plus). */
export const SOLO_REWARD_PER_WORD = 2
export const SOLO_REWARD_MAX = 60
export const VERSUS_REWARD_BASE = 15
export const VERSUS_REWARD_PER_OPPONENT = 5
export const VERSUS_REWARD_MAX = 40
/** Plafond du jour (solo et salons confondus). */
export const BOMB_DAILY_CAP = 150

export const soloReward = (words: number): number => Math.min(SOLO_REWARD_MAX, Math.max(0, words) * SOLO_REWARD_PER_WORD)
export const versusReward = (players: number): number =>
  players < MIN_PLAYERS ? 0 : Math.min(VERSUS_REWARD_MAX, VERSUS_REWARD_BASE + (players - 1) * VERSUS_REWARD_PER_OPPONENT)
export const cappedReward = (amount: number, earnedToday: number): number => Math.max(0, Math.min(amount, BOMB_DAILY_CAP - earnedToday))

/** Difficulté de la syllabe suivante, selon le nombre de mots déjà trouvés dans la partie. */
export function difficultyFor(progress: number, random: () => number): Difficulty {
  if (progress < 5) return 'easy'
  if (progress < 14) return random() < 0.75 ? 'medium' : 'easy'
  return random() < 0.6 ? 'hard' : 'medium'
}

/**
 * Durée de la mèche (ms), tirée au sort : de 12–18 s au début à 6–10 s quand la partie
 * s'emballe. Personne ne sait d'avance quand elle explosera… sauf en la regardant brûler.
 */
export function fuseMs(progress: number, random: () => number): number {
  const shrink = Math.min(1, progress / 25)
  const min = 12_000 - shrink * 6_000
  const max = 18_000 - shrink * 8_000
  return Math.round((min + random() * (max - min)) * timing.fuseScale)
}

/** Syllabe suivante : de la difficulté voulue, jamais une des dernières jouées. */
export function pickSyllable(lexicon: Lexicon, progress: number, recent: readonly string[], random: () => number): string {
  const pool = lexicon.syllables[difficultyFor(progress, random)]
  const fresh = pool.filter((syllable) => !recent.includes(syllable))
  const list = fresh.length > 0 ? fresh : pool
  return list[Math.floor(random() * list.length)] ?? 'ar'
}

/** Garde les `size` dernières syllabes jouées (pour ne pas les resservir aussitôt). */
export const rememberSyllable = (recent: readonly string[], syllable: string, size = 12): string[] => [...recent, syllable].slice(-size)
