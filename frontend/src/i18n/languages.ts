/**
 * Primitives de langue, sans aucune dépendance : importables par les stores
 * sans créer de cycle avec `i18n/index.ts` (qui, lui, lit le store).
 */
export const LANGUAGES = ['fr', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)

/**
 * Langue initiale d'un nouvel appareil : celle du navigateur si on la sert,
 * sinon le français (langue historique de l'app).
 */
export function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'fr'
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = candidate?.slice(0, 2).toLowerCase()
    if (isLanguage(base)) return base
  }
  return 'fr'
}
