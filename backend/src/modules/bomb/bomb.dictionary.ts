import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { HL_WORKS } from '../higherlower/hl.data.js'
import { JJK_CHARACTERS } from '../dle/jjk.characters.js'
import { DRAGONBALL_CHARACTERS } from '../dle/dragonball.characters.js'
import { MHA_CHARACTERS } from '../dle/mha.characters.js'
import { JOJO_CHARACTERS } from '../dle/jojo.characters.js'
import { NARUTO_CHARACTERS } from '../dle/naruto.characters.js'
import { ONEPIECE_CHARACTERS } from '../dle/onepiece.characters.js'

/*
 * Dictionnaires de l'Anime Bomb Party, en mémoire : une validation est une recherche
 * dans une table (quelques microsecondes), jamais un appel réseau ni une requête SQL.
 *
 * - Vocabulaire FR : ~323 000 mots (formes fléchies comprises) de `an-array-of-french-words`
 *   (licence MIT, cf. `data/fr-words.LICENSE`), normalisés une fois pour toutes (minuscules,
 *   sans accents, lettres seules) dans `data/fr-words.txt.gz`.
 * - Manga & Anime : les personnages du BookshelfDLE (noms et surnoms) et les œuvres du
 *   Higher or Lower (titres et autres titres). On accepte le nom entier (« Monkey D. Luffy »)
 *   ou un de ses mots marquants (« Luffy »).
 *
 * Les syllabes imposées viennent du dictionnaire lui-même : on ne tire que des séquences
 * de 2 ou 3 lettres que beaucoup de mots contiennent (de moins en moins au fil de la partie).
 */

export const BOMB_MODES = ['classic', 'manga'] as const
export type BombMode = (typeof BOMB_MODES)[number]
export type Difficulty = 'easy' | 'medium' | 'hard'

/** Comparaison sans casse, accents ni ponctuation : « Été » = « ete », « Kaiju No. 8 » = « kaijuno ». */
export const normalizeWord = (value: string): string =>
  value
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')

export interface Lexicon {
  /** Forme canonique d'un mot accepté (le nom affiché pour le mode Manga), `null` sinon. */
  lookup: (normalized: string) => string | null
  /** Syllabes jouables, par difficulté. */
  syllables: Record<Difficulty, readonly string[]>
  /** Un mot (ou nom) qui aurait marché, montré après une explosion ; `null` si aucun. */
  example: (syllable: string, used: ReadonlySet<string>, random?: () => number) => string | null
  size: number
}

/** Seuils (nombre de mots ou de noms qui contiennent la syllabe) de chaque difficulté. */
const THRESHOLDS: Record<BombMode, Record<Difficulty, [number, number]>> = {
  classic: { easy: [2500, Infinity], medium: [700, 2500], hard: [180, 700] },
  manga: { easy: [14, Infinity], medium: [7, 14], hard: [3, 7] },
}

/** Combien d'entrées distinctes contiennent chaque séquence de 2 ou 3 lettres. */
function syllableCounts(entries: Iterable<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const forms of entries) {
    seen.clear()
    for (const form of forms) {
      for (let size = 2; size <= 3; size += 1) {
        for (let index = 0; index + size <= form.length; index += 1) seen.add(form.slice(index, index + size))
      }
    }
    for (const syllable of seen) counts.set(syllable, (counts.get(syllable) ?? 0) + 1)
  }
  return counts
}

function pools(counts: Map<string, number>, mode: BombMode): Record<Difficulty, string[]> {
  const result: Record<Difficulty, string[]> = { easy: [], medium: [], hard: [] }
  for (const [syllable, count] of counts) {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const [min, max] = THRESHOLDS[mode][difficulty]
      if (count >= min && count < max) result[difficulty].push(syllable)
    }
  }
  // Une difficulté vide (petit dictionnaire de test) emprunte à la voisine.
  if (result.hard.length === 0) result.hard = [...result.medium]
  if (result.medium.length === 0) result.medium = [...result.easy, ...result.hard]
  if (result.easy.length === 0) result.easy = [...result.medium]
  for (const list of Object.values(result)) list.sort()
  return result
}

/* ---- Vocabulaire FR ---------------------------------------------------------------------- */

const WORDS_FILE = new URL('../../../data/fr-words.txt.gz', import.meta.url)

let classic: Promise<Lexicon> | null = null

/** Le dictionnaire français, lu et indexé une fois (≈ 1 s), puis gardé. */
export function classicLexicon(): Promise<Lexicon> {
  classic ??= (async () => {
    const words = gunzipSync(await readFile(WORDS_FILE)).toString('utf8').split('\n').filter(Boolean)
    const set = new Set(words)
    return {
      lookup: (normalized) => (set.has(normalized) ? normalized : null),
      syllables: pools(syllableCounts(words.map((word) => [word])), 'classic'),
      // Un mot courant de préférence : court (4 à 8 lettres), pris à partir d'un point au hasard.
      example: (syllable, used, random = Math.random) => {
        const start = Math.floor(random() * words.length)
        let fallback: string | null = null
        for (let step = 0; step < words.length; step += 1) {
          const word = words[(start + step) % words.length] as string
          if (!word.includes(syllable) || used.has(word)) continue
          if (word.length >= 4 && word.length <= 8) return word
          fallback ??= word
        }
        return fallback
      },
      size: set.size,
    }
  })()
  classic.catch(() => {
    classic = null
  })
  return classic
}

/* ---- Manga & Anime ----------------------------------------------------------------------- */

/** Mots trop courants pour compter seuls (« The », « Kaisen » oui, « no » non). */
const STOP_WORDS = new Set(['the', 'and', 'les', 'des', 'une', 'aux', 'for', 'with', 'from', 'that', 'this', 'who', 'can', 'not', 'cant', 'your', 'into', 'over'])

interface NamedEntry {
  display: string
  names: readonly string[]
}

function mangaEntries(): NamedEntry[] {
  const characters = [...NARUTO_CHARACTERS, ...ONEPIECE_CHARACTERS, ...JOJO_CHARACTERS, ...JJK_CHARACTERS, ...DRAGONBALL_CHARACTERS, ...MHA_CHARACTERS].map((character) => ({
    display: character.name,
    names: [character.name, ...(character.aliases ?? [])],
  }))
  const works = HL_WORKS.map((work) => ({ display: work.name, names: [work.name, ...(work.titles ?? [])] }))
  return [...characters, ...works]
}

let manga: Lexicon | null = null

export function mangaLexicon(): Lexicon {
  if (manga) return manga
  const accepted = new Map<string, string>()
  const forms: string[][] = []
  const displays: string[] = []
  for (const entry of mangaEntries()) {
    const own = new Set<string>()
    for (const name of entry.names) {
      const whole = normalizeWord(name)
      if (whole.length >= 3) own.add(whole)
      for (const word of name.split(/[\s\-–:.,!?'’×/()]+/)) {
        const token = normalizeWord(word)
        if (token.length >= 4 && !STOP_WORDS.has(token)) own.add(token)
      }
    }
    // Premier arrivé, premier servi : un mot partagé (« Uchiha ») désigne un seul nom affiché.
    for (const form of own) if (!accepted.has(form)) accepted.set(form, entry.display)
    forms.push([...own])
    displays.push(entry.display)
  }
  manga = {
    lookup: (normalized) => accepted.get(normalized) ?? null,
    syllables: pools(syllableCounts(forms), 'manga'),
    example: (syllable, used, random = Math.random) => {
      const start = Math.floor(random() * displays.length)
      for (let step = 0; step < displays.length; step += 1) {
        const index = (start + step) % displays.length
        const display = displays[index] as string
        if (!used.has(normalizeWord(display)) && forms[index]?.some((form) => form.includes(syllable))) return display
      }
      return null
    },
    size: accepted.size,
  }
  return manga
}

export const lexiconOf = (mode: BombMode): Promise<Lexicon> => (mode === 'classic' ? classicLexicon() : Promise.resolve(mangaLexicon()))

/* ---- Validation ---------------------------------------------------------------------------- */

export type WordVerdict =
  | { ok: true; key: string; display: string }
  | { ok: false; reason: 'short' | 'syllable' | 'unknown' | 'used' }

/**
 * Un mot proposé : assez long, contenant la syllabe, connu, pas encore joué dans la partie.
 * `key` sert à interdire la redite (pour le mode Manga, le nom entier : « Luffy » puis
 * « Monkey D. Luffy », c'est le même personnage).
 */
export function checkWord(lexicon: Lexicon, input: string, syllable: string, used: ReadonlySet<string>): WordVerdict {
  const normalized = normalizeWord(input)
  if (normalized.length < Math.max(2, syllable.length)) return { ok: false, reason: 'short' }
  if (!normalized.includes(syllable)) return { ok: false, reason: 'syllable' }
  const display = lexicon.lookup(normalized)
  if (display === null) return { ok: false, reason: 'unknown' }
  const key = normalizeWord(display)
  if (used.has(key)) return { ok: false, reason: 'used' }
  return { ok: true, key, display }
}
