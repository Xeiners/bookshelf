import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Flame, Heart, Trophy, X } from 'lucide-react'
import { useT } from '../../i18n'
import { flameLevel, tierProgress } from '../../lib/higherLower'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playHlPress, playHlRight, playHlSlide, playHlTier, playHlWrong } from '../../lib/sfx'
import type { HlChoice, HlGuessResult } from '../../services/higherLowerApi'
import { hlSound, useHigherLowerStore } from '../../store/useHigherLowerStore'
import { DleBar } from '../dle/DleBar'
import { HlCard } from './HlCard'
import { SoundToggle } from './SoundToggle'
import { HL_DOWN, HL_GRADIENT, HL_UP, gradientText } from './hlStyle'

type Phase = 'choose' | 'reveal' | 'shift' | 'lost'

/** Couleur de la flamme selon la série : braise, feu, brasier, plasma. */
const FLAME_COLORS = ['#ffc46b', '#ff8a3d', '#ff5e8a', '#c86bff'] as const

const SPARKS = 10

/** Places de la grille : la référence en haut (à gauche sur grand écran), la carte à deviner en bas (à droite). */
const SLOT_CLASS = ['row-start-1 col-start-1', 'row-start-2 col-start-1 md:row-start-1 md:col-start-2'] as const // i18n-ignore

/**
 * Le duel. Une réponse se joue en trois temps : le compteur dévoile la valeur de la
 * carte B ; verdict (éclair, médaillon ✓ ou ✗, étincelles, secousse) ; si c'est juste,
 * B glisse à la place de A, qui s'efface, pendant qu'une nouvelle carte arrive.
 * L'état du store ne change qu'à la fin du glissement (`advance`) : les cartes gardent
 * leur clé (rang dans la partie), React réutilise leurs nœuds, aucun saut d'image.
 */
export function HlGame() {
  const t = useT()
  const run = useHigherLowerStore((state) => state.run)
  const tiers = useHigherLowerStore((state) => state.overview?.tiers ?? [])
  const best = useHigherLowerStore((state) => state.overview?.me.best ?? 0)
  const maxLives = useHigherLowerStore((state) => state.overview?.lives ?? 2)
  const guess = useHigherLowerStore((state) => state.guess)
  const advance = useHigherLowerStore((state) => state.advance)
  const finish = useHigherLowerStore((state) => state.finish)
  const quit = useHigherLowerStore((state) => state.quit)
  const rootRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('choose')
  const [answer, setAnswer] = useState<HlGuessResult | null>(null)
  const [error, setError] = useState(false)
  const [quitting, setQuitting] = useState(false)
  /** Cartes jouées : clé des cartes (une chance perdue fait avancer sans changer la série). */
  const [turn, setTurn] = useState(0)
  const { contextSafe } = useGSAP({ scope: rootRef })

  const streak = answer?.correct ? answer.streak : (run?.streak ?? 0)
  const verdict = answer && phase !== 'reveal' ? (answer.correct ? 'right' : 'wrong') : null
  const lives = answer && phase !== 'reveal' ? answer.lives : (run?.lives ?? 0)
  const level = flameLevel(streak)
  const progress = tierProgress(streak, tiers)

  const choose = useCallback(
    (choice: HlChoice) => {
      if (phase !== 'choose' || !run) return
      vibrate(10)
      hlSound(() => playHlPress(choice))
      setError(false)
      setPhase('reveal')
      guess(choice)
        .then(setAnswer)
        .catch(() => {
          setPhase('choose')
          setError(true)
        })
    },
    [phase, run, guess],
  )

  // Au clavier : ↑ plus haut, ↓ plus bas.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') choose('higher')
      else if (event.key === 'ArrowDown') choose('lower')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose])

  // Entrée des deux premières cartes.
  useGSAP(
    () => {
      gsap.fromTo('[data-hl-card]', { y: 30, autoAlpha: 0, scale: 0.96 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.6, stagger: 0.1, ease: EASE.glide })
      gsap.fromTo('[data-hl-orb]', { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.7, delay: 0.25, ease: EASE.snap })
    },
    { scope: rootRef },
  )

  // La série grimpe : le compteur bondit.
  useGSAP(
    () => {
      if (streak > 0) gsap.fromTo('[data-hl-streak]', { scale: 1.6 }, { scale: 1, duration: 0.5, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [streak] },
  )

  /** Valeur dévoilée : verdict, puis glissement ou fin de partie. */
  const onRevealed = contextSafe(() => {
    if (!answer) return
    if (answer.correct) {
      vibrate([8, 40, 14])
      hlSound(() => playHlRight(answer.streak))
      // Palier de récompense franchi : carillon en plus.
      if (tiers.some((tier) => tier.streak === answer.streak)) gsap.delayedCall(0.3, () => hlSound(playHlTier))
      setPhase('shift')
      gsap.fromTo('[data-hl-slot="1"] [data-hl-flash]', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.9, ease: 'power2.out' })
      gsap.fromTo('[data-hl-orb]', { scale: 1.35 }, { scale: 1, duration: 0.6, ease: EASE.snap })
      gsap.utils.toArray<HTMLElement>('[data-hl-spark]').forEach((spark, index) => {
        const angle = (index / SPARKS) * Math.PI * 2 + Math.random() * 0.4
        const distance = 60 + Math.random() * 50
        gsap.fromTo(
          spark,
          { x: 0, y: 0, scale: 1, autoAlpha: 1 },
          { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, scale: 0.2, autoAlpha: 0, duration: 0.75, ease: 'power2.out' },
        )
      })
    } else if (!answer.result) {
      // Erreur pardonnée : une chance part (le cœur se brise), puis la partie continue.
      vibrate([30, 60, 30])
      hlSound(playHlWrong)
      setPhase('shift')
      gsap.fromTo('[data-hl-slot="1"] [data-hl-flash]', { autoAlpha: 1 }, { autoAlpha: 0, duration: 1.1 })
      gsap.to('[data-hl-slot="1"]', { keyframes: { x: [0, -12, 11, -8, 6, -3, 0] }, duration: 0.5, ease: 'power1.inOut' })
      gsap.fromTo('[data-hl-orb]', { scale: 1.3, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.6, ease: EASE.snap })
      gsap.fromTo(`[data-hl-heart="${answer.lives}"]`, { scale: 1.8, rotation: -25 }, { scale: 1, rotation: 0, duration: 0.6, ease: EASE.snap })
      gsap.fromTo('[data-hl-lifelost]', { y: 6, autoAlpha: 0 }, { y: -4, autoAlpha: 1, duration: 0.35, ease: EASE.swift })
    } else {
      vibrate([30, 60, 30])
      hlSound(playHlWrong)
      setPhase('lost')
      gsap.fromTo('[data-hl-slot="1"] [data-hl-flash]', { autoAlpha: 1 }, { autoAlpha: 0.6, duration: 1.2 })
      gsap.to('[data-hl-slot="1"]', { keyframes: { x: [0, -12, 11, -8, 6, -3, 0] }, duration: 0.5, ease: 'power1.inOut' })
      gsap.fromTo('[data-hl-orb]', { scale: 1.3, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.6, ease: EASE.snap })
      const result = answer.result
      const current = run?.current
      const next = run?.next
      gsap.delayedCall(1.5, () => {
        if (result && current && next) finish(result, { current, next: { ...next, value: answer.value } })
      })
    }
  })

  // Glissement : B prend la place de A, A s'efface, la nouvelle carte arrive de l'autre côté.
  useGSAP(
    () => {
      if (phase !== 'shift' || !answer) return
      const root = rootRef.current
      const a = root?.querySelector<HTMLElement>('[data-hl-slot="0"]')
      const b = root?.querySelector<HTMLElement>('[data-hl-slot="1"]:not([data-hl-incoming])')
      const c = root?.querySelector<HTMLElement>('[data-hl-incoming]')
      if (!a || !b) return
      const from = b.getBoundingClientRect()
      const to = a.getBoundingClientRect()
      const dx = to.left - from.left
      const dy = to.top - from.top
      const timeline = gsap.timeline({
        // Une chance perdue : le temps de voir la bonne valeur en rouge.
        delay: answer.correct ? 0.55 : 1.1,
        onStart: () => hlSound(playHlSlide),
        onComplete: () => {
          if (answer.next) {
            advance(answer)
            setTurn((value) => value + 1)
          }
          setAnswer(null)
          setPhase('choose')
          // Plus de carte à tirer (catégorie épuisée) : la partie est finie, gagnante.
          if (!answer.next && answer.result && run) finish(answer.result, { current: run.current, next: { ...run.next, value: answer.value } })
        },
      })
      timeline.to(a, { x: dx, y: dy, scale: 0.88, autoAlpha: 0, duration: 0.5, ease: EASE.exit }, 0)
      timeline.to(b, { x: dx, y: dy, duration: 0.7, ease: 'power3.inOut' }, 0)
      if (c) timeline.fromTo(c, { x: -dx, y: -dy, autoAlpha: 0, scale: 0.94 }, { x: 0, y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0.12)
    },
    { scope: rootRef, dependencies: [phase] },
  )

  // Après `advance`, les cartes ont changé de place dans la grille : on efface les décalages du glissement.
  const shownTurn = useRef(turn)
  useLayoutEffect(() => {
    if (shownTurn.current === turn) return
    shownTurn.current = turn
    if (rootRef.current) gsap.set(rootRef.current.querySelectorAll('[data-hl-slot]'), { clearProps: 'transform,opacity,visibility' })
  }, [turn])

  if (!run) return null

  const cards = [
    { key: turn, card: run.current, slot: 0, role: 'current' as const },
    { key: turn + 1, card: run.next, slot: 1, role: 'next' as const },
    ...(phase === 'shift' && answer?.next ? [{ key: turn + 2, card: answer.next, slot: 1, role: 'next' as const, incoming: true }] : []),
  ]

  const onQuit = () => {
    if (quitting) return
    setQuitting(true)
    void quit().finally(() => setQuitting(false))
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.hl.quit} onBack={onQuit} danger={streak > 0}>
        <SoundToggle />
        {/* Chances : un cœur par erreur encore permise. */}
        <span className="inline-flex items-center gap-0.5" aria-label={t.hl.livesAria(lives)}>
          {Array.from({ length: maxLives }, (_, index) => (
            <span key={index} data-hl-heart={index} className="grid will-change-transform">
              <Heart size={16} className={index < lives ? 'fill-[#ff5e8a] text-[#ff5e8a]' : 'text-cream/25'} aria-hidden />
            </span>
          ))}
        </span>
        {best > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-cream/70 tabular-nums" title={t.hl.best}>
            <Trophy size={12} className="text-gold" aria-hidden />
            {Math.max(best, streak)}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1.5 rounded-full border bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums"
          style={{ borderColor: `${FLAME_COLORS[level]}66`, color: FLAME_COLORS[level], boxShadow: level > 0 ? `0 0 18px -4px ${FLAME_COLORS[level]}` : undefined }}
          aria-label={`${t.hl.streak} ${streak}`}
        >
          <Flame size={15} className={level > 0 ? 'fill-current' : ''} aria-hidden />
          <span data-hl-streak className="inline-block will-change-transform">
            {streak}
          </span>
        </span>
      </DleBar>

      {/* Palier suivant : de quoi viser la prochaine récompense. */}
      <div className="mx-auto flex w-full max-w-5xl shrink-0 items-center gap-3 px-5 pb-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
          <div className="h-full origin-left rounded-full transition-transform duration-700" style={{ background: HL_GRADIENT, transform: `scaleX(${progress.ratio})` }} />
        </div>
        <span className="shrink-0 text-[11px] text-cream/60 tabular-nums">{progress.next ? t.hl.nextTier(progress.next.streak, progress.next.reward) : t.hl.maxTier}</span>
      </div>

      <div className="relative mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-rows-2 gap-3 px-4 pb-4 md:grid-cols-2 md:grid-rows-1 md:gap-6 md:px-6 md:pb-6">
        {cards.map((entry) => (
          <div
            key={entry.key}
            data-hl-card
            data-hl-slot={entry.slot}
            data-hl-incoming={'incoming' in entry ? true : undefined}
            className={`${SLOT_CLASS[entry.slot]} min-h-0 will-change-transform`}
            style={{ zIndex: 'incoming' in entry ? 1 : entry.slot === 1 ? 2 : 1 }}
          >
            <HlCard
              card={entry.card}
              metric={run.metric}
              role={entry.role}
              revealed={entry.slot === 1 && !('incoming' in entry) ? (answer?.value ?? null) : null}
              onRevealed={onRevealed}
              verdict={entry.slot === 1 && !('incoming' in entry) ? verdict : null}
              onChoose={choose}
              disabled={phase !== 'choose'}
            />
          </div>
        ))}

        {/* Médaillon entre les deux cartes : VS, puis le verdict. */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="relative grid place-items-center">
            {Array.from({ length: SPARKS }, (_, index) => (
              <span
                key={index}
                data-hl-spark
                aria-hidden
                className="absolute size-2 rounded-full opacity-0"
                style={{ background: index % 2 === 0 ? '#fff4c8' : HL_UP.color }}
              />
            ))}
            <div
              data-hl-orb
              className="grid size-16 place-items-center rounded-full border-2 md:size-20"
              style={{
                borderColor: verdict === 'right' ? HL_UP.color : verdict === 'wrong' ? HL_DOWN.color : 'rgba(255,255,255,0.25)',
                background:
                  verdict === 'right'
                    ? `radial-gradient(circle at 50% 35%, ${HL_UP.glow}, #06110d 70%)`
                    : verdict === 'wrong'
                      ? `radial-gradient(circle at 50% 35%, ${HL_DOWN.glow}, #14060b 70%)`
                      : 'radial-gradient(circle at 50% 35%, rgba(124,92,255,0.45), #08080f 70%)',
                boxShadow: `0 0 0 6px #050508, 0 0 30px -4px ${verdict === 'right' ? HL_UP.glow : verdict === 'wrong' ? HL_DOWN.glow : 'rgba(124,92,255,0.5)'}`,
              }}
            >
              {verdict === 'right' ? (
                <Check size={30} strokeWidth={3} style={{ color: HL_UP.color }} aria-label={t.hl.right} />
              ) : verdict === 'wrong' ? (
                <X size={30} strokeWidth={3} style={{ color: HL_DOWN.color }} aria-label={t.hl.wrong} />
              ) : (
                <span className="font-display text-xl md:text-2xl" style={gradientText(HL_GRADIENT)}>
                  {t.hl.vs}
                </span>
              )}
            </div>
            {verdict === 'wrong' && answer && !answer.result && (
              <span
                data-hl-lifelost
                className="absolute top-full mt-3 inline-flex items-center gap-1 rounded-full bg-[#050508] px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap opacity-0"
                style={{ color: HL_DOWN.color, boxShadow: `inset 0 0 0 1px ${HL_DOWN.color}55` }}
              >
                <Heart size={11} className="fill-current" aria-hidden />
                {t.hl.lifeLost}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="shrink-0 pb-3 text-center text-xs text-nope">{t.hl.guessError}</p>}
      <p className="hidden shrink-0 pb-3 text-center text-[10px] tracking-[0.2em] text-cream/30 uppercase md:block">{t.hl.keyboard}</p>
    </div>
  )
}
