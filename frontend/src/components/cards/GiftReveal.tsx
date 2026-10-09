import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playFlip, playReveal } from '../../lib/sfx'
import { partyName } from '../../lib/trades'
import type { AppNotification } from '../../services/notificationsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useNotificationStore } from '../../store/useNotificationStore'
import { useUiStore } from '../../store/useUiStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { CardBack } from './CardBack'
import { CARD_RATIO, CollectibleCard } from './CollectibleCard'

type GiftNotification = Extract<AppNotification, { type: 'card_gift' }>

/**
 * La surprise d'un cadeau de carte : à la visite suivante, la carte reçue (d'un membre ou
 * de l'équipe) arrive en plein écran, face cachée ; un toucher la retourne, dans une gerbe
 * de confettis aux couleurs de sa rareté. Une par une s'il y en a plusieurs ; vue = lue.
 */
export function GiftReveal() {
  const signedIn = useAuthStore((state) => state.user !== null)
  const items = useNotificationStore((state) => state.items)
  const markRead = useNotificationStore((state) => state.markRead)
  // Déjà montrées pendant cette visite (le temps que la lecture remonte au serveur).
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  const pending = useMemo(
    () =>
      items
        .filter((item): item is GiftNotification => item.type === 'card_gift' && !item.read && !shown.has(item.id))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [items, shown],
  )
  const current = signedIn ? pending[0] : undefined
  if (!current) return null
  const done = (id: string) => {
    setShown((set) => new Set(set).add(id))
    markRead([id])
  }
  return createPortal(<Reveal key={current.id} gift={current} left={pending.length - 1} onDone={() => done(current.id)} />, document.body)
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
