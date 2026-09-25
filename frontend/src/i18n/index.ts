/**
 * i18n minimaliste : deux dictionnaires typés, un store Zustand pour la langue.
 *
 *   const t = useT()           // dans un composant
 *   t.nav.discover             // texte
 *   t.deck.addedToWishlist(x)  // texte avec paramètre
 *   getT()                     // hors React (stores, services)
 *
 * Pas de bibliothèque : zéro chargement asynchrone, et TypeScript vérifie à la
 * compilation que chaque clé existe dans les deux langues.
 */
import { useSettingsStore } from '../store/useSettingsStore'
import { en } from './en'
import { fr, type Dictionary } from './fr'
import type { Language } from './languages'

export type { Dictionary }
export { LANGUAGES, detectLanguage, isLanguage, type Language } from './languages'

export const DICTIONARIES: Record<Language, Dictionary> = { fr, en }

/** Dictionnaire de la langue courante, réactif. */
export function useT(): Dictionary {
  return DICTIONARIES[useSettingsStore((state) => state.language)]
}

export function useLanguage(): Language {
  return useSettingsStore((state) => state.language)
}

/** Hors React : toasts émis par un store, messages d'un service… */
export function getT(): Dictionary {
  return DICTIONARIES[useSettingsStore.getState().language]
}

export function getLanguage(): Language {
  return useSettingsStore.getState().language
}
