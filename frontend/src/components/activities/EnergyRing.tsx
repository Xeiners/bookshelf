import { useId, type ReactNode } from 'react'

interface EnergyRingProps {
  /** Remplissage, 0 → 1. */
  progress: number
  size: number
  /** Pleine énergie : l'anneau s'illumine et pulse. */
  charged?: boolean
  children?: ReactNode
  label: string
}

const TICKS = 48

/**
 * Jauge d'énergie circulaire, façon horloge néon : graduations fines, arc
 * cyan → violet → or qui se remplit, lueur quand la jauge est pleine. Le
 * contenu (compte à rebours, « prêt ») est centré dedans.
 */
export function EnergyRing({ progress, size, charged = false, children, label }: EnergyRingProps) {
  const id = useId().replace(/:/g, '')
  const stroke = Math.max(4, size * 0.07)
  const radius = (size - stroke) / 2 - size * 0.06
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const clamped = Math.min(1, Math.max(0, progress))

  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <defs>
          <linearGradient id={`energy-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4cc9f0" />
            <stop offset="0.55" stopColor="#b46cff" />
            <stop offset="1" stopColor="#ffc46b" />
          </linearGradient>
        </defs>
        {/* Graduations. */}
        {Array.from({ length: TICKS }, (_, index) => {
          const angle = (index / TICKS) * Math.PI * 2 - Math.PI / 2
          const outer = size / 2 - 1
          const inner = outer - (index % 6 === 0 ? size * 0.07 : size * 0.035)
          return (
            <line
              key={index}
              x1={center + inner * Math.cos(angle)}
              y1={center + inner * Math.sin(angle)}
              x2={center + outer * Math.cos(angle)}
              y2={center + outer * Math.sin(angle)}
              stroke={index / TICKS <= clamped ? '#fff4c8' : 'rgba(247,245,240,0.16)'}
              strokeWidth={index % 6 === 0 ? 1.4 : 0.8}
            />
          )
        })}
        {/* Piste et arc d'énergie. */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(247,245,240,0.08)" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#energy-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      {charged && (
        <div
          aria-hidden
          data-card-fx
          className="pointer-events-none absolute inset-[12%] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(255,196,107,0.35), transparent)', animation: 'altar-pulse 2.2s ease-in-out infinite' }}
        />
      )}
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}
