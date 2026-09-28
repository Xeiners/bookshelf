import { useRef } from 'react'
import { Star } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { LibraryStats } from '../../lib/stats'

/** Objectif de lecture annuel — pilote l'anneau de progression. */
const YEARLY_GOAL = 24

const RING_RADIUS = 54
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * Lecture au quotidien, calculée sur la bibliothèque de l'appareil : objectif
 * de l'année (anneau) et « ADN de lecture » (genres dominants).
 */
export function ReadingInsights({ stats }: { stats: LibraryStats }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)

  const goalRatio = Math.min(1, stats.byStatus.read / YEARLY_GOAL)
  const maxGenre = stats.topGenres[0]?.count ?? 1

  useGSAP(
    () => {
      gsap.fromTo(
        ringRef.current,
        { strokeDashoffset: RING_CIRCUMFERENCE },
        { strokeDashoffset: RING_CIRCUMFERENCE * (1 - goalRatio), duration: 1.5, delay: 0.15, ease: 'power3.inOut' },
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

  return (
    <div ref={rootRef} className="grid gap-3 md:grid-cols-2">
      <section className="glass flex items-center gap-5 rounded-4xl p-5" data-anim>
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
            <circle cx="64" cy="64" r={RING_RADIUS} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="8" />
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
            <span className="font-display text-4xl leading-none text-cream tabular-nums">{stats.byStatus.read}</span>
            <span className="text-[10px] text-mist">{t.profile.goalUnit(YEARLY_GOAL)}</span>
          </div>
        </div>

        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight text-cream">{t.profile.goalTitle(new Date().getFullYear())}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-mist">
            {goalRatio >= 1 ? t.profile.goalReached : t.profile.goalRemaining(YEARLY_GOAL - stats.byStatus.read)}
          </p>
        </div>
      </section>

      <section className="glass rounded-4xl p-5" data-anim>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">{t.profile.dnaTitle}</h2>
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
          <p className="mt-3 text-xs leading-relaxed text-mist">{t.profile.dnaEmpty}</p>
        )}

        {stats.longestTitle && (
          <p className="mt-5 border-t border-white/8 pt-4 text-[11px] leading-relaxed text-mist">
            {t.profile.longest}
            <span className="mt-0.5 block text-cream">{stats.longestTitle}</span>
          </p>
        )}
      </section>
    </div>
  )
}
