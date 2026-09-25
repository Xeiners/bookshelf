import { useEffect, useMemo, useRef, useState } from 'react'
import { useCoverTone } from '../../hooks/useCoverTone'
import { useT } from '../../i18n'
import { hueFromString } from '../../lib/format'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { LibraryEntry } from '../../types/book'
import { Book3D } from './Book3D'

/** Largeur visée d'un livre, et espace entre deux livres (la tranche en 3D déborde). */
/**
 * Gabarit selon la place : 3 livres par rayon sur téléphone, de grands volumes
 * sur ordinateur (un livre de 84 px sur une planche de 1 300 px paraît perdu).
 */
function metricsFor(available: number) {
  if (available >= 1000) return { target: 132, max: 150, gap: 34 }
  // Colonne de droite sur ordinateur (~580 px) : 4 beaux volumes par rayon.
  if (available >= 520) return { target: 116, max: 140, gap: 26 }
  return { target: 84, max: 116, gap: 18 }
}
/** Retrait des livres par rapport aux bords de la planche. */
const INSET = 12
/** Hauteur de la planche (dessus + chant) ; les livres reposent sur son dessus. */
const PLANK_HEIGHT = 24
const PLANK_TOP = 13

/** Orientations de repos : la tranche teintée est visible, chaque livre un peu différent. */
const RESTING_ANGLES = [22, 30, 18, 34, 26]
const restingAngle = (id: string) => RESTING_ANGLES[hueFromString(`${id}#angle`) % RESTING_ANGLES.length]

interface ShelfBookProps {
  entry: LibraryEntry
  width: number
  onOpen: (entry: LibraryEntry) => void
}

/** Un livre posé sur l'étagère : il jette sa couleur sur la planche et pivote vers nous au tap. */
function ShelfBook({ entry, width, onOpen }: ShelfBookProps) {
  const t = useT()
  const tone = useCoverTone(entry.book)
  const slotRef = useRef<HTMLButtonElement>(null)
  const bookRef = useRef<HTMLDivElement>(null)
  const angle = restingAngle(entry.book.id)

  const { contextSafe } = useGSAP(
    () => {
      gsap.set(bookRef.current, { rotationY: angle, rotationX: -4, transformOrigin: '50% 100%' })
    },
    { scope: slotRef },
  )

  // Au tap : le livre se tourne face à nous et se soulève, comme pris en main.
  const present = (out: boolean) =>
    contextSafe(() => {
      gsap.to(bookRef.current, {
        rotationY: out ? 0 : angle,
        y: out ? -16 : 0,
        z: out ? 40 : 0,
        duration: out ? 0.32 : 0.7,
        ease: out ? 'power3.out' : EASE.spring,
        overwrite: 'auto',
      })
    })()

  const percent = Math.round(entry.progress * 100)

  return (
    <button
      ref={slotRef}
      data-shelf-book
      type="button"
      title={entry.book.title}
      aria-label={entry.book.title}
      onClick={() => onOpen(entry)}
      onPointerDown={() => present(true)}
      onPointerUp={() => present(false)}
      onPointerLeave={() => present(false)}
      onPointerCancel={() => present(false)}
      className="relative shrink-0"
      style={{ width }}
    >
      {/* La couleur de la couverture éclaire le dessus de la planche et coule sur le chant */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 w-[170%] -translate-x-1/2"
        style={{
          bottom: -PLANK_HEIGHT + 2,
          height: PLANK_HEIGHT + 16,
          // `closest-side` : l'ellipse tient dans sa boîte, donc transparente sur chaque bord.
          background: `radial-gradient(closest-side, color-mix(in oklab, ${tone} 70%, transparent), transparent)`,
        }}
      />
      {/* Ombre de contact */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-1.5 left-1/2 h-3.5 w-[96%] -translate-x-1/2"
        style={{ background: 'radial-gradient(ellipse, rgb(0 0 0 / 0.8), transparent 72%)' }}
      />

      <Book3D ref={bookRef} book={entry.book} width={width} tone={tone} bookmark={entry.status === 'reading'} />

      {entry.status === 'reading' && (
        <span
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[10px] whitespace-nowrap text-gold tabular-nums"
          style={{ bottom: -PLANK_HEIGHT - 26 }}
        >
          <span className="h-[3px] w-8 overflow-hidden rounded-full bg-cream/15">
            <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(percent, 4)}%` }} />
          </span>
          {t.library.percent(percent)}
        </span>
      )}
    </button>
  )
}

/**
 * Planche en volume : un dessus éclairé par le spot (vu en légère plongée), un
 * chant sombre au bord vif, et une bande LED dont la lueur coule vers le bas.
 */
function Plank() {
  return (
    <div data-plank className="absolute inset-x-0 bottom-0 origin-left" style={{ height: PLANK_HEIGHT }}>
      {/* Dessus : plus clair vers l'avant, là où tombe la lumière du spot */}
      <div
        className="absolute inset-x-1.5 top-0 rounded-t-[3px] bg-linear-to-b from-[#1f1d27] to-[#3a3646]"
        style={{ height: PLANK_TOP }}
      />
      {/* Chant */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-[2px] bg-linear-to-b from-[#2b2833] via-[#18161f] to-[#0f0e14] shadow-[0_26px_38px_-16px_rgb(0_0_0/0.95)]"
        style={{ top: PLANK_TOP }}
      >
        <span className="absolute inset-x-0 top-0 h-px bg-cream/45" />
      </div>
      <span
        data-led
        className="absolute inset-x-6 -bottom-px h-[2px] rounded-full bg-glow shadow-[0_0_14px_3px_rgb(124_92_255/0.7)]"
      />
      <span
        data-led
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-14"
        style={{ background: 'radial-gradient(ellipse 50% 100% at 50% 0%, rgb(124 92 255 / 0.28), transparent)' }}
      />
    </div>
  )
}

interface ShowcaseShelvesProps {
  entries: LibraryEntry[]
  onOpen: (entry: LibraryEntry) => void
}

/**
 * Vitrine : les couvertures, en volume, posées face à nous sur des étagères
 * éclairées. Le nombre de livres par rayon suit la largeur réelle.
 *
 * Entrée : les planches se déroulent, les LED s'allument, puis les livres
 * montent du rayon un à un.
 */
export function ShowcaseShelves({ entries, onOpen }: ShowcaseShelvesProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      setAvailable(Math.max(0, (entry?.contentRect.width ?? 0) - INSET * 2))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { rows, width, gap } = useMemo(() => {
    const { target, max, gap: spacing } = metricsFor(available)
    if (available <= 0) return { rows: [] as LibraryEntry[][], width: target, gap: spacing }
    const columns = Math.max(2, Math.floor((available + spacing) / (target + spacing)))
    const bookWidth = Math.min(max, Math.floor((available - spacing * (columns - 1)) / columns))
    const chunks: LibraryEntry[][] = []
    for (let index = 0; index < entries.length; index += columns) chunks.push(entries.slice(index, index + columns))
    return { rows: chunks, width: bookWidth, gap: spacing }
  }, [entries, available])

  const signature = `${width}:${rows.map((row) => row.map((entry) => entry.book.id).join(',')).join('|')}`

  useGSAP(
    () => {
      if (rows.length === 0) return
      gsap
        .timeline({ defaults: { ease: EASE.swift } })
        .from('[data-plank]', { scaleX: 0, duration: 0.8, stagger: 0.12 }, 0)
        .from('[data-led]', { autoAlpha: 0, duration: 0.6, stagger: 0.06 }, 0.35)
        .from('[data-row-light]', { autoAlpha: 0, duration: 0.9, stagger: 0.12 }, 0.3)
        .from(
          '[data-shelf-book]',
          {
            y: 52,
            autoAlpha: 0,
            duration: 0.75,
            stagger: { each: 0.05, from: 'start' },
            ease: EASE.snap,
            clearProps: 'opacity,visibility,transform',
          },
          0.35,
        )
    },
    { dependencies: [signature], revertOnUpdate: true, scope: rootRef },
  )

  const bookHeight = Math.round(width * 1.5)

  return (
    <div ref={rootRef} className="space-y-16 pb-10">
      {rows.map((row) => (
        // Pas de `content-visibility` : son confinement de peinture rognerait les
        // lueurs qui débordent du rayon (reflets, LED, pourcentage de lecture).
        <div key={row.map((entry) => entry.book.id).join('|')} className="relative">
          {/* Spot de vitrine. `closest-side` : la lueur s'éteint AVANT les bords de
              sa boîte ; un dégradé coupé par un bord dessinait un rectangle pâle. */}
          <div
            data-row-light
            aria-hidden
            className="pointer-events-none absolute -inset-x-6 -top-16 bottom-6"
            style={{
              background:
                'radial-gradient(closest-side at 50% 55%, rgb(255 255 255 / 0.08), rgb(255 255 255 / 0.03) 60%, transparent)',
            }}
          />

          {/* La planche est posée AVANT les livres : ils se tiennent dessus, et leur
              reflet coloré s'étale sur elle au lieu de passer dessous. */}
          <div className="relative" style={{ height: bookHeight + PLANK_HEIGHT + 22 }}>
            <Plank />
            <div
              // Centrés : un rayon incomplet ne laisse pas une longue planche vide d'un seul côté.
              className="absolute inset-x-0 flex items-end justify-center [perspective:1000px]"
              style={{ bottom: PLANK_HEIGHT - PLANK_TOP / 2, gap, paddingInline: INSET }}
            >
              {row.map((entry) => (
                <ShelfBook key={entry.book.id} entry={entry} width={width} onOpen={onOpen} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
