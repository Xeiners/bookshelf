import type { Book } from './book'

/**
 * Romans du compte (EPUB stockés sur le serveur). Contrat partagé avec l'API :
 * `toDto` dans `backend/src/modules/books/books.service.ts`.
 */
export interface CloudBook {
  id: string
  title: string
  author: string | null
  /** Couverture choisie, sinon celle du fichier (`/api/books/:id/cover`), sinon `null`. */
  coverUrl: string | null
  synopsis: string
  language: string | null
  publisher: string | null
  year: number | null
  pages: number | null
  format: 'EPUB'
  fileSize: number
  originalName: string
  /** Avancement 0 → 100. */
  progressPercent: number
  /** Position EPUB (CFI) enregistrée par le dernier appareil. */
  lastCfi: string | null
  /** Horodatage (ms) de cette position, pris sur l'appareil qui l'a écrite. */
  progressAt: number | null
  /**
   * Fiche de la bibliothèque rattachée : roman en ligne (`ol:…`, `gb:…`) ou
   * fiche tirée du fichier (`novel:<id>`). `null` : pas encore rattaché.
   */
  workId: string | null
  createdAt: string
  updatedAt: string
}

/** Position de lecture d'un roman : la phrase (CFI), l'avancement et quand. */
export interface CloudPosition {
  cfi: string
  /** 0 → 100. */
  percent: number
  at: number
}

/** Champs de fiche modifiables (`PATCH /api/books/:id`). */
export interface CloudBookPatch {
  title?: string
  author?: string | null
  synopsis?: string
  coverUrl?: string | null
  publisher?: string | null
  year?: number | null
  pages?: number | null
}

/**
 * Où ranger un livre importé (réponse de l'import et du rattachement) :
 * fiche en ligne reconnue ou imposée (`linked`, `record: null` si le client
 * la connaît déjà), fiche tirée du fichier (`created`), ou fiches entre
 * lesquelles choisir (`choose`).
 */
export type ImportMatch =
  | { status: 'linked'; record: Book | null }
  | { status: 'created'; record: Book }
  | { status: 'choose'; candidates: Book[] }

/** Préfixe des fiches tirées du fichier lui-même (`novel:<id du livre importé>`). */
export const OWN_NOVEL_PREFIX = 'novel:'
