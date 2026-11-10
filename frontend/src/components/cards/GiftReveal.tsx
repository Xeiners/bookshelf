import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FastForward, Gift, Megaphone } from 'lucide-react'
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
 * des notifications, une présentation déjà vue se rejoue. « Tout passer » marque d'un coup
 * toutes les surprises en attente comme vues et montre leurs cartes, face visible, en récap.
 */
export function GiftReveal() {
  const signedIn = useAuthStore((state) => state.user !== null)
  const items = useNotificationStore((state) => state.items)
  const markRead = useNotificationStore((state) => state.markRead)
  const replaying = useShowcaseStore((state) => state.replaying)
  const clearReplay = useShowcaseStore((state) => state.clear)
  const collectionChanged = useBoosterStore((state) => state.collectionChanged)
  // Déjà montrées pendant cette visite (le temps que la lecture remonte au serveur).
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  /** « Tout passer » : les surprises passées, montrées d'un coup en récap. */
  const [recap, setRecap] = useState<Surprise[] | null>(null)
  const pending = useMemo(
    () =>
      items
        .filter((item): item is Surprise => (item.type === 'card_gift' || item.type === 'card_share') && !item.read && !shown.has(item.id))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [items, shown],
  )
  const replay = replaying ? items.find((item): item is ShareNotification => item.id === replaying && item.type === 'card_share') : undefined
  const current = signedIn ? (replay ?? pending[0]) : undefined
  if (recap) return createPortal(<SurpriseRecap items={recap} onClose={() => setRecap(null)} />, document.body)
  if (!current) return null
  const left = replay ? 0 : pending.length - 1
  const done = (id: string) => {
    setShown((set) => new Set(set).add(id))
    markRead([id])
    if (replay) clearReplay()
  }
  /** Toutes les surprises en attente vues d'un coup : leurs cartes en récap. */
  const skip = () => {
    const skipped = replay ? [replay] : pending
    vibrate(10)
    setShown((set) => new Set([...set, ...skipped.map((item) => item.id)]))
    markRead(skipped.map((item) => item.id))
    if (skipped.some((item) => item.type === 'card_gift')) collectionChanged()
    if (replay) clearReplay()
    setRecap(skipped)
  }
  return createPortal(
    <>
      {current.type === 'card_share' ? (
        <ShareReveal key={current.id} share={current} left={left} onDone={() => done(current.id)} />
      ) : (
        <Reveal key={current.id} gift={current} left={left} onDone={() => done(current.id)} />
      )}
      <SkipButton count={left + 1} onSkip={skip} />
    </>,
    document.body,
  )
}

function Reveal({ gift, left, onDone }: { gift: GiftNotification; left: number; onDone: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const flipRef = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)
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
      })
      .to(flipRef.current, { rotationY: 0, scale: 1, duration: 0.5, ease: EASE.snap })
    gsap.fromTo('[data-gift-after]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.7, ease: EASE.glide, stagger: 0.08 })
  }

  const title = from ? t.notifications.giftReveal.fromMember(partyName(from, t.trades.anonymous)) : t.notifications.giftReveal.fromTeam

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[96] flex flex-col items-center justify-center gap-7 overflow-y-auto px-6 py-10 text-center">
      <div data-gift-backdrop aria-hidden className="fixed inset-0 bg-void/95" style={{ backgroundImage: `radial-gradient(closest-side at 50% 45%, ${color}40, transparent 70%)` }} />

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
              <span className="block">
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
                    <span className="block">
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

/** « Tout passer » : en haut à droite, au-dessus de la surprise en cours. */
function SkipButton({ count, onSkip }: { count: number; onSkip: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onSkip}
      className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-[97] inline-flex items-center gap-1.5 rounded-full border border-[#ffe39a]/30 bg-black/60 px-3.5 py-2 text-xs font-semibold text-[#fff4c8] tabular-nums hover:bg-[#ffe39a]/10"
    >
      <FastForward size={14} aria-hidden />
      {t.notifications.surpriseRecap.skip(count)}
    </button>
  )
}

/** Cartes affichées à la fois dans le récap ; « Voir plus » en ajoute autant. */
const RECAP_PAGE = 48

/**
 * Récap des surprises passées : toutes leurs cartes, face visible, en grille, chacune avec
 * qui l'a montrée (ou offerte). Rien à retourner, rien à valider une par une.
 */
function SurpriseRecap({ items, onClose }: { items: Surprise[]; onClose: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(RECAP_PAGE)
  const entries = useMemo(
    () =>
      items.flatMap((item) =>
        item.type === 'card_share'
          ? item.data.cards.map((card, index) => ({ key: `${item.id}-${index}`, card, from: t.notifications.surpriseRecap.from(partyName(item.data.by, t.trades.anonymous)) }))
          : [
              {
                key: item.id,
                card: item.data.card,
                from: item.data.from ? t.notifications.surpriseRecap.from(partyName(item.data.from, t.trades.anonymous)) : t.notifications.surpriseRecap.fromTeam,
              },
            ],
      ),
    [items, t],
  )
  const gap = 10
  const columns = Math.max(2, Math.min(6, Math.floor((Math.min(window.innerWidth, 760) - 48 + gap) / (96 + gap))))
  const width = Math.min(150, Math.floor((Math.min(window.innerWidth, 760) - 48 - (columns - 1) * gap) / columns))
  const title = t.notifications.surpriseRecap.title(entries.length)

  useGSAP(
    () => {
      gsap.fromTo('[data-recap-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 })
      gsap.fromTo('[data-recap-card]', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, ease: EASE.glide, stagger: Math.min(0.03, 0.6 / Math.max(1, Math.min(entries.length, RECAP_PAGE))) })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[96] flex flex-col overflow-y-auto px-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-center">
      <div data-recap-backdrop aria-hidden className="fixed inset-0 bg-void/95" />
      <header className="relative flex flex-col items-center gap-2 pb-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-glow/15 px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-glow uppercase">
          <Megaphone size={12} aria-hidden />
          {t.notifications.surpriseRecap.eyebrow}
        </span>
        <h2 className="font-display text-3xl leading-tight text-cream">{title}</h2>
      </header>
      <ul className="relative mx-auto grid justify-center" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, gap }}>
        {entries.slice(0, limit).map((entry) => (
          <li key={entry.key} data-recap-card className="flex flex-col items-center gap-1.5">
            <CollectibleCard card={entry.card} width={width} />
            <span className="w-full truncate text-[11px] text-cream/60">{entry.from}</span>
          </li>
        ))}
      </ul>
      {entries.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + RECAP_PAGE)} className="relative mx-auto mt-5 rounded-full border border-[#ffe39a]/30 px-4 py-2 text-xs text-[#fff4c8] hover:bg-[#ffe39a]/10">
          {t.notifications.surpriseRecap.more(entries.length - limit)}
        </button>
      )}
      {/* Toujours à portée de pouce, même au milieu d'une longue liste. */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-void via-void/90 to-transparent pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} className="mx-auto h-12 w-full max-w-sm rounded-full bg-cream text-sm font-semibold text-void">
          {t.notifications.surpriseRecap.close}
        </button>
      </div>
    </div>
  )
}
