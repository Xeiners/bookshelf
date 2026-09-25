import { useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, BookOpen, Heart, LayoutGrid, Rows3, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { getT } from '../../i18n'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { LibraryEntry, LibraryTab } from '../../types/book'
import { LIBRARY_TABS } from '../../types/book'
import { Pressable } from '../ui/Pressable'
import { BookTile } from './BookTile'
import { FeaturedBook } from './FeaturedBook'
import { SegmentedTabs } from './SegmentedTabs'
import { ShowcaseShelves } from './ShowcaseShelves'

/** `shelf` = vitrine 3D (livre à la une + étagères éclairées), `grid` = mosaïque de couvertures. */
type LibraryLayout = 'shelf' | 'grid'

/**
 * Au-delà de cette largeur, la vitrine passe sur deux colonnes : le livre à la
 * une reste épinglé à gauche pendant qu'on parcourt les étagères à droite.
 */
const WIDE_LAYOUT = 900

/**
 * Largeur du livre à la une selon la place disponible. En colonne épinglée, la
 * carte entière doit tenir dans la hauteur visible : on réduit le livre sur les
 * écrans bas (un 1440 × 900 laisse ~640 px utiles).
 */
function heroWidthFor(width: number, height: number): number {
  if (width >= WIDE_LAYOUT) return height >= 820 ? 170 : height >= 700 ? 146 : 120
  return width >= 640 ? 150 : 112
}

/** Le titre « à la une » : celui qu'on a touché en dernier dans l'onglet. */
const lastTouched = (entry: LibraryEntry) => entry.updatedAt ?? entry.addedAt

/** Icône de l'état vide ; titre et texte viennent de `t.library.empty`. */
const EMPTY_ICON: Record<LibraryTab, typeof BookOpen> = {
  read: BookMarked,
  reading: BookOpen,
  wishlist: Sparkles,
  favorites: Heart,
}

export function LibraryView() {
  const t = useT()
  const entries = useLibraryStore((state) => state.entries)
  const openDetail = useUiStore((state) => state.openDetail)
  const notify = useUiStore((state) => state.notify)
  const setStatus = useLibraryStore((state) => state.setStatus)
  // Dans le store : la barre latérale d'ordinateur ouvre la biblio sur un onglet précis.
  const tab = useUiStore((state) => state.libraryTab)
  const setTab = useUiStore((state) => state.setLibraryTab)
  const [layout, setLayout] = useState<LibraryLayout>('shelf')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) =>
      setContainer({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const containerWidth = container.width
  const heroWidth = heroWidthFor(container.width, container.height)

  const grouped = useMemo(() => {
    const base: Record<LibraryTab, LibraryEntry[]> = { read: [], reading: [], wishlist: [], favorites: [] }
    for (const entry of Object.values(entries)) {
      base[entry.status].push(entry)
      // Les coups de cœur, tous statuts confondus.
      if (entry.favorite) base.favorites.push(entry)
    }
    for (const tab of LIBRARY_TABS) base[tab].sort((a, b) => b.addedAt - a.addedAt)
    return base
  }, [entries])

  const counts = useMemo(
    () => ({
      read: grouped.read.length,
      reading: grouped.reading.length,
      wishlist: grouped.wishlist.length,
      favorites: grouped.favorites.length,
    }),
    [grouped],
  )

  const items = grouped[tab]

  // Vitrine : un titre à la une, le reste sur les étagères (dans l'ordre d'ajout).
  const featured = useMemo(
    () => items.reduce<LibraryEntry | null>((best, entry) => (!best || lastTouched(entry) > lastTouched(best) ? entry : best), null),
    [items],
  )
  const shelved = useMemo(() => items.filter((entry) => entry !== featured), [items, featured])
  // Deux colonnes seulement s'il y a des étagères à côté de la une.
  const wide = containerWidth >= WIDE_LAYOUT && shelved.length > 0

  const startReading = (entry: LibraryEntry) => {
    vibrate([10, 30, 14])
    setStatus(entry.book.id, 'reading')
    notify(getT().book.movedTo(getT().status.reading), 'like')
    // On suit le livre dans son nouvel onglet.
    setTab('reading')
  }

  // Cascade de la grille. En mode vitrine, ce sont `FeaturedBook` et `ShowcaseShelves` qui animent.
  useGSAP(
    () => {
      if (layout !== 'grid') return
      gsap.from('[data-tile]', {
        y: 28,
        autoAlpha: 0,
        duration: 0.55,
        stagger: 0.045,
        ease: EASE.swift,
        overwrite: 'auto',
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [tab, layout, items.length], scope: scrollRef },
  )

  const empty = t.library.empty[tab]
  const EmptyIcon = EMPTY_ICON[tab]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5">
      <div className="flex items-center gap-2 md:max-w-lg">
        <SegmentedTabs value={tab} counts={counts} onChange={setTab} />

        <Pressable
          onClick={() => {
            vibrate(6)
            setLayout((current) => (current === 'shelf' ? 'grid' : 'shelf'))
          }}
          aria-label={layout === 'shelf' ? t.library.showGrid : t.library.showShelf}
          className="glass grid size-11 shrink-0 place-items-center rounded-full text-cream/70"
        >
          {layout === 'shelf' ? <LayoutGrid size={16} /> : <Rows3 size={16} />}
        </Pressable>
      </div>

      <div
        ref={scrollRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-10 text-center">
            <div className="glass grid size-16 place-items-center rounded-full">
              <EmptyIcon size={22} className="text-cream/70" />
            </div>
            <div>
              <h2 className="font-display text-2xl">{empty.title}</h2>
              <p className="mx-auto mt-2 max-w-[15rem] text-sm text-mist">{empty.body}</p>
            </div>
          </div>
        ) : layout === 'shelf' ? (
          // Repartir de zéro à chaque onglet : la vitrine se rejoue entièrement.
          <div
            key={tab}
            className={
              wide
                ? 'grid grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start gap-10 pt-1'
                : 'space-y-10 pt-1'
            }
          >
            {featured && (
              // Sur deux colonnes, la une reste à l'écran pendant le défilement des étagères.
              <div className={wide ? 'sticky top-0' : undefined}>
                <FeaturedBook
                  entry={featured}
                  width={heroWidth}
                  layout={wide ? 'stacked' : 'row'}
                  onOpen={() => openDetail(featured.book)}
                  onStart={() => startReading(featured)}
                />
              </div>
            )}
            {shelved.length > 0 && (
              <div className={wide ? 'pt-6' : undefined}>
                <ShowcaseShelves entries={shelved} onOpen={(entry) => openDetail(entry.book)} />
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 md:gap-x-5 xl:grid-cols-6">
            {items.map((entry) => (
              <BookTile key={entry.book.id} entry={entry} onOpen={() => openDetail(entry.book)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
