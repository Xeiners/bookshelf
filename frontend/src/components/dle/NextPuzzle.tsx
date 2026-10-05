import { useRef } from 'react'
import { ArrowRight, PartyPopper } from 'lucide-react'
import { useT } from '../../i18n'
import { nextPuzzle } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { DleCategory, DleMode } from '../../services/dleApi'
import { useDleStore } from '../../store/useDleStore'
import { CATEGORY_STYLE, modeLabel } from './dleStyle'
import { ModeIcon } from './ModeIcon'

/**
 * Fin d'une énigme du jour : on enchaîne. Le format suivant de la catégorie (Classique
 * → Portrait → …), puis la catégorie suivante ; une fois tout trouvé, retour à l'accueil.
 */
export function NextPuzzle({ category, mode, fresh }: { category: DleCategory; mode: DleMode; fresh: boolean }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const daily = useDleStore((state) => state.overview?.daily ?? null)
  const openCategory = useDleStore((state) => state.openCategory)
  const openDaily = useDleStore((state) => state.openDaily)
  const openHome = useDleStore((state) => state.openHome)

  useGSAP(
    () => {
      // Après la carte et le gain du panneau de victoire.
      gsap.fromTo(rootRef.current, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: fresh ? 1.3 : 0, ease: EASE.swift })
    },
    { scope: rootRef },
  )

  if (!daily) return null
  const next = nextPuzzle(daily, category, mode)

  if (!next) {
    return (
      <div ref={rootRef} className="flex flex-col items-center gap-3 text-center">
        <p className="inline-flex items-center gap-2 text-sm text-cream/80">
          <PartyPopper size={16} className="text-gold" aria-hidden />
          {t.dle.game.allDone}
        </p>
        <button type="button" onClick={openHome} className="rounded-full border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-white/[0.1]">
          {t.dle.game.backHome}
        </button>
      </div>
    )
  }

  const style = CATEGORY_STYLE[next.category]
  const otherCategory = next.category !== category
  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          if (otherCategory) openCategory(next.category)
          openDaily(next.mode)
        }}
        className="group flex w-full items-center gap-3.5 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-2.5 pr-4 text-left transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-glow"
        style={{ boxShadow: `0 18px 40px -26px ${style.accent}` }}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-void" style={{ background: style.gradient }}>
          <ModeIcon category={next.category} mode={next.mode} size={22} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-mist uppercase">{t.dle.game.next}</span>
          <span className="truncate font-display text-xl text-cream">
            {otherCategory ? `${t.dle.categories[next.category].title} · ${modeLabel(t, next.category, next.mode)}` : modeLabel(t, next.category, next.mode)}
          </span>
        </span>
        <ArrowRight size={20} className="shrink-0 text-cream/70 transition-transform group-hover:translate-x-1" aria-hidden />
      </button>
    </div>
  )
}
