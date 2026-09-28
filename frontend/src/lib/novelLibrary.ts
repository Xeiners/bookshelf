import { useLibraryStore } from '../store/useLibraryStore'
import type { Book, ReadingStatus } from '../types/book'
import { OWN_NOVEL_PREFIX } from '../types/novel'

/*
 * Livres importés (EPUB) ↔ fiches de la bibliothèque : chaque fichier est
 * rattaché à une fiche (`workId`), qui vit dans la bibliothèque comme toute
 * œuvre (même grille, même synchronisation avec le compte). Ce module range
 * la fiche et y reporte l'avancement lu dans le fichier.
 */

/** Au-delà, un roman est terminé : la dernière page n'atteint pas toujours 100 % (cf. l'API). */
export const NOVEL_FINISHED_PERCENT = 98

/** Fiches de roman en ligne auxquelles un fichier peut être rattaché (cf. `ONLINE_NOVEL_ID` de l'API). */
const ONLINE_NOVEL_ID = /^(ol:OL\d+W|gb:[\w-]{1,64})$/

/** Fiche de roman qui peut recevoir un fichier EPUB depuis sa fiche détaillée. */
export const acceptsEpub = (book: Book) => book.kind === 'book' && ONLINE_NOVEL_ID.test(book.id)

/** Fiche tirée du fichier lui-même (et non d'un catalogue en ligne). */
export const isOwnNovelWork = (workId: string | null) => !!workId?.startsWith(OWN_NOVEL_PREFIX)

/** Avancement de la fiche (0 → 1) pour un pourcentage lu dans le fichier. */
export const progressFor = (percent: number) => (percent >= NOVEL_FINISHED_PERCENT ? 1 : Math.max(0, percent) / 100)

const statusFor = (percent: number): ReadingStatus => (percent >= NOVEL_FINISHED_PERCENT ? 'read' : percent > 0 ? 'reading' : 'wishlist')

/**
 * Range la fiche d'un livre importé dans la bibliothèque. Une fiche déjà là
 * garde son statut (un roman en « Lus » ne redevient pas une envie parce
 * qu'on en importe le fichier).
 */
export function placeInLibrary(record: Book, percent = 0): void {
  const library = useLibraryStore.getState()
  if (!library.entries[record.id]) library.save(record, statusFor(percent))
  if (percent > 0) reportProgress(record.id, percent)
}

/**
 * Avancement lu dans le fichier → fiche rattachée : « En cours », puis « Lus »
 * à la fin. Un roman déjà lu qu'on relit ne repasse pas « En cours ».
 */
export function reportProgress(workId: string | null, percent: number): void {
  if (!workId) return
  const library = useLibraryStore.getState()
  const entry = library.entries[workId]
  if (!entry || entry.status === 'read') return
  const next = progressFor(percent)
  // Les pages tournées se suivent de près : inutile de réécrire (et de synchroniser) pour un demi-pour-cent.
  if (Math.abs(next - entry.progress) < 0.005 && !(next >= 1)) return
  library.setProgress(workId, next)
}

/**
 * Le fichier change de fiche (« Changer de fiche ») : la nouvelle reprend le
 * statut et l'avancement de l'ancienne ; une ancienne fiche tirée du fichier
 * disparaît (elle n'existait que pour lui).
 */
export function moveWork(from: string | null, to: Book): void {
  const library = useLibraryStore.getState()
  const previous = from ? library.entries[from] : undefined
  if (from === to.id) return
  if (!library.entries[to.id]) library.save(to, previous?.status ?? 'wishlist')
  if (previous && previous.progress > 0 && previous.status !== 'read') library.setProgress(to.id, previous.progress)
  if (from && isOwnNovelWork(from)) library.remove(from)
}

/** Fichier supprimé du compte : sa fiche tirée du fichier part avec lui ; une fiche en ligne reste (sans fichier). */
export function forgetOwnWork(workId: string | null): void {
  if (!workId || !isOwnNovelWork(workId)) return
  const library = useLibraryStore.getState()
  if (library.entries[workId]) library.remove(workId)
}
