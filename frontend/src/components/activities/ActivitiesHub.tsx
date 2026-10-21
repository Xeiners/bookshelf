import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CalendarCheck, Check, ChevronRight, FlaskConical, Gamepad2, Gift, Handshake, Layers, MoonStar, Sparkle, Sparkles, TrendingUp, WifiOff, Zap } from 'lucide-react'
import { useActivitiesStatus } from '../../hooks/useActivitiesStatus'
import { useBoosters } from '../../hooks/useBoosters'
import { useCollection } from '../../hooks/useCollection'
import { useUnreadTrades } from '../../hooks/useNotifications'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useT } from '../../i18n'
import { completion, rarityRank } from '../../lib/boosters'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { formatCountdown } from '../../lib/oracle'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useHigherLowerStore } from '../../store/useHigherLowerStore'
import { useTradeStore } from '../../store/useTradeStore'
import { CYCLE_DAYS } from '../../services/dailyApi'
import { useDailyStore } from '../../store/useDailyStore'
import { useUiStore, type ActivityTab } from '../../store/useUiStore'
import { StackEmblem } from '../stack/StackEmblem'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CardBack } from '../cards/CardBack'
import { CARD_FRAMES } from '../cards/cardFrames'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { HL_DOWN, HL_GRADIENT, HL_UP } from '../higherlower/hlStyle'
import { Bomb } from '../bomb/Bomb'
import { BOMB_GRADIENT } from '../../lib/bomb'
import { EnergyRing } from './EnergyRing'
import { ShopBanners } from './ShopBanners'
import { inkText } from '../../lib/ink'
import { canvasApi } from '../../services/canvasApi'

/** Texte néon : lueur de la couleur donnée. */
const neon = (color: string): CSSProperties => ({ color, textShadow: `0 0 6px ${color}, 0 0 18px ${color}` })

/**
 * Hub « Activités ». L'ouverture des boosters est la vedette : elle ouvre la page, toujours
 * visible au-dessus des rubriques. Au-dessus d'elle, seulement l'essentiel : la récompense
 * du jour et le stock de boosters. Puis trois rubriques en onglets collants — Cartes (boutique,
 * album, Marché), Jeux (grille de tuiles), Univers (Toile, Oracle) — dont seule celle affichée
 * est montée (et animée). La rubrique est gardée dans le store : au retour d'un jeu, on retombe
 * au même endroit.
 */
export function ActivitiesHub() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  // Le hub n'affiche que le stock : le décompte à la seconde reste dans l'autel.
  const boosters = useBoosters({ tick: false })
  // Ouverture de booster en plein écran : le hub, recouvert, cesse de s'animer.
  const covered = useUiStore((state) => state.boosterOpen)
  const tab = useUiStore((state) => state.activityTab)
  const setTab = useUiStore((state) => state.setActivityTab)
  const signedIn = useAuthStore((state) => state.user !== null)
  const loadDle = useDleStore((state) => state.loadOverview)

  // Énigmes du jour : de quoi allumer la tuile du DLE.
  useEffect(() => {
    if (signedIn) void loadDle()
  }, [signedIn, loadDle])

  // Changement de rubrique : l'ancienne sort d'un côté pendant que la nouvelle entre de l'autre
  // (vers la gauche si l'on va à droite, et inversement). La vedette, au-dessus, ne bouge pas.
  const [leaving, setLeaving] = useState<{ tab: ActivityTab; direction: 1 | -1 } | null>(null)
  useGSAP(
    () => {
      if (!leaving) return
      const done = () => setLeaving(null)
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done()
      const shift = leaving.direction * 100
      gsap.fromTo('[data-panel="out"]', { xPercent: 0, autoAlpha: 1 }, { xPercent: -shift, autoAlpha: 0.4, duration: 0.42, ease: 'power3.inOut' })
      gsap.fromTo('[data-panel="in"]', { xPercent: shift }, { xPercent: 0, duration: 0.42, ease: 'power3.inOut', onComplete: done })
    },
    { scope: rootRef, dependencies: [leaving] },
  )

  const choose = (id: ActivityTab) => {
    if (id === tab) return
    vibrate(6)
    setLeaving({ tab, direction: TAB_ORDER.indexOf(id) > TAB_ORDER.indexOf(tab) ? 1 : -1 })
    setTab(id)
    // La rubrique commence sous les onglets : on la montre depuis son début.
    const tabs = document.getElementById('hub-tabs')
    if (rootRef.current && tabs && rootRef.current.scrollTop > tabs.offsetTop) rootRef.current.scrollTo({ top: tabs.offsetTop, behavior: 'smooth' })
  }

  return (
    <div ref={rootRef} data-paused={covered || undefined} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-10">
      <div className="flex shrink-0 flex-col gap-4 px-5">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DailyChip />
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#ffe39a]/25 bg-black/40 px-3 text-xs font-semibold text-[#fff4c8] tabular-nums"
            aria-label={t.activities.boosterCountAria(boosters.available, boosters.max)}
          >
            <Zap size={13} className="fill-gold text-gold" />
            {/* Le stock qui se régénère sur son plafond ; les boosters offerts à côté, hors plafond. */}
            {!boosters.ready ? '…' : boosters.unlimited ? t.activities.unlimited : t.activities.boosterCount(boosters.available - boosters.gifted, boosters.max)}
            {boosters.gifted > 0 && !boosters.unlimited && (
              <span className="ml-0.5 inline-flex items-center gap-1 text-gold">
                <Gift size={12} aria-hidden />
                {t.activities.giftedCount(boosters.gifted)}
              </span>
            )}
          </span>
          {boosters.unlimited && (
            <span
              title={t.activities.sandboxHint}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-like/40 bg-like/10 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-like uppercase"
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

        <BoosterHero />
      </div>

      {/* Onglets collants : on sait toujours où l'on est. */}
      <div id="hub-tabs" className="sticky top-0 z-10 mt-4 shrink-0 px-5 pt-2 pb-3">
        <div role="tablist" aria-label={t.activities.hub.tabsLabel} className="relative grid grid-cols-3 rounded-full border border-white/10 bg-[#101017]/90 p-1 backdrop-blur">
          {/* Le sélecteur glisse d'une rubrique à l'autre. */}
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-cream shadow-[0_6px_18px_-8px_rgba(247,245,240,0.6)] transition-transform duration-[420ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(${TAB_ORDER.indexOf(tab) * 100}%)` }}
          />
          {HUB_TABS.map(({ id, icon: Icon }) => {
            const selected = tab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`hub-tab-${id}`}
                aria-selected={selected}
                aria-controls="hub-panel"
                onClick={() => choose(id)}
                className={`relative inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold transition-colors duration-300 ${
                  selected ? 'text-void' : 'text-cream/70 hover:text-cream'
                }`}
              >
                <Icon size={15} aria-hidden className="shrink-0" />
                <span className="truncate">{t.activities.hub.tabs[id]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Les deux rubriques partagent la même case pendant la transition ; le débord est masqué. */}
      <div id="hub-panel" role="tabpanel" aria-labelledby={`hub-tab-${tab}`} className="grid shrink-0 overflow-x-clip">
        {(leaving ? [leaving.tab, tab] : [tab]).map((id) => (
          <div
            key={id}
            data-panel={leaving ? (id === tab ? 'in' : 'out') : undefined}
            aria-hidden={id !== tab || undefined}
            inert={id !== tab || undefined}
            className="col-start-1 row-start-1 flex min-w-0 flex-col gap-4 self-start px-5"
          >
            <HubPanel tab={id} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Le contenu d'une rubrique. */
function HubPanel({ tab }: { tab: ActivityTab }) {
  if (tab === 'games') return <GamesGrid />
  if (tab === 'cards')
    return (
      <div className="grid shrink-0 gap-4 md:grid-cols-2">
        <CollectionArtefact />
        <MarketArtefact />
      </div>
    )
  return (
    <div className="grid shrink-0 gap-4 md:grid-cols-2">
      <CanvasArtefact />
      <OracleArtefact />
    </div>
  )
}

const TAB_ORDER: readonly ActivityTab[] = ['cards', 'games', 'more']

const HUB_TABS: { id: ActivityTab; icon: typeof Layers }[] = [
  { id: 'cards', icon: Layers },
  { id: 'games', icon: Gamepad2 },
  { id: 'more', icon: Sparkles },
]

/** Énigmes du jour pas encore résolues (toutes catégories et tous formats). */
const dailyToPlay = (overview: ReturnType<typeof useDleStore.getState>['overview']): number =>
  overview ? Object.values(overview.daily).flatMap((modes) => Object.values(modes)).filter((daily) => !daily.solved).length : 0

/**
 * La récompense du jour, en pastille : dorée avec un point quand elle attend, sinon le jour
 * de la série (un toucher rouvre le calendrier). Rien en invité.
 */
function DailyChip() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const status = useDailyStore((state) => state.status)
  const show = useDailyStore((state) => state.show)
  if (!signedIn || !status) return null
  const ready = status.claimable
  return (
    <button
      type="button"
      onClick={show}
      className="relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-transform active:scale-95"
      style={
        ready
          ? { background: 'linear-gradient(150deg, #fff6c8, #ffc23a 55%, #ff8a3d)', borderColor: 'transparent', color: '#3a2200' }
          : { backgroundColor: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,227,154,0.25)', color: 'rgba(247,245,240,0.75)' }
      }
    >
      <CalendarCheck size={14} aria-hidden />
      {ready ? t.activities.hub.daily.claim : t.activities.hub.daily.streak(Math.min(status.streak, CYCLE_DAYS), CYCLE_DAYS)}
      {ready && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-[#ff4d6d] ring-2 ring-[#050507]" />}
    </button>
  )
}

/* ---- Cadre d'artefact ---------------------------------------------------------- */

/** Surface d'un artefact : une carte sombre et unie ; seul le liseré prend la couleur de l'activité. */
const surface = (tint: string): CSSProperties => ({
  backgroundColor: '#101017',
  borderColor: `${tint}38`,
})

const TINT = { booster: '#ffc46b', oracle: '#9d7bff', collection: '#e0a82e', market: '#3fe0a0', bomb: '#b46cff', dle: '#ff5ec4', hl: '#4cc9f0', runner: '#ff6fb5', canvas: '#2bc3ff', stack: '#ff9a5c' } as const

const ARTEFACT_CLASS = 'relative isolate shrink-0 rounded-[1.75rem] border text-left'

/* ---- Vedette : l'ouverture des boosters ------------------------------------------------------------- */

/**
 * La vedette de la page : les trois séries en éventail qui flottent dans un halo, le titre, la
 * Légendaire garantie, et un grand bouton « Ouvrir » avec sa jauge. Plus de booster : la jauge
 * montre l'attente et le compte à rebours. Sans compte : les boosters d'essai, puis l'inscription.
 * Une seule animation en boucle (le paquet qui flotte), coupée quand l'ouverture recouvre la page.
 */
function BoosterHero() {
  const t = useT()
  const ref = useRef<HTMLElement>(null)
  const boosters = useBoosters()
  const openBooster = useUiStore((state) => state.openBooster)
  const openAuth = useUiStore((state) => state.openAuth)
  const covered = useUiStore((state) => state.boosterOpen)
  const lit = boosters.canOpen
  // Invité à court d'essais : la suite passe par un compte.
  const guestDone = !boosters.signedIn && !boosters.canOpen

  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-hero-pack]', { y: -8, duration: 2.2, ease: 'sine.inOut', repeat: -1, yoyo: true })
    },
    { scope: ref, dependencies: [covered], revertOnUpdate: true },
  )

  // Jauge : pleine si un booster attend (ou en recette), sinon l'avancement du minuteur.
  const progress = boosters.unlimited || boosters.available > 0 ? 1 : boosters.progress
  const ring = guestDone ? (
    <Gift size={20} className="text-[#fff4c8]/70" aria-hidden />
  ) : boosters.unlimited ? (
    <span className="text-2xl leading-none font-semibold" style={neon('#3fe0a0')}>
      ∞
    </span>
  ) : boosters.available > 0 ? (
    <span className="text-lg leading-none font-semibold tabular-nums" style={neon('#ffc46b')}>
      {boosters.available}/{boosters.max}
    </span>
  ) : (
    <span className="text-[10px] leading-none font-semibold tabular-nums" style={neon('#4cc9f0')}>
      {boosters.remaining !== null ? formatCountdown(boosters.remaining * 1000) : '—'}
    </span>
  )
  const subtitle = boosters.signedIn ? t.activities.booster.pity(boosters.legendaryEvery, !boosters.unlimited ? boosters.legendaryIn : null) : guestDone ? t.activities.guest.body : t.activities.guest.trialBody(boosters.available)

  return (
    <section
      ref={ref}
      aria-label={t.activities.booster.title}
      className="relative isolate grid shrink-0 overflow-hidden rounded-[2rem] border lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      style={{
        borderColor: lit ? 'rgba(255,214,130,0.6)' : 'rgba(255,196,107,0.22)',
        background: lit
          ? 'radial-gradient(120% 90% at 20% 20%, rgba(255,196,107,0.22), transparent 60%), radial-gradient(90% 80% at 90% 100%, rgba(255,94,196,0.18), transparent 60%), #101017'
          : 'radial-gradient(120% 90% at 20% 20%, rgba(124,92,255,0.16), transparent 60%), #101017',
      }}
    >
      <div className="flex min-w-0 flex-col justify-center">
      <div className="flex items-center gap-3 p-5 pb-4 md:gap-8 md:p-7 md:pb-5">
        {/* Les trois séries en éventail ; la nouvelle (3) devant. */}
        <div aria-hidden className="relative grid h-[9.5rem] w-[9.25rem] shrink-0 place-items-center md:h-[12rem] md:w-[12rem]">
          <div aria-hidden className="absolute bottom-0 h-6 w-28 rounded-[50%]" style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.75), transparent)' }} />
          <div data-hero-pack className="relative" style={{ willChange: 'transform' }}>
            <div className="absolute top-3 -left-8 md:-left-12" style={{ transform: 'rotate(-14deg)', opacity: 0.8 }}>
              <BoosterPackArt width={64} series={1} lit={lit} dim={!lit} />
            </div>
            <div className="absolute top-3 -right-8 md:-right-12" style={{ transform: 'rotate(14deg)', opacity: 0.8 }}>
              <BoosterPackArt width={64} series={2} lit={lit} dim={!lit} />
            </div>
            <div className="relative" style={{ transform: 'rotate(-2deg)' }}>
              <BoosterPackArt width={82} series={3} lit={lit} dim={!lit} halo={lit ? 'LEGENDARY' : null} />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[8px] font-bold tracking-[0.16em] whitespace-nowrap text-[#2a1a02] uppercase" style={{ background: '#ffb347' }}>
                {t.activities.booster.newSeries}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-[10px] tracking-[0.28em] text-[#fff4c8]/60 uppercase">{t.activities.booster.eyebrow}</p>
          <h2 className="font-display text-[1.55rem] leading-[1.05] md:text-[2.2rem]" style={inkText('linear-gradient(135deg, #fff4c8, #ffc46b 45%, #ff5ec4)')}>
            {t.activities.booster.title}
          </h2>
          <p className="text-xs leading-snug text-[#ffc46b]/85 md:text-sm">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 pb-5 md:px-7 md:pb-7">
        <EnergyRing progress={progress} size={56} charged={lit} label={t.activities.ringLabel}>
          {ring}
        </EnergyRing>
        {guestDone ? (
          <GoldButton wide onClick={openAuth} icon={<Gift size={16} />} label={t.activities.guest.cta} />
        ) : (
          <GoldButton
            wide
            onClick={() => {
              vibrate(12)
              openBooster()
            }}
            disabled={!boosters.canOpen}
            icon={<Zap size={16} className="fill-current" />}
            label={boosters.canOpen ? t.activities.booster.open : t.activities.booster.empty}
          />
        )}
      </div>
      {/* Un booster peut encore arriver pendant qu'un autre attend : le minuteur reste lisible. */}
      {boosters.signedIn && !boosters.unlimited && boosters.available > 0 && boosters.remaining !== null && (
        <p className="-mt-2 px-5 pb-4 text-[11px] tracking-[0.1em] text-cream/50 uppercase tabular-nums md:px-7">{t.activities.booster.next(formatCountdown(boosters.remaining * 1000))}</p>
      )}
      {!boosters.signedIn && !guestDone && (
        <p className="-mt-2 flex flex-wrap items-center gap-x-2 px-5 pb-4 text-[11px] tracking-[0.1em] text-cream/50 uppercase md:px-7">
          {t.activities.guest.trial}
          <span aria-hidden>·</span>
          <button type="button" onClick={openAuth} className="text-[#fff4c8]/85 uppercase underline-offset-4 hover:underline">
            {t.activities.guest.keep}
          </button>
        </p>
      )}
      </div>
      {/* La boutique à côté (PC) ou dessous (téléphone) : un booster ou une boîte mystère contre des ✦. */}
      <div className="flex min-w-0 flex-col justify-center border-t border-white/8 p-3 sm:p-4 md:p-5 lg:border-t-0 lg:border-l lg:p-6">
        <ShopBanners />
      </div>
    </section>
  )
}

function GoldButton({ onClick, icon, label, disabled = false, wide = false }: { onClick: () => void; icon: ReactNode; label: string; disabled?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-13 max-w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-full px-5 text-[15px] font-semibold transition-transform active:scale-95 disabled:cursor-not-allowed sm:px-6 ${wide ? 'flex-1' : ''}`}
      style={
        disabled
          ? { background: 'rgba(247,245,240,0.08)', color: 'rgba(247,245,240,0.45)' }
          : {
              background: 'linear-gradient(180deg, #ffdf8a, #f2b83a)',
              color: '#2a1a02',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 26px -10px rgba(242,184,58,0.9)',
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
      style={unread > 0 ? { ...surface(TINT.market), borderColor: `${TINT.market}80` } : surface(TINT.market)}
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

/**
 * L'emblème du Runner : un soir de sakura sur la voie. Ciel dégradé, soleil, montagnes et
 * torii à l'horizon, trois couloirs qui filent vers le spectateur, le coureur au premier plan.
 */
function RunnerEmblem() {
  return (
    <svg viewBox="0 0 72 72" className="block size-full">
      <defs>
        <linearGradient id="runner-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b3aa8" />
          <stop offset="0.55" stopColor="#ff6fb5" />
          <stop offset="1" stopColor="#ffd35c" />
        </linearGradient>
        <radialGradient id="runner-sun">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.6" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="runner-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1650" />
          <stop offset="1" stopColor="#120828" />
        </linearGradient>
      </defs>
      <rect width="72" height="40" fill="url(#runner-sky)" />
      <circle data-runner-sun cx="36" cy="30" r="13" fill="url(#runner-sun)" />
      <path d="M0 40 L0 31 L9 25 L16 30 L26 21 L34 29 L42 24 L50 30 L60 19 L72 29 L72 40 Z" fill="#3b2270" />
      {/* Torii à l'horizon. */}
      <g fill="#d6264b">
        <rect x="31" y="31.5" width="10" height="1.4" rx="0.6" />
        <rect x="32" y="33.6" width="8" height="0.9" />
        <rect x="32.8" y="32.5" width="1.1" height="7.5" />
        <rect x="38.1" y="32.5" width="1.1" height="7.5" />
      </g>
      <rect y="40" width="72" height="32" fill="url(#runner-ground)" />
      {/* Trois couloirs : rails qui défilent. */}
      <g stroke="#ff9ccf" strokeWidth="1.3" strokeDasharray="7 5" data-runner-rail>
        <line x1="33" y1="40" x2="4" y2="72" />
        <line x1="35" y1="40" x2="26" y2="72" />
        <line x1="37" y1="40" x2="46" y2="72" />
        <line x1="39" y1="40" x2="68" y2="72" />
      </g>
      {/* Le coureur, de dos, en pleine course. */}
      <g data-runner-hop>
        <ellipse cx="36" cy="68" rx="7" ry="1.6" fill="#000" opacity="0.35" />
        <path d="M33 66 L34.5 59 L37.5 59 L40 66" stroke="#2b3a7e" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <rect x="32" y="50" width="8" height="10" rx="2.6" fill="#f2f2f2" />
        <rect x="32" y="56.2" width="8" height="1.6" fill="#1f2a4d" />
        <path d="M32.5 52 L28.5 57 M39.5 52 L43.5 47.5" stroke="#f2c9a5" strokeWidth="2" strokeLinecap="round" />
        <circle cx="36" cy="46.5" r="4.2" fill="#1b1730" />
        <path d="M31.6 45 Q36 40.5 40.4 45 L41 46.6 L31 46.6 Z" fill="#e9c46a" />
        <rect x="31.8" y="45.6" width="8.4" height="1.2" fill="#c62828" />
      </g>
    </svg>
  )
}

const CANVAS_GRADIENT = 'linear-gradient(135deg, #2bc3ff, #7c5cff 55%, #ff5cb4)'

/**
 * La Toile : un tableau presque infini où tout le monde dessine en même temps. L'emblème montre
 * la grille, un trait qui se trace et trois curseurs d'artistes qui flottent ; sous le titre, combien
 * d'artistes sont en ligne. Sans compte, le clic mène à l'inscription.
 */
function CanvasArtefact() {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const openActivity = useUiStore((state) => state.openActivity)
  const openAuth = useUiStore((state) => state.openAuth)
  const covered = useUiStore((state) => state.boosterOpen)
  const signedIn = useAuthStore((state) => state.user !== null)
  const [online, setOnline] = useState<number | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    canvasApi
      .home()
      .then((home) => alive && setOnline(home.online))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [signedIn])

  useGSAP(
    () => {
      if (covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-canvas-c1]', { x: 5, y: -4, duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-canvas-c2]', { x: -4, y: 5, duration: 2.1, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('[data-canvas-c3]', { x: 3, y: 4, duration: 1.4, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.fromTo('[data-canvas-stroke]', { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 2.4, ease: 'power1.inOut', repeat: -1, repeatDelay: 0.8 })
    },
    { scope: ref, dependencies: [covered], revertOnUpdate: true },
  )

  return (
    <button ref={ref} type="button" data-artefact onClick={() => (signedIn ? openActivity('canvas') : openAuth())} className={`${ARTEFACT_CLASS} w-full overflow-hidden`} style={surface(TINT.canvas)}>
      <span className="flex items-center gap-5 p-5">
        <span aria-hidden className="relative block size-[4.5rem] shrink-0 overflow-hidden rounded-[1.4rem]" style={{ boxShadow: '0 0 28px -6px rgba(43,195,255,0.8), inset 0 0 0 2px rgba(124,92,255,0.55)' }}>
          <CanvasEmblem />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl" style={inkText(CANVAS_GRADIENT)}>
              {t.canvas.title}
            </span>
            <span className="rounded-full bg-[#2bc3ff]/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#7fd9ff] uppercase">{t.canvas.hub.eyebrow}</span>
            {online !== null && online > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-like/15 px-2 py-0.5 text-[10px] font-semibold text-like">
                <span className="size-1.5 rounded-full bg-like" aria-hidden />
                {t.canvas.hub.online(online)}
              </span>
            )}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-cream/65">{t.canvas.hub.body}</span>
        </span>
        <ChevronRight size={20} className="shrink-0 text-cream/40" aria-hidden />
      </span>
    </button>
  )
}

/** L'emblème de la Toile : grille de points, trait de pinceau, trois curseurs. */
function CanvasEmblem() {
  return (
    <svg viewBox="0 0 72 72" className="block size-full">
      <defs>
        <linearGradient id="canvas-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1450" />
          <stop offset="1" stopColor="#0c2a52" />
        </linearGradient>
        <pattern id="canvas-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#9db4ff" fillOpacity="0.35" />
        </pattern>
      </defs>
      <rect width="72" height="72" fill="url(#canvas-bg)" />
      <rect width="72" height="72" fill="url(#canvas-dots)" />
      <path data-canvas-stroke d="M10 50 C 20 24, 30 60, 42 36 S 58 22, 64 30" fill="none" stroke="#ffc46b" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="60 60" />
      <rect x="40" y="46" width="20" height="14" rx="2" fill="#ff5cb4" fillOpacity="0.85" />
      <circle cx="22" cy="20" r="6" fill="none" stroke="#2bc3ff" strokeWidth="2.2" />
      <g data-canvas-c1>
        <path d="M14 8 L14 22 L18 18.5 L21 25 L23.5 23.8 L20.6 17.6 L26 17.6 Z" fill="#2fd1a0" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
      <g data-canvas-c2>
        <path d="M44 38 L44 52 L48 48.5 L51 55 L53.5 53.8 L50.6 47.6 L56 47.6 Z" fill="#ff4d6d" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
      <g data-canvas-c3>
        <path d="M28 40 L28 54 L32 50.5 L35 57 L37.5 55.8 L34.6 49.6 L40 49.6 Z" fill="#9a6bff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
    </svg>
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

/* ---- Jeux -------------------------------------------------------------------------------------- */

const RUNNER_GRADIENT = 'linear-gradient(135deg, #ffd35c, #ff6fb5 55%, #c58bff)'
const STACK_GRADIENT = 'linear-gradient(135deg, #ffd35c, #ff9a5c 55%, #ff5ec4)'
/** Mèche de la bombe de la tuile : immobile, seule sa silhouette sert d'emblème. */
const HUB_FUSE_MS = 9000

/**
 * Les jeux, en tuiles égales : emblème, nom, une ligne pour dire de quoi il s'agit, les modes,
 * et un état quand il y en a un (énigmes à jouer, record). Deux colonnes sur téléphone, trois
 * au-delà : tout tient en un coup d'œil, sans long défilement.
 */
function GamesGrid() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const signedIn = useAuthStore((state) => state.user !== null)
  const overview = useDleStore((state) => state.overview)
  const hl = useHigherLowerStore((state) => state.overview?.me ?? null)
  const loadHl = useHigherLowerStore((state) => state.loadOverview)
  const g = t.activities.hub.games
  const toPlay = dailyToPlay(overview)

  useEffect(() => {
    if (signedIn) void loadHl()
  }, [signedIn, loadHl])

  const dleStatus: TileStatus | null =
    !signedIn || !overview ? null : toPlay > 0 ? { label: g.toPlay(toPlay), tint: TINT.dle, pulse: true } : { label: g.done, tint: '#3fe0a0', done: true }
  const hlStatus: TileStatus | null =
    signedIn && hl ? (hl.games === 0 ? { label: g.new, tint: '#5ef2c2' } : hl.best > 0 ? { label: g.record(hl.best), tint: '#ffb36b' } : null) : null

  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
      <GameTile title={t.dle.title} gradient={STARDUST_GRADIENT} tagline={g.dle} modes={g.modes.dle} tint={TINT.dle} status={dleStatus} onClick={() => openActivity('dle')}>
        <DleEmblem />
      </GameTile>
      <GameTile title={t.hl.title} gradient={HL_GRADIENT} tagline={g.hl} modes={g.modes.hl} tint={TINT.hl} status={hlStatus} onClick={() => openActivity('higherlower')}>
        <HlEmblem />
      </GameTile>
      <GameTile title={t.stack.title} gradient={STACK_GRADIENT} tagline={g.stack} modes={g.modes.stack} tint={TINT.stack} onClick={() => openActivity('stack')}>
        <span className="block size-16 overflow-hidden rounded-[1.25rem]" style={{ boxShadow: '0 0 22px -6px rgba(255,154,92,0.8), inset 0 0 0 2px rgba(255,211,92,0.55)' }}>
          <StackEmblem />
        </span>
      </GameTile>
      <GameTile title={t.bomb.title} gradient={BOMB_GRADIENT} tagline={g.bomb} modes={g.modes.bomb} tint={TINT.bomb} onClick={() => openActivity('bomb')}>
        <span className="block translate-y-1">
          <Bomb syllable="爆" endsAt={null} totalMs={HUB_FUSE_MS} size={64} />
        </span>
      </GameTile>
      <GameTile title={t.runner.title} gradient={RUNNER_GRADIENT} tagline={g.runner} modes={g.modes.runner} tint={TINT.runner} onClick={() => openActivity('runner')}>
        <span className="block size-16 overflow-hidden rounded-[1.25rem]" style={{ boxShadow: '0 0 22px -6px rgba(255,111,181,0.8), inset 0 0 0 2px rgba(255,211,92,0.55)' }}>
          <RunnerEmblem />
        </span>
      </GameTile>
    </div>
  )
}

interface TileStatus {
  label: string
  tint: string
  /** Quelque chose attend : la tuile s'allume, un point bat. */
  pulse?: boolean
  done?: boolean
}

interface GameTileProps {
  title: string
  gradient: string
  tagline: string
  modes: string
  tint: string
  status?: TileStatus | null
  onClick: () => void
  /** L'emblème du jeu. */
  children: ReactNode
}

function GameTile({ title, gradient, tagline, modes, tint, status = null, onClick, children }: GameTileProps) {
  const lit = status?.pulse === true
  return (
    <button
      type="button"
      data-artefact
      onClick={onClick}
      className="relative isolate flex min-h-[12.5rem] w-full flex-col items-start gap-3 overflow-hidden rounded-[1.5rem] border p-4 text-left transition-transform active:scale-[0.98]"
      style={{ backgroundColor: '#101017', borderColor: lit ? `${tint}99` : `${tint}38` }}
    >
      <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 -z-10 size-32 rounded-full opacity-20 blur-2xl" style={{ background: tint }} />
      <span className="flex w-full items-start justify-between gap-2">
        <span aria-hidden className="grid size-16 shrink-0 place-items-center">
          {children}
        </span>
        {status && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-tight font-semibold" style={{ backgroundColor: `${status.tint}22`, color: status.tint }}>
            {status.done ? (
              <Check size={11} aria-hidden className="shrink-0" />
            ) : status.pulse ? (
              <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full" style={{ background: status.tint }} />
            ) : null}
            <span className="truncate">{status.label}</span>
          </span>
        )}
      </span>
      <span className="mt-auto flex w-full min-w-0 flex-col gap-1">
        <span className="font-display text-xl leading-tight" style={inkText(gradient)}>
          {title}
        </span>
        <span className="text-xs leading-snug text-cream/70">{tagline}</span>
        <span className="text-[10px] font-semibold tracking-[0.12em] text-cream/40 uppercase">{modes}</span>
      </span>
    </button>
  )
}

/** Emblème du Plus ou Moins : une courbe qui grimpe dans un médaillon, flèches ▲ ▼. */
function HlEmblem() {
  return (
    <span className="relative grid size-16 shrink-0 place-items-center">
      <span className="absolute inset-0 rounded-[1.35rem]" style={{ background: HL_GRADIENT, boxShadow: '0 0 26px -6px rgba(94,242,194,0.7)' }} />
      <span className="absolute inset-[2.5px] rounded-[1.2rem]" style={{ background: 'radial-gradient(circle at 50% 38%, rgba(94,242,194,0.4), rgba(124,92,255,0.25) 45%, #0b0918 75%)' }} />
      <TrendingUp size={30} strokeWidth={2.5} className="relative text-[#eafff7]" />
      <span className="absolute -top-1.5 -right-1 text-[11px] leading-none" style={{ color: HL_UP.color }}>
        ▲
      </span>
      <span className="absolute -bottom-1.5 -left-1 text-[11px] leading-none" style={{ color: HL_DOWN.color }}>
        ▼
      </span>
    </span>
  )
}
