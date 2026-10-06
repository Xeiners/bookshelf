import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
  const listRef = useRef<HTMLUListElement>(null)
  /** Place de la liste : sous le champ, ou au-dessus quand l'écran (ou le clavier) n'en laisse pas assez. */
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 320 })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const suggestions = useMemo(() => (works ? searchWorks(works, query, excluded) : []), [works, query, excluded])
  const showList = open && query.trim().length > 0

  // La liste ne dépasse jamais de la zone visible : ni de l'écran (ou du clavier), ni du
  // panneau qui défile autour du jeu (sinon elle passait sous son bord, coupée).
  // Mesurée à l'ouverture, à chaque frappe, et quand la page défile ou change de taille.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!showList || !box) return
    const measure = () => {
      const rect = box.getBoundingClientRect()
      const viewport = window.visualViewport
      let top = viewport?.offsetTop ?? 0
      let bottom = top + (viewport?.height ?? window.innerHeight)
      const clip = scrollParent(box)
      if (clip) {
        const area = clip.getBoundingClientRect()
        top = Math.max(top, area.top)
        bottom = Math.min(bottom, area.bottom)
      }
      const below = bottom - rect.bottom - 12
      const above = rect.top - top - 12
      const up = below < 220 && above > below
      setPlacement({ up, maxHeight: Math.max(96, Math.min(320, up ? above : below)) })
    }
    measure()
    const clip = scrollParent(box)
    clip?.addEventListener('scroll', measure, { passive: true })
    window.visualViewport?.addEventListener('resize', measure)
    window.addEventListener('resize', measure)
    return () => {
      clip?.removeEventListener('scroll', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.removeEventListener('resize', measure)
    }
  }, [showList, suggestions.length])

  // Au clavier (↑ ↓), la suggestion choisie reste visible : la liste défile avec elle.
  // (Pas au survol de la souris : la liste ne doit pas bouger sous le pointeur.)
  const byKeyboard = useRef(false)
  useEffect(() => {
    if (!showList || !byKeyboard.current) return
    byKeyboard.current = false
    listRef.current?.querySelector<HTMLElement>(`[data-option="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, showList])

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
      byKeyboard.current = true
      setOpen(true)
      setActive((index) => Math.min(suggestions.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      byKeyboard.current = true
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
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ maxHeight: placement.maxHeight }}
          className={`absolute inset-x-0 ${placement.up ? 'bottom-full mb-2' : 'top-full mt-2'} overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#101019] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]`}
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-3 text-sm text-mist">{t.dle.game.noMatch}</li>
          ) : (
            suggestions.map((work, index) => (
              <li key={work.id} role="option" data-option={index} aria-selected={index === active}>
                <button
                  type="button"
                  // Le choix part au clic (un vrai tap), jamais au toucher : sur mobile, faire
                  // défiler la liste commence aussi par un toucher. `mousedown` empêché : le
                  // champ garde le focus (et le clavier reste ouvert).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void choose(work)}
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

/** Le plus proche parent qui défile (et coupe donc ce qui dépasse) ; `null` : la page. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') return node
  }
  return null
}
