import { z } from 'zod'

/** Langues de l'interface et du catalogue. */
export const LANGUAGES = ['fr', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const LanguageSchema = z.enum(LANGUAGES)

/** Langue par défaut : celle de l'application historique (rétrocompatibilité). */
export const DEFAULT_LANGUAGE: Language = 'fr'

/**
 * Paramètre de requête `?lang=` : absent, vide, inconnu ou répété → langue par
 * défaut, jamais d'erreur. (`.catch` et non `unknown().transform()` : avec
 * zod 4, ce dernier rend la clé obligatoire dans un objet.)
 */
export const LangQuerySchema = LanguageSchema.catch(DEFAULT_LANGUAGE)

/**
 * Ordre de préférence pour un texte MangaDex : la langue demandée, puis l'autre.
 * `fr` → [fr, en] ; `en` → [en, fr].
 */
export function preferenceOrder(language: Language): readonly [Language, Language] {
  return language === 'fr' ? ['fr', 'en'] : ['en', 'fr']
}
