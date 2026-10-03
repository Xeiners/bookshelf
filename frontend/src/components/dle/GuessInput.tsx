import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE } from '../../lib/boosters'
import { searchWorks } from '../../lib/dle'
import type { DleWorkOption } from '../../services/dleApi'

interface GuessInputProps {
  works: DleWorkOption[] | null
  /** Œuvres déjà proposées : jamais suggérées deux fois. */
  excluded: ReadonlySet<string>
  disabled?: boolean
  onGuess: (cardId: string) => Promise<void>
}

/**
 * Saisie d'une œuvre : suggestions dès la première lettre (titre, mot du titre,
 * titres dans d'autres langues), au clavier (↑ ↓ Entrée) comme au doigt. Une
 * proposition part au choix d'une suggestion ; le champ se vide et garde le focus.
 */
export function GuessInput({ works, excluded, disabled = false, onGuess }: GuessInputProps) {
  const t = useT()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  /** Place de la liste : sous le champ, ou au-dessus quand l'écran (ou le clavier) n'en laisse pas assez. */
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 320 })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const suggestions = useMemo(() => (works ? searchWorks(works, query, excluded) : []), [works, query, excluded])
  const showList = open && query.trim().length > 0

  // La liste ne dépasse jamais de l'écran visible : mesurée à chaque ouverture et à chaque frappe.
  useLayoutEffect(() => {
    if (!showList || !boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const viewport = window.visualViewport
    const top = viewport?.offsetTop ?? 0
    const bottom = top + (viewport?.height ?? window.innerHeight)
    const below = bottom - rect.bottom - 12
    const above = rect.top - top - 12
    const up = below < 220 && above > below
    setPlacement({ up, maxHeight: Math.max(120, Math.min(320, up ? above : below)) })
  }, [showList, suggestions.length])

  const choose = async (work: DleWorkOption | undefined) => {
    if (!work || busy || disabled) return
    setBusy(true)
    try {
      await onGuess(work.id)
      setQuery('')
      setActive(0)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(suggestions.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void choose(suggestions[active] ?? suggestions[0])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative z-20">
      <div ref={boxRef} className="flex scroll-mt-3 items-center gap-3 rounded-2xl border border-white/10 bg-carbon/90 px-4 py-3 transition-colors focus-within:border-glow/60">
        {busy ? <Loader2 size={18} className="shrink-0 animate-spin text-glow" aria-hidden /> : <Search size={18} className="shrink-0 text-mist" aria-hidden />}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t.dle.game.searchAria}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          disabled={disabled || works === null}
          value={query}
          placeholder={t.dle.game.placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            // Téléphone : le champ remonte en haut de l'écran, la liste a la place de s'ouvrir sous lui.
            if (window.matchMedia('(max-width: 767px)').matches) window.setTimeout(() => boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250)
          }}
          // Un tap sur une suggestion arrive après le blur : on lui laisse le temps.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-cream outline-none placeholder:text-mist/70 disabled:opacity-50"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          style={{ maxHeight: placement.maxHeight }}
          className={`absolute inset-x-0 ${placement.up ? 'bottom-full mb-2' : 'top-full mt-2'} overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#101019] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]`}
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-3 text-sm text-mist">{t.dle.game.noMatch}</li>
          ) : (
            suggestions.map((work, index) => (
              <li key={work.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  // `pointerdown` : le choix part avant que le champ ne perde le focus.
                  onPointerDown={(event) => {
                    event.preventDefault()
                    void choose(work)
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${index === active ? 'bg-white/[0.08]' : ''}`}
                >
                  <img src={work.imageUrl} alt="" loading="lazy" decoding="async" className="h-11 w-8 shrink-0 rounded-md bg-ink object-cover object-top" />
                  <span className="min-w-0 flex-1 truncate text-sm text-cream">{work.name}</span>
                  {work.rarity && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: RARITY_STYLE[work.rarity].color }} />}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
