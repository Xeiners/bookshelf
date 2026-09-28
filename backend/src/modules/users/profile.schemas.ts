import { z } from 'zod'
import { TITLE_IDS } from './titles.js'

/** Taille de la vitrine de cartes. */
export const FEATURED_MAX = 3
export const BIO_MAX = 160

const CardId = z.string().trim().min(1).max(40)

/** URL d'image servie par Bookshelf ou par un catalogue HTTPS connu du navigateur. */
const AvatarUrl = z
  .string()
  .trim()
  .min(1)
  .max(1200)
  .refine((value) => {
    if (value.startsWith('/api/')) return true
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    } catch {
      return false
    }
  }, 'L’image d’avatar doit utiliser HTTPS ou une URL Bookshelf.')

/** Texte libre : vide (après nettoyage) = effacé. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null)

/** `PATCH /api/profile` : chaque champ absent reste inchangé ; `null` efface. */
export const ProfilePatchSchema = z
  .strictObject({
    displayName: optionalText(40).optional(),
    bio: optionalText(BIO_MAX).optional(),
    avatarCardId: CardId.nullable().optional(),
    avatarUrl: AvatarUrl.nullable().optional(),
    featuredCardIds: z
      .array(CardId)
      .max(FEATURED_MAX, `${FEATURED_MAX} cartes au plus en vitrine.`)
      .refine((ids) => new Set(ids).size === ids.length, 'Une même carte ne peut être exposée deux fois.')
      .optional(),
    activeTitle: z.enum(TITLE_IDS).nullable().optional(),
    /** Profil public complet ; privé : seuls pseudo, avatar, titre et vitrine restent visibles. */
    isProfilePublic: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: 'Rien à modifier.' })

export type ProfilePatch = z.infer<typeof ProfilePatchSchema>
