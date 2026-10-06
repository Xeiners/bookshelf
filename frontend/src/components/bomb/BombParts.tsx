import { forwardRef, type KeyboardEvent } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'
import { useT } from '../../i18n'
import { splitAround } from '../../lib/bomb'

/** Le mot en train d'être tapé, la syllabe surlignée, avec un curseur qui clignote. */
export function TypedWord({ text, syllable, caret = true, className = '' }: { text: string; syllable: string; caret?: boolean; className?: string }) {
  const segments = splitAround(text, syllable)
  return (
    <span className={`inline-flex min-h-[1.2em] items-baseline font-display tracking-[0.04em] uppercase ${className}`}>
      {segments.map((segment, index) =>
        segment.hit ? (
          <span key={index} className="rounded-md bg-gold/20 px-0.5 text-gold" style={{ textShadow: '0 0 14px rgba(255,196,107,0.7)' }}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
      {caret && <span data-bomb-fx className="ml-0.5 inline-block h-[0.9em] w-[3px] translate-y-[0.1em] rounded-full bg-cream/80" style={{ animation: 'bomb-caret 1s steps(1) infinite' }} />}
    </span>
  )
}

/** Les vies : des orbes pleins, puis éteints. */
export function Lives({ lives, max = 3, size = 12 }: { lives: number; max?: number; size?: number }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={t.bomb.livesAria(lives)}>
      {Array.from({ length: max }, (_, index) => (
        <span
          key={index}
          className="rounded-full transition-all duration-300"
          style={{
            width: size,
            height: size,
            background: index < lives ? 'radial-gradient(circle at 35% 30%, #fff, #ff5e9c 45%, #8a1050)' : 'rgba(255,255,255,0.08)',
            boxShadow: index < lives ? '0 0 10px rgba(255,94,156,0.7)' : 'inset 0 0 0 1px rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </span>
  )
}

interface WordInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  busy?: boolean
  placeholder: string
  /** Mot refusé : le champ tremble et passe au rouge. */
  error?: boolean
}

/** Le champ de saisie : gros, en capitales, Entrée pour valider. */
export const WordInput = forwardRef<HTMLInputElement, WordInputProps>(function WordInput({ value, onChange, onSubmit, disabled = false, busy = false, placeholder, error = false }, ref) {
  const t = useT()
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (value.trim()) onSubmit()
    }
  }
  return (
    <div
      className={`flex w-full items-center gap-2 rounded-2xl border bg-black/50 px-4 py-2 backdrop-blur transition-colors ${
        error ? 'border-nope/70' : 'border-white/15 focus-within:border-glow/70'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={t.bomb.inputAria}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        maxLength={40}
        className="min-w-0 flex-1 bg-transparent py-1.5 font-display text-2xl tracking-[0.05em] text-cream uppercase outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-mist/60 placeholder:normal-case"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        aria-label={t.bomb.send}
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-glow/25 text-cream transition-colors hover:bg-glow/40 disabled:opacity-40"
      >
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <SendHorizontal size={18} aria-hidden />}
      </button>
    </div>
  )
})
