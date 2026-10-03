import { useEffect, useRef, type ReactNode } from 'react'
import { Check, Flame, Lock, Sparkle, Sparkles, Timer } from 'lucide-react'
import { useNow } from '../../hooks/useNow'
import { useT } from '../../i18n'
import { formatCountdownLong } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { DLE_MODES, type DleCategory, type DleOverview, type DleWorkOption } from '../../services/dleApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { pendingGuestStardust, useGuestStardustStore } from '../../store/useGuestStardustStore'
import { CATEGORY_STYLE, STARDUST_GRADIENT } from './dleStyle'
import { BoosterEntry } from './MenuEntry'
import { StardustBadge } from './StardustBadge'

type CharacterCategory = Exclude<DleCategory, 'manga'>

/** Visages des cartes de personnages (ceux dont MyAnimeList a un portrait, en général). */
const FACES: Record<CharacterCategory, string[]> = {
  naruto: ['naruto', 'sasuke', 'kakashi'],
  onepiece: ['luffy', 'zoro', 'sanji'],
  jojo: ['jotaro', 'giorno', 'dio'],
  jjk: ['yuji', 'gojo', 'sukuna'],
}

/**
 * Entrée du BookshelfDLE : une grille Bento des catégories. Une grande carte pour
 * les mangas et manhwas (éventail de couvertures), une par univers de personnages
 * (Naruto, One Piece, JoJo, Jujutsu Kaisen : portraits), et des univers à venir, verrouillés. Chaque carte dit s'il reste une énigme du jour.
 */
export function BentoHome({ overview }: { overview: DleOverview }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const works = useDleStore((state) => state.works)
  const loadWorks = useDleStore((state) => state.loadWorks)
  const openCategory = useDleStore((state) => state.openCategory)
  const signedIn = useAuthStore((state) => state.user !== null)
  const guestReceipts = useGuestStardustStore((state) => state.receipts)
  const now = useNow(true, 1000)

  // Illustrations des cartes : quelques couvertures, quelques portraits.
  useEffect(() => {
    void loadWorks('manga')
    void loadWorks('naruto')
    void loadWorks('onepiece')
    void loadWorks('jojo')
    void loadWorks('jjk')
  }, [loadWorks])

  useGSAP(
    () => {
      gsap.fromTo('[data-logo]', { y: -16, autoAlpha: 0, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: EASE.snap })
      gsap.fromTo('[data-bento]', { y: 28, scale: 0.96, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.7, stagger: 0.09, delay: 0.1, ease: EASE.glide })
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.to('[data-logo-star]', { rotation: 360, duration: 6, repeat: -1, ease: 'none', stagger: { each: 3 } })
      gsap.to('[data-soon-glow]', { autoAlpha: 0.35, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    },
    { scope: rootRef },
  )

  const covers = (works.manga ?? []).slice(0, 4)
  const facesOf = (category: CharacterCategory) =>
    FACES[category].map((id) => works[category]?.find((work) => work.id === id)).filter((work): work is DleWorkOption => work !== undefined)
  const countdown = formatCountdownLong(Date.parse(overview.nextAt) - now)

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pt-2">
        {/* Logo, série, solde. */}
        <header data-logo className="flex flex-col items-center gap-3">
          <h2 className="flex items-center gap-3 font-display text-[2.6rem] leading-none sm:text-5xl">
            <Sparkles data-logo-star size={22} className="text-[#ffc46b]" aria-hidden />
            <span style={{ backgroundImage: STARDUST_GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t.dle.title}</span>
            <Sparkles data-logo-star size={22} className="text-[#b46cff]" aria-hidden />
          </h2>
          <div className="flex items-center gap-2">
            {overview.stats.dailyStreak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs font-semibold text-gold tabular-nums" title={t.dle.home.stats.streak}>
                <Flame size={13} aria-hidden />
                {overview.stats.dailyStreak}
              </span>
            )}
            <StardustBadge balance={signedIn ? overview.stardust : pendingGuestStardust(guestReceipts)} />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <BentoCard category="manga" overview={overview} showStatus={signedIn} className="col-span-2 h-48 sm:h-56" onOpen={() => openCategory('manga')}>
            {/* Éventail de couvertures : en haut à droite sur téléphone (le titre garde sa place), en bas sur grand écran. */}
            <span aria-hidden className="absolute top-3 right-3 flex items-start sm:top-auto sm:right-4 sm:bottom-0 sm:h-full sm:items-end sm:pb-4">
              {covers.map((work, index) => (
                <img
                  key={work.id}
                  src={work.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`-ml-8 h-24 w-[4.2rem] rounded-xl border-2 border-white/20 object-cover shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:-translate-y-1.5 sm:-ml-10 sm:h-40 sm:w-28 ${index >= 3 ? 'hidden sm:block' : ''}`}
                  style={{ transform: `rotate(${(index - (covers.length - 1) / 2) * 9}deg) translateY(${Math.abs(index - (covers.length - 1) / 2) * 8}px)`, zIndex: index }}
                />
              ))}
            </span>
          </BentoCard>

          {(['naruto', 'onepiece', 'jojo', 'jjk'] as const).map((category) => (
            <BentoCard key={category} category={category} overview={overview} showStatus={signedIn} className="col-span-1 h-44 sm:h-56" onOpen={() => openCategory(category)}>
              <span aria-hidden className="absolute -top-1 -right-4 flex items-start sm:-right-3">
                {facesOf(category).map((work, index) => (
                  <img
                    key={work.id}
                    src={work.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(event) => (event.currentTarget.style.display = 'none')}
                    className="-ml-7 w-14 rounded-b-2xl border-2 border-t-0 border-white/20 object-cover object-top transition-transform duration-300 group-hover:translate-y-1.5 sm:-ml-6 sm:w-[4.5rem]"
                    style={{ height: `${6.4 - Math.abs(index - 1) * 1.1}rem`, zIndex: index === 1 ? 3 : 1 }}
                  />
                ))}
              </span>
            </BentoCard>
          ))}

          {/* Univers à venir : verrouillés, une lueur qui respire. */}
          <div data-bento className="relative col-span-2 flex h-28 flex-col justify-end overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-4">
            <span data-soon-glow aria-hidden className="pointer-events-none absolute inset-0 rounded-[1.75rem]" style={{ boxShadow: 'inset 0 0 0 1px rgba(180,108,255,0.6), inset 0 0 40px -10px rgba(180,108,255,0.55)' }} />
            <span aria-hidden className="absolute top-4 right-4 flex gap-2">
              {[0, 1].map((slot) => (
                <span key={slot} className="grid h-14 w-11 place-items-center rounded-xl border border-dashed border-white/15 bg-black/30 text-mist/60">
                  <Lock size={16} />
                </span>
              ))}
            </span>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
              <Lock size={11} aria-hidden />
              {t.dle.categories.locked}
            </span>
            <span className="mt-2 font-display text-2xl text-cream/70">{t.dle.categories.soon}</span>
          </div>
        </div>

        {signedIn && (
          <div data-bento className="flex flex-col">
            <BoosterEntry balance={overview.stardust} price={overview.boosterPrice} />
          </div>
        )}

        <p className="inline-flex items-center justify-center gap-1.5 text-xs text-mist tabular-nums" title={t.dle.home.nextIn(countdown)}>
          <Timer size={13} aria-hidden />
          {countdown}
        </p>
      </div>
    </div>
  )
}

interface BentoCardProps {
  category: DleCategory
  overview: DleOverview
  /** Badge « à jouer » des énigmes du jour (comptes seulement). */
  showStatus: boolean
  className: string
  onOpen: () => void
  /** Illustration (couvertures, portraits), à droite de la carte. */
  children: ReactNode
}

/** Une catégorie : son dégradé, son nom, son illustration, et l'état de ses énigmes du jour. */
function BentoCard({ category, overview, showStatus, className, onOpen, children }: BentoCardProps) {
  const t = useT()
  const style = CATEGORY_STYLE[category]
  const toPlay = DLE_MODES.filter((mode) => !overview.daily[category][mode].solved).length
  return (
    <button
      type="button"
      data-bento
      onClick={() => {
        vibrate(10)
        onOpen()
      }}
      className={`group relative isolate flex flex-col justify-end overflow-hidden rounded-[1.75rem] p-4 text-left transition-transform duration-300 hover:-translate-y-1 active:scale-[0.98] sm:p-5 ${className}`}
      style={{ background: `radial-gradient(circle at 85% 20%, ${style.glow}, transparent 60%), linear-gradient(160deg, rgba(24,20,38,0.96), rgba(8,8,14,0.96))` }}
    >
      {/* Liseré du dégradé de la catégorie, et lueur au survol. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[1.75rem] border-2 border-transparent" style={{ background: `${style.gradient} border-box`, WebkitMask: 'linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude', opacity: 0.55 }} />
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-[1.75rem] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ boxShadow: `inset 0 0 60px -10px ${style.glow}` }} />
      {children}
      <span className={`relative z-10 flex flex-col items-start gap-1.5 ${category === 'manga' ? 'max-w-[58%] sm:max-w-none' : ''}`}>
        {showStatus && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] whitespace-nowrap uppercase ${toPlay > 0 ? 'text-[#1a0b1f]' : 'bg-like/20 text-like'}`}
            style={toPlay > 0 ? { background: STARDUST_GRADIENT } : undefined}
          >
            {toPlay > 0 ? <Sparkle size={10} className="fill-current" aria-hidden /> : <Check size={11} strokeWidth={3} aria-hidden />}
            {/* Court : tient sur une ligne, même dans une demi-carte de téléphone. */}
            {toPlay > 0 ? t.dle.hub.toPlayShort(toPlay) : t.dle.hub.doneShort}
          </span>
        )}
        <span className={`font-display leading-none text-white ${category === 'manga' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'}`} style={{ textShadow: '0 2px 14px rgba(0,0,0,0.7)' }}>
          {t.dle.categories[category].title}
        </span>
        <span className={`line-clamp-1 text-xs ${category === 'manga' ? '' : 'hidden sm:block'}`} style={{ color: style.ink }}>
          {t.dle.categories[category].hint}
        </span>
      </span>
    </button>
  )
}
