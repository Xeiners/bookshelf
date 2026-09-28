import { useCallback, useEffect, useRef, useState } from 'react'
import { FlaskConical, Gift, X, Zap } from 'lucide-react'
import { useBoosters } from '../../hooks/useBoosters'
import { requestTiltPermission } from '../../hooks/useHoloTilt'
import { useT } from '../../i18n'
import { RARITIES, RARITY_STYLE, bestRarity, observedRate, type Rarity } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playTear } from '../../lib/sfx'
import { ApiError, isNetworkError } from '../../services/api'
import type { PulledCard } from '../../services/cardsApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useUiStore } from '../../store/useUiStore'
import { CardZoom } from '../cards/CardZoom'
import { BoosterOpeningAnimation } from './BoosterOpeningAnimation'
import { CardReveal } from './CardReveal'
import { ParticleBurst, type Burst } from './ParticleBurst'

/** `summoning` : le serveur tire le booster pendant que le paquet s'avance. */
type Stage = 'summoning' | 'intro' | 'tearing' | 'reveal' | 'done' | 'error'

/** Largeur des cartes révélées : trois de front, marges comprises (dès 370 px). */
const cardWidthFor = (viewport: number) => (viewport >= 900 ? 200 : viewport >= 640 ? 164 : Math.max(96, Math.floor((viewport - 32 - 24) / 3)))
const packWidthFor = (viewport: number) => Math.min(250, Math.round(viewport * 0.56))

/** Halo du paquet : seulement si une Épique (ou mieux) se cache dedans — sinon aucun indice. */
const haloFor = (cards: PulledCard[]): Rarity | null => {
  if (cards.length === 0) return null
  const best = bestRarity(cards.map((pulled) => pulled.card.rarity))
  return RARITY_STYLE[best].holo ? best : null
}

/**
 * Ouverture d'un booster, en plein écran : fond flouté sous une vignette très
 * sombre. Le serveur tire le booster dès l'ouverture de la fenêtre, pendant
 * que le paquet s'avance : son halo peut ainsi trahir une Légendaire (dorée)
 * ou une Mythique (irisée). Puis déchirure (glisser ou toucher), jaillissement
 * des cartes et révélation une à une, avec tremblement d'écran pour les grandes.
 *
 * Le booster est dépensé à l'ouverture de la fenêtre : la fermer avant la
 * déchirure ne perd rien, les cartes sont déjà dans l'album.
 */
export function BoosterPackModal() {
  const t = useT()
  const close = useUiStore((state) => state.closeBooster)
  const openActivity = useUiStore((state) => state.openActivity)
  const openAuth = useUiStore((state) => state.openAuth)
  const openBooster = useBoosterStore((state) => state.open)
  const tally = useBoosterStore((state) => state.tally)
  const boosters = useBoosters()

  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [stage, setStage] = useState<Stage>('summoning')
  const [round, setRound] = useState(0)
  const [cards, setCards] = useState<PulledCard[]>([])
  const [error, setError] = useState<string | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  /** Carte révélée affichée en grand, avec son résumé. */
  const [inspected, setInspected] = useState<PulledCard | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const busy = stage === 'tearing'
  useEffect(() => {
    // Carte ouverte en grand : Échap la ferme elle seule (elle a son propre écouteur).
    if (inspected) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close, inspected])

  const messageFor = useCallback(
    (reason: unknown) => {
      if (isNetworkError(reason)) return t.boosters.errors.offline
      if (reason instanceof ApiError && reason.status === 409) return useAuthStore.getState().user ? t.boosters.errors.empty : t.activities.guest.limit
      if (reason instanceof ApiError && reason.status === 503) return t.boosters.errors.notReady
      return t.boosters.errors.generic
    },
    [t],
  )

  /**
   * Dernier tirage demandé. Un tirage DÉPENSE un booster : il ne doit partir
   * qu'une fois par `round`, même si React rejoue l'effet (StrictMode en
   * développement monte, démonte et remonte chaque effet).
   */
  const requested = useRef(-1)

  // Tirage côté serveur à chaque nouveau booster (`round`), pendant que le paquet s'avance.
  useEffect(() => {
    if (requested.current === round) return
    requested.current = round
    const current = round
    // Invité : booster d'essai, tiré aussi par le serveur (reçu signé gardé sur l'appareil).
    openBooster(useAuthStore.getState().user ? 'account' : 'guest')
      .then((pulled) => {
        if (requested.current !== current) return
        setCards(pulled)
        setStage('intro')
      })
      .catch((reason: unknown) => {
        if (requested.current !== current) return
        setError(messageFor(reason))
        setStage('error')
      })
  }, [round, openBooster, messageFor])

  const { contextSafe } = useGSAP(
    () => {
      gsap.fromTo('[data-booster-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: 'power1.out' })
    },
    { scope: rootRef },
  )

  /** Tremblement d'écran : quelques secousses décroissantes, en `transform` seulement. */
  const shake = (intensity: number) =>
    contextSafe(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const steps = 9
      gsap.to('[data-shake]', {
        keyframes: [
          ...Array.from({ length: steps }, (_, index) => {
            const amplitude = intensity * (1 - index / steps)
            return {
              x: gsap.utils.random(-amplitude, amplitude),
              y: gsap.utils.random(-amplitude, amplitude),
              duration: 0.035,
            }
          }),
          { x: 0, y: 0, duration: 0.06 },
        ],
        ease: 'none',
      })
    })()

  const tear = () => {
    if (stage !== 'intro') return
    setStage('tearing')
    vibrate([15, 30, 25])
    playTear()
    requestTiltPermission()
  }

  /** Étincelles : petites gerbes au point de coupe, grande gerbe à l'arrachement. */
  const sparks = (x: number, y: number, count: number) =>
    setBurst({
      id: performance.now(),
      x,
      y,
      colors: ['#fff4c8', '#ffc46b', '#ffffff', '#ff9f43'],
      count,
      kind: 'sparks',
      spread: count < 20 ? Math.PI * 0.55 : Math.PI * 0.9,
    })

  const again = () => {
    setCards([])
    setError(null)
    setBurst(null)
    setStage('summoning')
    setRound((value) => value + 1)
  }

  const toAlbum = () => {
    close()
    openActivity('collection')
  }

  const best = cards.length > 0 ? bestRarity(cards.map((pulled) => pulled.card.rarity)) : null
  const tone = (stage === 'done' || stage === 'reveal') && best ? RARITY_STYLE[best].color : '#7c5cff'
  const canAgain = boosters.unlimited || boosters.available > 0
  // Invité à court d'essais : la suite passe par un compte (et ses 2 boosters offerts).
  const signUp =
    !boosters.signedIn && !canAgain
      ? () => {
          close()
          openAuth()
        }
      : undefined

  return (
    // `select-none` : glisser pour découper ne doit rien sélectionner (ni menu d'appui long sur iOS).
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.boosters.dialog}
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden text-cream select-none [-webkit-touch-callout:none]"
    >
      {/* Fond presque opaque (aucun flou : trop coûteux), halo de la meilleure carte, vignette très sombre. */}
      <div data-booster-backdrop aria-hidden className="absolute inset-0 bg-[#050507]/95">
        <div
          className="absolute inset-0 transition-[background] duration-700"
          style={{
            background: `radial-gradient(closest-side at 50% 48%, color-mix(in oklab, ${tone} 32%, transparent), transparent 75%)`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0,0,0,0.92) 100%)',
          }}
        />
      </div>
      <ParticleBurst burst={burst} />

      <div className="relative z-[2] flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[#ffe39a]/25 bg-black/40 px-3 py-1.5 text-xs font-semibold text-[#fff4c8] tabular-nums"
            aria-label={t.activities.boosterCountAria(boosters.available, boosters.max)}
          >
            <Zap size={13} className="fill-gold text-gold" />
            {boosters.unlimited ? '∞' : t.activities.boosterCount(boosters.available, boosters.max)}
          </span>
          {boosters.unlimited && <SandboxChip />}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          disabled={busy}
          aria-label={t.boosters.close}
          className="grid size-11 place-items-center rounded-full border border-cream/10 bg-black/40 text-cream/80 hover:bg-cream/10 disabled:opacity-40"
        >
          <X size={18} />
        </button>
      </div>

      {/* Pendant le suspens et la déchirure, rien ne doit rogner la bande qui s'envole ni l'éclair : pas de défilement. */}
      <div
        data-shake
        className={`relative z-[2] flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${stage === 'reveal' || stage === 'done' || stage === 'error' ? 'overflow-y-auto' : 'overflow-visible'}`}
      >
        {(stage === 'summoning' || stage === 'intro' || stage === 'tearing') && (
          <>
            <BoosterOpeningAnimation
              key={round}
              width={packWidthFor(viewport)}
              halo={haloFor(cards)}
              ready={stage !== 'summoning'}
              torn={stage === 'tearing'}
              onTear={tear}
              onSparks={sparks}
              onTorn={() => setStage('reveal')}
            />
            <p className="text-center text-xs tracking-[0.2em] text-cream/60 uppercase" aria-live="polite">
              {stage === 'summoning' ? t.boosters.summoning : stage === 'tearing' ? t.boosters.opening : t.boosters.swipeToOpen}
            </p>
          </>
        )}

        {(stage === 'reveal' || stage === 'done') && (
          <CardReveal
            key={round}
            cards={cards}
            width={cardWidthFor(viewport)}
            onAllRevealed={() => setStage('done')}
            onBurst={setBurst}
            onShake={shake}
            onInspect={setInspected}
            footer={stage === 'done' ? <DoneActions canAgain={canAgain} onAgain={again} onAlbum={toAlbum} onSignUp={signUp} /> : null}
          />
        )}

        {stage === 'error' && (
          <div className="flex max-w-xs flex-col items-center gap-4 text-center" role="alert">
            <p className="text-sm text-cream/85">{error}</p>
            <div className="flex gap-2">
              {signUp && (
                <button type="button" onClick={signUp} className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-void">
                  {t.activities.guest.cta}
                </button>
              )}
              {canAgain && (
                <button type="button" onClick={again} className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-void">
                  {t.boosters.retry}
                </button>
              )}
              <button type="button" onClick={close} className="rounded-full border border-cream/20 px-5 py-2.5 text-sm text-cream/85">
                {t.boosters.close}
              </button>
            </div>
          </div>
        )}
      </div>

      {inspected && <CardZoom card={{ ...inspected.card, count: inspected.count }} onClose={() => setInspected(null)} />}

      {boosters.unlimited && tally.packs > 0 && (
        <div className="relative z-[2] mx-auto mb-[max(0.75rem,env(safe-area-inset-bottom))] flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-cream/10 bg-black/50 px-3 py-2 text-[10px] text-cream/70 tabular-nums">
          <span className="font-semibold text-cream/85">{t.boosters.tally(tally.packs)}</span>
          {RARITIES.map((rarity) => (
            <span key={rarity} className="inline-flex items-center gap-1">
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: RARITY_STYLE[rarity].color }} />
              {t.cards.rarity[rarity]} {observedRate(tally, rarity)} %
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SandboxChip() {
  const t = useT()
  return (
    <span
      title={t.activities.sandboxHint}
      className="inline-flex items-center gap-1 rounded-full border border-like/40 bg-like/10 px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.14em] text-like uppercase"
    >
      <FlaskConical size={12} aria-hidden />
      {t.activities.sandbox}
    </span>
  )
}

function DoneActions({ canAgain, onAgain, onAlbum, onSignUp }: { canAgain: boolean; onAgain: () => void; onAlbum: () => void; onSignUp?: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      gsap.fromTo(ref.current, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.4, ease: EASE.glide })
    },
    { scope: ref },
  )
  return (
    <div ref={ref} className="flex flex-wrap justify-center gap-3">
      {onSignUp && (
        <button
          type="button"
          onClick={onSignUp}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#2a1a02] shadow-[0_0_28px_rgba(255,196,107,0.55)]"
          style={{
            background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)',
          }}
        >
          <Gift size={15} />
          {t.activities.guest.cta}
        </button>
      )}
      {canAgain && (
        <button
          type="button"
          onClick={onAgain}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#2a1a02] shadow-[0_0_28px_rgba(255,196,107,0.55)]"
          style={{
            background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)',
          }}
        >
          <Zap size={15} className="fill-[#2a1a02]" />
          {t.boosters.again}
        </button>
      )}
      <button type="button" onClick={onAlbum} className="rounded-full border border-[#ffe39a]/30 bg-black/40 px-6 py-3 text-sm font-semibold text-[#fff4c8]">
        {t.boosters.done}
      </button>
    </div>
  )
}
