import { z } from 'zod'
import { BookSchema } from '../books/book.schema.js'

export const READING_STATUSES = ['wishlist', 'reading', 'read'] as const
export const ReadingStatusSchema = z.enum(READING_STATUSES)
export type ReadingStatus = z.infer<typeof ReadingStatusSchema>

/** Note personnelle : 0,5 → 5 par demi-étoiles. */
export const UserRatingSchema = z
  .number()
  .min(0.5)
  .max(5)
  .refine((value) => Number.isInteger(value * 2), { message: 'La note va par demi-étoiles.' })

/** Horodatage client en millisecondes. Borné pour rejeter les valeurs absurdes. */
const Timestamp = z.number().int().min(0).max(8_640_000_000_000)

/**
 * Position dans le lecteur intégré. `page` est l'index (0-based) de la page
 * affichée, `offset` la part déjà défilée de cette page (mode webtoon) : la
 * reprise se fait au pixel près, quelle que soit la hauteur de l'écran.
 */
export const ReadingPositionSchema = z.object({
  chapterId: z.string().min(1).max(64),
  /** Numéro affiché (« 12.5 »), `null` pour un one-shot. */
  chapter: z.string().max(16).nullable(),
  page: z.number().int().min(0).max(5000),
  pageCount: z.number().int().min(1).max(5000),
  offset: z.number().min(0).max(1).default(0),
  /** Avancement dans le chapitre, 0 → 1. */
  ratio: z.number().min(0).max(1),
  at: Timestamp,
})
export type ReadingPosition = z.infer<typeof ReadingPositionSchema>

/** Compteur de chapitres lus : borné large (les plus longues séries dépassent 1 000). */
const ChaptersRead = z.number().int().min(0).max(100_000)

export const EntryInputSchema = z.object({
  book: BookSchema,
  status: ReadingStatusSchema,
  progress: z.number().min(0).max(1).default(0),
  favorite: z.boolean().default(false),
  userRating: UserRatingSchema.nullable().default(null),
  chaptersRead: ChaptersRead.default(0),
  /** Une position illisible (ancien format) est oubliée, pas bloquante. */
  position: ReadingPositionSchema.nullable().catch(null).default(null),
  addedAt: Timestamp.optional(),
  updatedAt: Timestamp.optional(),
})
export type EntryInput = z.infer<typeof EntryInputSchema>

/**
 * État invité envoyé au login/register (`initialData`) ou à `/library/sync`.
 *
 * Tolérant par élément : une entrée locale corrompue ou d'un ancien format est
 * écartée seule, elle ne doit pas faire échouer la connexion entière. Les
 * bornes couvrent largement l'usage réel (le front plafonne les skips à 400).
 */
export const LibrarySnapshotSchema = z.object({
  entries: z
    .array(z.unknown())
    .max(5000)
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = EntryInputSchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      }),
    ),
  skipped: z
    .array(z.unknown())
    .max(2000)
    .default([])
    .transform((items) =>
      items.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128),
    ),
})
export type LibrarySnapshot = z.infer<typeof LibrarySnapshotSchema>

export const SwipeSchema = z
  .object({
    mangaId: z.string().min(1).max(128),
    action: z.enum(['wishlist', 'reading', 'read', 'skipped']),
    /** Obligatoire sauf pour `skipped` : la bibliothèque s'affiche depuis cet instantané. */
    book: BookSchema.optional(),
    at: Timestamp.optional(),
  })
  .refine((swipe) => swipe.action === 'skipped' || swipe.book !== undefined, {
    message: 'La fiche `book` est requise pour cette action.',
    path: ['book'],
  })
  .refine((swipe) => !swipe.book || swipe.book.id === swipe.mangaId, {
    message: '`book.id` doit correspondre à `mangaId`.',
    path: ['book', 'id'],
  })
export type SwipeInput = z.infer<typeof SwipeSchema>

export const PatchEntrySchema = z
  .object({
    status: ReadingStatusSchema.optional(),
    progress: z.number().min(0).max(1).optional(),
    favorite: z.boolean().optional(),
    /** `null` efface la note. */
    userRating: UserRatingSchema.nullable().optional(),
    at: Timestamp.optional(),
  })
  .refine(
    (patch) =>
      patch.status !== undefined ||
      patch.progress !== undefined ||
      patch.favorite !== undefined ||
      patch.userRating !== undefined,
    { message: 'Rien à modifier.' },
  )
export type PatchEntryInput = z.infer<typeof PatchEntrySchema>

/**
 * `PATCH /library/progress` : position du lecteur, envoyée en rafale pendant la
 * lecture (le front ne garde que la dernière de la file). `chaptersRead`,
 * `progress` et `status` accompagnent la fin d'un chapitre.
 */
export const ProgressSchema = z.object({
  workId: z.string().min(1).max(128),
  position: ReadingPositionSchema,
  chaptersRead: ChaptersRead.optional(),
  progress: z.number().min(0).max(1).optional(),
  status: ReadingStatusSchema.optional(),
  at: Timestamp.optional(),
})
export type ProgressInput = z.infer<typeof ProgressSchema>
