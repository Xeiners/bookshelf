import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronRight, Flame, FlaskConical, Gift, Handshake, MoonStar, Sparkle, TrendingUp, WifiOff, Zap } from 'lucide-react'
import { useActivitiesStatus } from '../../hooks/useActivitiesStatus'
import { useBoosters } from '../../hooks/useBoosters'
import { useCollection } from '../../hooks/useCollection'
import { useUnreadTrades } from '../../hooks/useNotifications'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useT } from '../../i18n'
import { completion, rarityRank } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { formatCountdown } from '../../lib/oracle'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useHigherLowerStore } from '../../store/useHigherLowerStore'
import { useTradeStore } from '../../store/useTradeStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CardBack } from '../cards/CardBack'
import { CARD_FRAMES } from '../cards/cardFrames'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { HL_DOWN, HL_GRADIENT, HL_UP } from '../higherlower/hlStyle'
import { Bomb } from '../bomb/Bomb'
import { BOMB_GRADIENT } from '../../lib/bomb'
import { StardustBadge } from '../dle/StardustBadge'
import { EnergyRing } from './EnergyRing'
import { inkText } from '../../lib/ink'

/** Texte néon : lueur de la couleur donnée. */
const neon = (color: string): CSSProperties => ({ color, textShadow: `0 0 6px ${color}, 0 0 18px ${color}` })

/**
 * Hub « Activités », façon sanctuaire : trois artefacts sur fond d'encre
 * (cf. `SanctumBackdrop`). L'autel du booster en tête — paquet isométrique
 * qui flotte au-dessus d'un piédestal lumineux, jauge d'énergie circulaire,
 * bordures incandescentes quand un booster est prêt — puis l'Oracle et la
 * collection. Sans compte : 2 boosters d'essai, dont les cartes rejoignent le
 * compte à l'inscription.
 */
export function ActivitiesHub() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  // Le hub n'affiche que le stock : le décompte à la seconde reste dans l'autel.
  const boosters = useBoosters({ tick: false })
  // Ouverture de booster en plein écran : le hub, recouvert, cesse de s'animer.
  const covered = useUiStore((state) => state.boosterOpen)
  const openActivity = useUiStore((state) => state.openActivity)
  const signedIn = useAuthStore((state) => state.user !== null)
  const stardust = useDleStore((state) => state.overview?.stardust ?? null)
  const loadDle = useDleStore((state) => state.loadOverview)

  // Solde de Poussières et énigmes du jour : de quoi allumer l'artefact du BookshelfDLE.
  useEffect(() => {
    if (signedIn) void loadDle()
  }, [signedIn, loadDle])

  useGSAP(
    () => {
      gsap.fromTo('[data-artefact]', { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, stagger: 0.09, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} data-paused={covered || undefined} className="no-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-10">
      <div data-artefact className="flex shrink-0 flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-[#ffe39a]/25 bg-black/40 px-3 py-1.5 text-xs font-semibold text-[#fff4c8] tabular-nums"
          aria-label={t.activities.boosterCountAria(boosters.available, boosters.max)}
        >
          <Zap size={13} className="fill-gold text-gold" />
          {/* Le stock qui se régénère sur son plafond ; les boosters offerts à côté, hors plafond. */}
          {!boosters.ready ? '…' : boosters.unlimited ? t.activities.unlimited : t.activities.boosterCount(boosters.available - boosters.gifted, boosters.max)}
        </span>
        {boosters.gifted > 0 && !boosters.unlimited && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold tabular-nums">
            <Gift size={13} aria-hidden />
            {t.activities.giftedCount(boosters.gifted)}
          </span>
        )}
        {signedIn && stardust !== null && (
          <button type="button" onClick={() => openActivity('dle')} className="rounded-full transition-transform active:scale-95">
            <StardustBadge balance={stardust} />
          </button>
        )}
        {boosters.unlimited && (
          <span
            title={t.activities.sandboxHint}
            className="inline-flex items-center gap-1 rounded-full border border-like/40 bg-like/10 px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.14em] text-like uppercase"
          >
            <FlaskConical size={12} aria-hidden />
            {t.activities.sandbox}
          </span>
        )}
        {boosters.offline && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gold" title={t.activities.offline}>
            <WifiOff size={13} aria-hidden />
            <span className="sr-only">{t.activities.offline}</span>
          </span>
        )}
      </div>

      <BoosterAltar />
      <div className="grid shrink-0 gap-5 md:grid-cols-2">
        <OracleArtefact />
        <CollectionArtefact />
      </div>
      <div className="grid shrink-0 gap-5 md:grid-cols-2">
        <DleArtefact />
        <HigherLowerArtefact />
      </div>
      <BombArtefact />
      <MarketArtefact />
    </div>
  )
}

/* ---- Cadre d'artefact ---------------------------------------------------------- */

/**
 * Surface d'un artefact, façon widget : deux teintes de l'activité naissent de coins opposés
 * et se mêlent en diagonale sur l'encre de la carte ; liseré uni, teinté de la première.
 */
const surface = ([tint, accent]: readonly [string, string], from = '0% 0%'): CSSProperties => ({
  background: [
    `radial-gradient(110% 130% at ${from}, ${tint}4d 0%, ${tint}1f 38%, transparent 70%)`,
    `radial-gradient(90% 110% at 100% 100%, ${accent}38 0%, ${accent}12 40%, transparent 72%)`,
    'linear-gradient(160deg, #15151f, #0c0c13)',
  ].join(', '),
  borderColor: `${tint}3d`,
})

const TINT = {
  booster: ['#ffc46b', '#ff5ec4'],
  oracle: ['#9d7bff', '#4c6bff'],
  collection: ['#e0a82e', '#ff7a3d'],
  market: ['#3fe0a0', '#4cc9f0'],
  bomb: ['#b46cff', '#ff5e9c'],
  dle: ['#ff5ec4', '#9d7bff'],
  hl: ['#4cc9f0', '#3fe0a0'],
} as const

/**
 * Lueur incandescente autour d'un artefact « chargé ». Fixe : une grande ombre
 * floue dont l'opacité pulse en continu coûte cher à recomposer sur mobile.
 */
function Incandescence() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-px -z-10 rounded-[1.8rem]"
      style={{ boxShadow: '0 0 0 1px rgba(255,228,160,0.7)' }}
    />
  )
}

const ARTEFACT_CLASS = 'relative isolate shrink-0 rounded-[1.75rem] border text-left'

/* ---- Autel du booster ---------------------------------------------------------------- */

function BoosterAltar() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const boosters = useBoosters()
  const openBooster = useUiStore((state) => state.openBooster)
  const openAuth = useUiStore((state) => state.openAuth)
  const covered = useUiStore((state) => state.boosterOpen)
  const lit = boosters.canOpen

  // Le paquet flotte et respire ; un reflet balaie la feuille ; l'ombre suit la hauteur.
  // Recouvert par l'ouverture d'un booster : tout s'arrête (`revertOnUpdate`).
  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-altar-pack]', { y: -12, duration: 2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-altar-shadow]', { scale: 0.8, autoAlpha: 0.35, duration: 2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.fromTo('[data-pack-shine]', { xPercent: -170 }, { xPercent: 260, duration: 2.4, ease: 'power1.inOut', repeat: -1, repeatDelay: 1.6 })
    },
    { scope: ref, dependencies: [covered], revertOnUpdate: true },
  )

  // Invité à court d'essais : la suite passe par un compte.
  const guestDone = !boosters.signedIn && !boosters.canOpen

  const ringContent = guestDone ? (
    <Gift size={22} className="text-[#fff4c8]/70" aria-hidden />
  ) : boosters.unlimited ? (
    <span className="flex flex-col items-center">
      <span className="text-3xl leading-none font-semibold" style={neon('#3fe0a0')}>
        ∞
      </span>
      <span className="mt-1 text-[9px] tracking-[0.25em] text-cream/60 uppercase">{t.activities.sandbox}</span>
    </span>
  ) : boosters.available > 0 ? (
    <span className="flex flex-col items-center">
      <span className="text-2xl leading-none font-semibold tabular-nums" style={neon('#ffc46b')}>
        {boosters.available}/{boosters.max}
      </span>
      <span className="mt-1 text-[9px] tracking-[0.25em] text-[#fff4c8]/80 uppercase">{t.activities.ringReady}</span>
    </span>
  ) : (
    <span className="flex flex-col items-center">
      <span className="text-[13px] leading-none font-semibold tabular-nums" style={neon('#4cc9f0')}>
        {boosters.remaining !== null ? formatCountdown(boosters.remaining * 1000) : '—'}
      </span>
      <span className="mt-1 text-[9px] tracking-[0.25em] text-cream/60 uppercase">{t.activities.ringNext}</span>
    </span>
  )

  // Jauge : pleine si un booster attend (ou en recette), sinon l'avancement du minuteur.
  const progress = boosters.unlimited || boosters.available > 0 ? 1 : boosters.progress

  return (
    <section data-artefact aria-label={t.activities.booster.title} className={`${ARTEFACT_CLASS} overflow-hidden`} style={surface(TINT.booster, '20% 100%')}>
      {lit && <Incandescence />}
      <div ref={ref} className="flex flex-col items-center gap-5 p-5 md:flex-row md:items-center md:gap-8 md:p-7">
        {/* Piédestal : cercle doré lumineux, ombre portée, paquet isométrique. */}
        <div className="relative grid h-[15.5rem] w-full shrink-0 place-items-center md:w-64">
          <div
            aria-hidden
            className="absolute bottom-3 h-14 w-48 rounded-[50%]"
            style={{
              background: lit
                ? 'radial-gradient(closest-side, rgba(255,196,107,0.55), rgba(255,94,196,0.18) 60%, transparent)'
                : 'radial-gradient(closest-side, rgba(124,92,255,0.35), transparent)',
            }}
          />
          <div aria-hidden className="absolute bottom-5 h-8 w-40 rounded-[50%] border border-[#ffe39a]/35" style={{ boxShadow: lit ? '0 0 18px rgba(255,196,107,0.45)' : undefined }} />
          <div data-altar-shadow aria-hidden className="absolute bottom-6 h-5 w-28 rounded-[50%]" style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.85), transparent)', willChange: 'transform' }} />
          <div data-altar-pack className="relative mb-6" style={{ willChange: 'transform' }}>
            {/* Vue isométrique : perspective et rotations dans un seul transform, sous-arbre aplati. */}
            {/* Les deux séries en éventail : la 2 en retrait, la 1 devant. */}
            <div className="absolute top-2 left-10" style={{ transform: 'perspective(700px) rotateX(10deg) rotateY(-24deg) rotateZ(9deg)', opacity: 0.9 }}>
              <BoosterPackArt width={112} series={2} lit={lit} dim={!lit} />
            </div>
            <div className="relative -left-6" style={{ transform: 'perspective(700px) rotateX(10deg) rotateY(-24deg) rotateZ(-5deg)' }}>
              <BoosterPackArt width={122} series={1} lit={lit} dim={!lit} halo={lit ? 'LEGENDARY' : null} />
            </div>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-4">
          <div>
            <p className="text-[10px] tracking-[0.32em] text-[#fff4c8]/60 uppercase">{t.activities.booster.eyebrow}</p>
            <h2
              className="mt-1 font-display text-[2rem] leading-[1.05]"
              style={inkText('linear-gradient(135deg, #fff4c8, #ffc46b 45%, #ff5ec4)')}
            >
              {t.activities.booster.title}
            </h2>
            <p className="mt-1.5 text-sm text-cream/65">{boosters.signedIn ? t.activities.booster.body : guestDone ? t.activities.guest.body : t.activities.guest.trialBody(boosters.available)}</p>
          </div>

          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <EnergyRing progress={progress} size={96} charged={lit} label={t.activities.ringLabel}>
              {ringContent}
            </EnergyRing>
            {guestDone ? (
              <GoldButton onClick={openAuth} icon={<Gift size={15} />} label={t.activities.guest.cta} />
            ) : (
              <GoldButton
                onClick={() => {
                  vibrate(12)
                  openBooster()
                }}
                disabled={!boosters.canOpen}
                icon={<Zap size={15} className="fill-current" />}
                label={boosters.canOpen ? t.activities.booster.open : t.activities.booster.empty}
              />
            )}
          </div>
          {/* Un booster peut encore arriver pendant qu'un autre attend : le minuteur reste lisible. */}
          {boosters.signedIn && !boosters.unlimited && boosters.available > 0 && boosters.remaining !== null && (
            <p className="text-[11px] tracking-[0.12em] text-cream/55 uppercase tabular-nums">{t.activities.booster.next(formatCountdown(boosters.remaining * 1000))}</p>
          )}
          {!boosters.signedIn && !guestDone && (
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] tracking-[0.12em] text-cream/55 uppercase">
              {t.activities.guest.trial}
              <span aria-hidden>·</span>
              <button type="button" onClick={openAuth} className="text-[#fff4c8]/85 uppercase underline-offset-4 hover:underline">
                {t.activities.guest.keep}
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function GoldButton({ onClick, icon, label, disabled = false }: { onClick: () => void; icon: ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative inline-flex h-12 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full px-5 text-sm font-semibold sm:px-6 transition-transform active:scale-95 disabled:cursor-not-allowed"
      style={
        disabled
          ? { background: 'rgba(247,245,240,0.08)', color: 'rgba(247,245,240,0.45)' }
          : {
              background: 'linear-gradient(180deg, #ffdf8a, #f2b83a)',
              color: '#2a1a02',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 22px -10px rgba(242,184,58,0.8)',
            }
      }
    >
      {/* Libellé long (autre langue, écran étroit) : points de suspension, jamais de texte coupé net. */}
      <span className="relative flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
    </button>
  )
}

/* ---- Oracle ------------------------------------------------------------------------------- */

function OracleArtefact() {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const oracle = useOracleStatus()
  const { streak } = useActivitiesStatus()
  const openActivity = useUiStore((state) => state.openActivity)
  const covered = useUiStore((state) => state.boosterOpen)

  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-tarot]', { y: -6, rotation: -4, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true })
    },
    { scope: ref, dependencies: [covered], revertOnUpdate: true },
  )

  return (
    <button ref={ref} type="button" data-artefact onClick={() => openActivity('oracle')} className={`${ARTEFACT_CLASS} w-full`} style={surface(TINT.oracle)}>
      <span className="flex items-center gap-5 p-5">
        {/* Lame de tarot flottante. */}
        <span
          data-tarot
          aria-hidden
          className="grid h-28 w-[4.6rem] shrink-0 -rotate-[8deg] place-items-center rounded-xl border border-[#ffe39a]/60"
          style={{
            willChange: 'transform',
            background: 'radial-gradient(circle at 50% 40%, rgba(180,108,255,0.55), transparent 65%), linear-gradient(160deg, #22154a, #0b0918)',
            boxShadow: '0 0 24px rgba(124,92,255,0.45), inset 0 0 0 3px rgba(11,9,24,1), inset 0 0 0 4px rgba(255,228,160,0.35)',
          }}
        >
          <MoonStar size={30} className="text-[#fff4c8]" />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="block font-display text-2xl text-cream">{t.activities.oracle.title}</span>
          <span className="mt-1 block text-sm text-cream/60">{t.activities.oracle.body}</span>
          <span className={`mt-3 inline-flex flex-wrap items-center gap-1.5 text-xs ${oracle.available ? 'text-gold' : 'text-mist'}`}>
            {oracle.available && <span aria-hidden className="size-1.5 rounded-full bg-gold shadow-[0_0_8px_var(--color-gold)]" />}
            {oracle.available ? t.activities.oracle.ready : t.activities.oracle.done}
            {streak > 0 && <span className="text-mist">· {t.oracle.streak(streak)}</span>}
          </span>
        </span>
      </span>
    </button>
  )
}

/* ---- Collection ------------------------------------------------------------------------------ */

function CollectionArtefact() {
  const t = useT()
  const { signedIn, data } = useCollection()
  const openActivity = useUiStore((state) => state.openActivity)
  // Éventail : les trois plus rares de l'album, sinon trois dos de carte.
  const best = (data?.cards ?? [])
    .filter((card) => card.owned)
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.number - b.number)
    .slice(0, 3)
  const percent = data ? completion(data.owned, data.total) : 0
  const fan = best.length > 0 ? best : [null, null, null]

  return (
    <button
      type="button"
      data-artefact
      onClick={() => openActivity('collection')}
      className={`${ARTEFACT_CLASS} w-full`}
      style={surface(TINT.collection)}
    >
      <span className="flex items-center gap-5 p-5">
        <span aria-hidden className="relative block h-28 w-[5.4rem] shrink-0">
          {fan.map((card, index) => (
            <span
              key={card?.id ?? index}
              className="absolute top-2 left-3 block origin-bottom overflow-hidden rounded-md shadow-[0_10px_20px_-8px_rgba(0,0,0,0.9)]"
              style={{ transform: `rotate(${(index - (fan.length - 1) / 2) * 14}deg)`, zIndex: index === 1 ? 2 : 1 }}
            >
              {card ? (
                <span className="block h-[5.4rem] w-[3.9rem] p-[3px]" style={{ background: CARD_FRAMES[card.rarity].metal }}>
                  <img src={card.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full rounded-[3px] object-cover" />
                </span>
              ) : (
                <CardBack width={62} animated={false} />
              )}
            </span>
          ))}
        </span>
        <span className="block min-w-0 flex-1">
          <span className="block font-display text-2xl text-cream">{t.activities.collection.title}</span>
          <span className="mt-1 block text-sm text-cream/60">{signedIn ? t.activities.collection.body : t.activities.guest.collectionBody}</span>
          {data && <span className="mt-3 block text-xs text-[#fff4c8]/85 tabular-nums">{t.cards.progress(data.owned, data.total)}</span>}
        </span>
        {data && (
          <EnergyRing progress={percent / 100} size={58} charged={percent === 100} label={t.cards.progress(data.owned, data.total)}>
            <span className="text-[11px] font-semibold tabular-nums" style={neon('#fff4c8')}>
              {percent} %
            </span>
          </EnergyRing>
        )}
      </span>
    </button>
  )
}

/* ---- Marché d'échange -------------------------------------------------------------------------- */

/**
 * Le Marché : échanger ses doublons avec les autres collectionneurs (comptes seulement).
 * Une nouveauté (échange conclu, offre qui manque à l'album) allume l'artefact : pastille
 * qui bat, poignée de main qui s'agite.
 */
function MarketArtefact() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const unread = useUnreadTrades()
  const mine = useTradeStore((state) => state.mine)
  const openOffers = mine?.filter((offer) => offer.mine && offer.status === 'OPEN').length ?? null
  const rootRef = useRef<HTMLButtonElement>(null)

  useGSAP(
    () => {
      if (unread === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.fromTo('[data-market-ping]', { scale: 1, autoAlpha: 0.8 }, { scale: 2.4, autoAlpha: 0, duration: 1.4, ease: 'power1.out', repeat: -1 })
      gsap.to('[data-market-icon]', { keyframes: { rotation: [0, -14, 12, -8, 0] }, duration: 0.9, ease: 'power1.inOut', repeat: -1, repeatDelay: 2.2 })
    },
    { scope: rootRef, dependencies: [unread > 0], revertOnUpdate: true },
  )

  return (
    <button
      ref={rootRef}
      type="button"
      data-artefact
      onClick={() => openActivity('market')}
      className={`${ARTEFACT_CLASS} w-full`}
      style={unread > 0 ? { ...surface(TINT.market), borderColor: `${TINT.market[0]}80` } : surface(TINT.market)}
    >
      <span className="flex items-center gap-5 p-5">
        <span
          aria-hidden
          className="relative grid size-14 shrink-0 place-items-center rounded-2xl border border-[#ffe39a]/35 bg-black/40 text-gold shadow-[inset_0_0_18px_rgba(255,196,107,0.18)]"
        >
          <span data-market-icon className="grid will-change-transform">
            <Handshake size={26} />
          </span>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center">
              <span data-market-ping className="absolute inset-0 rounded-full bg-like will-change-transform" />
              <span className="relative size-3 rounded-full bg-like shadow-[0_0_0_2px_#050507]" />
            </span>
          )}
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl text-cream">{t.trades.title}</span>
            {unread > 0 && (
              <span className="rounded-full bg-like/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-like uppercase">{t.trades.hubNew(unread)}</span>
            )}
          </span>
          <span className="mt-1 block text-sm text-cream/60">{t.trades.body}</span>
          {openOffers !== null && <span className="mt-1.5 block text-[11px] text-gold/80">{t.trades.hubOpen(openOffers)}</span>}
        </span>
        <ChevronRight size={20} className="shrink-0 text-cream/40" aria-hidden />
      </span>
    </button>
  )
}

/* ---- Anime Bomb Party ------------------------------------------------------------------------ */

/** Mèche de l'artefact : elle brûle en boucle (bleu → rouge), sans tic-tac. */
const HUB_FUSE_MS = 9000

/**
 * L'Anime Bomb Party : une syllabe, une bombe, un mot avant l'explosion. Sur l'artefact,
 * la petite bombe brûle sa mèche en boucle.
 */
function BombArtefact() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const covered = useUiStore((state) => state.boosterOpen)
  const [endsAt, setEndsAt] = useState(() => Date.now() + HUB_FUSE_MS)

  return (
    <button
      type="button"
      data-artefact
      onClick={() => openActivity('bomb')}
      className={`${ARTEFACT_CLASS} w-full overflow-hidden`}
      style={surface(TINT.bomb)}
    >
      <span className="flex items-center gap-4 p-4 pr-5">
        <span className="-my-3 -ml-2 shrink-0">
          <Bomb syllable="爆" endsAt={covered ? null : endsAt} totalMs={HUB_FUSE_MS} onZero={() => setEndsAt(Date.now() + HUB_FUSE_MS)} size={96} />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl" style={inkText(BOMB_GRADIENT)}>
              {t.bomb.title}
            </span>
            <span className="rounded-full bg-[#6fd6ff]/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#9be8ff] uppercase">{t.bomb.hub.eyebrow}</span>
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-cream/65">{t.bomb.hub.body}</span>
        </span>
        <ChevronRight size={20} className="shrink-0 text-cream/40" aria-hidden />
      </span>
    </button>
  )
}

/* ---- BookshelfDLE ---------------------------------------------------------------------------- */


/**
 * Le BookshelfDLE : deviner l'œuvre du jour, défier les autres. L'artefact
 * s'allume (grille qui se retourne, pastille) tant qu'une énigme du jour attend.
 */
function DleArtefact() {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const openActivity = useUiStore((state) => state.openActivity)
  const covered = useUiStore((state) => state.boosterOpen)
  const signedIn = useAuthStore((state) => state.user !== null)
  const overview = useDleStore((state) => state.overview)
  const toPlay = overview ? Object.values(overview.daily).flatMap((modes) => Object.values(modes)).filter((daily) => !daily.solved).length : 0
  const lit = signedIn && toPlay > 0

  // L'emblème flotte, son « ? » respire, ses étoiles scintillent (plus vite quand une énigme attend).
  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-dle-emblem]', { y: -4, rotation: -3, duration: 2.2, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-dle-mark]', { scale: 1.08, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.fromTo(
        '[data-dle-spark]',
        { scale: 0.2, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, rotation: 90, duration: 0.6, ease: 'power2.out', yoyo: true, repeat: -1, repeatDelay: lit ? 0.4 : 1.6, stagger: 0.5 },
      )
    },
    { scope: ref, dependencies: [covered, lit], revertOnUpdate: true },
  )

  return (
    <button
      ref={ref}
      type="button"
      data-artefact
      onClick={() => openActivity('dle')}
      className={`${ARTEFACT_CLASS} w-full overflow-hidden`}
      style={lit ? { ...surface(TINT.dle), borderColor: `${TINT.dle[0]}80` } : surface(TINT.dle)}
    >
      <span className="flex items-center gap-5 p-5">
        <DleEmblem />
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl" style={inkText(STARDUST_GRADIENT)}>
              {t.dle.title}
            </span>
            <span className="rounded-full bg-[#ff5ec4]/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#ff9ad8] uppercase">{t.dle.eyebrow}</span>
          </span>
          {signedIn && overview && (
            <span className={`mt-2 inline-flex items-center gap-1.5 text-xs ${lit ? 'text-[#ff9ad8]' : 'text-like'}`}>
              {lit ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[#ff5ec4]" /> : <Check size={13} aria-hidden />}
              {lit ? t.dle.hub.toPlay(toPlay) : t.dle.hub.allSolved}
            </span>
          )}
        </span>
        <ChevronRight size={20} className="shrink-0 text-cream/40" aria-hidden />
      </span>
    </button>
  )
}

/**
 * Emblème du BookshelfDLE : un médaillon cerclé du dégradé des Poussières d'Étoile,
 * un grand « ? » lumineux au centre, et des étoiles qui scintillent autour.
 */
function DleEmblem() {
  return (
    <span aria-hidden data-dle-emblem className="relative grid size-16 shrink-0 place-items-center will-change-transform">
      {/* Anneau du dégradé, puis le cœur d'encre où le « ? » brille. */}
      <span className="absolute inset-0 rounded-[1.35rem]" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 26px -6px rgba(255,94,196,0.75)' }} />
      <span className="absolute inset-[2.5px] rounded-[1.2rem]" style={{ background: 'radial-gradient(circle at 50% 38%, rgba(255,94,196,0.45), rgba(124,92,255,0.25) 45%, #0b0918 75%)' }} />
      <span
        data-dle-mark
        className="relative font-display text-[2.6rem] leading-none will-change-transform"
        style={inkText('linear-gradient(180deg, #fff8dc, #ffc46b 55%, #ff5ec4)')}
      >
        ?
      </span>
      {/* Étoiles autour du médaillon. */}
      <Sparkle data-dle-spark size={13} className="absolute -top-1.5 -right-1.5 fill-[#fff4c8] text-[#fff4c8]" />
      <Sparkle data-dle-spark size={9} className="absolute -bottom-1 -left-1 fill-[#ff9ad8] text-[#ff9ad8]" />
      <Sparkle data-dle-spark size={7} className="absolute top-1 -left-2 fill-[#b46cff] text-[#b46cff]" />
    </span>
  )
}

/* ---- Higher or Lower --------------------------------------------------------------------------- */

/**
 * Le Higher or Lower : plus haut ou plus bas, en série. L'emblème — une courbe qui
 * grimpe dans un médaillon, flèches ▲ ▼ qui respirent — et le record du compte.
 */
function HigherLowerArtefact() {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const openActivity = useUiStore((state) => state.openActivity)
  const covered = useUiStore((state) => state.boosterOpen)
  const signedIn = useAuthStore((state) => state.user !== null)
  const me = useHigherLowerStore((state) => state.overview?.me ?? null)
  const loadOverview = useHigherLowerStore((state) => state.loadOverview)

  useEffect(() => {
    if (signedIn) void loadOverview()
  }, [signedIn, loadOverview])

  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-hl-emblem]', { y: -4, rotation: 3, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-hl-up]', { y: -3, duration: 1.1, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-hl-down]', { y: 3, duration: 1.1, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.4 })
    },
    { scope: ref, dependencies: [covered], revertOnUpdate: true },
  )

  return (
    <button ref={ref} type="button" data-artefact onClick={() => openActivity('higherlower')} className={`${ARTEFACT_CLASS} w-full overflow-hidden`} style={surface(TINT.hl)}>
      <span className="flex items-center gap-5 p-5">
        <span aria-hidden data-hl-emblem className="relative grid size-16 shrink-0 place-items-center will-change-transform">
          <span className="absolute inset-0 rounded-[1.35rem]" style={{ background: HL_GRADIENT, boxShadow: '0 0 26px -6px rgba(94,242,194,0.7)' }} />
          <span className="absolute inset-[2.5px] rounded-[1.2rem]" style={{ background: 'radial-gradient(circle at 50% 38%, rgba(94,242,194,0.4), rgba(124,92,255,0.25) 45%, #0b0918 75%)' }} />
          <TrendingUp size={30} strokeWidth={2.5} className="relative text-[#eafff7]" />
          <span data-hl-up className="absolute -top-1.5 -right-1 text-[11px] leading-none will-change-transform" style={{ color: HL_UP.color }}>
            ▲
          </span>
          <span data-hl-down className="absolute -bottom-1.5 -left-1 text-[11px] leading-none will-change-transform" style={{ color: HL_DOWN.color }}>
            ▼
          </span>
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl" style={inkText(HL_GRADIENT)}>
              {t.hl.title}
            </span>
            {signedIn && me?.games === 0 && (
              <span className="rounded-full bg-[#5ef2c2]/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#5ef2c2] uppercase">{t.hl.hubNew}</span>
            )}
          </span>
          <span className="mt-1 block text-sm text-cream/60">{t.hl.hubBody}</span>
          {signedIn && me && me.best > 0 && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#ffb36b] tabular-nums">
              <Flame size={13} className="fill-current" aria-hidden />
              {t.hl.hubRecord(me.best)}
            </span>
          )}
        </span>
        <ChevronRight size={20} className="shrink-0 text-cream/40" aria-hidden />
      </span>
    </button>
  )
}
