import { useMemo, useRef } from 'react'
import { BookOpen, Flame, Hourglass, Layers, Star, Trash2 } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { computeStats } from '../../lib/stats'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'
import { InstallCard } from './InstallCard'

/** Objectif de lecture annuel (mockup) — pilote l'anneau de progression. */
const YEARLY_GOAL = 24

const RING_RADIUS = 54
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface StatTileProps {
  icon: typeof BookOpen
  label: string
  value: number
  suffix?: string
}

function StatTile({ icon: Icon, label, value, suffix }: StatTileProps) {
  const valueRef = useCountUp(value, {
    format: (current) => Math.round(current).toLocaleString('fr-FR'),
  })

  return (
    <div data-anim className="glass rounded-3xl p-4">
      <Icon size={16} className="text-glow" />
      <p className="mt-3 font-display text-3xl leading-none text-cream">
        <span ref={valueRef} className="tabular-nums">
          0
        </span>
        {suffix && <span className="ml-1 text-sm text-mist">{suffix}</span>}
      </p>
      <p className="mt-1 text-[11px] text-mist">{label}</p>
    </div>
  )
}

export function ProfileView() {
  const entries = useLibraryStore((state) => state.entries)
  const resetAll = useLibraryStore((state) => state.resetAll)
  const notify = useUiStore((state) => state.notify)

  const stats = useMemo(() => computeStats(entries), [entries])
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)

  const memberSince = useMemo(() => {
    const timestamps = Object.values(entries).map((entry) => entry.addedAt)
    if (timestamps.length === 0) return null
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
      new Date(Math.min(...timestamps)),
    )
  }, [entries])

  const goalRatio = Math.min(1, stats.byStatus.read / YEARLY_GOAL)
  const hours = Math.round(stats.minutesRead / 60)
  const maxGenre = stats.topGenres[0]?.count ?? 1

  useGSAP(
    () => {
      gsap.fromTo(
        ringRef.current,
        { strokeDashoffset: RING_CIRCUMFERENCE },
        {
          strokeDashoffset: RING_CIRCUMFERENCE * (1 - goalRatio),
          duration: 1.5,
          delay: 0.15,
          ease: 'power3.inOut',
        },
      )
    },
    { dependencies: [goalRatio], revertOnUpdate: true },
  )

  // La valeur cible de chaque barre est lue sur l'élément (`data-ratio`).
  useGSAP(
    () => {
      gsap.fromTo(
        '[data-genre-bar]',
        { scaleX: 0 },
        {
          scaleX: (_index, target: HTMLElement) => Number(target.dataset.ratio ?? 0),
          duration: 1,
          stagger: 0.08,
          delay: 0.35,
          ease: EASE.swift,
        },
      )
    },
    { dependencies: [stats.topGenres.length], revertOnUpdate: true, scope: rootRef },
  )

  useGSAP(
    () => {
      gsap.from('[data-anim]', {
        y: 26,
        autoAlpha: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    },
    { scope: rootRef },
  )

  return (
    <div
      ref={rootRef}
      className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6"
    >
      <div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
      <section className="glass flex items-center gap-5 rounded-4xl p-5" data-anim>
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
            <circle
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              stroke="rgb(255 255 255 / 0.08)"
              strokeWidth="8"
            />
            <circle
              ref={ringRef}
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--color-glow)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-4xl leading-none text-cream tabular-nums">
              {stats.byStatus.read}
            </span>
            <span className="text-[10px] text-mist">/ {YEARLY_GOAL} livres</span>
          </div>
        </div>

        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight text-cream">Objectif {new Date().getFullYear()}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-mist">
            {goalRatio >= 1
              ? 'Objectif atteint. Chapeau.'
              : `Encore ${YEARLY_GOAL - stats.byStatus.read} titres pour tenir le rythme.`}
          </p>
          {memberSince && (
            <p className="mt-3 text-[10px] tracking-[0.16em] text-mist/70 uppercase">
              Depuis {memberSince}
            </p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <StatTile icon={BookOpen} label="Livres terminés" value={stats.byStatus.read} />
        <StatTile icon={Flame} label="Lectures en cours" value={stats.byStatus.reading} />
        <StatTile icon={Layers} label="Pages avalées" value={stats.pagesRead} />
        <StatTile icon={Hourglass} label="Temps de lecture" value={hours} suffix="h" />
      </div>

      <div className="md:col-span-2">
        <InstallCard />
      </div>

      <section className="glass rounded-4xl p-5 md:col-span-2" data-anim>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">ADN de lecture</h2>
          {stats.averageRating !== null && (
            <span className="flex items-center gap-1 text-xs text-gold">
              <Star size={12} className="fill-gold" />
              {stats.averageRating.toFixed(1)}
            </span>
          )}
        </div>

        {stats.topGenres.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {stats.topGenres.map((genre) => (
              <li key={genre.label}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-cream/80">{genre.label}</span>
                  <span className="text-mist tabular-nums">{genre.count}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream/10">
                  <div
                    data-genre-bar
                    data-ratio={genre.count / maxGenre}
                    className="h-full origin-left rounded-full bg-linear-to-r from-glow to-like"
                    style={{ transform: 'scaleX(0)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-mist">
            Ton ADN se dessinera dès que tu auras commencé quelques lectures.
          </p>
        )}

        {stats.longestTitle && (
          <p className="mt-5 border-t border-white/8 pt-4 text-[11px] leading-relaxed text-mist">
            Plus gros pavé terminé
            <span className="mt-0.5 block text-cream">{stats.longestTitle}</span>
          </p>
        )}
      </section>

      {stats.total > 0 && (
        <div className="flex justify-center md:col-span-2" data-anim>
          <Pressable
            onClick={() => {
              resetAll()
              notify('Bibliothèque réinitialisée', 'nope')
            }}
            className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] text-nope/80"
          >
            <Trash2 size={12} />
            Réinitialiser mes données
          </Pressable>
        </div>
      )}
      </div>
    </div>
  )
}
