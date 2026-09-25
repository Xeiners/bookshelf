import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { BookOpen, Heart, Play, Star } from 'lucide-react'
import { useCoverTone } from '../../hooks/useCoverTone'
import { useT } from '../../i18n'
import { formatAuthors, primaryCategory } from '../../lib/format'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { LibraryEntry } from '../../types/book'
import { Pill } from '../ui/Pill'
import { Pressable } from '../ui/Pressable'
import { Book3D } from './Book3D'

/** Orientation de repos : la tranche teintée est visible, le livre « posé » face à nous. */
const REST = { rotationY: 24, rotationX: -5 }
/** Amplitude de l'inclinaison qui suit le pointeur. */
const TILT = { y: 16, x: 9 }

interface FeaturedBookProps {
  entry: LibraryEntry
  width: number
  /**
   * `row` : bandeau (livre à gauche, texte à droite) — téléphone et tablette.
   * `stacked` : colonne (livre centré au-dessus du texte) — colonne latérale sur ordinateur.
   */
  layout?: 'row' | 'stacked'
  onOpen: () => void
  /** Wishlist uniquement : passer directement le titre en lecture. */
  onStart: () => void
}

/**
 * Le livre « à la une » d'un onglet : grand volume 3D sur un halo de la couleur
 * de sa couverture. Il flotte, un reflet balaie la couverture de temps en temps,
 * et il s'incline vers le pointeur.
 */
export function FeaturedBook({ entry, width, layout = 'row', onOpen, onStart }: FeaturedBookProps) {
  const stacked = layout === 'stacked'
  const t = useT()
  const { book, status, progress } = entry
  const tone = useCoverTone(book)

  const rootRef = useRef<HTMLElement>(null)
  const bookRef = useRef<HTMLDivElement>(null)
  const tilt = useRef<{ y: gsap.QuickToFunc; x: gsap.QuickToFunc } | null>(null)

  useGSAP(
    () => {
      const node = bookRef.current
      if (!node) return

      gsap.set(node, { ...REST, transformOrigin: '50% 60%' })

      gsap
        .timeline({ defaults: { ease: EASE.glide } })
        // Le halo apparaît en fondu, sans échelle : il épouse exactement la carte.
        .from('[data-hero-halo]', { autoAlpha: 0, duration: 1.2 }, 0)
        .from(node, { rotationY: 88, x: -46, z: -120, autoAlpha: 0, duration: 1.1, ease: EASE.snap }, 0.05)
        .from('[data-hero-line]', { y: 18, autoAlpha: 0, duration: 0.7, stagger: 0.07, ease: EASE.swift }, 0.25)
        .from('[data-hero-progress]', { scaleX: 0, duration: 1, ease: EASE.swift }, 0.6)

      // Seul le livre flotte : un fond qui zoome et dézoome en boucle fatigue l'œil.
      gsap.to(node, { y: -7, duration: 2.8, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.1 })
      gsap.fromTo(
        '[data-glint]',
        { xPercent: 0 },
        { xPercent: 380, duration: 1.3, ease: 'power2.inOut', repeat: -1, repeatDelay: 4.5, delay: 1.6 },
      )

      tilt.current = {
        y: gsap.quickTo(node, 'rotationY', { duration: 0.6, ease: 'power3.out' }),
        x: gsap.quickTo(node, 'rotationX', { duration: 0.6, ease: 'power3.out' }),
      }
    },
    // Un nouveau titre à la une rejoue toute l'entrée.
    { dependencies: [book.id], scope: rootRef, revertOnUpdate: true },
  )

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || !tilt.current) return
    const box = event.currentTarget.getBoundingClientRect()
    const dx = (event.clientX - box.left) / box.width - 0.5
    const dy = (event.clientY - box.top) / box.height - 0.5
    tilt.current.y(REST.rotationY + dx * TILT.y * 2)
    tilt.current.x(REST.rotationX - dy * TILT.x * 2)
  }

  const onPointerLeave = () => {
    tilt.current?.y(REST.rotationY)
    tilt.current?.x(REST.rotationX)
  }

  const percent = Math.round(progress * 100)
  const primary =
    status === 'reading'
      ? { label: t.library.resume, icon: Play, action: onOpen }
      : status === 'wishlist'
        ? { label: t.library.startReading, icon: Play, action: onStart }
        : { label: t.library.details, icon: BookOpen, action: onOpen }
  const PrimaryIcon = primary.icon

  // Note · parution · chapitres · année — seulement ce que MangaDex connaît.
  const meta: { key: string; node: ReactNode }[] = []
  if (book.rating !== null) {
    meta.push({
      key: 'rating',
      node: (
        <span className="flex items-center gap-1 text-gold">
          <Star size={11} className="fill-gold" />
          {book.rating.toFixed(1)}
        </span>
      ),
    })
  }
  if (book.publicationStatus) meta.push({ key: 'status', node: t.publication[book.publicationStatus] })
  if (book.chapters) meta.push({ key: 'chapters', node: t.book.chaptersShort(book.chapters) })
  if (book.year !== null) meta.push({ key: 'year', node: book.year })

  return (
    <section
      ref={rootRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="glass relative isolate overflow-hidden rounded-4xl"
      style={{ '--tone': tone } as CSSProperties}
    >
      {/*
        Halo de la couleur de la couverture + contre-jour de marque. Il couvre
        EXACTEMENT la carte (`inset-0`, jamais mis à l'échelle) : ses bords
        coïncident avec ceux de la carte, aucune arête ne peut apparaître.
      */}
      <div
        data-hero-halo
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: stacked
            ? `radial-gradient(ellipse 90% 55% at 50% 26%, color-mix(in oklab, ${tone} 62%, transparent) 0%, color-mix(in oklab, ${tone} 20%, transparent) 55%, transparent 80%),
               radial-gradient(ellipse 80% 40% at 50% 100%, rgb(124 92 255 / 0.16), transparent 75%)`
            : `radial-gradient(ellipse 55% 85% at 20% 50%, color-mix(in oklab, ${tone} 62%, transparent) 0%, color-mix(in oklab, ${tone} 20%, transparent) 55%, transparent 80%),
               radial-gradient(ellipse 45% 70% at 100% 100%, rgb(124 92 255 / 0.16), transparent 75%)`,
        }}
      />
      {/* Liseré supérieur dans la teinte de la couverture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 top-0 -z-10 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${tone}, transparent)` }}
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" />

      <div className={stacked ? 'flex flex-col items-center gap-6 px-6 pt-7 pb-6' : 'flex items-center gap-5 p-5 md:gap-8 md:p-7'}>
        {/* Le livre : scène 3D */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={book.title}
          className="relative shrink-0 [perspective:900px]"
          style={{ width: width + 18, height: Math.round(width * 1.5) + 14 }}
        >
          <Book3D
            ref={bookRef}
            book={book}
            width={width}
            tone={tone}
            bookmark={status === 'reading'}
            glint
            eager
            className="mx-auto mt-2"
          />
          {/* Au sol : la couleur de la couverture, puis l'ombre portée */}
          <span
            aria-hidden
            className="absolute -bottom-6 left-1/2 h-10 w-[150%] -translate-x-1/2"
            style={{ background: `radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklab, ${tone} 60%, transparent), transparent 100%)` }}
          />
          <span
            aria-hidden
            className="absolute -bottom-3 left-1/2 h-4 w-[85%] -translate-x-1/2 rounded-[50%]"
            style={{ background: 'radial-gradient(ellipse, rgb(0 0 0 / 0.75), transparent 70%)' }}
          />
        </button>

        <div className={stacked ? 'w-full min-w-0' : 'min-w-0 flex-1'}>
          <p data-hero-line className="text-[9.5px] leading-relaxed tracking-[0.2em] uppercase" style={{ color: tone }}>
            {t.library.featured} · {t.status[status]}
          </p>
          <h2
            data-hero-line
            className="mt-2 line-clamp-3 font-display text-[1.65rem] leading-[1.02] text-cream md:text-[2.1rem]"
          >
            {book.title}
          </h2>
          <p data-hero-line className="mt-1.5 truncate text-[11px] tracking-[0.18em] text-mist uppercase">
            {formatAuthors(book.authors, t)}
          </p>

          <div data-hero-line className="mt-3 flex flex-wrap gap-1.5">
            {entry.favorite && (
              <Pill tone="nope" icon={<Heart size={11} strokeWidth={2.6} className="fill-nope" />}>
                {t.library.favorites}
              </Pill>
            )}
            {typeof entry.userRating === 'number' && (
              <Pill tone="gold" icon={<Star size={11} className="fill-gold" />}>
                {t.book.ratingValue(entry.userRating)}
              </Pill>
            )}
            {book.kind && book.kind !== 'book' && <Pill tone="glow">{t.kind[book.kind]}</Pill>}
            <Pill>{primaryCategory(book, t)}</Pill>
          </div>

          {/* Fiche technique : sur grand écran, ou dans la colonne latérale. */}
          {meta.length > 0 && (
            <p
              data-hero-line
              className={`mt-3 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mist ${stacked ? 'flex' : 'hidden md:flex'}`}
            >
              {meta.map((item, index) => (
                <span key={item.key} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden className="size-0.5 rounded-full bg-mist/60" />}
                  {item.node}
                </span>
              ))}
            </p>
          )}

          {status === 'reading' && (
            <div data-hero-line className="mt-4">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-mist">{t.book.progress}</span>
                <span className="font-display text-lg text-gold tabular-nums">{t.library.percent(percent)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream/12">
                <div
                  data-hero-progress
                  className="h-full origin-left rounded-full bg-linear-to-r from-gold to-[#ffdf9e]"
                  style={{ width: `${Math.max(percent, 2)}%` }}
                />
              </div>
            </div>
          )}

          {/* Sur grand écran, la place à droite accueille le début du résumé. */}
          {book.synopsis && (
            <p
              data-hero-line
              lang={book.synopsisLanguage ?? undefined}
              className={`mt-4 text-sm leading-relaxed text-cream/65 ${stacked ? 'line-clamp-4' : 'hidden max-w-xl md:line-clamp-3'}`}
            >
              {book.synopsis}
            </p>
          )}

          <div data-hero-line className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pressable
              onClick={primary.action}
              press={0.95}
              className="flex items-center gap-1.5 rounded-full bg-cream px-4 py-2.5 text-xs font-medium text-void"
            >
              <PrimaryIcon size={13} className={primary.icon === Play ? 'fill-void' : ''} />
              {primary.label}
            </Pressable>
            {status === 'wishlist' && (
              <button type="button" onClick={onOpen} className="py-1.5 text-xs whitespace-nowrap text-cream/70 underline-offset-4 hover:underline">
                {t.library.details}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
