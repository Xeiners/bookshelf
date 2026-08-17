import { useEffect, useRef } from 'react'
import { Clock, ExternalLink, Minus, Plus, Star, Trash2, X } from 'lucide-react'
import { DUR, Draggable, EASE, InertiaPlugin, gsap, useGSAP } from '../../lib/gsap'
import { formatAuthors, formatReadingTime } from '../../lib/format'
import { vibrate } from '../../lib/haptics'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { Book, ReadingStatus } from '../../types/book'
import { STATUS_LABEL, STATUS_ORDER } from '../../types/book'
import { BookCover } from '../ui/BookCover'
import { Pill } from '../ui/Pill'
import { Pressable } from '../ui/Pressable'

const PROGRESS_STEP = 0.1

interface BookSheetProps {
  book: Book
}

/**
 * Fiche livre en feuille modale : timeline d'entrée, plus un `Draggable`
 * vertical limité à l'en-tête pour refermer — la zone de texte reste scrollable.
 */
export function BookSheet({ book }: BookSheetProps) {
  const closeDetail = useUiStore((state) => state.closeDetail)
  const notify = useUiStore((state) => state.notify)

  const entry = useLibraryStore((state) => state.entries[book.id])
  const save = useLibraryStore((state) => state.save)
  const setStatus = useLibraryStore((state) => state.setStatus)
  const setProgress = useLibraryStore((state) => state.setProgress)
  const remove = useLibraryStore((state) => state.remove)

  const backdropRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const dismissRef = useRef<() => void>(() => {})

  /* Entrée ------------------------------------------------------------ */
  const { contextSafe } = useGSAP(() => {
    gsap
      .timeline({ defaults: { ease: EASE.glide } })
      .set(sheetRef.current, { yPercent: 100 })
      .to(backdropRef.current, { autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, 0)
      .to(sheetRef.current, { yPercent: 0, duration: 0.75 }, 0)
      .from(
        '[data-sheet-item]',
        { y: 24, autoAlpha: 0, duration: 0.55, stagger: 0.055, ease: EASE.swift },
        0.16,
      )
  })

  /* Sortie ------------------------------------------------------------ */
  const dismiss = contextSafe(() => {
    if (closingRef.current) return
    closingRef.current = true
    const sheet = sheetRef.current

    gsap
      .timeline({ onComplete: closeDetail })
      .to(sheet, { y: (sheet?.offsetHeight ?? 600) + 60, duration: 0.42, ease: 'power2.in' }, 0)
      .to(backdropRef.current, { autoAlpha: 0, duration: 0.34 }, 0)
  })

  // `contextSafe` renvoie une nouvelle fonction à chaque rendu : les callbacks
  // GSAP, créés une seule fois, doivent viser la dernière via ce ref.
  useEffect(() => {
    dismissRef.current = dismiss
  })

  /* Fermeture au geste ------------------------------------------------ */
  useGSAP(() => {
    const sheet = sheetRef.current
    const handle = handleRef.current
    if (!sheet || !handle) return

    InertiaPlugin.track(sheet, 'y')

    let drag!: Draggable
    const instances = Draggable.create(sheet, {
      type: 'y',
      trigger: handle,
      // On ne remonte jamais au-dessus de la position de repos.
      bounds: { minY: 0, maxY: window.innerHeight },
      edgeResistance: 0.92,
      onDragEnd() {
        const velocity = InertiaPlugin.getVelocity(sheet, 'y')
        if (drag.y > 120 || velocity > 700) dismissRef.current()
        else gsap.to(sheet, { y: 0, duration: DUR.slow, ease: EASE.spring, overwrite: 'auto' })
      },
    })
    drag = instances[0]

    return () => {
      drag.kill()
      InertiaPlugin.untrack(sheet, 'y')
    }
  })

  /* Échap ------------------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* Jauge de progression --------------------------------------------- */
  const progress = entry?.progress ?? 0
  useGSAP(
    () => {
      gsap.to('[data-progress-bar]', {
        scaleX: Math.max(progress, 0.015),
        duration: 0.7,
        ease: EASE.swift,
      })
    },
    { dependencies: [progress, entry?.status], scope: sheetRef },
  )

  const applyStatus = (status: ReadingStatus) => {
    vibrate(10)
    if (entry) setStatus(book.id, status)
    else save(book, status)
    notify(`Classé dans « ${STATUS_LABEL[status]} »`, 'like')
  }

  const nudgeProgress = (delta: number) => {
    if (!entry) return
    vibrate(6)
    setProgress(book.id, entry.progress + delta)
  }

  const readingTime = formatReadingTime(book.pages)

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={book.title}>
      <div
        ref={backdropRef}
        onClick={() => dismissRef.current()}
        className="absolute inset-0 bg-void/75 opacity-0 backdrop-blur-md"
      />

      <div
        ref={sheetRef}
        className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[90svh] flex-col rounded-t-[2.25rem] pb-safe will-change-transform md:bottom-6 md:max-h-[82vh] md:max-w-xl md:rounded-[2.25rem]"
      >
        {/* Zone de préhension : seul déclencheur du Draggable */}
        <div ref={handleRef} className="shrink-0 cursor-grab px-6 pt-3 active:cursor-grabbing">
          <div className="mx-auto h-1.5 w-11 rounded-full bg-cream/25" />

          <div className="mt-5 flex gap-4" data-sheet-item>
            <div className="w-24 shrink-0 overflow-hidden rounded-xl shadow-lift">
              <BookCover book={book} className="aspect-2/3 w-full" eager />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1.75rem] leading-[1.02] text-cream">
                {book.title}
              </h2>
              <p className="mt-1.5 text-[11px] tracking-[0.2em] text-mist uppercase">
                {formatAuthors(book.authors)}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {book.rating !== null && (
                  <Pill tone="gold" icon={<Star size={11} className="fill-gold" />}>
                    {book.rating.toFixed(1)}
                  </Pill>
                )}
                {readingTime && <Pill icon={<Clock size={11} />}>{readingTime}</Pill>}
                {book.pages !== null && <Pill>{book.pages} p.</Pill>}
              </div>
            </div>

            <button
              type="button"
              onClick={() => dismissRef.current()}
              aria-label="Fermer"
              className="glass size-9 shrink-0 self-start rounded-full text-cream/60"
            >
              <X size={16} className="mx-auto" />
            </button>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5">
          {book.categories.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5" data-sheet-item>
              {book.categories.map((category) => (
                <Pill key={category} tone="glow">
                  {category}
                </Pill>
              ))}
            </div>
          )}

          <p className="text-sm leading-relaxed text-cream/75" data-sheet-item>
            {book.synopsis || 'Aucun résumé disponible pour ce titre sur Open Library.'}
          </p>

          {book.publisher && (
            <p className="mt-4 text-[11px] text-mist" data-sheet-item>
              {book.publisher}
              {book.year !== null && ` · ${book.year}`}
            </p>
          )}

          {book.previewLink && (
            <a
              href={book.previewLink}
              target="_blank"
              rel="noreferrer"
              data-sheet-item
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-glow"
            >
              Voir sur Open Library
              <ExternalLink size={12} />
            </a>
          )}

          {entry?.status === 'reading' && (
            <div className="mt-6 rounded-2xl bg-cream/[0.04] p-4" data-sheet-item>
              <div className="flex items-center justify-between">
                <span className="text-xs text-mist">Progression</span>
                <span className="font-display text-xl text-gold tabular-nums">
                  {Math.round(progress * 100)}%
                </span>
              </div>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream/12">
                <div data-progress-bar className="h-full origin-left scale-x-0 bg-gold" />
              </div>

              <div className="mt-4 flex gap-2">
                <Pressable
                  onClick={() => nudgeProgress(-PROGRESS_STEP)}
                  aria-label="Reculer de 10 %"
                  className="glass grid size-10 place-items-center rounded-full text-cream/70"
                >
                  <Minus size={16} />
                </Pressable>
                <Pressable
                  onClick={() => nudgeProgress(PROGRESS_STEP)}
                  aria-label="Avancer de 10 %"
                  className="glass grid size-10 place-items-center rounded-full text-cream/70"
                >
                  <Plus size={16} />
                </Pressable>
                <span className="flex-1 self-center text-right text-[11px] text-mist">
                  {book.pages !== null && `≈ ${Math.round(book.pages * progress)} / ${book.pages} p.`}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 pt-4 pb-2" data-sheet-item>
          <div className="flex gap-2">
            {STATUS_ORDER.map((status) => {
              const isActive = entry?.status === status
              return (
                <Pressable
                  key={status}
                  onClick={() => applyStatus(status)}
                  className={`flex-1 rounded-full py-3 text-xs font-medium ${
                    isActive ? 'bg-cream text-void' : 'glass text-cream/70'
                  }`}
                >
                  {STATUS_LABEL[status]}
                </Pressable>
              )
            })}
          </div>

          {entry && (
            <button
              type="button"
              onClick={() => {
                vibrate(14)
                remove(book.id)
                notify('Retiré de ta bibliothèque', 'nope')
                dismissRef.current()
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 py-1 text-[11px] text-nope/80"
            >
              <Trash2 size={12} />
              Retirer de ma bibliothèque
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
