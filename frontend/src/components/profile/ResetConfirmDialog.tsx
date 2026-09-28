import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'

interface ResetConfirmDialogProps {
  onConfirm: () => void
  onClose: () => void
}

/**
 * Garde-fou avant d'effacer la bibliothèque : il faut taper le mot de
 * confirmation (« CONFIRMER » / « CONFIRM »), un clic égaré ne suffit pas.
 * Monté dans un portail : la zone animée (`<main>`, transformée) piégerait
 * un élément fixe.
 */
export function ResetConfirmDialog({ onConfirm, onClose }: ResetConfirmDialogProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const hintId = useId()
  const word = t.profile.resetConfirm.word
  // Casse et espaces autour ignorés : seul le mot compte.
  const armed = typed.trim().toLocaleUpperCase(t.locale) === word.toLocaleUpperCase(t.locale)

  useGSAP(
    () => {
      gsap.fromTo('[data-reset-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'power1.out' })
      gsap.fromTo('[data-reset-panel]', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (!armed) return
    vibrate(20)
    onConfirm()
  }

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[90] grid place-items-center p-4" role="alertdialog" aria-modal aria-labelledby={titleId} aria-describedby={hintId}>
      <div data-reset-backdrop onClick={onClose} className="absolute inset-0 bg-void/90" />
      <form
        data-reset-panel
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="relative w-full max-w-sm rounded-3xl border border-nope/30 bg-[#0d0c14] p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]"
      >
        <button type="button" onClick={onClose} aria-label={t.profile.resetConfirm.cancel} className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-mist hover:text-cream">
          <X size={18} />
        </button>
        <span className="grid size-11 place-items-center rounded-full bg-nope/15 text-nope">
          <Trash2 size={18} aria-hidden />
        </span>
        <h2 id={titleId} className="mt-3 font-display text-2xl text-cream">
          {t.profile.resetConfirm.title}
        </h2>
        <p id={hintId} className="mt-2 text-sm leading-relaxed text-cream/75">
          {t.profile.resetConfirm.body}
        </p>
        <label className="mt-4 block text-xs text-mist">
          {t.profile.resetConfirm.label(word)}
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={word}
            className="mt-1.5 block h-11 w-full rounded-xl border border-cream/15 bg-black/40 px-3 text-sm tracking-[0.2em] text-cream uppercase placeholder:text-cream/20 focus:border-nope/60 focus:outline-none"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-full border border-cream/15 px-5 text-sm text-cream/85">
            {t.profile.resetConfirm.cancel}
          </button>
          <button type="submit" disabled={!armed} className="h-11 rounded-full bg-nope px-5 text-sm font-semibold text-void transition-opacity disabled:cursor-not-allowed disabled:opacity-35">
            {t.profile.resetConfirm.submit}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
