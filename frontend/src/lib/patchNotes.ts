/*
 * Patch notes : à l'ouverture du site, une fenêtre présente les nouveautés — une seule fois par
 * appareil et par version. Pour en publier une nouvelle : changer `PATCH_NOTES_ID` (la date de la
 * version), puis réécrire `patchNotes` dans les fichiers de langue (`i18n/fr.ts`, `i18n/en.ts`).
 * Les icônes se choisissent parmi `PatchIcon`.
 */

export const PATCH_NOTES_ID = '2026-10-19'

export type PatchIcon = 'stack' | 'gift' | 'dust' | 'market' | 'library' | 'canvas'

export interface PatchNote {
  icon: PatchIcon
  title: string
  text: string
}

const KEY = 'bookshelf:patchnotes:seen'

/** Les nouveautés de cette version ont-elles déjà été vues sur cet appareil ? */
export function patchNotesSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === PATCH_NOTES_ID
  } catch {
    // Stockage indisponible (navigation privée…) : on ne répète pas la fenêtre pour autant (voir `useSeenInSession`).
    return false
  }
}

export function markPatchNotesSeen(): void {
  try {
    localStorage.setItem(KEY, PATCH_NOTES_ID)
  } catch {
    // Sans stockage, la fenêtre reviendra à la prochaine ouverture : acceptable.
  }
}
