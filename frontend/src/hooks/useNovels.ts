import { useEffect } from 'react'
import { useLanguage } from '../i18n'
import { useAuthStore } from '../store/useAuthStore'
import type { CachedCloudBook } from '../lib/reader/cloudBooks'
import { useNovelStore } from '../store/useNovelStore'
import { useUiStore } from '../store/useUiStore'

/**
 * Romans du compte pour un écran : la liste (chargée à l'affichage), les
 * imports en cours, et `importFiles`, identique partout (feuille « Mes
 * romans », bibliothèque, hub Activités). Sans compte, importer ouvre
 * l'inscription : les romans vivent sur le compte.
 */
export function useNovels({ load = true }: { load?: boolean } = {}) {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const language = useLanguage()
  const books = useNovelStore((state) => state.books)
  const offline = useNovelStore((state) => state.offline)
  const uploads = useNovelStore((state) => state.uploads)

  useEffect(() => {
    if (load && userId) void useNovelStore.getState().refresh(userId).catch(() => {})
  }, [load, userId])

  const importFiles = (files: File[], options: { openSheet?: boolean } = {}) => {
    const ui = useUiStore.getState()
    if (!userId) {
      ui.openAuth()
      return
    }
    if (options.openSheet) ui.openNovels()
    void useNovelStore.getState().upload(userId, files, language)
  }

  return { userId, signedIn: userId !== null, books: userId ? books : null, offline, uploads, importFiles }
}

/**
 * Positions de romans lues hors-ligne : envoyées au démarrage et dès que le
 * réseau revient, même sans rouvrir le livre — l'ordinateur doit les voir.
 */
export function usePendingNovelProgress(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  useEffect(() => {
    if (!userId) return
    const flush = () => void useNovelStore.getState().flushPending(userId)
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [userId])
}

/**
 * Fichier EPUB rattaché à une fiche de la bibliothèque (roman en ligne, ou
 * fiche tirée du fichier), `null` sinon. Sans compte : jamais.
 */
export function useLinkedNovel(workId: string): CachedCloudBook | null {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  return useNovelStore((state) => (userId ? (state.books?.find((entry) => entry.book.workId === workId) ?? null) : null))
}
