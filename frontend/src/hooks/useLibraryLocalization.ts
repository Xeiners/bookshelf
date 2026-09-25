import { useEffect } from 'react'
import { useLanguage, type Language } from '../i18n'
import { BATCH_SIZE, fetchBooks, isMangadexId } from '../services/catalog'
import { useLibraryStore } from '../store/useLibraryStore'
import type { LibraryEntry } from '../types/book'

/** Entrée MangaDex dont la fiche n'est pas (encore) dans la langue voulue. */
const isStale = (entry: LibraryEntry, language: Language) =>
  isMangadexId(entry.book.id) && entry.book.lang !== language

/**
 * Garde la bibliothèque dans la langue choisie.
 *
 * Les fiches enregistrées sont des instantanés : prises en français, elles le
 * restent. Quand la langue change — ou qu'une bibliothèque arrive du compte avec
 * des fiches dans l'autre langue — on retraduit les entrées concernées via
 * `/manga/batch`. Les anciens livres Open Library restent tels quels (pas de
 * source multilingue).
 *
 * Un passage traite un lot de 100. La retraduction fait baisser le nombre
 * d'entrées à traiter, ce qui relance l'effet pour le lot suivant : aucune
 * boucle manuelle, et un échec (hors-ligne) ne relance rien tant que ce nombre
 * ne bouge pas.
 */
export function useLibraryLocalization(): void {
  const language = useLanguage()
  // Un nombre : sélecteur Zustand stable, l'effet ne repart que s'il change.
  const staleCount = useLibraryStore(
    (state) => Object.values(state.entries).filter((entry) => isStale(entry, language)).length,
  )

  useEffect(() => {
    if (staleCount === 0) return

    const controller = new AbortController()
    const ids = Object.values(useLibraryStore.getState().entries)
      .filter((entry) => isStale(entry, language))
      .map((entry) => entry.book.id)
      .slice(0, BATCH_SIZE)

    fetchBooks(ids, language, controller.signal)
      .then((books) => {
        if (!controller.signal.aborted) useLibraryStore.getState().refreshBooks(books)
      })
      .catch(() => {
        // Hors-ligne ou API arrêtée : les fiches restent lisibles dans l'autre langue.
      })

    return () => controller.abort()
  }, [language, staleCount])
}
