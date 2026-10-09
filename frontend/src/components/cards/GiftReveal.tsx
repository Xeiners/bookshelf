import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift, Megaphone } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, rarityRank } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playFlip, playReveal } from '../../lib/sfx'
import { partyName } from '../../lib/trades'
import type { AppNotification } from '../../services/notificationsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useShowcaseStore } from '../../store/useShowcaseStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { CardBack } from './CardBack'
import { CARD_RATIO, CollectibleCard } from './CollectibleCard'

type GiftNotification = Extract<AppNotification, { type: 'card_gift' }>
type ShareNotification = Extract<AppNotification, { type: 'card_share' }>
type Surprise = GiftNotification | ShareNotification

/**
 * La surprise d'un cadeau de carte : à la visite suivante, la carte reçue (d'un membre ou
 * de l'équipe) arrive en plein écran, face cachée ; un toucher la retourne, dans une gerbe
 * de confettis aux couleurs de sa rareté. Les cartes qu'un membre montre (« Informer »)
 * arrivent de la même façon, en rangée. Une surprise à la fois ; vue = lue. Depuis la liste
 * des notifications, une présentation déjà vue se rejoue.
 */
export function GiftReveal() {
  const signedIn = useAuthStore((state) => state.user !== null)
  const items = useNotificationStore((state) => state.items)
  const markRead = useNotificationStore((state) => state.markRead)
  const replaying = useShowcaseStore((state) => state.replaying)
  const clearReplay = useShowcaseStore((state) => state.clear)
  // Déjà montrées pendant cette visite (le temps que la lecture remonte au serveur).
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  const pending = useMemo(
    () =>
      items
        .filter((item): item is Surprise => (item.type === 'card_gift' || item.type === 'card_share') && !item.read && !shown.has(item.id))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [items, shown],
  )
  const replay = replaying ? items.find((item): item is ShareNotification => item.id === replaying && item.type === 'card_share') : undefined
  const current = signedIn ? (replay ?? pending[0]) : undefined
  if (!current) return null
  const left = replay ? 0 : pending.length - 1
  const done = (id: string) => {
    setShown((set) => new Set(set).add(id))
    markRead([id])
    if (replay) clearReplay()
  }
  return createPortal(
    current.type === 'card_share' ? (
      <ShareReveal key={current.id} share={current} left={left} onDone={() => done(current.id)} />
    ) : (
      <Reveal key={current.id} gift={current} left={left} onDone={() => done(current.id)} />
    ),
    document.body,
  )
}

function Reveal({ gift, left, onDone }: { gift: GiftNotification; left: number; onDone: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const flipRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)
  const openActivity = useUiStore((state) => state.openActivity)
  const collectionChanged = useBoosterStore((state) => state.collectionChanged)
  const { card, from, message } = gift.data
  const color = RARITY_STYLE[card.rarity].color
  const width = Math.min(240, Math.round(window.innerWidth * 0.62))

  // La carte reçue entre dans l'album : il se recharge.
  useEffect(() => {
    collectionChanged()
  }, [collectionChanged])

  useGSAP(
    () => {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      gsap.fromTo('[data-gift-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 })
      gsap.fromTo('[data-gift-title]', { y: -18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.15, ease: EASE.glide })
      gsap.fromTo('[data-gift-card]', { y: 120, scale: 0.6, rotation: -12, autoAlpha: 0 }, { y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.9, delay: 0.25, ease: EASE.spring })
      if (!still) gsap.to('[data-gift-float]', { y: -10, duration: 1.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1 })
    },
    { scope: rootRef },
  )

  const flip = () => {
    if (revealed) return
    setRevealed(true)
    playFlip()
    vibrate([12, 40, 24])
    gsap
      .timeline()
      .to(flipRef.current, { rotationY: 90, scale: 1.08, duration: 0.28, ease: 'power2.in' })
      .add(() => {
        flipRef.current?.setAttribute('data-face', 'front')
        playReveal(card.rarity)
        const box = flipRef.current?.getBoundingClientRect()
        if (box) setBurst({ id: Date.now(), x: box.left + box.width / 2, y: box.top + box.height / 2, colors: [color, '#fff4c8', '#ffffff'], count: 90, spread: Math.PI * 2 })
      })
      .to(flipRef.current, { rotationY: 0, scale: 1, duration: 0.5, ease: EASE.snap })
    gsap.fromTo('[data-gift-after]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.7, ease: EASE.glide, stagger: 0.08 })
  }

  const title = from ? t.notifications.giftReveal.fromMember(partyName(from, t.trades.anonymous)) : t.notifications.giftReveal.fromTeam

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[96] flex flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-10 text-center">
      <div data-gift-backdrop aria-hidden className="fixed inset-0 bg-void/95" style={{ backgroundImage: `radial-gradient(closest-side at 50% 45%, ${color}40, transparent 70%)` }} />
      <ParticleBurst burst={burst} />

      <header data-gift-title className="relative flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-gold uppercase">
          <Gift size={12} aria-hidden />
          {t.notifications.giftReveal.eyebrow}
        </span>
        <h2 className="font-display text-3xl leading-tight text-cream">{title}</h2>
      </header>

      <button type="button" data-gift-card onClick={flip} aria-label={revealed ? card.name : t.notifications.giftReveal.tap} className="relative" style={{ perspective: 1000 }}>
        <span data-gift-float className="block">
          <span ref={flipRef} data-face="back" className="group block" style={{ width, height: Math.round(width * CARD_RATIO), transformStyle: 'preserve-3d' }}>
            {revealed ? (
              <CollectibleCard card={card} width={width} interactive gyro lazy={false} />
            ) : (
              <span className="block" style={{ filter: `drop-shadow(0 0 28px ${color}aa)` }}>
                <CardBack width={width} />
              </span>
            )}
          </span>
        </span>
      </button>

      {!revealed && <p className="relative animate-pulse text-xs tracking-[0.2em] text-cream/60 uppercase">{t.notifications.giftReveal.tap}</p>}

      {revealed && (
        <div className="relative flex w-full max-w-sm flex-col items-center gap-4">
          {message && (
            <p data-gift-after className="rounded-2xl border border-white/10 bg-ink/95 px-4 py-3 text-sm text-cream/90 italic">
              « {message} »
            </p>
          )}
          <div data-gift-after className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => {
                onDone()
                openActivity('collection')
              }}
              className="h-12 flex-1 rounded-full bg-white/10 text-sm font-semibold text-cream"
            >
              {t.notifications.giftReveal.album}
            </button>
            <button type="button" onClick={onDone} className="h-12 flex-1 rounded-full bg-cream text-sm font-semibold text-void">
              {left > 0 ? t.notifications.giftReveal.next(left) : t.notifications.giftReveal.thanks}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Cartes montrées par un membre : face cachée en rangée, chacune se retourne d'un toucher. */
function ShareReveal({ share, left, onDone }: { share: ShareNotification; left: number; onDone: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(() => new Set())
  const [burst, setBurst] = useState<Burst | null>(null)
  const { cards, by, message } = share.data
  const best = cards.reduce((top, card) => (rarityRank(card.rarity) > rarityRank(top.rarity) ? card : top), cards[0]!)
  const color = RARITY_STYLE[best.rarity].color
  const all = flipped.size >= cards.length
  // Une rangée tant que ça tient ; au-delà de 4, deux rangées.
  const columns = Math.min(cards.length, 4)
  const width = Math.min(cards.length === 1 ? 220 : 150, Math.floor((Math.min(window.innerWidth, 640) - 48 - (columns - 1) * 12) / columns))
  const title = t.notifications.shareReveal.title(partyName(by, t.trades.anonymous), cards.length)
  useGSAP(
    () => {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      gsap.fromTo('[data-gift-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 })
      gsap.fromTo('[data-gift-title]', { y: -18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.15, ease: EASE.glide })
      gsap.fromTo('[data-share-card]', { y: 120, scale: 0.6, rotation: -10, autoAlpha: 0 }, { y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.8, delay: 0.25, ease: EASE.spring, stagger: 0.08 })
      if (!still) gsap.to('[data-gift-float]', { y: -8, duration: 1.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1, stagger: 0.2 })
    },
    { scope: rootRef },
  )

  /** Cartes retournées, lues par les minuteurs de « Tout retourner » (l'état React y serait périmé). */
  const turned = useRef<Set<number>>(new Set())
  const flip = (index: number) => {
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-share-flip="${index}"]`)
    if (turned.current.has(index) || !node) return
    turned.current.add(index)
    const card = cards[index]!
    setFlipped(new Set(turned.current))
    playFlip()
    vibrate(12)
    gsap
      .timeline()
      .to(node, { rotationY: 90, scale: 1.08, duration: 0.24, ease: 'power2.in' })
      .add(() => {
        node.setAttribute('data-face', 'front')
        playReveal(card.rarity)
        const box = node.getBoundingClientRect()
        const tier = rarityRank(card.rarity)
        if (tier >= 1) setBurst({ id: Date.now() + index, x: box.left + box.width / 2, y: box.top + box.height / 2, colors: [RARITY_STYLE[card.rarity].color, '#fff4c8', '#ffffff'], count: 30 + tier * 25, spread: Math.PI * 2 })
      })
      .to(node, { rotationY: 0, scale: 1, duration: 0.45, ease: EASE.snap })
    // Les boutons de fin n'existent qu'au rendu suivant : on les anime juste après.
    if (turned.current.size >= cards.length) {
      window.setTimeout(() => {
        const after = rootRef.current?.querySelectorAll('[data-gift-after]')
        if (after?.length) gsap.fromTo(after, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.5, ease: EASE.glide, stagger: 0.08 })
      }, 0)
    }
  }

  const flipAll = () => cards.forEach((_, index) => window.setTimeout(() => flip(index), index * 260))

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[96] flex flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-10 text-center">
      <div data-gift-backdrop aria-hidden className="fixed inset-0 bg-void/95" style={{ backgroundImage: `radial-gradient(closest-side at 50% 45%, ${color}38, transparent 70%)` }} />
      <ParticleBurst burst={burst} />

      <header data-gift-title className="relative flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-glow/15 px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-glow uppercase">
          <Megaphone size={12} aria-hidden />
          {t.notifications.shareReveal.eyebrow}
        </span>
        <h2 className="font-display text-3xl leading-tight text-cream">{title}</h2>
      </header>

      <div className="relative grid justify-center gap-3" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, perspective: 1000 }}>
        {cards.map((card, index) => {
          const shown = flipped.has(index)
          return (
            <button
              key={`${card.id}-${index}`}
              type="button"
              data-share-card
              onClick={() => flip(index)}
              aria-label={shown ? card.name : t.notifications.shareReveal.tap}
              className="relative"
            >
              <span data-gift-float className="block">
                <span data-share-flip={index} data-face="back" className="group block" style={{ width, height: Math.round(width * CARD_RATIO), transformStyle: 'preserve-3d' }}>
                  {shown ? (
                    <CollectibleCard card={card} width={width} interactive gyro={cards.length === 1} lazy={false} />
                  ) : (
                    <span className="block" style={{ filter: `drop-shadow(0 0 18px ${RARITY_STYLE[card.rarity].color}88)` }}>
                      <CardBack width={width} />
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {!all && (
        <div className="relative flex flex-col items-center gap-3">
          <p className="animate-pulse text-xs tracking-[0.2em] text-cream/60 uppercase">{t.notifications.shareReveal.tap}</p>
          {cards.length > 1 && (
            <button type="button" onClick={flipAll} className="rounded-full border border-[#ffe39a]/30 px-4 py-2 text-xs text-[#fff4c8] hover:bg-[#ffe39a]/10">
              {t.notifications.shareReveal.revealAll}
            </button>
          )}
        </div>
      )}

      {all && (
        <div className="relative flex w-full max-w-sm flex-col items-center gap-4">
          {message && (
            <p data-gift-after className="rounded-2xl border border-white/10 bg-ink/95 px-4 py-3 text-sm text-cream/90 italic">
              « {message} »
            </p>
          )}
          <button data-gift-after type="button" onClick={onDone} className="h-12 w-full rounded-full bg-cream text-sm font-semibold text-void">
            {left > 0 ? t.notifications.shareReveal.next(left) : t.notifications.shareReveal.cheer}
          </button>
        </div>
      )}
    </div>
  )
}
