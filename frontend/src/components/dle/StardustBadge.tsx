import { useEffect, useRef } from 'react'
import { Sparkle } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

/**
 * Solde de Poussières d'Étoile : étoile scintillante et montant. Quand le solde
 * monte, le chiffre défile jusqu'à sa nouvelle valeur et l'étoile pétille.
 */
export function StardustBadge({ balance, size = 'md' }: { balance: number; size?: 'sm' | 'md' | 'lg' }) {
  const t = useT()
  const rootRef = useRef<HTMLSpanElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  const shown = useRef(balance)

  const { contextSafe } = useGSAP({ scope: rootRef })
  useEffect(() => {
    const node = valueRef.current
    if (!node) return
    const from = shown.current
    shown.current = balance
    if (from === balance) {
      node.textContent = String(balance)
      return
    }
    contextSafe(() => {
      const counter = { value: from }
      gsap.to(counter, {
        value: balance,
        duration: Math.min(1.4, 0.4 + Math.abs(balance - from) / 120),
        ease: 'power2.out',
        onUpdate: () => {
          node.textContent = String(Math.round(counter.value))
        },
      })
      if (balance > from) gsap.fromTo('[data-stardust-star]', { rotation: 0, scale: 1 }, { rotation: 180, scale: 1.5, duration: 0.35, yoyo: true, repeat: 1, ease: EASE.swift })
    })()
  }, [balance, contextSafe])

  const sizes = {
    sm: { box: 'gap-1 px-2.5 py-1 text-xs', icon: 12 },
    md: { box: 'gap-1.5 px-3 py-1.5 text-xs', icon: 13 },
    lg: { box: 'gap-2 px-4 py-2 text-base', icon: 18 },
  }[size]

  return (
    <span
      ref={rootRef}
      aria-label={t.dle.stardustAria(balance)}
      className={`inline-flex items-center rounded-full border border-[#ff9ad8]/30 bg-black/40 font-semibold text-[#ffe9f6] tabular-nums ${sizes.box}`}
    >
      <span data-stardust-star className="grid will-change-transform" aria-hidden>
        <Sparkle size={sizes.icon} className="fill-[#ffc46b] text-[#ffc46b]" />
      </span>
      <span ref={valueRef} aria-hidden>
        {balance}
      </span>
    </span>
  )
}
