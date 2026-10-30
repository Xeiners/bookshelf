import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CalendarCheck, Check, Newspaper, ChevronRight, FlaskConical, Gift, Handshake, MoonStar, Sparkle, TrendingUp, WifiOff, Zap } from 'lucide-react'
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
import { useNews } from '../../store/useNews'
import { useUiStore } from '../../store/useUiStore'
import { StackEmblem } from '../stack/StackEmblem'
import { JumpEmblem } from '../jump/JumpEmblem'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CardBack } from '../cards/CardBack'
import { CARD_FRAMES } from '../cards/cardFrames'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { StardustBadge } from '../dle/StardustBadge'
import { HL_DOWN, HL_GRADIENT, HL_UP } from '../higherlower/hlStyle'
import { Bomb } from '../bomb/Bomb'
import { EnergyRing } from './EnergyRing'
import { ShopBanners } from './ShopBanners'
import { inkText } from '../../lib/ink'
import { canvasApi } from '../../services/canvasApi'
import { SeasonalCorner, SeasonalHubBanner } from '../layout/SeasonalDecor'

/** Texte néon : lueur de la couleur donnée. */
const neon = (color: string): CSSProperties => ({ color, textShadow: `0 0 6px ${color}, 0 0 18px ${color}` })

/**
 * Hub « Activités », en vitrine (façon App Store) :
 * 1. la barre d'état (série de la récompense, boosters, Poussières, actus), le bandeau de fête ;
 * 2. une grande bannière qui défile de côté — ouvrir un booster, la boutique (côte à côte sur
 *    ordinateur) ;
 * 3. « À faire aujourd'hui » : ce qui attend vraiment, un toucher mène au bon endroit ;
 * 4. des rangées de grandes cartes illustrées — Jeux, Cartes, Créer & explorer — qui défilent de
 *    côté sur téléphone (la carte suivante dépasse) et passent en grille sur grand écran.
 * Au retour d'un module, la page se replace sur sa rangée (`hubReturnTo`).
 */
export function ActivitiesHub() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  // Le hub n'affiche que le stock : le décompte à la seconde reste dans la bannière.
  const boosters = useBoosters({ tick: false })
  // Ouverture de booster en plein écran : le hub, recouvert, cesse de s'animer.
  const covered = useUiStore((state) => state.boosterOpen)
  const returnTo = useUiStore((state) => state.hubReturnTo)
  const signedIn = useAuthStore((state) => state.user !== null)
  const loadDle = useDleStore((state) => state.loadOverview)
  const stardust = useDleStore((state) => state.overview?.stardust ?? null)
  const sections = t.activities.hub.sections

  // Énigmes du jour : de quoi allumer la carte du DLE et la rangée « À faire ».
  useEffect(() => {
    if (signedIn) void loadDle()
  }, [signedIn, loadDle])

  // Retour d'un jeu ou d'un module : la page reprend à sa rangée, sans animation.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!returnTo || !root) return
    const section = root.querySelector<HTMLElement>(`[data-hub-section="${returnTo}"]`)
    if (section) root.scrollTop = section.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8
    useUiStore.getState().clearHubReturn()
  }, [returnTo])

  return (
    <div ref={rootRef} data-paused={covered || undefined} className="no-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-5 pb-10">
      <div className="flex shrink-0 flex-col gap-4">
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
          {/* Les Poussières ✦, juste à côté des boosters : ce qu'on peut dépenser à la boutique. */}
          {signedIn && stardust !== null && <StardustBadge balance={stardust} />}
          {/* Les actus : la pastille rouge tant qu'une nouveauté n'a pas été vue. */}
          <NewsChip />
          {boosters.unlimited && (
            <span
              title={t.activities.sandboxHint}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-like/40 bg-like/10 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-like uppercase"
            >
              <FlaskConical size={12} aria-hidden />
              {t.activities.sandbox}
            </span>
          )}
          {/* Développement : boosters d'aperçu pour voir une Légendaire ou une Mythique à coup sûr (absents du build). */}
          {import.meta.env.DEV && signedIn && <PreviewPacks />}
          {boosters.offline && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gold" title={t.activities.offline}>
              <WifiOff size={13} aria-hidden />
              <span className="sr-only">{t.activities.offline}</span>
            </span>
          )}
        </div>

        {/* Thème saisonnier : un bandeau de fête en tête du hub (rien hors thème). */}
        <SeasonalHubBanner />
        {boosters.signedIn && boosters.legendaryPacks > 0 && <LegendaryPackBanner count={boosters.legendaryPacks} />}
      </div>

      <HeroCarousel
        label={sections.boosters.title}
        slides={[
          { id: 'open', node: <BoosterHero part="open" /> },
          { id: 'shop', node: <BoosterHero part="shop" /> },
        ]}
      />

      <TodayRow />

      <ShelfRow id="cards" title={sections.cards.title} subtitle={sections.cards.subtitle} grid="md:grid-cols-2">
        <CollectionArtefact />
        <MarketArtefact />
      </ShelfRow>

      <ShelfRow id="games" title={sections.games.title} subtitle={sections.games.subtitle} grid="md:grid-cols-3 xl:grid-cols-5">
        <GamesCards />
      </ShelfRow>

      <ShelfRow id="more" title={sections.more.title} subtitle={sections.more.subtitle} grid="md:grid-cols-2">
        <CanvasArtefact />
        <OracleArtefact />
      </ShelfRow>
    </div>
  )
}

/** Titre d'une rangée : sobre, un titre et une ligne pour dire à quoi elle sert. */
function SectionTitle({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="font-display text-[1.4rem] leading-tight text-cream">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-mist">{subtitle}</p>
    </div>
  )
}

/**
 * Une rangée de la vitrine : elle défile de côté sur téléphone (la carte suivante dépasse, pour
 * inviter à faire glisser) et passe en grille sur grand écran (`grid` : ses colonnes). `id` sert
 * aussi à y revenir au retour d'un module (cf. `hubReturnTo`).
 */
function ShelfRow({ id, title, subtitle, grid, children }: { id: string; title: string; subtitle: string; grid: string; children: ReactNode }) {
  return (
    <section data-hub-section={id} aria-labelledby={`hub-${id}`} className="flex shrink-0 flex-col gap-3">
      <SectionTitle id={`hub-${id}`} title={title} subtitle={subtitle} />
      <div className={`no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0 ${grid}`}>{children}</div>
    </section>
  )
}

/**
 * La bannière du haut : des diapositives que l'on fait défiler de côté, avec des points de
 * pagination (touchables) ; sur ordinateur, elles s'affichent côte à côte, sans points.
 */
function HeroCarousel({ label, slides }: { label: string; slides: { id: string; node: ReactNode }[] }) {
  const t = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  /** Largeur d'un pas : une diapositive et l'écart qui la suit. */
  const step = () => {
    const track = trackRef.current
    const first = track?.firstElementChild as HTMLElement | null
    if (!track || !first) return 0
    return first.offsetWidth + Number.parseFloat(getComputedStyle(track).columnGap || '0')
  }
  const onScroll = () => {
    const width = step()
    if (width > 0 && trackRef.current) setActive(Math.min(slides.length - 1, Math.round(trackRef.current.scrollLeft / width)))
  }
  const goTo = (index: number) => {
    vibrate(5)
    trackRef.current?.scrollTo({ left: index * step(), behavior: 'smooth' })
  }

  return (
    <section data-hub-section="boosters" aria-label={label} aria-roledescription="carousel" className="flex shrink-0 flex-col gap-3">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0"
      >
        {slides.map((slide, index) => (
          <div key={slide.id} aria-roledescription="slide" aria-label={t.activities.hub.slide(index + 1, slides.length)} className="w-full shrink-0 snap-center lg:w-auto">
            {slide.node}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 lg:hidden">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            aria-label={t.activities.hub.slide(index + 1, slides.length)}
            aria-current={index === active || undefined}
            onClick={() => goTo(index)}
            className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${index === active ? 'w-5 bg-cream' : 'w-1.5 bg-white/25'}`}
          />
        ))}
      </div>
    </section>
  )
}

interface TodayItem {
  id: string
  icon: typeof Zap
  tint: string
  title: string
  hint: string
  onClick: () => void
}

/**
 * « À faire aujourd'hui » : une rangée de raccourcis, seulement pour ce qui attend vraiment
 * (récompense du jour, booster prêt, énigmes du jour, tirage de l'Oracle, nouveauté au Marché).
 * Rien en attente : une ligne le dit, et la rangée disparaît.
 */
function TodayRow() {
  const t = useT()
  const copy = t.activities.hub.today
  const signedIn = useAuthStore((state) => state.user !== null)
  const boosters = useBoosters({ tick: false })
  const daily = useDailyStore((state) => state.status)
  const showDaily = useDailyStore((state) => state.show)
  const overview = useDleStore((state) => state.overview)
  const oracle = useOracleStatus()
  const unread = useUnreadTrades()
  const openActivity = useUiStore((state) => state.openActivity)
  const openBooster = useUiStore((state) => state.openBooster)

  const items: TodayItem[] = []
  if (signedIn && daily?.claimable) items.push({ id: 'daily', icon: CalendarCheck, tint: TINT.booster, title: copy.daily, hint: copy.dailyHint, onClick: showDaily })
  if (boosters.ready && boosters.canOpen) {
    items.push({ id: 'booster', icon: Zap, tint: TINT.booster, title: copy.booster(boosters.unlimited ? null : boosters.available), hint: copy.boosterHint, onClick: () => openBooster() })
  }
  const toPlay = dailyToPlay(overview)
  if (signedIn && toPlay > 0) items.push({ id: 'dle', icon: Sparkle, tint: TINT.dle, title: copy.dle(toPlay), hint: copy.dleHint, onClick: () => openActivity('dle') })
  if (oracle.available) items.push({ id: 'oracle', icon: MoonStar, tint: TINT.oracle, title: copy.oracle, hint: copy.oracleHint, onClick: () => openActivity('oracle') })
  if (unread > 0) items.push({ id: 'market', icon: Handshake, tint: TINT.market, title: copy.market(unread), hint: copy.marketHint, onClick: () => openActivity('market') })

  return (
    <section aria-labelledby="hub-today" className="flex shrink-0 flex-col gap-3">
      <SectionTitle id="hub-today" title={copy.title} subtitle={items.length > 0 ? copy.subtitle : copy.allDone} />
      {items.length > 0 && (
        // Défile de côté sur téléphone (les cartes s'alignent), en grille au-delà.
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          {items.map(({ id, icon: Icon, tint, title, hint, onClick }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                vibrate(8)
                onClick()
              }}
              className="group flex w-[15.5rem] shrink-0 snap-start items-center gap-3 rounded-2xl border border-white/[0.07] p-3 text-left transition-[transform,border-color] duration-200 hover:border-white/[0.16] active:scale-[0.98] md:w-auto"
              style={{ background: CARD_SURFACE }}
            >
              <span aria-hidden className="relative grid size-11 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${tint}17`, color: tint }}>
                <Icon size={20} />
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[#13131b]" style={{ backgroundColor: tint }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-cream">{title}</span>
                <span className="block truncate text-[11px] text-mist">{hint}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-cream/25 transition-colors duration-200 group-hover:text-cream/60" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** Développement seulement : ouvre un booster d'aperçu avec une Légendaire ou une Mythique. */
function PreviewPacks() {
  const t = useT()
  const open = useUiStore((state) => state.openPreviewPack)
  const packs = [
    { rarity: 'LEGENDARY', label: t.activities.preview.legendary, style: { background: 'linear-gradient(135deg, #fff0b0, #e0a82e 55%, #c8901c)', color: '#2a1a02' } },
    { rarity: 'MYTHIC', label: t.activities.preview.mythic, style: { background: 'linear-gradient(100deg, #ff5ec4, #ffc46b 30%, #3fe0a0 55%, #4cc9f0 80%, #b46cff)', color: '#0b0b12' } },
  ] as const
  return (
    <>
      {packs.map((pack) => (
        <button
          key={pack.rarity}
          type="button"
          title={t.activities.preview.hint}
          onClick={() => {
            vibrate(10)
            open(pack.rarity)
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-transform active:scale-95"
          style={pack.style}
        >
          <FlaskConical size={13} aria-hidden />
          {pack.label}
        </button>
      ))}
    </>
  )
}

function NewsChip() {
  const t = useT()
  const unseen = useNews((state) => state.unseen)
  return (
    <button
      type="button"
      onClick={() => {
        vibrate(6)
        useNews.getState().openPage()
      }}
      aria-label={unseen > 0 ? `${t.news.openAria} · ${t.news.unseen(unseen)}` : t.news.openAria}
      className="relative ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3 text-xs font-semibold text-cream/85 transition-transform active:scale-95"
    >
      <Newspaper size={14} aria-hidden />
      {t.news.open}
      {unseen > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-[#ff4d6d] ring-2 ring-[#050507]" />}
    </button>
  )
}

/** Énigmes du jour pas encore résolues (toutes catégories et tous formats). */
const dailyToPlay = (overview: ReturnType<typeof useDleStore.getState>['overview']): number =>
  overview ? Object.values(overview.daily).flatMap((modes) => Object.values(modes)).filter((daily) => !daily.solved).length : 0

/**
 * La série de la récompense du jour, en pastille (un toucher rouvre le calendrier). À récupérer :
 * c'est la rangée « À faire aujourd'hui » qui le propose, la pastille s'efface. Rien en invité.
 */
function DailyChip() {
  const t = useT()
  const signedIn = useAuthStore((state) => state.user !== null)
  const status = useDailyStore((state) => state.status)
  const show = useDailyStore((state) => state.show)
  if (!signedIn || !status || status.claimable) return null
  return (
    <button
      type="button"
      onClick={show}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#ffe39a]/25 bg-black/40 px-3 text-xs font-semibold text-cream/75 transition-transform active:scale-95"
    >
      <CalendarCheck size={14} aria-hidden />
      {t.activities.hub.daily.streak(Math.min(status.streak, CYCLE_DAYS), CYCLE_DAYS)}
    </button>
  )
}

/** Couleur de chaque mode : couverture de sa carte, pastille d'état, raccourci « À faire ». */
const TINT = { booster: '#ffc46b', oracle: '#9d7bff', collection: '#e0a82e', market: '#3fe0a0', bomb: '#b46cff', dle: '#ff5ec4', hl: '#4cc9f0', runner: '#ff6fb5', canvas: '#2bc3ff', stack: '#ff9a5c', jump: '#ff8a6b' } as const

/* ---- Vedette : l'ouverture des boosters ------------------------------------------------------------- */

/**
 * La vedette de la page : les trois séries en éventail qui flottent dans un halo, le titre, la
 * Légendaire garantie, et un grand bouton « Ouvrir » avec sa jauge. Plus de booster : la jauge
 * montre l'attente et le compte à rebours. Sans compte : les boosters d'essai, puis l'inscription.
 * Une seule animation en boucle (le paquet qui flotte), coupée quand l'ouverture recouvre la page.
 */
/** Pack Légendaire offert par l'équipe : il s'ouvre ici, avec la mise en scène des boosters. */
function LegendaryPackBanner({ count }: { count: number }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={() => {
        vibrate(12)
        useUiStore.getState().openLegendaryPack()
      }}
      className="relative mb-3 flex w-full shrink-0 items-center gap-3 overflow-hidden rounded-[1.5rem] border border-[#ffd27a]/60 p-3.5 text-left shadow-[0_0_40px_-14px_#ffc46b] transition-transform active:scale-[0.99] sm:gap-4 sm:p-4"
      style={{ background: 'radial-gradient(120% 120% at 0% 0%, rgba(255,214,130,0.35), transparent 55%), linear-gradient(110deg, #3a2408, #24120a 55%, #2a0f22)' }}
    >
      <span className="relative -my-2 shrink-0" style={{ transform: 'rotate(-8deg)' }}>
        <BoosterPackArt width={46} series={3} lit halo="LEGENDARY" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-[10px] font-semibold tracking-[0.2em] text-[#ffd27a] uppercase">{t.activities.legendaryPack.eyebrow}</span>
        <span className="block font-display text-lg leading-tight text-cream sm:text-xl">{t.activities.legendaryPack.title(count)}</span>
        <span className="block text-xs text-cream/65">{t.activities.legendaryPack.body}</span>
      </span>
      <span className="btn-cta relative shrink-0 rounded-full px-4 py-2 text-sm font-bold">
        {t.activities.legendaryPack.open}
      </span>
    </button>
  )
}

/**
 * La vedette des boosters, en deux diapositives de la bannière du haut : `open` (le paquet, le
 * titre, la jauge et « Ouvrir ») et `shop` (la boutique : un booster ou une boîte mystère contre des ✦).
 */
function BoosterHero({ part }: { part: 'open' | 'shop' }) {
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
  // Le stock normal (3 au plus) ; les boosters offerts, hors plafond, s'affichent à part.
  const stock = boosters.available - boosters.gifted
  const ring = guestDone ? (
    <Gift size={20} className="text-[#fff4c8]/70" aria-hidden />
  ) : boosters.unlimited ? (
    <span className="text-2xl leading-none font-semibold" style={neon('#3fe0a0')}>
      ∞
    </span>
  ) : stock > 0 ? (
    <span className="text-lg leading-none font-semibold tabular-nums" style={neon('#ffc46b')}>
      {stock}/{boosters.max}
    </span>
  ) : boosters.gifted > 0 ? (
    // Stock vide, boosters offerts en réserve : on les montre (ils s'ouvrent tout de suite).
    <span className="text-lg leading-none font-semibold tabular-nums" style={neon('#ffc46b')}>
      +{boosters.gifted}
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
      aria-label={part === 'open' ? t.activities.booster.title : t.activities.shop.buyTitle}
      className="relative isolate flex h-full shrink-0 flex-col overflow-hidden rounded-[2rem] border"
      style={{
        borderColor: lit ? 'rgba(255,214,130,0.6)' : 'rgba(255,196,107,0.22)',
        background: lit
          ? 'radial-gradient(120% 90% at 20% 20%, rgba(255,196,107,0.12), transparent 60%), radial-gradient(90% 80% at 90% 100%, rgba(255,94,196,0.07), transparent 60%), #0e0e14'
          : 'radial-gradient(120% 90% at 20% 20%, rgba(124,92,255,0.09), transparent 60%), #0e0e14',
      }}
    >
      {part === 'open' && <SeasonalCorner size={84} />}
      {part === 'open' && (
      <div className="flex min-w-0 flex-1 flex-col justify-center">
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
      )}
      {/* La boutique : un booster ou une boîte mystère contre des ✦. */}
      {part === 'shop' && (
        <div className="flex min-w-0 flex-1 flex-col justify-center p-3 sm:p-4 md:p-5">
          <ShopBanners />
        </div>
      )}
    </section>
  )
}

function GoldButton({ onClick, icon, label, disabled = false, wide = false }: { onClick: () => void; icon: ReactNode; label: string; disabled?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // Bouton d'action principal : son habit vient du thème (`.btn-cta`, cf. index.css).
      className={`relative inline-flex h-13 max-w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-full px-5 text-[15px] font-semibold transition-transform active:scale-95 disabled:cursor-not-allowed sm:px-6 ${wide ? 'flex-1' : ''} ${disabled ? '' : 'btn-cta'}`}
      style={disabled ? { background: 'rgba(247,245,240,0.08)', color: 'rgba(247,245,240,0.45)' } : undefined}
    >
      {/* Libellé long (autre langue, écran étroit) : points de suspension, jamais de texte coupé net. */}
      <span className="relative flex min-w-0 items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
    </button>
  )
}

/* ---- Carte d'un mode ------------------------------------------------------------------------ */

/** État d'une carte, en pastille : quelque chose attend, c'est fait, ou une simple info. */
interface CardStatus {
  label: string
  tone: 'attention' | 'done' | 'info'
}

interface HubCardProps {
  title: string
  description: string
  /** Couleur du mode : teinte de la couverture et de la pastille. */
  tint: string
  status?: CardStatus | null
  /** Barre de progression (0 → 1) en bas de la carte. */
  progress?: number | null
  /** Scène illustrée qui remplit toute la couverture (Runner, Toile, Page Stack). */
  scene?: ReactNode
  /** Sinon : l'emblème (64 px), en grand au centre, sur la couleur du mode. */
  emblem?: ReactNode
  onClick: () => void
}

/**
 * Carte d'un mode du hub — la même pour les jeux, l'album, le Marché, la Toile et l'Oracle :
 * une couverture teintée de la couleur du mode avec son emblème (et l'état en pastille), puis le
 * titre, une description courte, une ligne d'info, et une barre de progression s'il y a lieu.
 * Aucune animation en boucle : rien ne bouge tant qu'on ne la touche pas.
 */
function HubCard({ title, description, tint, status = null, progress = null, scene = null, emblem = null, onClick }: HubCardProps) {
  const attention = status?.tone === 'attention'
  return (
    <button
      type="button"
      data-artefact
      onClick={() => {
        vibrate(6)
        onClick()
      }}
      // Dans une rangée : la carte suivante dépasse sur téléphone ; en grille au-delà.
      className="group relative isolate flex w-[min(15rem,64vw)] shrink-0 snap-start flex-col overflow-hidden rounded-[1.5rem] border border-white/[0.07] text-left transition-[transform,border-color] duration-200 hover:border-white/[0.16] active:scale-[0.98] md:w-auto md:min-w-0"
      style={{ background: CARD_SURFACE }}
    >
      {/* Couverture illustrée, en pleine largeur : la scène du mode, ou son emblème en grand sur sa couleur. */}
      <span aria-hidden className="relative block h-40 shrink-0 overflow-hidden">
        {scene ? (
          <span className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]">{scene}</span>
        ) : (
          <>
            <span className="absolute inset-0" style={{ background: `radial-gradient(85% 95% at 50% 38%, ${tint}55, transparent 72%), linear-gradient(160deg, ${tint}2a, #0c0c12 80%)` }} />
            <span className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.4px)', backgroundSize: '14px 14px' }} />
            <span className="absolute inset-0 grid place-items-center pb-5">
              <span className="grid size-16 scale-[1.5] place-items-center transition-transform duration-500 group-hover:scale-[1.58]">{emblem}</span>
            </span>
          </>
        )}
        {/* Le bas de l'illustration se fond dans la carte, sous le titre. */}
        <span className="absolute inset-x-0 bottom-0 h-3/5" style={{ background: 'linear-gradient(to top, #0e0e14 8%, rgba(14,14,20,0.72) 45%, transparent)' }} />
        {/* Liseré lumineux en haut, à la couleur du mode : plus vif quand quelque chose attend. */}
        <span className="absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${tint}${attention ? 'ee' : '80'}, transparent)` }} />
      </span>
      {status && <StatusPill status={status} tint={tint} />}

      <span className="relative -mt-9 flex min-w-0 flex-1 flex-col gap-1 px-4 pb-4">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-display text-lg leading-tight text-cream">{title}</span>
          <ChevronRight size={16} aria-hidden className="ml-auto shrink-0 text-cream/30 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-cream/70" />
        </span>
        <span className="truncate text-xs text-mist">{description}</span>
        {progress !== null && (
          <span aria-hidden className="mt-2.5 block h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
            <span className="block h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, background: tint }} />
          </span>
        )}
      </span>
    </button>
  )
}

/** Surface des cartes du hub : presque noire, à peine plus claire en haut. */
const CARD_SURFACE = 'linear-gradient(180deg, #13131b 0%, #0c0c12 100%)'

/** Pastille d'état, sobre : fond sombre, texte clair ; un point de couleur si quelque chose attend, une coche si c'est fait. */
function StatusPill({ status, tint }: { status: CardStatus; tint: string }) {
  return (
    <span className="absolute top-3 right-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[10px] leading-tight font-semibold text-cream/85">
      {status.tone === 'done' ? (
        <Check size={11} aria-hidden className="shrink-0 text-like" />
      ) : status.tone === 'attention' ? (
        <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full" style={{ background: tint }} />
      ) : null}
      <span className="truncate">{status.label}</span>
    </span>
  )
}

/* ---- Cartes, Créer & explorer ----------------------------------------------------------------- */

/** L'album : les trois cartes les plus rares en éventail (sinon trois dos), et la progression. */
function CollectionArtefact() {
  const t = useT()
  const { signedIn, data } = useCollection()
  const openActivity = useUiStore((state) => state.openActivity)
  const best = (data?.cards ?? [])
    .filter((card) => card.owned)
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.number - b.number)
    .slice(0, 3)
  const percent = data ? completion(data.owned, data.total) : 0
  const fan = best.length > 0 ? best : [null, null, null]

  return (
    <HubCard
      title={t.activities.collection.title}
      description={signedIn ? t.activities.collection.body : t.activities.guest.collectionBody}
      tint={TINT.collection}
      status={data ? { label: `${percent} %`, tone: percent === 100 ? 'done' : 'info' } : null}
      progress={data ? percent / 100 : null}
      onClick={() => openActivity('collection')}
      emblem={
        <span className="relative block h-16 w-14">
          {fan.map((card, index) => (
            <span
              key={card?.id ?? index}
              className="absolute top-1 left-[0.6rem] block origin-bottom overflow-hidden rounded-[5px] shadow-[0_8px_16px_-8px_rgba(0,0,0,0.9)]"
              style={{ transform: `rotate(${(index - (fan.length - 1) / 2) * 14}deg)`, zIndex: index === 1 ? 2 : 1 }}
            >
              {card ? (
                <span className="block h-[3.5rem] w-[2.5rem] p-[2px]" style={{ background: CARD_FRAMES[card.rarity].metal }}>
                  <img src={card.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full rounded-[3px] object-cover" />
                </span>
              ) : (
                <CardBack width={40} animated={false} />
              )}
            </span>
          ))}
        </span>
      }
    />
  )
}

/** Le Marché : échanger ses doublons avec les autres collectionneurs ; une nouveauté l'allume. */
function MarketArtefact() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const unread = useUnreadTrades()
  const mine = useTradeStore((state) => state.mine)
  const openOffers = mine?.filter((offer) => offer.mine && offer.status === 'OPEN').length ?? null

  return (
    <HubCard
      title={t.trades.title}
      description={t.trades.body}
      tint={TINT.market}
      status={unread > 0 ? { label: t.trades.hubNew(unread), tone: 'attention' } : openOffers ? { label: t.trades.hubOpen(openOffers), tone: 'info' } : null}
      onClick={() => openActivity('market')}
      emblem={
        <span className="grid size-14 place-items-center rounded-2xl border border-[#3fe0a0]/35 bg-black/40 text-[#3fe0a0]">
          <Handshake size={26} />
        </span>
      }
    />
  )
}

/** La Toile : un tableau presque infini où tout le monde dessine ; sans compte, mène à l'inscription. */
function CanvasArtefact() {
  const t = useT()
  const openActivity = useUiStore((state) => state.openActivity)
  const openAuth = useUiStore((state) => state.openAuth)
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

  return (
    <HubCard
      title={t.canvas.title}
      description={t.canvas.hub.body}
      tint={TINT.canvas}
      status={online !== null && online > 0 ? { label: t.canvas.hub.online(online), tone: 'info' } : null}
      onClick={() => (signedIn ? openActivity('canvas') : openAuth())}
      scene={<CanvasEmblem cover />}
    />
  )
}

/** L'Oracle : le tirage du jour, et la série. */
function OracleArtefact() {
  const t = useT()
  const oracle = useOracleStatus()
  const { streak } = useActivitiesStatus()
  const openActivity = useUiStore((state) => state.openActivity)

  return (
    <HubCard
      title={t.activities.oracle.title}
      description={t.activities.oracle.body}
      tint={TINT.oracle}
      status={oracle.available ? { label: t.activities.oracle.ready, tone: 'attention' } : { label: streak > 0 ? t.oracle.streak(streak) : t.activities.oracle.done, tone: 'done' }}
      onClick={() => openActivity('oracle')}
      emblem={
        <span
          className="grid h-16 w-11 -rotate-[8deg] place-items-center rounded-lg border border-[#ffe39a]/60"
          style={{
            background: 'radial-gradient(circle at 50% 40%, rgba(180,108,255,0.55), transparent 65%), linear-gradient(160deg, #22154a, #0b0918)',
            boxShadow: 'inset 0 0 0 2px rgba(11,9,24,1), inset 0 0 0 3px rgba(255,228,160,0.35)',
          }}
        >
          <MoonStar size={20} className="text-[#fff4c8]" />
        </span>
      }
    />
  )
}

/* ---- Jeux -------------------------------------------------------------------------------------- */

/** Mèche de la bombe de la carte : immobile, seule sa silhouette sert d'emblème. */
const HUB_FUSE_MS = 9000

/** Les cartes des jeux, posées dans leur rangée de la vitrine. */
function GamesCards() {
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

  const dleStatus: CardStatus | null = !signedIn || !overview ? null : toPlay > 0 ? { label: g.toPlay(toPlay), tone: 'attention' } : { label: g.done, tone: 'done' }
  const hlStatus: CardStatus | null = signedIn && hl ? (hl.games === 0 ? { label: g.new, tone: 'info' } : hl.best > 0 ? { label: g.record(hl.best), tone: 'info' } : null) : null

  return (
    <>
      <HubCard title={t.dle.title} description={g.dle} tint={TINT.dle} status={dleStatus} onClick={() => openActivity('dle')} emblem={<DleEmblem />} />
      <HubCard title={t.hl.title} description={g.hl} tint={TINT.hl} status={hlStatus} onClick={() => openActivity('higherlower')} emblem={<HlEmblem />} />
      <HubCard
        title={t.jump.title}
        description={g.jump}
        tint={TINT.jump}
        status={{ label: g.new, tone: 'attention' }}
        onClick={() => openActivity('jump')}
        scene={<JumpEmblem wide className="block size-full" />}
      />
      <HubCard
        title={t.stack.title}
        description={g.stack}
        tint={TINT.stack}
        onClick={() => openActivity('stack')}
        scene={<StackEmblem wide className="block size-full" />}
      />
      <HubCard
        title={t.bomb.title}
        description={g.bomb}
        tint={TINT.bomb}
        onClick={() => openActivity('bomb')}
        emblem={
          <span className="block translate-y-1">
            <Bomb syllable="爆" endsAt={null} totalMs={HUB_FUSE_MS} size={64} />
          </span>
        }
      />
      <HubCard
        title={t.runner.title}
        description={g.runner}
        tint={TINT.runner}
        onClick={() => openActivity('runner')}
        scene={<RunnerEmblem cover />}
      />
    </>
  )
}

/** Cadrage d'un dessin carré : remplir le cadre (rogné) ou s'y loger entier. */
const svgFit = (cover: boolean) => (cover ? 'xMidYMid slice' : 'xMidYMid meet') // i18n-ignore : attributs SVG

/**
 * L'emblème du Runner : un soir de sakura sur la voie. Ciel dégradé, soleil, montagnes et
 * torii à l'horizon, trois couloirs qui filent vers le spectateur, le coureur au premier plan.
 */
function RunnerEmblem({ cover = false }: { /** Remplit tout le cadre (rogné), au lieu de s'y loger. */ cover?: boolean }) {
  return (
    <svg viewBox="0 0 72 72" preserveAspectRatio={svgFit(cover)} className="block size-full">
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

/** L'emblème de la Toile : grille de points, trait de pinceau, trois curseurs. */
function CanvasEmblem({ cover = false }: { /** Remplit tout le cadre (rogné), au lieu de s'y loger. */ cover?: boolean }) {
  return (
    <svg viewBox="0 0 72 72" preserveAspectRatio={svgFit(cover)} className="block size-full">
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
