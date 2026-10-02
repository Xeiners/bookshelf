import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Search } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { CollectionCard } from '../../lib/boosters'
import { offerableDuplicates, requestableFor, reservedCopies, type Duplicate } from '../../lib/trades'
import { useTradeStore } from '../../store/useTradeStore'
import { useUiStore } from '../../store/useUiStore'
import { CollectibleCard } from '../cards/CollectibleCard'
import { Sheet } from '../ui/Sheet'

const GAP = 10
const columnsFor = (width: number) => (width >= 560 ? 5 : width >= 420 ? 4 : 3)

type Step = 0 | 1 | 2

/**
 * « Proposer un échange », en trois étapes : un doublon libre de l'album, puis
 * la carte voulue (même rareté, manquantes d'abord), puis la confirmation.
 * L'API revérifie tout : doublon libre, rareté, limite d'offres.
 */
export function CreateTradeSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const copy = t.trades.createSheet
  const { data } = useCollection()
  const mine = useTradeStore((state) => state.mine)
  const create = useTradeStore((state) => state.create)
  const notify = useUiStore((state) => state.notify)

  const [step, setStep] = useState<Step>(0)
  const [offered, setOffered] = useState<Duplicate | null>(null)
  const [wanted, setWanted] = useState<CollectionCard | null>(null)
  const [missingOnly, setMissingOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [publishing, setPublishing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  /** Sens de la dernière navigation : l'étape suivante arrive de droite, la précédente de gauche. */
  const direction = useRef<1 | -1>(1)
  const go = (next: Step) => {
    direction.current = next > step ? 1 : -1
    vibrate(6)
    setStep(next)
  }

  // Changement d'étape : le contenu glisse, la jauge se remplit jusqu'à l'étape atteinte.
  useGSAP(
    () => {
      gsap.to('[data-step-fill]', { scaleX: (index: number) => (index <= step ? 1 : 0), duration: 0.5, ease: EASE.swift, stagger: 0.06 })
      gsap.fromTo('[data-step-body]', { x: direction.current * 36, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: EASE.glide })
      if (step !== 2) return
      // Confirmation : les deux cartes se rejoignent, l'orbe bat entre elles.
      gsap
        .timeline()
        .fromTo('[data-confirm-give]', { x: -40, rotation: -8, autoAlpha: 0 }, { x: 0, rotation: -3, autoAlpha: 1, duration: 0.6, ease: EASE.snap }, 0.05)
        .fromTo('[data-confirm-want]', { x: 40, rotation: 8, autoAlpha: 0 }, { x: 0, rotation: 3, autoAlpha: 1, duration: 0.6, ease: EASE.snap }, '<')
        .fromTo('[data-confirm-orb]', { scale: 0 }, { scale: 1, duration: 0.45, ease: EASE.snap }, '-=0.25')
        .to('[data-confirm-orb]', { scale: 1.12, duration: 0.7, ease: 'sine.inOut', repeat: -1, yoyo: true })
    },
    { scope: stageRef, dependencies: [step], revertOnUpdate: true },
  )

  const reserved = useMemo(() => reservedCopies(mine ?? []), [mine])
  const duplicates = useMemo(() => (data ? offerableDuplicates(data.cards, reserved) : []), [data, reserved])
  const candidates = useMemo(
    () => (data && offered ? requestableFor(data.cards, offered, { missingOnly, query: search }) : []),
    [data, offered, missingOnly, search],
  )

  const publish = async (dismiss: () => void) => {
    if (!offered || !wanted) return
    setPublishing(true)
    try {
      await create(offered.id, wanted.id)
      notify(copy.created, 'like')
      dismiss()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
      setPublishing(false)
    }
  }

  const canContinue = step === 0 ? offered !== null : step === 1 ? wanted !== null : !publishing

  return (
    <Sheet
      label={copy.title}
      title={copy.title}
      subtitle={copy.step(step + 1, 3)}
      onClose={onClose}
      footer={(dismiss) => (
        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go((step - 1) as Step)}
              disabled={publishing}
              className="h-11 rounded-full bg-cream/10 px-5 text-sm font-semibold text-cream disabled:opacity-40"
            >
              {copy.back}
            </button>
          )}
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => (step === 2 ? void publish(dismiss) : go((step + 1) as Step))}
            className="h-11 flex-1 rounded-full bg-gold text-sm font-semibold text-void disabled:opacity-40"
          >
            {step === 2 ? (publishing ? copy.publishing : copy.publish) : copy.next}
          </button>
        </div>
      )}
    >
      <div ref={stageRef}>
      {/* Jauge des trois étapes. */}
      <div aria-hidden className="mb-4 grid grid-cols-3 gap-1.5">
        {copy.steps.map((name, index) => (
          <span key={name} className="flex flex-col gap-1.5">
            <span className="h-1 overflow-hidden rounded-full bg-white/8">
              <span data-step-fill className="block h-full origin-left scale-x-0 rounded-full bg-gold will-change-transform" />
            </span>
            <span className={`text-[10px] tracking-[0.12em] uppercase transition-colors duration-300 ${index === step ? 'text-gold' : 'text-mist/70'}`}>{name}</span>
          </span>
        ))}
      </div>
      <div data-step-body>
      {step === 0 && (
        <section>
          <p className="mb-3 text-sm text-cream/75">{copy.pickDuplicate}</p>
          {data && duplicates.length === 0 ? (
            <p className="py-8 text-center text-sm text-mist">{copy.noDuplicate}</p>
          ) : (
            <CardGrid
              cards={duplicates}
              selected={offered?.id ?? null}
              onPick={(card) => {
                setOffered(card)
                // Autre doublon, autre rareté possible : la demande est à refaire.
                if (wanted && wanted.rarity !== card.rarity) setWanted(null)
              }}
              badge={(card) => copy.free(card.free)}
            />
          )}
        </section>
      )}

      {step === 1 && offered && (
        <section>
          <p className="mb-3 text-sm text-cream/75">{copy.pickWanted(t.cards.rarity[offered.rarity])}</p>
          <div className="mb-3 flex flex-col gap-2">
            <label className="glass flex h-10 items-center gap-2 rounded-full px-4 focus-within:ring-1 focus-within:ring-glow/60">
              <Search size={15} className="shrink-0 text-mist" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.search}
                aria-label={copy.search}
                className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist"
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 self-start text-xs text-cream/80">
              <input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} className="size-4 accent-gold" />
              {copy.missingOnly}
            </label>
          </div>
          {candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-mist">{copy.noCandidate}</p>
          ) : (
            <CardGrid
              cards={candidates}
              selected={wanted?.id ?? null}
              onPick={setWanted}
              badge={(card) => (card.owned ? copy.copies(card.count) : copy.missing)}
            />
          )}
        </section>
      )}

      {step === 2 && offered && wanted && (
        <section className="flex flex-col items-center gap-5 py-2">
          <div className="flex items-center justify-center gap-4">
            <figure data-confirm-give className="flex flex-col items-center gap-2">
              <figcaption className="text-[10px] tracking-[0.16em] text-nope uppercase">{copy.give}</figcaption>
              <CollectibleCard card={offered} width={120} lazy={false} />
              <span className="max-w-[120px] truncate text-xs text-cream/80">{offered.name}</span>
            </figure>
            <span
              data-confirm-orb
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full border border-gold/60 bg-[#0b0b12] text-gold will-change-transform"
              style={{ boxShadow: `0 0 22px -6px ${RARITY_STYLE[offered.rarity].color}` }}
            >
              <ArrowLeftRight size={19} />
            </span>
            <figure data-confirm-want className="flex flex-col items-center gap-2">
              <figcaption className="text-[10px] tracking-[0.16em] text-like uppercase">{copy.want}</figcaption>
              <CollectibleCard card={wanted} width={120} lazy={false} />
              <span className="max-w-[120px] truncate text-xs text-cream/80">{wanted.name}</span>
            </figure>
          </div>
          <p className="max-w-sm text-center text-xs leading-5 text-mist">{copy.summary}</p>
        </section>
      )}
      </div>
      </div>
    </Sheet>
  )
}

interface CardGridProps<C extends CollectionCard> {
  cards: readonly C[]
  selected: string | null
  onPick: (card: C) => void
  badge: (card: C) => string
}

/** Grille de choix : cartes montrées à découvert (on choisit ce qu'on voit), la choisie cerclée d'or. */
function CardGrid<C extends CollectionCard>({ cards, selected, onPick, badge }: CardGridProps<C>) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const columns = columnsFor(width)
  const cardWidth = width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0

  // Carte choisie : la coche tombe en rebondissant (la carte reste en place : la feuille la rognerait).
  useGSAP(
    () => {
      if (!selected) return
      gsap.fromTo('[data-picked]', { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.45, ease: EASE.snap })
    },
    { scope: ref, dependencies: [selected] },
  )

  return (
    // Marge intérieure : l'anneau de la carte choisie tient dans la zone qui défile, sans être rogné.
    <div ref={ref} className="p-1">
      {cardWidth > 0 && (
        <ul role="listbox" className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}>
          {cards.map((card) => {
            const active = card.id === selected
            return (
              <li key={card.id} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.round(cardWidth * 1.45)}px` }}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-label={card.name}
                  onClick={() => {
                    vibrate(5)
                    onPick(card)
                  }}
                  className={`relative block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-glow/70 ${
                    active ? 'ring-2 ring-gold ring-offset-2 ring-offset-[#0b0b12]' : ''
                  }`}
                >
                  <span className="block">
                  <CollectibleCard
                    card={card}
                    width={cardWidth}
                    effects={false}
                    badge={
                      <span className="rounded-full bg-void/80 px-1.5 py-0.5 text-[9px] font-semibold text-cream tabular-nums">{badge(card)}</span>
                    }
                  />
                  </span>
                  {active && (
                    <span data-picked className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-gold text-void shadow-lift">
                      <Check size={14} aria-hidden />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
