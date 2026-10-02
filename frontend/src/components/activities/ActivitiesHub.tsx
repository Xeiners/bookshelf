import { useRef, type CSSProperties, type ReactNode } from 'react'
import { BookText, ChevronRight, FlaskConical, Gift, Handshake, MoonStar, WifiOff, Zap } from 'lucide-react'
import { useActivitiesStatus } from '../../hooks/useActivitiesStatus'
import { useBoosters } from '../../hooks/useBoosters'
import { useCollection } from '../../hooks/useCollection'
import { useNovels } from '../../hooks/useNovels'
import { useUnreadTrades } from '../../hooks/useNotifications'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useT } from '../../i18n'
import { completion, rarityRank } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { novelAsBook } from '../../lib/novels'
import { formatCountdown } from '../../lib/oracle'
import { displayPercent } from '../../store/useNovelStore'
import { useTradeStore } from '../../store/useTradeStore'
import { useUiStore } from '../../store/useUiStore'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CardBack } from '../cards/CardBack'
import { CARD_FRAMES } from '../cards/cardFrames'
import { EpubDropZone } from '../novels/EpubDropZone'
import { BookCover } from '../ui/BookCover'
import { EnergyRing } from './EnergyRing'

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
      <MarketArtefact />
      <NovelsArtefact />
    </div>
  )
}

/* ---- Cadre d'artefact ---------------------------------------------------------- */

/** Liseré doré qui s'estompe vers le violet, sur un verre d'encre (bordure en dégradé). */
const ARTEFACT_SURFACE: CSSProperties = {
  background:
    'linear-gradient(160deg, rgba(20,18,32,0.92), rgba(8,8,14,0.94)) padding-box, linear-gradient(135deg, rgba(255,228,160,0.55), rgba(255,228,160,0.08) 35%, rgba(124,92,255,0.35) 100%) border-box',
}

/**
 * Lueur incandescente autour d'un artefact « chargé ». Fixe : une grande ombre
 * floue dont l'opacité pulse en continu coûte cher à recomposer sur mobile.
 */
function Incandescence() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-px -z-10 rounded-[1.8rem]"
      style={{ boxShadow: '0 0 0 1px rgba(255,228,160,0.9), 0 0 22px rgba(255,196,107,0.4)' }}
    />
  )
}

const ARTEFACT_CLASS = 'relative isolate shrink-0 rounded-[1.75rem] border border-transparent text-left'

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
    <section data-artefact aria-label={t.activities.booster.title} className={`${ARTEFACT_CLASS} overflow-hidden`} style={ARTEFACT_SURFACE}>
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
            <div style={{ transform: 'perspective(700px) rotateX(10deg) rotateY(-24deg) rotateZ(-3deg)' }}>
              <BoosterPackArt width={122} lit={lit} dim={!lit} halo={lit ? 'LEGENDARY' : null} />
            </div>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-4">
          <div>
            <p className="text-[10px] tracking-[0.32em] text-[#fff4c8]/60 uppercase">{t.activities.booster.eyebrow}</p>
            <h2
              className="mt-1 font-display text-[2rem] leading-[1.05]"
              style={{ backgroundImage: 'linear-gradient(135deg, #fff4c8, #ffc46b 45%, #ff5ec4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
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
              background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)',
              color: '#2a1a02',
              boxShadow: '0 0 26px rgba(255,196,107,0.5), inset 0 1px 0 rgba(255,255,255,0.7)',
            }
      }
    >
      {!disabled && (
        <span
          aria-hidden
          data-card-fx
          className="absolute inset-y-0 left-0 w-1/2 -skew-x-12"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', animation: 'shimmer 2.8s ease-in-out infinite' }}
        />
      )}
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
    <button ref={ref} type="button" data-artefact onClick={() => openActivity('oracle')} className={`${ARTEFACT_CLASS} w-full`} style={ARTEFACT_SURFACE}>
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
      style={ARTEFACT_SURFACE}
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
      style={unread > 0 ? { ...ARTEFACT_SURFACE, boxShadow: '0 0 0 1px rgba(63,224,160,0.45), 0 18px 46px -22px rgba(63,224,160,0.6)' } : ARTEFACT_SURFACE}
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

/* ---- Romans ---------------------------------------------------------------------------------- */

/**
 * Romans du compte : les derniers lus en éventail, l'import d'un EPUB
 * (glisser-déposer sur ordinateur) et l'accès à la liste. Pas un bouton
 * unique comme les autres artefacts : il contient deux actions distinctes.
 */
function NovelsArtefact() {
  const t = useT()
  const { signedIn, books, importFiles } = useNovels()
  const openNovels = useUiStore((state) => state.openNovels)
  const recent = (books ?? []).slice(0, 3)
  const current = (books ?? []).find((entry) => {
    const percent = displayPercent(entry)
    return percent > 0 && percent < 100
  })

  return (
    <section data-artefact aria-label={t.novels.artefact.title} className={ARTEFACT_CLASS} style={ARTEFACT_SURFACE}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span aria-hidden className="relative block h-28 w-[5.4rem] shrink-0 self-center">
          {recent.length > 0 ? (
            recent.map((entry, index) => (
              <span
                key={entry.id}
                className="absolute top-2 left-3 block h-[5.4rem] w-[3.9rem] origin-bottom overflow-hidden rounded-md bg-carbon shadow-[0_10px_20px_-8px_rgba(0,0,0,0.9)]"
                style={{ transform: `rotate(${(index - (recent.length - 1) / 2) * 12}deg)`, zIndex: index === 1 ? 2 : 1 }}
              >
                <BookCover book={novelAsBook(entry.book)} className="h-full w-full" />
              </span>
            ))
          ) : (
            <span className="absolute inset-2 grid place-items-center rounded-xl border border-[#ffe39a]/40 bg-black/30">
              <BookText size={30} className="text-[#fff4c8]" />
            </span>
          )}
        </span>
        <span className="block min-w-0 flex-1">
          <span className="block text-[10px] tracking-[0.32em] text-[#fff4c8]/60 uppercase">{t.novels.artefact.eyebrow}</span>
          <span className="mt-1 block font-display text-2xl text-cream">{t.novels.artefact.title}</span>
          <span className="mt-1 block text-sm text-cream/60">{signedIn ? t.novels.artefact.body : t.novels.guest.body}</span>
          {current && <span className="mt-2 block truncate text-xs text-gold">{t.novels.artefact.reading(current.book.title)}</span>}
          <span className="mt-3 flex flex-wrap items-center gap-2">
            <EpubDropZone variant="pill" onFiles={(files) => importFiles(files, { openSheet: true })} />
            <button
              type="button"
              onClick={() => {
                vibrate(6)
                openNovels()
              }}
              className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs text-[#fff4c8]/85 hover:text-[#fff4c8]"
            >
              {signedIn && books && books.length > 0 ? `${t.novels.artefact.open} · ${t.novels.count(books.length)}` : t.novels.artefact.open}
              <ChevronRight size={14} aria-hidden />
            </button>
          </span>
        </span>
      </div>
    </section>
  )
}
