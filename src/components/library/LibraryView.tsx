import { useMemo, useRef, useState } from 'react'
import { BookMarked, BookOpen, LayoutGrid, Rows3, Sparkles } from 'lucide-react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import type { LibraryEntry, ReadingStatus } from '../../types/book'
import { STATUS_ORDER } from '../../types/book'
import { Pressable } from '../ui/Pressable'
import { BookTile } from './BookTile'
import { SegmentedTabs } from './SegmentedTabs'
import { ShelfWall } from './ShelfWall'

type LibraryLayout = 'shelf' | 'grid'

const EMPTY_COPY: Record<ReadingStatus, { icon: typeof BookOpen; title: string; body: string }> = {
  read: {
    icon: BookMarked,
    title: 'Aucun livre terminé',
    body: 'Marque une lecture comme terminée depuis sa fiche et elle atterrira ici.',
  },
  reading: {
    icon: BookOpen,
    title: 'Pas de lecture en cours',
    body: 'Ouvre un livre de ta wishlist puis passe-le en « En cours ».',
  },
  wishlist: {
    icon: Sparkles,
    title: 'Wishlist vide',
    body: 'Va dans Découvrir et swipe à droite ce qui t’attire.',
  },
}

export function LibraryView() {
  const entries = useLibraryStore((state) => state.entries)
  const openDetail = useUiStore((state) => state.openDetail)
  const [tab, setTab] = useState<ReadingStatus>('wishlist')
  const [layout, setLayout] = useState<LibraryLayout>('shelf')
  const scrollRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(() => {
    const base: Record<ReadingStatus, LibraryEntry[]> = { read: [], reading: [], wishlist: [] }
    for (const entry of Object.values(entries)) base[entry.status].push(entry)
    for (const status of STATUS_ORDER) base[status].sort((a, b) => b.addedAt - a.addedAt)
    return base
  }, [entries])

  const counts = useMemo(
    () => ({
      read: grouped.read.length,
      reading: grouped.reading.length,
      wishlist: grouped.wishlist.length,
    }),
    [grouped],
  )

  const items = grouped[tab]

  // Cascade de la grille. En mode étagère, c'est `ShelfWall` qui anime.
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

  const empty = EMPTY_COPY[tab]
  const EmptyIcon = empty.icon

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5">
      <div className="flex items-center gap-2 md:max-w-lg">
        <SegmentedTabs value={tab} counts={counts} onChange={setTab} />

        <Pressable
          onClick={() => {
            vibrate(6)
            setLayout((current) => (current === 'shelf' ? 'grid' : 'shelf'))
          }}
          aria-label={layout === 'shelf' ? 'Afficher en grille' : 'Afficher en étagère'}
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
          <ShelfWall
            // Repartir de zéro à chaque onglet : le rangement change entièrement.
            key={tab}
            entries={items}
            onOpen={(entry) => openDetail(entry.book)}
          />
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
