import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Search } from 'lucide-react'
import { useT } from '../../i18n'
import { DEFAULT_FILTER, RARITY_STYLE, filterCollection, type CollectionCard } from '../../lib/boosters'

/** Vignettes montées d'un coup, puis par paquets : une collection de 600 cartes reste fluide. */
const PAGE = 45

interface CardPickerProps {
  heading: string
  /** Album complet : seules les cartes possédées sont proposées. */
  cards: readonly CollectionCard[]
  /** Album pas encore arrivé : squelette plutôt que « collection vide ». */
  loading?: boolean
  selectedId: string | null
  /** Cartes déjà prises ailleurs (autres emplacements de la vitrine). */
  unavailableIds?: ReadonlySet<string>
  onPick: (card: CollectionCard) => void
  onBack: () => void
}

/** Vignette légère (image + liseré de rareté) : pas de cadre animé, pas de calque 3D. */
function CardThumb({ card, selected, disabled, onClick }: { card: CollectionCard; selected: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={card.name || card.title}
      className="group relative aspect-[63/88] overflow-hidden rounded-xl border-2 bg-ink text-left transition-opacity disabled:opacity-30"
      style={{ borderColor: selected ? 'var(--color-cream)' : RARITY_STYLE[card.rarity].color }}
    >
      <img src={card.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-linear-to-t from-void/90 to-transparent px-1.5 pt-4 pb-1 text-[9px] leading-tight text-cream">
        {card.name || card.title}
      </span>
      {selected && (
        <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-cream text-void">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/** Choix d'une carte possédée (avatar ou vitrine), avec recherche par titre. */
export function CardPicker({ heading, cards, loading = false, selectedId, unavailableIds, onPick, onBack }: CardPickerProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const owned = useMemo(() => cards.filter((card) => card.owned), [cards])
  const matches = useMemo(() => filterCollection(owned, { ...DEFAULT_FILTER, query }), [owned, query])

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t.profile.editor.back}
          className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/70"
        >
          <ArrowLeft size={16} />
        </button>
        <h3 className="min-w-0 truncate font-display text-xl text-cream">{heading}</h3>
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-[63/88] overflow-hidden rounded-xl bg-cream/5">
              <div className="animate-shimmer h-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
            </div>
          ))}
        </div>
      ) : owned.length === 0 ? (
        <p className="px-2 py-10 text-center text-xs leading-relaxed text-mist">{t.profile.editor.emptyCollection}</p>
      ) : (
        <>
          <label className="glass mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
            <Search size={15} className="shrink-0 text-mist" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setLimit(PAGE)
              }}
              placeholder={t.profile.editor.search}
              aria-label={t.profile.editor.search}
              className="min-w-0 flex-1 bg-transparent text-sm text-cream placeholder:text-mist/60 focus:outline-none"
            />
          </label>

          {matches.length === 0 ? (
            <p className="py-10 text-center text-xs text-mist">{t.profile.editor.noMatch}</p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
              {matches.slice(0, limit).map((card) => (
                <CardThumb
                  key={card.id}
                  card={card}
                  selected={card.id === selectedId}
                  disabled={unavailableIds?.has(card.id) ?? false}
                  onClick={() => onPick(card)}
                />
              ))}
            </div>
          )}

          {matches.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((current) => current + PAGE)}
              className="glass mx-auto mt-4 block rounded-full px-5 py-2.5 text-xs text-cream/80"
            >
              {t.profile.editor.showMore}
            </button>
          )}
        </>
      )}
    </div>
  )
}
