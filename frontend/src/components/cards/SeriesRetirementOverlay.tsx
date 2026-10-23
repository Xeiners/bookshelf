import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITIES, RARITY_STYLE, rarityRank } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playChime, playGlint, playReveal } from '../../lib/sfx'
import type { RetiredCard, SeriesRetirement } from '../../services/cardsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useRetirementStore } from '../../store/useRetirementStore'
import { STARDUST_GRADIENT } from '../dle/dleStyle'

/** Poussières qui s'échappent de chaque carte vers l'orbe. */
const MOTES_PER_CARD = 7

/**
 * Retrait des Séries 1 et 2, à monter une fois dans `App` : interroge le serveur pour le compte
 * connecté et, s'il a eu des cartes converties, joue leur conversion en Poussières.
 */
export function SeriesRetirementGate() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const retirement = useRetirementStore((state) => state.retirement)

  useEffect(() => {
    if (accountId) void useRetirementStore.getState().load(accountId)
    else useRetirementStore.getState().reset()
  }, [accountId])

  if (!retirement) return null
  return <SeriesRetirementOverlay retirement={retirement} />
}

/**
 * La conversion, en plein écran : le titre, puis le mur des cartes retirées (les plus rares) ;
 * une à une — les plus communes d'abord, les Mythiques pour finir — elles s'illuminent et se
 * dissolvent en Poussières qui filent vers l'orbe, dont le compteur monte. Puis le bilan par
 * rareté, le total et le nouveau solde. « Passer » mène droit au bilan.
 *
 * Les Poussières sont DÉJÀ sur le compte (le serveur a tout converti) : l'animation ne fait que
 * le montrer, et ne disparaît qu'une fois vue jusqu'au bout (sinon elle revient, sans rien
 * recréditer).
 */
function SeriesRetirementOverlay({ retirement }: { retirement: SeriesRetirement }) {
  const t = useT()
  const copy = t.retirement
  const rootRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef<HTMLSpanElement>(null)
  const timeline = useRef<gsap.core.Timeline | null>(null)
  const [done, setDone] = useState(false)
  const [compact] = useState(() => window.innerWidth < 640)
  // Le mur : assez de cartes pour impressionner, sans déborder d'un téléphone.
  const shown = retirement.highlights.slice(0, compact ? 18 : 27)
  const hidden = Math.max(0, retirement.cards - shown.length)
  const cardWidth = compact ? 52 : 70

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') timeline.current?.progress(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useGSAP(
    () => {
      const root = rootRef.current
      const counter = counterRef.current
      if (!root || !counter) return
      const total = retirement.stardust
      const tally = { value: 0 }
      const writeCounter = () => (counter.textContent = `+${Math.round(tally.value).toLocaleString()}`)
      writeCounter()

      const cards = gsap.utils.toArray<HTMLElement>('[data-retired-card]', root)
      // Les plus communes se dissolvent d'abord : les grandes cartes ferment la marche.
      const order = [...cards].reverse()
      const step = Math.max(0.05, Math.min(0.16, 3.2 / Math.max(1, order.length)))
      const dissolveAt = 1.9
      const dissolveEnd = dissolveAt + step * Math.max(0, order.length - 1) + 0.9

      const motes = (card: HTMLElement) => {
        const orb = root.querySelector<HTMLElement>('[data-orb]')
        if (!orb) return
        const base = root.getBoundingClientRect()
        const from = card.getBoundingClientRect()
        const to = orb.getBoundingClientRect()
        const rarity = card.dataset.rarity as keyof typeof RARITY_STYLE | undefined
        const tint = rarity ? RARITY_STYLE[rarity].color : '#ffc46b'
        for (let index = 0; index < MOTES_PER_CARD; index += 1) {
          const mote = document.createElement('span')
          mote.className = 'pointer-events-none absolute left-0 top-0 rounded-full' // i18n-ignore
          const size = 3 + Math.random() * 4
          Object.assign(mote.style, {
            width: `${size}px`,
            height: `${size}px`,
            background: index % 2 ? '#fff4c8' : tint,
            boxShadow: `0 0 8px ${tint}`,
          })
          root.appendChild(mote)
          const x0 = from.left - base.left + from.width * (0.2 + Math.random() * 0.6)
          const y0 = from.top - base.top + from.height * (0.2 + Math.random() * 0.6)
          const x1 = to.left - base.left + to.width / 2 + (Math.random() - 0.5) * 18
          const y1 = to.top - base.top + to.height / 2 + (Math.random() - 0.5) * 18
          // Une courbe : chaque grain s'écarte un peu avant de plonger vers l'orbe.
          const bend = (Math.random() - 0.5) * 160
          gsap.fromTo(
            mote,
            { x: x0, y: y0, scale: 1, autoAlpha: 1 },
            {
              keyframes: [
                { x: (x0 + x1) / 2 + bend, y: Math.min(y0, y1) - 30 - Math.random() * 60, duration: 0.45, ease: 'sine.out' },
                { x: x1, y: y1, scale: 0.4, duration: 0.5, ease: 'power2.in' },
                { autoAlpha: 0, duration: 0.12 },
              ],
              delay: Math.random() * 0.12,
              onComplete: () => mote.remove(),
            },
          )
        }
      }

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const tl = gsap.timeline({
        onComplete: () => {
          tally.value = total
          writeCounter()
          setDone(true)
        },
      })
      timeline.current = tl
      tl.fromTo('[data-retire-head]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, stagger: 0.12, ease: EASE.glide })
        .fromTo('[data-orb]', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8, ease: 'back.out(1.6)' }, 0.3)
        .fromTo(cards, { y: 24, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, stagger: { each: 0.025, from: 'random' }, ease: 'back.out(1.5)' }, 0.5)
        .add(() => playChime(false), 0.5)
        // Le compteur monte tout au long des dissolutions, et finit pile au total.
        .to(tally, { value: total, duration: dissolveEnd - dissolveAt, ease: 'power1.in', onUpdate: writeCounter }, dissolveAt + 0.3)
      order.forEach((card, index) => {
        const at = dissolveAt + index * step
        const rank = Number(card.dataset.rank ?? 0)
        tl.add(() => {
          motes(card)
          if (index % 3 === 0 || rank >= 3) playGlint()
          if (rank >= 3) vibrate(18)
        }, at)
          .to(card, { scale: 1.12, filter: 'brightness(1.9) saturate(1.4)', duration: 0.18, ease: 'sine.out' }, at)
          .to(card, { scale: 0.2, autoAlpha: 0, filter: 'brightness(3) blur(6px)', rotation: (Math.random() - 0.5) * 30, duration: 0.45, ease: 'power2.in' }, at + 0.18)
          .to('[data-orb]', { scale: 1.06 + Math.min(0.12, rank * 0.03), duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut' }, at + 0.85)
      })
      tl.add(() => {
        playReveal(retirement.byRarity.MYTHIC.copies > 0 ? 'MYTHIC' : 'LEGENDARY')
        vibrate([40, 30, 90])
      }, dissolveEnd)
        .fromTo('[data-orb-ring]', { scale: 0.6, autoAlpha: 0.9 }, { scale: 2.6, autoAlpha: 0, duration: 0.9, ease: 'power2.out' }, dissolveEnd)
        .to('[data-wall]', { height: 0, marginTop: 0, marginBottom: 0, duration: 0.5, ease: 'power2.inOut' }, dissolveEnd)
        .set('[data-summary-wrap]', { display: 'flex' }, dissolveEnd + 0.2)
        .fromTo('[data-retire-summary]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.08, ease: EASE.glide }, dissolveEnd + 0.25)
      if (reduced) tl.progress(1)
    },
    { scope: rootRef },
  )

  const finish = () => {
    vibrate(10)
    void useRetirementStore.getState().acknowledge()
  }

  const rows = [...RARITIES].reverse().filter((rarity) => retirement.byRarity[rarity].copies > 0)

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      className="fixed inset-0 z-[120] flex flex-col items-center overflow-x-hidden overflow-y-auto bg-[#07050d] px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-cream select-none"
    >
      {/* Fond : brume d'étoiles et lueur des Poussières, sous l'orbe. */}
      <div aria-hidden className="pointer-events-none fixed inset-0" style={{ background: 'radial-gradient(60% 45% at 50% 78%, #ff5ec433, transparent 70%), radial-gradient(50% 40% at 50% 20%, #7c5cff26, transparent 70%)' }} />

      <div className="relative flex w-full max-w-3xl flex-1 flex-col items-center justify-center">
        <div className="absolute top-0 right-0 flex justify-end">
          {!done && (
            <button type="button" onClick={() => timeline.current?.progress(1)} className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs font-semibold tracking-[0.12em] text-cream/75 uppercase">
              {copy.skip}
            </button>
          )}
        </div>

        <p data-retire-head className="mt-10 text-[11px] font-semibold tracking-[0.3em] text-[#ff9ad8] uppercase">
          {copy.eyebrow}
        </p>
        <h2 data-retire-head className="mt-2 max-w-xl text-center font-display text-3xl leading-tight sm:text-4xl">
          {copy.title}
        </h2>
        <p data-retire-head className="mt-3 max-w-lg text-center text-sm leading-relaxed text-cream/70">
          {copy.body(retirement.cards, retirement.copies)}
        </p>

        {/* Le mur des cartes retirées. */}
        <div data-wall className="my-6 flex max-w-3xl flex-wrap justify-center gap-2 overflow-hidden sm:gap-2.5">
          {shown.map((card) => (
            <RetiredCardTile key={card.id} card={card} width={cardWidth} />
          ))}
        </div>

        {/* L'orbe des Poussières et son compteur. */}
        <div className="relative flex flex-col items-center gap-3 pt-2">
          <div data-orb className="relative grid size-28 place-items-center rounded-full sm:size-32" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 60px -6px #ff5ec4, 0 0 120px -30px #ffc46b, inset 0 0 30px rgba(255,255,255,0.45)' }}>
            <span data-orb-ring aria-hidden className="absolute inset-0 rounded-full border-2 border-[#fff4c8] opacity-0" />
            <Sparkles size={34} className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.9)]" aria-hidden />
          </div>
          <p className="flex items-baseline gap-1.5 font-display text-4xl tabular-nums sm:text-5xl" aria-live="polite">
            <span ref={counterRef} />
            <span className="text-2xl text-[#ffc46b]">✦</span>
          </p>
          <p className="-mt-2 text-[11px] font-semibold tracking-[0.2em] text-cream/55 uppercase">{copy.gained}</p>
        </div>

        {/* Le bilan, une fois la conversion faite. */}
        {/* Hors du flux tant qu'il est invisible : l'orbe reste à l'écran pendant la conversion. */}
        <div data-summary-wrap className="mt-5 hidden w-full max-w-sm flex-col gap-2">
          {rows.map((rarity) => (
            <div key={rarity} data-retire-summary className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 opacity-0">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: RARITY_STYLE[rarity].color, boxShadow: `0 0 10px ${RARITY_STYLE[rarity].color}` }} />
              <span className="flex-1 text-sm font-semibold">{t.cards.rarity[rarity]}</span>
              <span className="text-xs text-cream/55 tabular-nums">{copy.copies(retirement.byRarity[rarity].copies)}</span>
              <span className="w-20 text-right text-sm font-bold text-[#ffc46b] tabular-nums">+{retirement.byRarity[rarity].stardust.toLocaleString()} ✦</span>
            </div>
          ))}
          {hidden > 0 && (
            <p data-retire-summary className="text-center text-xs text-cream/50 opacity-0">
              {copy.more(hidden)}
            </p>
          )}
          <p data-retire-summary className="mt-1 text-center text-sm text-cream/75 tabular-nums opacity-0">
            {copy.balance(retirement.balance)}
          </p>
          <button
            type="button"
            data-retire-summary
            onClick={finish}
            disabled={!done}
            className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-white opacity-0 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #ff5ec4, #7c5cff)', boxShadow: '0 10px 26px -10px rgba(255,94,196,0.9)' }}
          >
            {copy.cta}
          </button>
          <p data-retire-summary className="text-center text-[11px] leading-relaxed text-cream/45 opacity-0">
            {copy.note}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Une carte retirée, en petit : sa couverture, son liseré de rareté, ses exemplaires. */
function RetiredCardTile({ card, width }: { card: RetiredCard; width: number }) {
  const style = RARITY_STYLE[card.rarity]
  const rank = rarityRank(card.rarity)
  return (
    <div
      data-retired-card
      data-rarity={card.rarity}
      data-rank={rank}
      className="relative shrink-0 overflow-hidden rounded-lg opacity-0"
      style={{
        width,
        height: Math.round(width * 1.4),
        boxShadow: `0 0 0 2px ${style.color}, 0 0 ${rank >= 2 ? 16 : 6}px ${style.color}`,
        willChange: 'transform, filter',
      }}
    >
      <img src={card.imageUrl} alt="" loading="eager" decoding="async" className="h-full w-full object-cover" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
      {card.count > 1 && (
        <span className="absolute top-1 right-1 rounded-full bg-black/70 px-1.5 text-[9px] font-bold text-cream tabular-nums">×{card.count}</span>
      )}
    </div>
  )
}
