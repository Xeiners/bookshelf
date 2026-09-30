import type { Book } from './book'

/**
 * Types du lecteur intégré. Contrat partagé avec l'API
 * (`backend/src/modules/chapters/` et `library.schemas.ts`).
 */

export type ChapterLanguage = 'fr' | 'en'

/** Provenance d'un chapitre (MangaDex, Consumet, une source JSON…). */
export interface ChapterSource {
  id: string
  name: string
}

/**
 * État d'une source pour une œuvre : `timeout` = délai dépassé, `failed` = erreur,
 * `skipped` = mise en pause après des échecs répétés.
 */
export interface SourceStatus extends ChapterSource {
  status: 'ok' | 'timeout' | 'failed' | 'skipped'
  chapters: number
  /** Absents des copies hors-ligne plus anciennes. */
  durationMs?: number
  error?: string
}

/** Chapitre tel que le sert `GET /api/manga/:id/chapters`, quelle que soit sa source. */
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
  /** Absente des réponses d'avant les sources multiples (copies hors-ligne) : MangaDex. */
  source?: ChapterSource
  /** Le même chapitre chez les autres sources : bascule manuelle et repli automatique. */
  alternates?: ReaderChapter[]
}

export interface ChapterList {
  mangaId: string
  /** Langue servie : celle demandée, ou l'autre si elle n'a aucun chapitre. */
  language: ChapterLanguage
  available: Record<ChapterLanguage, number>
  /** Absent des copies hors-ligne d'avant les sources multiples. */
  sources?: SourceStatus[]
  chapters: ReaderChapter[]
  /** Où lire officiellement : surtout utile quand `chapters` est vide (titre sous licence). */
  officialPlatforms?: OfficialPlatform[]
}

/** Plateforme de lecture officielle (MANGA Plus, WEBTOON, Tappytoon…). */
export interface OfficialPlatform {
  name: string
  url: string
  /** Icône du service, à afficher si elle charge. */
  logo?: string
  /** Couleur de marque, `#rrggbb`. */
  color?: string
  /** Langue de lecture (code ISO 639-1), `null` si inconnue. */
  language: string | null
}

/** Pages d'un chapitre (`GET /api/chapters/:id/pages`). */
export interface ChapterPages {
  pages: ReaderPage[]
  /** Chapitre réellement servi : celui demandé, ou sa version chez une autre source. */
  servedBy: string
  source: ChapterSource | null
  /** La source demandée a échoué : les pages viennent d'une autre. */
  fallback: boolean
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

/** `dark` : sombre (#09090b) ; `black` : noir pur, idéal OLED ; `sepia` : papier. */
export type TextTheme = 'dark' | 'black' | 'light' | 'sepia' | 'night'
/** `serif` / `sans` : polices du système ; les autres sont embarquées (lisibles hors-ligne). */
export type TextFont = 'serif' | 'merriweather' | 'sans' | 'inter' | 'roboto' | 'dyslexic'

/** Romans : la page tourne comme une feuille (`book`), ou change d'un coup (`instant`). */
export type PageTurnStyle = 'book' | 'instant'

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

/**
 * Ce que le lecteur ouvre : une œuvre MangaDex, un fichier importé sur
 * l'appareil, ou un roman du compte (stocké sur le serveur, synchronisé).
 */
export type ReaderSession =
  | { source: 'mangadex'; book: Book; chapterId?: string }
  | { source: 'local'; fileId: string }
  | { source: 'cloud'; bookId: string }

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
