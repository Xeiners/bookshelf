import { BookText, ChevronRight } from 'lucide-react'
import { useNovels } from '../../hooks/useNovels'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { useUiStore } from '../../store/useUiStore'
import { EpubDropZone } from '../novels/EpubDropZone'

/**
 * Accès aux romans du compte depuis « Ma biblio » : la liste d'un tap,
 * l'import d'un EPUB en un autre (glisser-déposer accepté sur ordinateur).
 */
export function NovelsStrip() {
  const t = useT()
  const { signedIn, books, importFiles } = useNovels()
  const openNovels = useUiStore((state) => state.openNovels)

  return (
    // Trop étroit pour les deux (téléphone) : deux lignes pleine largeur plutôt qu'un titre tronqué.
    <div className="flex flex-wrap items-center gap-2 md:max-w-lg">
      <button
        type="button"
        onClick={() => {
          vibrate(6)
          openNovels()
        }}
        className="glass flex h-10 min-w-[11rem] flex-1 items-center gap-2 rounded-full pr-3 pl-4 text-xs text-cream/85"
      >
        <BookText size={15} className="shrink-0 text-gold" aria-hidden />
        <span className="truncate font-medium">{t.novels.title}</span>
        {signedIn && books && books.length > 0 && <span className="shrink-0 text-mist tabular-nums">· {t.novels.count(books.length)}</span>}
        <ChevronRight size={14} className="ml-auto shrink-0 text-cream/40" aria-hidden />
      </button>
      <EpubDropZone variant="pill" grow onFiles={(files) => importFiles(files, { openSheet: true })} />
    </div>
  )
}
