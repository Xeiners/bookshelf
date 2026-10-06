import { randomBytes } from 'node:crypto'
import { notFound } from '../../lib/errors.js'
import { checkWord, lexiconOf, type BombMode, type Lexicon, type WordVerdict } from './bomb.dictionary.js'
import { LIVES, fuseMs, pickSyllable, rememberSyllable, soloReward, timing } from './bomb.logic.js'
import { settleGame, type BombReward } from './bomb.stats.js'

/*
 * Solo / entraînement : le SERVEUR tient la partie (syllabe, mèche, vies, mots joués). Le
 * navigateur n'affiche que ce qu'on lui dit et ne peut ni allonger une mèche ni valider
 * un mot inconnu. Une partie par joueur, en mémoire (comme le Higher or Lower).
 *
 * Une explosion se constate à l'heure du serveur : à la demande du joueur quand sa mèche
 * arrive au bout (`explode`), ou au mot suivant s'il arrive trop tard.
 */

/** Marge d'horloge : une demande d'explosion un poil en avance est acceptée. */
const EARLY_TOLERANCE_MS = 300
const IDLE_MS = 60 * 60 * 1000

interface SoloGame {
  id: string
  playerId: string
  mode: BombMode
  lexicon: Lexicon
  syllable: string
  recent: string[]
  lives: number
  words: number
  used: Set<string>
  fuseMs: number
  fuseEndsAt: number
  touchedAt: number
  /** Dernière explosion : la syllabe ratée et un mot qui aurait marché. */
  missed: { syllable: string; example: string | null; at: number } | null
  over: SoloResult | null
}

export interface SoloResult extends BombReward {
  words: number
}

export interface SoloView {
  id: string
  mode: BombMode
  syllable: string
  lives: number
  words: number
  fuseMs: number
  /** Heure (ms, horloge du serveur) à laquelle la bombe explose. */
  fuseEndsAt: number
  serverTime: number
  missed: SoloGame['missed']
  over: SoloResult | null
}

const games = new Map<string, SoloGame>()

const view = (game: SoloGame): SoloView => ({
  id: game.id,
  mode: game.mode,
  syllable: game.syllable,
  lives: game.lives,
  words: game.words,
  fuseMs: game.fuseMs,
  fuseEndsAt: game.fuseEndsAt,
  serverTime: Date.now(),
  missed: game.missed,
  over: game.over,
})

function arm(game: SoloGame, from: number): void {
  game.syllable = pickSyllable(game.lexicon, game.words, game.recent, Math.random)
  game.recent = rememberSyllable(game.recent, game.syllable)
  game.fuseMs = fuseMs(game.words, Math.random)
  game.fuseEndsAt = from + game.fuseMs
}

function gameOf(playerId: string, id: string): SoloGame {
  const game = games.get(id)
  if (!game || game.playerId !== playerId) throw notFound('Partie introuvable.')
  game.touchedAt = Date.now()
  return game
}

async function finish(game: SoloGame): Promise<void> {
  if (game.over) return
  const reward = await settleGame(game.playerId, { mode: game.mode, amount: soloReward(game.words), solo: game.words })
  game.over = { ...reward, words: game.words }
}

/** Les explosions survenues depuis (mèche au bout) : une vie chacune, puis une bombe neuve. */
async function settle(game: SoloGame, now: number, early = 0): Promise<void> {
  while (!game.over && now + early >= game.fuseEndsAt) {
    game.lives -= 1
    game.missed = { syllable: game.syllable, example: game.lexicon.example(game.syllable, game.used), at: game.fuseEndsAt }
    if (game.lives <= 0) {
      game.lives = 0
      await finish(game)
      return
    }
    arm(game, game.fuseEndsAt + timing.pauseMs)
  }
}

export async function startSolo(playerId: string, mode: BombMode): Promise<SoloView> {
  for (const [id, game] of games) if (game.playerId === playerId || Date.now() - game.touchedAt > IDLE_MS) games.delete(id)
  const lexicon = await lexiconOf(mode)
  const game: SoloGame = {
    id: randomBytes(9).toString('hex'),
    playerId,
    mode,
    lexicon,
    syllable: '',
    recent: [],
    lives: LIVES,
    words: 0,
    used: new Set(),
    fuseMs: 0,
    fuseEndsAt: 0,
    touchedAt: Date.now(),
    missed: null,
    over: null,
  }
  arm(game, Date.now())
  games.set(game.id, game)
  return view(game)
}

export interface SoloWordResult {
  verdict: WordVerdict | null
  view: SoloView
}

export async function soloWord(playerId: string, id: string, word: string): Promise<SoloWordResult> {
  const game = gameOf(playerId, id)
  const now = Date.now()
  await settle(game, now)
  if (game.over) return { verdict: null, view: view(game) }
  const verdict = checkWord(game.lexicon, word, game.syllable, game.used)
  if (verdict.ok) {
    game.used.add(verdict.key)
    game.words += 1
    game.missed = null
    arm(game, now)
  }
  return { verdict, view: view(game) }
}

/** La mèche est au bout (côté joueur) : l'explosion, si le serveur la constate aussi. */
export async function soloExplode(playerId: string, id: string): Promise<SoloView> {
  const game = gameOf(playerId, id)
  await settle(game, Date.now(), EARLY_TOLERANCE_MS)
  return view(game)
}

/** Abandon : la partie s'arrête là, les mots trouvés comptent (record, Poussières). */
export async function soloQuit(playerId: string, id: string): Promise<SoloView> {
  const game = gameOf(playerId, id)
  if (!game.over) {
    game.lives = 0
    await finish(game)
  }
  return view(game)
}

export const forgetSoloGames = () => games.clear()
