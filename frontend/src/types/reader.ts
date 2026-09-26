import type { Book } from './book'

/**
 * Types du lecteur intégré. Contrat partagé avec l'API
 * (`backend/src/modules/chapters/` et `library.schemas.ts`).
 */

export type ChapterLanguage = 'fr' | 'en'

/** Chapitre MangaDex tel que le sert `GET /api/manga/:id/chapters`. */
export interface ReaderChapter {
  id: string
  /** Numéro affiché (« 12 », « 12.5 »), `null` pour un one-shot. */
  number: string | null
  volume: string | null
  title: string | null
  language: ChapterLanguage
  pages: number
  /** Équipes de traduction, à créditer. */
  groups: { id: string; name: string }[]
  publishedAt: string
}

export interface ChapterList {
  mangaId: string
  /** Langue servie : celle demandée, ou l'autre si elle n'a aucun chapitre. */
  language: ChapterLanguage
  available: Record<ChapterLanguage, number>
  chapters: ReaderChapter[]
}

/** Une page à afficher, quelle que soit sa source (MangaDex, archive CBZ…). */
export interface ReaderPage {
  index: number
  url: string
  /** Même page en qualité réduite, essayée seule si l'originale échoue. */
  fallbackUrl: string | null
}

/**
 * Position dans un chapitre : `page` est l'index (0-based) de la page en haut
 * de l'écran, `offset` la part déjà défilée de cette page (webtoon), `ratio`
 * l'avancement dans le chapitre (0 → 1).
 */
export interface ReadingPosition {
  chapterId: string
  chapter: string | null
  page: number
  pageCount: number
  offset: number
  ratio: number
  at: number
}

/** `webtoon` : défilement vertical continu ; `paged` : page par page. */
export type ReaderLayout = 'webtoon' | 'paged'
/** `rtl` : sens japonais (manga) ; `ltr` : sens occidental (comics, BD). */
export type ReadingDirection = 'rtl' | 'ltr'
/** Double page : automatique (écran large en paysage), jamais, ou toujours. */
export type SpreadMode = 'auto' | 'single' | 'double'
/** Qualité MangaDex : `auto` suit la connexion (Data Saver si elle est lente). */
export type ImageQuality = 'auto' | 'data' | 'data-saver'

export type TextTheme = 'black' | 'light' | 'sepia' | 'night'
export type TextFont = 'serif' | 'sans' | 'dyslexic'

/** Réglages typographiques du mode texte (EPUB). */
export interface TextSettings {
  /** Taille de police, en % de la taille du livre. */
  fontSize: number
  font: TextFont
  lineHeight: number
  /** Marges latérales, en pixels CSS. */
  margin: number
  theme: TextTheme
}

/** Formats de fichiers importés. Le CBR (RAR) n'est reconnu que pour être refusé proprement. */
export type LocalFormat = 'pdf' | 'epub' | 'cbz'

/** Ce que le lecteur ouvre : une œuvre MangaDex, ou un fichier importé sur l'appareil. */
export type ReaderSession =
  | { source: 'mangadex'; book: Book; chapterId?: string }
  | { source: 'local'; fileId: string }

/** Pilotage d'une vue d'images depuis les commandes (curseur, flèches). */
export interface ReaderViewController {
  goTo: (page: number) => void
  step: (direction: 1 | -1) => void
}

/** Position rapportée par une vue d'images. */
export interface ViewPosition {
  page: number
  offset: number
  ratio: number
}
