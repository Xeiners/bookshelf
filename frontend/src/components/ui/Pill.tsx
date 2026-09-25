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
  /** Variante plus transparente pour les badges portés par un élément mobile. */
  flat?: boolean
  className?: string
  /** Info-bulle (explication du badge). */
  title?: string
}

/** Badge semi-translucide (glassmorphism) — genre, note, durée de lecture. */
export function Pill({
  children,
  icon,
  tone = 'neutral',
  flat = false,
  className = '',
  title,
}: PillProps) {
  return (
    <span
      title={title}
      className={`${flat ? 'glass-flat' : 'glass'} inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] leading-none font-medium tracking-wide ${TONE_CLASS[tone]} ${className}`}
    >
      {icon}
      {/* `py-0.5 -my-0.5` : la zone rognée par `truncate` inclut les accents des capitales (« À »), hauteur inchangée. */}
      <span className="-my-0.5 truncate py-0.5">{children}</span>
    </span>
  )
}
