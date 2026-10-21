import { at, collect, decodeEntities, extractInitialData, isObject, text } from '../music/youtubeSearch.js'
import { seededRandom, shuffle } from '../../core/util/seeded.js'

/*
 * Fil « Edits » : des vidéos verticales d'anime (edits, AMV, MMV, MAD) trouvées sur YouTube
 * Shorts. Fonctions pures, testées (`backend/test/edits.test.ts`) : les recherches à lancer,
 * le tri de ce qui ressemble vraiment à un edit, la lecture des réponses de YouTube (API
 * officielle ou page de résultats) et l'assemblage du fil, varié d'un univers à l'autre.
 */

/** Univers proposés en filtre, avec leur nom de recherche (celui qu'emploient les monteurs). */
export const EDIT_UNIVERSES = {
  naruto: 'Naruto',
  onepiece: 'One Piece',
  jojo: 'JoJo',
  demonslayer: 'Demon Slayer',
  jjk: 'Jujutsu Kaisen',
  aot: 'Attack on Titan',
  dragonball: 'Dragon Ball',
  bleach: 'Bleach',
  hxh: 'Hunter x Hunter',
  chainsawman: 'Chainsaw Man',
  mha: 'My Hero Academia',
  sololeveling: 'Solo Leveling',
  frieren: 'Frieren',
  deathnote: 'Death Note',
  tokyoghoul: 'Tokyo Ghoul',
  vinland: 'Vinland Saga',
  bluelock: 'Blue Lock',
  haikyuu: 'Haikyuu',
  berserk: 'Berserk',
  spyxfamily: 'Spy x Family',
} as const

export type EditUniverse = keyof typeof EDIT_UNIVERSES
export const UNIVERSE_IDS = Object.keys(EDIT_UNIVERSES) as EditUniverse[]

/** Formats recherchés : les mots que les monteurs mettent dans leurs titres. */
const STYLES = ['edit', 'amv', 'edit 4k'] as const

export interface EditQuery {
  /** Univers visé ; `null` : edits d'anime en général. */
  universe: EditUniverse | null
  q: string
}

/** Recherches génériques, quand aucun univers n'est choisi : elles mélangent les séries. */
const GENERAL: readonly string[] = ['anime edit', 'anime amv', 'anime mmv', 'anime mad', 'anime edit 4k', 'manga edit']

/**
 * Les recherches d'un fil, dans un ordre propre à sa graine (deux visites ne voient pas le même
 * fil). Tous univers : un format par univers, plus les recherches générales ; un univers : ses
 * trois formats.
 */
export function editQueries(universe: EditUniverse | null, seed: string): EditQuery[] {
  const random = seededRandom(`edits:${seed}`)
  if (universe) {
    const name = EDIT_UNIVERSES[universe]
    return shuffle(
      STYLES.map((style) => ({ universe, q: `${name} ${style} #shorts` })),
      random,
    )
  }
  const perUniverse = UNIVERSE_IDS.map((id) => ({ universe: id, q: `${EDIT_UNIVERSES[id]} ${STYLES[Math.floor(random() * STYLES.length)]} #shorts` }))
  const general = GENERAL.map((q) => ({ universe: null, q: `${q} #shorts` }))
  return shuffle([...perUniverse, ...general], random)
}

/* ---- Ce qui est (ou n'est pas) un edit ------------------------------------------------- */

/** Indices d'un montage : au moins un doit figurer dans le titre (ou les hashtags). */
const EDIT_HINTS = /\b(edit|edits|amv|mmv|mad|twixtor|alight ?motion|after ?effects|ae|4k|sync|velocity|flow)\b|#(edit|amv|animeedit|anime_edit)/i
/** Ce qui n'en est pas : réactions, analyses, bandes-annonces, épisodes, tutoriels, directs… */
const NOT_EDIT =
  /\b(react(ion|ing)?|review|explained|explication|analyse|analysis|theory|th[ée]orie|trailer|teaser|bande[- ]annonce|episode|épisode|ep\.? ?\d+|full movie|podcast|tutorial|tuto|how to|live|stream|unboxing|cosplay|figure|figurine|ranking|tier ?list|top ?\d+|vs\.? battle|news|leak|spoiler)\b/i

export function looksLikeEdit(title: string): boolean {
  return EDIT_HINTS.test(title) && !NOT_EDIT.test(title)
}

/** Durée en secondes : « PT1M5S » (API) ou « 1:05 » (page) ; `null` si illisible. */
export function durationSeconds(value: string | null | undefined): number | null {
  if (!value) return null
  const iso = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (iso && value !== 'P' && value !== 'PT') return Number(iso[1] ?? 0) * 86400 + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0)
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  return null
}

/** Un Short dure trois minutes au plus. */
export const MAX_EDIT_SECONDS = 180

/* ---- Lecture des réponses de YouTube --------------------------------------------------- */

export interface EditVideo {
  id: string
  title: string
  channel: string | null
  /** Durée en secondes, quand YouTube la donne. */
  seconds: number | null
  universe: EditUniverse | null
}

const VIDEO_ID = /^[\w-]{11}$/

function accept(video: EditVideo | null, out: EditVideo[], seen: Set<string>): void {
  if (!video || !VIDEO_ID.test(video.id) || seen.has(video.id)) return
  if (!looksLikeEdit(video.title)) return
  if (video.seconds !== null && (video.seconds <= 0 || video.seconds > MAX_EDIT_SECONDS)) return
  seen.add(video.id)
  out.push(video)
}

/**
 * Page de résultats youtube.com (sans clé) : on ne garde que les Shorts, verticaux par nature —
 * les étagères de Shorts (`reelItemRenderer`, `shortsLockupViewModel`) et les vidéos dont le lien
 * mène à `/shorts/`. Une vidéo ordinaire, peut-être horizontale, est écartée.
 */
export function parseShortsPage(html: string, universe: EditUniverse | null): EditVideo[] {
  const data = extractInitialData(html)
  if (!data) return []
  const out: EditVideo[] = []
  const seen = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isObject(node)) return
    for (const [name, value] of Object.entries(node)) {
      if (name === 'reelItemRenderer') {
        const id = text(at(value, 'videoId'))
        const title = text(at(value, 'headline', 'simpleText')) ?? text(at(value, 'headline', 'runs', 0, 'text'))
        if (id && title) accept({ id, title, channel: null, seconds: null, universe }, out, seen)
      } else if (name === 'shortsLockupViewModel') {
        const id = text(collect(value, 'videoId')[0])
        const title = text(at(value, 'overlayMetadata', 'primaryText', 'content')) ?? text(at(value, 'accessibilityText'))
        if (id && title) accept({ id, title, channel: null, seconds: null, universe }, out, seen)
      } else if (name === 'videoRenderer') {
        const url = text(at(value, 'navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url'))
        const id = text(at(value, 'videoId'))
        const title = text(at(value, 'title', 'runs', 0, 'text')) ?? text(at(value, 'title', 'simpleText'))
        if (url?.startsWith('/shorts/') && id && title) {
          accept(
            {
              id,
              title,
              channel: text(at(value, 'ownerText', 'runs', 0, 'text')) ?? text(at(value, 'longBylineText', 'runs', 0, 'text')),
              seconds: durationSeconds(text(at(value, 'lengthText', 'simpleText'))),
              universe,
            },
            out,
            seen,
          )
        }
      } else walk(value)
    }
  }
  walk(data)
  return out
}

/** Identifiants d'une réponse `search.list` (API officielle). */
export function searchIds(body: unknown): string[] {
  const items = at(body, 'items')
  if (!Array.isArray(items)) return []
  return items.map((item) => text(at(item, 'id', 'videoId'))).filter((id): id is string => id !== null && VIDEO_ID.test(id))
}

/**
 * Réponse `videos.list` (parties `snippet`, `contentDetails`, `player` avec `maxHeight`) : seules
 * les vidéos courtes, intégrables, et plus hautes que larges passent.
 */
export function parseVideosList(body: unknown, universe: EditUniverse | null): EditVideo[] {
  const items = at(body, 'items')
  if (!Array.isArray(items)) return []
  const out: EditVideo[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const id = text(at(item, 'id'))
    const title = text(at(item, 'snippet', 'title'))
    if (!id || !title) continue
    const width = Number(at(item, 'player', 'embedWidth'))
    const height = Number(at(item, 'player', 'embedHeight'))
    // Format inconnu : on ne prend pas le risque d'une vidéo horizontale.
    if (!(width > 0 && height > width)) continue
    if (at(item, 'snippet', 'liveBroadcastContent') === 'live') continue
    const channel = text(at(item, 'snippet', 'channelTitle'))
    accept(
      { id, title: decodeEntities(title), channel: channel ? decodeEntities(channel) : null, seconds: durationSeconds(text(at(item, 'contentDetails', 'duration'))), universe },
      out,
      seen,
    )
  }
  return out
}

/* ---- Assemblage du fil ------------------------------------------------------------------ */

/**
 * Mêle des listes chacune issue d'une recherche, à tour de rôle : deux edits voisins viennent
 * rarement du même univers. Sans doublon (la première apparition gagne).
 */
export function interleave(lists: readonly (readonly EditVideo[])[], seen: Set<string> = new Set()): EditVideo[] {
  const out: EditVideo[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const video = list[index]
      if (!video || seen.has(video.id)) continue
      seen.add(video.id)
      out.push(video)
    }
  }
  return out
}

/** Recherches lancées ensemble pour une page du fil. */
export const QUERIES_PER_BATCH = 4
