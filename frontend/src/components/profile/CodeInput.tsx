import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { EASE, gsap, useGSAP } from '../../lib/gsap'

export type CodeStatus = 'idle' | 'busy' | 'error' | 'success'

interface CodeInputProps {
  value: string
  onChange: (value: string) => void
  /** Appelé dès que les 6 chiffres sont là (saisie, collage ou suggestion du téléphone). */
  onComplete: (code: string) => void
  status: CodeStatus
  label: string
  length?: number
  autoFocus?: boolean
}

/**
 * Saisie du code de vérification : six cases groupées 3 + 3.
 *
 * Une SEULE vraie zone de saisie, transparente, étendue sur les cases : c'est
 * ce qui permet de coller le code et d'accepter la suggestion du clavier
 * (`autocomplete="one-time-code"`, iOS et Android). Les cases ne sont que
 * l'affichage de sa valeur.
 *
 * Retours visuels : case active lumineuse avec curseur, chiffre qui « pop » à
 * l'arrivée, tremblement sur code faux, vague verte sur code bon.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  status,
  label,
  length = 6,
  autoFocus = true,
}: CodeInputProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const previousLength = useRef(value.length)
  const half = Math.ceil(length / 2)
  const locked = status === 'busy' || status === 'success'

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Chiffre ajouté : sa case rebondit.
  useGSAP(
    () => {
      const added = value.length > previousLength.current
      previousLength.current = value.length
      if (!added) return
      gsap.fromTo(
        `[data-code-cell="${value.length - 1}"] [data-code-digit]`,
        { scale: 0.4, y: 6, opacity: 0 },
        { scale: 1, y: 0, opacity: 1, duration: 0.35, ease: EASE.snap },
      )
    },
    { dependencies: [value], scope: rootRef },
  )

  // Code faux : la rangée tremble. Code bon : vague verte de gauche à droite.
  useGSAP(
    () => {
      if (status === 'error') {
        gsap.fromTo(
          '[data-code-row]',
          { x: 0 },
          { keyframes: { x: [0, -10, 9, -7, 5, -2, 0] }, duration: 0.45, ease: 'power1.out' },
        )
      }
      if (status === 'success') {
        gsap.fromTo(
          '[data-code-cell]',
          { scale: 1 },
          { keyframes: { scale: [1, 1.12, 1] }, duration: 0.45, stagger: 0.05, ease: 'power2.out' },
        )
        gsap.fromTo('[data-code-check]', { scale: 0, rotate: -30 }, { scale: 1, rotate: 0, duration: 0.5, delay: 0.3, ease: EASE.snap })
      }
    },
    { dependencies: [status], scope: rootRef },
  )

  const handleChange = (raw: string) => {
    if (locked) return
    const digits = raw.replace(/\D/g, '').slice(0, length)
    onChange(digits)
    if (digits.length === length) onComplete(digits)
  }

  const activeIndex = Math.min(value.length, length - 1)

  const cell = (index: number) => {
    const digit = value[index] ?? ''
    const active = focused && !locked && index === activeIndex && (value.length < length || index === length - 1)
    const tone =
      status === 'success'
        ? 'border-like/80 bg-like/10 text-like shadow-[0_0_24px_-6px_var(--color-like)]'
        : status === 'error'
          ? 'border-nope/80 bg-nope/10 text-nope'
          : active
            ? 'border-glow bg-glow/10 text-cream shadow-[0_0_0_4px_rgb(124_92_255/0.18),0_0_28px_-6px_var(--color-glow)]'
            : digit
              ? 'border-cream/25 bg-cream/[0.06] text-cream'
              : 'border-cream/10 bg-cream/[0.03] text-cream'
    return (
      <div
        key={index}
        data-code-cell={index}
        className={`relative grid aspect-[4/5] w-[clamp(36px,11.5vw,50px)] place-items-center rounded-2xl border transition-[border-color,background-color,box-shadow,color] duration-200 ${tone}`}
      >
        <span data-code-digit className="font-display text-[clamp(1.5rem,7vw,2.1rem)] leading-none tabular-nums">
          {digit}
        </span>
        {/* Curseur de la case active */}
        {active && !digit && <span aria-hidden className="absolute h-[42%] w-0.5 animate-pulse rounded-full bg-glow" />}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative mx-auto w-fit">
      <div data-code-row className="flex items-center gap-[clamp(4px,1.6vw,8px)]" aria-hidden>
        {Array.from({ length: half }, (_, index) => cell(index))}
        {/* Séparateur des deux groupes : un point lumineux */}
        <span
          className={`mx-[clamp(2px,1.2vw,6px)] size-1.5 rounded-full transition-colors ${
            status === 'success' ? 'bg-like shadow-[0_0_10px_var(--color-like)]' : 'bg-glow/70 shadow-[0_0_10px_var(--color-glow)]'
          }`}
        />
        {Array.from({ length: length - half }, (_, index) => cell(half + index))}
      </div>

      {/* La vraie zone de saisie : transparente, elle couvre toutes les cases. */}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        // Pas de maxLength : un code collé « 482 913 » (espace compris, comme dans
        // l'e-mail) serait tronqué avant nettoyage. On garde les 6 premiers chiffres.
        aria-label={label}
        aria-invalid={status === 'error'}
        disabled={locked}
        // 16 px minimum : iOS ne zoome pas sur le champ au focus.
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent"
      />

      {status === 'success' && (
        <span
          data-code-check
          aria-hidden
          className="absolute -top-3 -right-3 grid size-8 place-items-center rounded-full bg-like text-void shadow-[0_0_20px_var(--color-like)]"
        >
          <Check size={17} strokeWidth={3} />
        </span>
      )}
    </div>
  )
}
