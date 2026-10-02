import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { BookCopy, BookText, ChevronRight, FolderOpen } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useNovelStore } from '../../store/useNovelStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/** Largeur de la bulle, et marge minimale avec les bords de l'écran. */
const BUBBLE_WIDTH = 272
const GUTTER = 16

/**
 * Place de la bulle à l'écran : sous le bouton, alignée sur son bord droit,
 * mais ramenée dans l'écran (sur téléphone, le bouton n'est pas tout à droite).
 */
function bubblePosition(button: DOMRect, viewport: number): CSSProperties {
  const width = Math.min(BUBBLE_WIDTH, viewport - GUTTER * 2)
  const right = Math.min(Math.max(GUTTER, viewport - button.right), viewport - GUTTER - width)
  return { position: 'fixed', top: button.bottom + 8, right, width }
}

/**
 * « Ma biblio » : un seul bouton dans l'en-tête, qui ouvre une bulle vers
 * « Mes romans » (EPUB du compte) et « Mes fichiers » (PDF, EPUB, CBZ de
 * l'appareil). Fermée par un tap à côté, Échap, ou le choix d'une entrée.
 */
export function LibraryMenu() {
  const t = useT()
  const copy = t.libraryMenu
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const open = position !== null
  const rootRef = useRef<HTMLDivElement>(null)
  const close = () => setPosition(null)

  // Tap hors de la bulle, ou Échap : elle se referme.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPosition(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPosition(null)
    }
    // Fenêtre redimensionnée (rotation du téléphone) : la bulle n'est plus sous le bouton.
    const onResize = () => setPosition(null)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Pressable
        onClick={(event) => {
          vibrate(6)
          setPosition(open ? null : bubblePosition(event.currentTarget.getBoundingClientRect(), window.innerWidth))
        }}
        aria-label={copy.open}
        title={copy.open}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`glass grid size-10 place-items-center md:size-11 rounded-full transition-colors ${open ? 'text-cream' : 'text-cream/70'}`}
      >
        <BookCopy size={17} />
      </Pressable>
      {position && <MenuBubble style={position} onClose={close} />}
    </div>
  )
}

function MenuBubble({ style, onClose }: { style: CSSProperties; onClose: () => void }) {
  const t = useT()
  const copy = t.libraryMenu
  const openNovels = useUiStore((state) => state.openNovels)
  const openFiles = useUiStore((state) => state.openFiles)
  const novels = useNovelStore((state) => state.books?.length ?? null)
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: -6, scale: 0.96, duration: 0.22, ease: EASE.swift, transformOrigin: 'top right' })
  })

  const items = [
    { id: 'novels', icon: BookText, tint: 'bg-gold/15 text-gold', title: copy.novels.title, hint: copy.novels.hint, count: novels, action: openNovels },
    { id: 'files', icon: FolderOpen, tint: 'bg-glow/15 text-glow', title: copy.files.title, hint: copy.files.hint, count: null, action: openFiles },
  ] as const

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={copy.open}
      style={style}
      className="glass-strong z-50 rounded-3xl p-1.5 shadow-lift"
    >
      {items.map(({ id, icon: Icon, tint, title, hint, count, action }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          onClick={() => {
            vibrate(6)
            onClose()
            action()
          }}
          className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none"
        >
          <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${tint}`}>
            <Icon size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-cream">{title}</span>
              {count !== null && count > 0 && (
                <span className="shrink-0 rounded-full bg-cream/10 px-1.5 text-[10px] text-cream/70 tabular-nums">{count}</span>
              )}
            </span>
            <span className="block text-[11px] leading-snug text-mist">{hint}</span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-cream/35" />
        </button>
      ))}
    </div>
  )
}
