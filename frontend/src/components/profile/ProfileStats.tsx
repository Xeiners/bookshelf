import { useRef } from 'react'
import { BookOpenCheck, ChevronRight, Gift, Layers } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'
import { useT } from '../../i18n'
import { RARITIES, RARITY_STYLE, completion, type Rarity } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

export interface CollectionSummary {
  owned: number
  total: number
  /** Exemplaires, doublons compris ; `null` si inconnu. */
  copies: number | null
  byRarity: Record<Rarity, { total: number; owned: number }>
}

export interface ReadingSummary {
  consulted: number
  finished: number
  /** `null` : pas suivi pour un invité (lecture intégrée et romans vivent sur le compte). */
  chaptersRead: number | null
  novels: number | null
  /** De 0 à 1. */
  completion: number
}

interface ProfileStatsProps {
  collection: CollectionSummary | null
  /** `null` : lectures masquées (profil public d'un autre compte). */
  reading: ReadingSummary | null
  /** `null` : inconnu (compte hors-ligne, profil pas encore chargé). */
  boostersOpened: number | null
  /** Absent : pas de lien vers l'album (profil d'un autre compte). */
  onOpenCollection?: () => void
}

function Count({ value, className = '' }: { value: number; className?: string }) {
  const t = useT()
  const ref = useCountUp(value, { format: (current) => Math.round(current).toLocaleString(t.locale) })
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      0
    </span>
  )
}

function Heading({ icon: Icon, label }: { icon: typeof Layers; label: string }) {
  return (
    <h3 className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
      <Icon size={13} className="text-glow" />
      {label}
    </h3>
  )
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-2xl bg-cream/[0.04] px-3 py-2.5">
      <p className="font-display text-2xl leading-none text-cream">{value === null ? '—' : <Count value={value} />}</p>
      <p className="mt-1 truncate text-[10px] text-mist">{label}</p>
    </div>
  )
}

/**
 * Statistiques du profil : collection (par rareté), lecture et boosters.
 * Barres et jauges animées en `transform` uniquement.
 */
export function ProfileStats({ collection, reading, boostersOpened, onOpenCollection }: ProfileStatsProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const percent = collection ? completion(collection.owned, collection.total) : 0
  const readingPercent = reading ? Math.round(reading.completion * 100) : 0

  // Remplissage des barres : la cible est lue sur l'élément (`data-ratio`).
  useGSAP(
    () => {
      gsap.fromTo(
        '[data-stat-bar]',
        { scaleX: 0 },
        {
          scaleX: (_index, target: HTMLElement) => Number(target.dataset.ratio ?? 0),
          duration: 1,
          stagger: 0.06,
          delay: 0.25,
          ease: EASE.swift,
        },
      )
    },
    { dependencies: [collection?.owned, collection?.total, readingPercent], revertOnUpdate: true, scope: rootRef },
  )

  return (
    <div ref={rootRef} className="grid gap-3 md:grid-cols-3">
      <section data-anim className="glass rounded-4xl p-5 md:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <Heading icon={Layers} label={t.profile.stats.collection} />
          {collection && <span className="text-xs text-mist tabular-nums">{percent} %</span>}
        </div>

        <p className="mt-3 font-display text-4xl leading-none text-cream">
          {collection ? (
            <>
              <Count value={collection.owned} />
              <span className="text-xl text-mist"> / {collection.total.toLocaleString(t.locale)}</span>
            </>
          ) : (
            '—'
          )}
        </p>
        {collection?.copies != null && collection.copies > 0 && (
          <p className="mt-1.5 text-[11px] text-mist">{t.profile.stats.copies(collection.copies)}</p>
        )}

        {collection && (
          <ul className="mt-4 space-y-2.5">
            {[...RARITIES].reverse().map((rarity) => {
              const tally = collection.byRarity[rarity]
              const ratio = tally.total > 0 ? tally.owned / tally.total : 0
              return (
                <li key={rarity}>
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span style={{ color: RARITY_STYLE[rarity].color }}>{t.cards.rarity[rarity]}</span>
                    <span className="text-mist tabular-nums">
                      {tally.owned} / {tally.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream/10">
                    <div
                      data-stat-bar
                      data-ratio={ratio}
                      className="h-full origin-left rounded-full"
                      style={{ background: RARITY_STYLE[rarity].color, transform: 'scaleX(0)' }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {onOpenCollection && (
          <button
            type="button"
            onClick={onOpenCollection}
            className="mt-4 flex items-center gap-1 text-[11px] font-medium text-glow"
          >
            {t.profile.stats.openCollection}
            <ChevronRight size={13} />
          </button>
        )}
      </section>

      <div className="grid gap-3">
        {reading && (
        <section data-anim className="glass rounded-4xl p-5">
          <Heading icon={BookOpenCheck} label={t.profile.stats.reading} />
          <div className="mt-3 flex items-baseline justify-between text-[11px]">
            <span className="text-cream/80">{t.profile.stats.completion}</span>
            <span className="text-mist tabular-nums">{readingPercent} %</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream/10">
            <div
              data-stat-bar
              data-ratio={reading.completion}
              className="h-full origin-left rounded-full bg-linear-to-r from-glow to-like"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label={t.profile.stats.consulted} value={reading.consulted} />
            <Metric label={t.profile.stats.finished} value={reading.finished} />
            <Metric label={t.profile.stats.chapters} value={reading.chaptersRead} />
            <Metric label={t.profile.stats.novels} value={reading.novels} />
          </div>
        </section>
        )}

        <section data-anim className="glass flex items-center gap-4 rounded-4xl p-5">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/12 text-gold">
            <Gift size={20} />
          </div>
          <div className="min-w-0">
            <p className="font-display text-3xl leading-none text-cream">
              {boostersOpened === null ? '—' : <Count value={boostersOpened} />}
            </p>
            <p className="mt-1 text-[11px] text-mist">{t.profile.stats.boostersOpened}</p>
          </div>
        </section>
      </div>
    </div>
  )
}
