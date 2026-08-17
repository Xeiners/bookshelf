import type { ReactNode } from 'react'

export type PillTone = 'neutral' | 'like' | 'gold' | 'glow' | 'nope'

const TONE_CLASS: Record<PillTone, string> = {
  neutral: 'text-cream/85',
  like: 'text-like',
  gold: 'text-gold',
  glow: 'text-glow',
  nope: 'text-nope',
}

interface PillProps {
  children: ReactNode
  icon?: ReactNode
  tone?: PillTone
  /**
   * Rendu sans `backdrop-filter`. Obligatoire sur un élément qui se déplace :
   * sinon son arrière-plan est reflouté à chaque frame du geste.
   */
  flat?: boolean
  className?: string
}

/** Badge semi-translucide (glassmorphism) — genre, note, durée de lecture. */
export function Pill({
  children,
  icon,
  tone = 'neutral',
  flat = false,
  className = '',
}: PillProps) {
  return (
    <span
      className={`${flat ? 'glass-flat' : 'glass'} inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] leading-none font-medium tracking-wide ${TONE_CLASS[tone]} ${className}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}
