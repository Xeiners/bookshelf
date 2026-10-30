import type { ReactNode, RefObject } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Moon, Skull, Sparkles, Swords, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { BOSS_HP } from '../../lib/runner/constants'
import type { BossPhase, RunAction } from '../../lib/runner/engine'

/** Ce que le HUD montre du combat (relu à chaque changement : phase, geste réussi ou raté…). */
export interface BossView {
  index: number
  phase: BossPhase
  hp: number
  round: number
  combo: RunAction[]
  progress: number
  /** Changent à chaque faux geste / contre-attaque : relancent leur animation. */
  misses: number
  counters: number
}

const ARROWS: Record<RunAction, ReactNode> = {
  up: <ArrowUp size={26} strokeWidth={3} aria-hidden />,
  down: <ArrowDown size={26} strokeWidth={3} aria-hidden />,
  left: <ArrowLeft size={26} strokeWidth={3} aria-hidden />,
  right: <ArrowRight size={26} strokeWidth={3} aria-hidden />,
}
const SKILL_ICONS = [<Zap key="ki" size={18} aria-hidden />, <Moon key="moon" size={18} aria-hidden />, <Sparkles key="stars" size={18} aria-hidden />]
const SKILL_COLORS = ['#4fc3ff', '#9ff6ff', '#ffc23a'] as const
/** Couleur de chaque boss (sa plaque, sa barre de vie). */
const BOSS_TINTS = ['#ff3b3b', '#5aa8ff', '#ff8a00'] as const

/**
 * Le combat de boss à l'écran : la plaque du boss et sa barre de vie (trois cœurs de
 * combat), l'annonce de son arrivée, les gestes à enchaîner (le prochain bat, les faits
 * s'allument, une erreur fait trembler le panneau), le temps qui file, les trois
 * compétences en bas, la contre-attaque et la victoire.
 */
export function BossHud({ view, timerRef }: { view: BossView; timerRef: RefObject<HTMLDivElement | null> }) {
  const t = useT()
  const look = view.index % 3
  const tint = BOSS_TINTS[look]!
  const names = t.runner.boss.names[look]!
  const skill = Math.min(view.round, 2)
  return (
    <div className="pointer-events-none absolute inset-0" aria-live="polite">
      {/* Plaque du boss et barre de vie. */}
      <div className="absolute inset-x-0 top-[max(4.75rem,calc(env(safe-area-inset-top)+4rem))] flex flex-col items-center gap-1.5 px-6">
        <span className="flex items-center gap-2 text-[11px] font-black tracking-[0.35em] uppercase" style={{ color: tint }}>
          <Skull size={14} aria-hidden />
          {t.runner.boss.tag}
          <Skull size={14} aria-hidden />
        </span>
        <span className="font-display text-2xl leading-none text-white">{names.name}</span>
        <div className="mt-0.5 flex w-full max-w-xs gap-1 rounded-full bg-black/50 p-1 shadow-[0_0_18px_rgba(0,0,0,0.5)]" role="meter" aria-valuemin={0} aria-valuemax={BOSS_HP} aria-valuenow={view.hp} aria-label={t.runner.boss.hp}>
          {Array.from({ length: BOSS_HP }, (_, index) => (
            <span
              key={index}
              className="h-3 flex-1 rounded-full transition-all duration-500"
              style={index < view.hp ? { background: `linear-gradient(180deg, #ffffff 0%, ${tint} 35%, #5a0010 100%)`, boxShadow: `0 0 10px ${tint}` } : { background: 'rgba(255,255,255,0.08)' }}
            />
          ))}
        </div>
      </div>

      {/* Arrivée : le titre en grand. */}
      {view.phase === 'intro' && (
        <div className="absolute inset-x-0 top-[36%] flex animate-[runner-awaken_2.6s_ease-out_forwards] flex-col items-center gap-2 opacity-0">
          <span className="flex items-center gap-3 font-black text-6xl leading-none text-white [-webkit-text-stroke:2px_#2a0008]" style={{ textShadow: `0 0 28px ${tint}, 0 4px 0 #2a0008` }}>
            <Swords size={44} aria-hidden />
            {t.runner.boss.tag}
          </span>
          <span className="rounded-full bg-black/55 px-4 py-1 text-sm font-bold tracking-[0.2em] text-white uppercase">{names.title}</span>
        </div>
      )}

      {/* Le combo à enchaîner. */}
      {view.phase === 'combo' && (
        <div key={view.misses} className={`absolute inset-x-0 bottom-[max(12.5rem,calc(env(safe-area-inset-bottom)+12rem))] flex flex-col items-center gap-2.5 px-4 ${view.misses ? 'animate-[runner-combo-miss_0.35s_ease-in-out]' : ''}`}>
          <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: SKILL_COLORS[skill] }}>
            {t.runner.boss.attack(view.round + 1, BOSS_HP)} · {t.runner.boss.skills[skill]}
          </span>
          <div className="flex gap-2">
            {view.combo.map((gesture, index) => {
              const done = index < view.progress
              const next = index === view.progress
              return (
                <span
                  key={index}
                  className={`grid size-14 place-items-center rounded-2xl border-2 transition-all duration-150 ${done ? 'scale-95 border-[#5dff9b] bg-[#5dff9b]/30 text-white' : next ? 'animate-pulse border-gold bg-gold/25 text-white shadow-[0_0_22px_rgba(255,196,107,0.7)]' : 'border-white/25 bg-black/50 text-white/60'}`}
                >
                  {done ? <Check size={24} strokeWidth={3.2} aria-hidden /> : ARROWS[gesture]}
                </span>
              )
            })}
          </div>
          <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-white/15">
            <div ref={timerRef} className="h-full origin-left rounded-full bg-gradient-to-r from-[#ff3b3b] via-gold to-[#5dff9b]" />
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-white/85">{t.runner.boss.hint}</span>
        </div>
      )}

      {/* Compétence lancée. */}
      {view.phase === 'strike' && (
        <div key={`strike-${view.round}`} className="absolute inset-x-0 top-[40%] flex animate-[runner-awaken_1.3s_ease-out_forwards] justify-center opacity-0">
          <span className="font-black text-5xl leading-none text-white uppercase [-webkit-text-stroke:2px_#08122a]" style={{ textShadow: `0 0 24px ${SKILL_COLORS[skill]}, 0 4px 0 #08122a` }}>
            {t.runner.boss.skills[skill]} !
          </span>
        </div>
      )}

      {/* Contre-attaque. */}
      {view.phase === 'counter' && (
        <div key={`counter-${view.counters}`} className="absolute inset-0">
          <div className="absolute inset-0 animate-[runner-hit_0.8s_ease-out_forwards] bg-[radial-gradient(circle_at_50%_70%,transparent_30%,rgba(255,30,60,0.55)_100%)]" />
          <div className="absolute inset-x-0 top-[42%] flex animate-[runner-awaken_1.3s_ease-out_forwards] flex-col items-center gap-1 opacity-0">
            <span className="font-black text-4xl text-[#ff5a6e] uppercase [-webkit-text-stroke:2px_#2a0008]">{t.runner.boss.counter}</span>
            <span className="rounded-full bg-black/55 px-3 py-1 text-sm font-bold text-white">{t.runner.boss.penalty}</span>
          </div>
        </div>
      )}

      {/* Il s'effondre : un petit bandeau en haut, la scène reste visible. */}
      {view.phase === 'dying' && (
        <div className="absolute inset-x-0 top-[max(10.5rem,calc(env(safe-area-inset-top)+9.75rem))] flex animate-[runner-awaken_2.4s_ease-out_forwards] justify-center opacity-0">
          <span className="rounded-full bg-black/55 px-4 py-1.5 font-black text-xl text-[#fff3c4] uppercase [text-shadow:0_0_16px_#ffc23a]">{t.runner.boss.finished}</span>
        </div>
      )}

      {/* Les trois compétences. */}
      <div className="absolute inset-x-0 bottom-[max(6.25rem,calc(env(safe-area-inset-bottom)+5.75rem))] flex justify-center gap-2 px-3">
        {t.runner.boss.skills.map((name, index) => {
          const done = index < BOSS_HP - view.hp
          const current = index === skill && !done && view.phase !== 'dying'
          return (
            <span
              key={name}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border px-2 py-2 text-[11px] font-bold transition-all ${current ? 'scale-105 bg-black/60 text-white' : done ? 'border-[#5dff9b]/60 bg-[#5dff9b]/15 text-[#c8ffd9]' : 'border-white/10 bg-black/40 text-white/45'}`}
              style={current ? { borderColor: SKILL_COLORS[index], boxShadow: `0 0 18px -2px ${SKILL_COLORS[index]}` } : undefined}
            >
              <span style={{ color: done ? '#5dff9b' : SKILL_COLORS[index] }}>{done ? <Check size={16} strokeWidth={3} aria-hidden /> : SKILL_ICONS[index]}</span>
              <span className="truncate">{name}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Victoire : un bandeau discret en haut (titre, boss vaincu, récompense) — ni éclair plein
 * écran ni gros texte au milieu : la route reprend aussitôt, on doit la voir.
 */
export function BossVictory({ index }: { index: number }) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(5.5rem,calc(env(safe-area-inset-top)+4.75rem))] flex animate-[runner-victory_2.2s_ease-out_forwards] justify-center px-4 opacity-0" aria-live="polite">
      <div className="flex max-w-sm flex-col items-center gap-0.5 rounded-2xl bg-black/55 px-4 py-2 text-center shadow-[0_0_24px_rgba(255,179,0,0.35)]">
        <span className="font-black text-2xl leading-none text-[#ffe37a] uppercase [text-shadow:0_0_14px_#ffb300]">{t.runner.boss.victory}</span>
        <span className="text-xs font-semibold text-white">
          {t.runner.boss.defeated(t.runner.boss.names[index % 3]!.name)} · <span className="text-gold">{t.runner.boss.reward}</span>
        </span>
      </div>
    </div>
  )
}
