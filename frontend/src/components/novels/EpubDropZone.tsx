import { useRef, useState, type DragEvent } from 'react'
import { BookUp, FileUp } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'

const ACCEPT = '.epub,application/epub+zip'

interface EpubDropZoneProps {
  onFiles: (files: File[]) => void
  /** `panel` : grande zone pointillée ; `pill` : bouton compact (bibliothèque, hub). */
  variant?: 'panel' | 'pill'
  disabled?: boolean
  /** `pill` : occupe la place restante de sa ligne (bandeau de la bibliothèque). */
  grow?: boolean
}

/** Le glissé contient-il des fichiers (et pas un lien ou du texte) ? */
const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')

/**
 * Import d'EPUB : glisser-déposer sur ordinateur, sélecteur de fichiers sur
 * téléphone (le même bouton). Plusieurs fichiers à la fois acceptés ; le
 * format réel est vérifié ensuite (signature), pas l'extension.
 */
export function EpubDropZone({ onFiles, variant = 'panel', disabled = false, grow = false }: EpubDropZoneProps) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  // Compteur : `dragleave` se déclenche aussi en passant sur un enfant de la zone.
  const depth = useRef(0)
  const [over, setOver] = useState(false)

  const accept = (files: FileList | null | undefined) => {
    const list = Array.from(files ?? [])
    if (list.length === 0 || disabled) return
    vibrate(10)
    onFiles(list)
  }

  const dragHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setOver(false)
      accept(event.dataTransfer.files)
    },
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple
      className="hidden"
      onChange={(event) => {
        accept(event.target.files)
        event.target.value = ''
      }}
    />
  )

  if (variant === 'pill') {
    return (
      <div {...dragHandlers} className={grow ? 'flex-auto' : 'shrink-0'}>
        {input}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={`flex h-10 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${grow ? 'w-full' : ''} ${
            over ? 'bg-gold text-void' : 'bg-cream text-void hover:bg-white'
          }`}
        >
          <BookUp size={15} aria-hidden />
          {over ? t.novels.dropActive : t.novels.importCta}
        </button>
      </div>
    )
  }

  return (
    <div {...dragHandlers}>
      {input}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full flex-col items-center gap-1.5 rounded-3xl border-2 border-dashed px-5 py-6 text-center transition-colors disabled:opacity-50 ${
          over ? 'border-gold bg-gold/10' : 'border-white/15 hover:border-white/30 hover:bg-white/[0.03]'
        }`}
      >
        <span className={`grid size-11 place-items-center rounded-full ${over ? 'bg-gold text-void' : 'bg-white/[0.06] text-gold'}`}>
          <FileUp size={19} aria-hidden />
        </span>
        <span className="text-sm font-semibold text-cream">{over ? t.novels.dropActive : t.novels.importCta}</span>
        <span className="text-xs text-mist">
          {t.novels.drop} · {t.novels.dropHint}
        </span>
      </button>
    </div>
  )
}
