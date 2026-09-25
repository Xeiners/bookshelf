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

export const EntryInputSchema = z.object({
  book: BookSchema,
  status: ReadingStatusSchema,
  progress: z.number().min(0).max(1).default(0),
  favorite: z.boolean().default(false),
  userRating: UserRatingSchema.nullable().default(null),
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
