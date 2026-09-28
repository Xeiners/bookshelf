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
