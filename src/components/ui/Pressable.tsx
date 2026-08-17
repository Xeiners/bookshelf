import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useRef } from 'react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

interface PressableProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Échelle atteinte pendant l'appui. */
  press?: number
}

/**
 * Bouton avec micro-interaction GSAP (enfoncement + rebond élastique).
 *
 * Les tweens déclenchés par un événement passent par `contextSafe()`, sans quoi
 * ils échappent au contexte du hook et ne sont pas revertés au démontage.
 */
export function Pressable({ children, press = 0.9, className = '', ...rest }: PressableProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const { contextSafe } = useGSAP()

  const down = contextSafe(() => {
    gsap.to(ref.current, { scale: press, duration: 0.16, ease: 'power2.out', overwrite: 'auto' })
  })

  const up = contextSafe(() => {
    gsap.to(ref.current, { scale: 1, duration: 0.55, ease: EASE.spring, overwrite: 'auto' })
  })

  return (
    <button
      ref={ref}
      type="button"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      className={className}
      {...rest}
    >
      {children}
    </button>
  )
}
