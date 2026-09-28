import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { FEATURED_MAX, type ProfileCard } from '../../services/profileApi'
import { CARD_RATIO, CollectibleCard } from '../cards/CollectibleCard'

interface ProfileShowcaseProps {
  /** Cartes exposées, dans l'ordre choisi : la première trône au centre. */
  cards: ProfileCard[]
  signedIn: boolean
  /** Emplacement libre touché : édition du profil (ou création de compte en invité). */
  onAddCard: () => void
  onOpenCard: (card: ProfileCard) => void
}

/** Place à l'écran de chaque emplacement : gauche, centre, droite. */
const POSITIONS = ['left', 'center', 'right'] as const
type Position = (typeof POSITIONS)[number]

/** Rang de la carte (ordre choisi) affiché à chaque place : la 1re au centre. */
const SLOT_AT: Record<Position, number> = { left: 1, center: 0, right: 2 }

/**
 * Pose 3D FIXE de chaque place : les cartes latérales pivotent vers le centre,
 * en retrait. Seul `transform` : chaque carte reste une couche GPU, et
 * l'inclinaison au doigt (`CollectibleCard interactive`) s'y ajoute.
 */
const POSE: Record<Position, CSSProperties> = {
  left: { transform: 'perspective(1000px) translateX(14%) rotateY(24deg) scale(0.82)', zIndex: 1 },
  center: { transform: 'translateY(-4%)', zIndex: 2 },
  right: { transform: 'perspective(1000px) translateX(-14%) rotateY(-24deg) scale(0.82)', zIndex: 1 },
}

/** Largeur de la carte centrale selon la place disponible. */
const cardWidthFor = (width: number) => Math.round(Math.min(190, Math.max(92, width * 0.38)))

/**
 * Vitrine : trois cartes favorites en éventail 3D. Les emplacements libres
 * invitent à en choisir ; toucher une carte l'affiche en grand.
 */
export function ProfileShowcase({ cards, signedIn, onAddCard, onOpenCard }: ProfileShowcaseProps) {
  const t = useT()
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const cardWidth = width > 0 ? cardWidthFor(width) : 0
  const cardHeight = Math.round(cardWidth * CARD_RATIO)
  const ready = cardWidth > 0
  const shownKey = cards.map((card) => card.id).join('|')

  // Arrivée des cartes, une fois leur taille connue (et à chaque nouvelle vitrine). Le calque animé est
  // intérieur : la pose 3D de la place (style inline) n'est jamais touchée.
  useGSAP(
    () => {
      if (!ready) return
      gsap.from('[data-showcase-rise]', {
        y: 36,
        autoAlpha: 0,
        duration: 0.8,
        stagger: { each: 0.09, from: 'center' },
        ease: EASE.snap,
        clearProps: 'transform,opacity,visibility',
      })
    },
    { dependencies: [ready, shownKey], scope: stageRef },
  )

  return (
    <section data-anim className="glass overflow-hidden rounded-4xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-cream">{t.profile.showcase.title}</h2>
        <p className="truncate text-[11px] text-mist">
          {signedIn ? t.profile.showcase.subtitle : t.profile.showcase.guest}
        </p>
      </div>

      <div
        ref={stageRef}
        className="mt-5 flex items-center justify-center"
        style={{ height: ready ? cardHeight + 24 : undefined, minHeight: 200 }}
      >
        {ready &&
          POSITIONS.map((position) => {
            const rank = SLOT_AT[position]
            const card = cards[rank]
            return (
              <div key={position} className="relative -mx-[3%] shrink-0" style={POSE[position]}>
                <div data-showcase-rise>
                  {card ? (
                    <button
                      type="button"
                      onClick={() => onOpenCard(card)}
                      aria-label={card.name || card.title}
                      className="block rounded-[9%/6.5%]"
                    >
                      <CollectibleCard card={card} width={cardWidth} interactive lazy={false} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onAddCard}
                      aria-label={signedIn ? t.profile.showcase.add : t.profile.showcase.guest}
                      className="grid place-items-center rounded-[9%/6.5%] border-2 border-dashed border-cream/15 bg-cream/[0.03] text-cream/35 transition-colors hover:border-cream/30 hover:text-cream/60"
                      style={{ width: cardWidth, height: cardHeight }}
                    >
                      <span className="flex flex-col items-center gap-2 px-3 text-center">
                        <Plus size={Math.round(cardWidth * 0.18)} />
                        <span className="text-[10px] leading-tight">{t.profile.showcase.empty}</span>
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {/* Emplacements restants : rappel discret sous la vitrine. */}
      {signedIn && cards.length < FEATURED_MAX && (
        <button type="button" onClick={onAddCard} className="mt-3 w-full text-center text-[11px] text-glow">
          {t.profile.showcase.add}
        </button>
      )}
    </section>
  )
}
