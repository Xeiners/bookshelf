import { useRef } from 'react'
import { X } from 'lucide-react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { useT } from '../../i18n'
import { isGenreShelf, type Shelf, type ShelfId } from '../../services/catalog'

interface ShelfPickerProps {
  /** Étagères du catalogue, ou celles des romans. */
  shelves: Shelf[]
  active: Shelf
  /** Genres cochés ensemble, dans l'ordre où ils l'ont été. */
  genres: readonly ShelfId[]
  /** « Pour toi » / « Tendances » : un mode seul, les genres cochés sont retirés. */
  onSelect: (shelf: Shelf) => void
  /** Un genre : coché en plus des autres, ou retiré. */
  onToggleGenre: (genre: ShelfId) => void
}

/**
 * Rail d'étagères. « Pour toi » et « Tendances » sont des modes exclusifs ;
 * les genres se cochent à plusieurs (l'un OU l'autre) : cochés, ils passent en
 * tête avec une croix pour les retirer. Débord à gauche uniquement
 * (`-ml-5 pl-5`) : les puces filent jusqu'au bord, les boutons d'action
 * restent épinglés à droite.
 */
export function ShelfPicker({ shelves, active, genres, onSelect, onToggleGenre }: ShelfPickerProps) {
  const t = useT()
  const rowRef = useRef<HTMLDivElement>(null)
  const modes = shelves.filter((shelf) => !isGenreShelf(shelf.id))
  const picked = genres.filter((genre) => shelves.some((shelf) => shelf.id === genre))
  const others = shelves.filter((shelf) => isGenreShelf(shelf.id) && !picked.includes(shelf.id))

  useGSAP(
    () => {
      gsap.from('[data-chip]', {
        y: 16,
        autoAlpha: 0,
        duration: 0.5,
        stagger: 0.035,
        ease: EASE.swift,
      })
    },
    { scope: rowRef },
  )

  // Un genre coché passe en tête : le rail revient au début pour le montrer.
  // Défilement du rail seul (`scrollIntoView` remontait aussi les parents) et
  // instantané au montage : pas de scroll animé par-dessus l'entrée de la vue.
  const centered = useRef(false)
  useGSAP(
    () => {
      const row = rowRef.current
      if (!row) return
      row.scrollTo({ left: 0, behavior: centered.current ? 'smooth' : 'instant' })
      centered.current = true
    },
    { dependencies: [active.id, picked.join(',')] },
  )

  const chip = 'shrink-0 rounded-full py-2 text-xs font-medium whitespace-nowrap transition-colors duration-300' // i18n-ignore : classes CSS

  return (
    <div
      ref={rowRef}
      className="no-scrollbar -ml-5 flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain py-1 pl-5"
      role="group"
      aria-label={t.shelves.pickerLabel}
    >
      {modes.map((shelf) => {
        const isActive = picked.length === 0 && shelf.id === active.id
        return (
          <button
            key={shelf.id}
            data-chip
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(shelf)}
            className={`${chip} px-4 ${isActive ? 'bg-cream text-void' : 'glass text-cream/65'}`}
          >
            {t.shelves.names[shelf.id]}
          </button>
        )
      })}

      {picked.map((genre) => (
        <button
          key={genre}
          data-chip
          type="button"
          aria-pressed
          onClick={() => onToggleGenre(genre)}
          aria-label={t.shelves.removeGenre(t.shelves.names[genre])}
          className={`${chip} flex items-center gap-1.5 bg-cream pr-2.5 pl-4 text-void`}
        >
          {t.shelves.names[genre]}
          <X size={12} strokeWidth={2.6} aria-hidden />
        </button>
      ))}

      {others.map((shelf) => (
        <button
          key={shelf.id}
          data-chip
          type="button"
          aria-pressed={false}
          onClick={() => onToggleGenre(shelf.id)}
          aria-label={t.shelves.addGenre(t.shelves.names[shelf.id])}
          className={`${chip} glass px-4 text-cream/65`}
        >
          {t.shelves.names[shelf.id]}
        </button>
      ))}
    </div>
  )
}
