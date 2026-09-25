import { z } from 'zod'

/**
 * Contrat `Book` partagé avec le front (`frontend/src/types/book.ts`).
 *
 * Sert deux fois : type des réponses du proxy MangaDex, et validation des
 * instantanés envoyés par le client (swipe, fusion invité → compte). Les champs
 * manga sont optionnels : les bibliothèques invitées plus anciennes contiennent
 * encore des livres Open Library.
 */
/** Texte tronqué plutôt que rejeté : un résumé trop long ne doit pas coûter l'entrée. */
const clipped = (max: number) => z.string().transform((value) => value.slice(0, max))
const clippedList = (maxItems: number, maxLength: number) =>
  z.array(z.string()).transform((items) => items.slice(0, maxItems).map((item) => item.slice(0, maxLength)))

export const BookSchema = z.object({
  id: z.string().min(1).max(128),
  title: clipped(500).pipe(z.string().min(1)),
  subtitle: clipped(500).nullable().default(null),
  authors: clippedList(10, 200).default([]),
  cover: z.string().max(1000).nullable().default(null),
  synopsis: clipped(10_000).default(''),
  categories: clippedList(12, 80).default([]),
  rating: z.number().min(0).max(5).nullable().default(null),
  ratingsCount: z.number().int().min(0).default(0),
  pages: z.number().int().min(0).nullable().default(null),
  year: z.number().int().nullable().default(null),
  publisher: z.string().max(200).nullable().default(null),
  previewLink: z.string().max(1000).nullable().default(null),

  kind: z.enum(['manga', 'manhwa', 'manhua', 'book']).optional(),
  publicationStatus: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).nullable().optional(),
  chapters: z.number().int().min(0).nullable().optional(),
  languages: z.array(z.string().max(8)).max(4).optional(),
  /** Langue pour laquelle titre, résumé et genres ont été choisis. */
  lang: z.enum(['fr', 'en']).optional(),
  /** Langue réelle du résumé : diffère de `lang` quand le repli a joué. */
  synopsisLanguage: z.enum(['fr', 'en']).nullable().optional(),
})

export type Book = z.infer<typeof BookSchema>
export type BookKind = NonNullable<Book['kind']>
export type PublicationStatus = NonNullable<Book['publicationStatus']>
