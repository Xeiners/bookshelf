import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { getT, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useAuthStore } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/** Libellé du mode : `t.auth.register` / `t.auth.login`. */
type Mode = 'register' | 'login'

const MIN_PASSWORD = 8
/** Contrôle de forme minimal ; l'API reste seule juge (même règle côté serveur). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FieldProps {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  placeholder?: string
  minLength?: number
  required?: boolean
}

function Field({ label, onChange, ...input }: FieldProps) {
  const id = useId()
  return (
    <label htmlFor={id} className="block" data-auth-item>
      <span className="mb-1.5 block text-[10px] tracking-[0.2em] text-mist uppercase">{label}</span>
      <input
        id={id}
        {...input}
        onChange={(event) => onChange(event.target.value)}
        className="glass w-full rounded-2xl px-4 py-3 text-sm text-cream placeholder:text-mist/60 focus:ring-2 focus:ring-glow/60 focus:outline-none"
      />
    </label>
  )
}

/**
 * Feuille « Créer un compte / Se connecter ». Même grammaire que la fiche livre :
 * montée depuis le bas, fond assombri, fermeture par Échap ou tap à l'extérieur.
 */
export function AuthSheet() {
  const t = useT()
  const closeAuth = useUiStore((state) => state.closeAuth)
  const notify = useUiStore((state) => state.notify)
  const register = useAuthStore((state) => state.register)
  const login = useAuthStore((state) => state.login)
  const localCount = useLibraryStore((state) => Object.keys(state.entries).length)

  const [mode, setMode] = useState<Mode>('register')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backdropRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const dismissRef = useRef<() => void>(() => {})

  const { contextSafe } = useGSAP(() => {
    gsap
      .timeline({ defaults: { ease: EASE.glide } })
      .set(sheetRef.current, { yPercent: 100 })
      .to(backdropRef.current, { autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, 0)
      .to(sheetRef.current, { yPercent: 0, duration: 0.7 }, 0)
      .from(
        '[data-auth-item]',
        { y: 20, autoAlpha: 0, duration: 0.5, stagger: 0.05, ease: EASE.swift },
        0.15,
      )
  })

  const dismiss = () =>
    contextSafe(() => {
      if (closingRef.current) return
      closingRef.current = true
      gsap
        .timeline({ onComplete: closeAuth })
        .to(sheetRef.current, { yPercent: 100, duration: 0.4, ease: 'power2.in' }, 0)
        .to(backdropRef.current, { autoAlpha: 0, duration: 0.32 }, 0)
    })()

  useEffect(() => {
    dismissRef.current = dismiss
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return

    // Erreurs de saisie détectées avant l'aller-retour réseau, dans la bonne langue.
    if (!EMAIL_SHAPE.test(email.trim())) {
      setError(t.errors.invalidEmail)
      return
    }
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(t.errors.passwordTooShort)
      return
    }

    setPending(true)
    setError(null)

    try {
      if (mode === 'register') await register({ email, password, displayName })
      else await login({ email, password })
      vibrate([10, 30, 14])
      // `getT()` et non `t` : la connexion a pu adopter la langue du compte entre-temps.
      const fresh = getT()
      notify(mode === 'register' ? fresh.auth.registered : fresh.auth.loggedIn, 'like')
      dismissRef.current()
    } catch (caught) {
      vibrate(20)
      setError(apiErrorMessage(caught, t))
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={t.auth[mode]}>
      <div
        ref={backdropRef}
        onClick={() => dismissRef.current()}
        className="absolute inset-0 bg-void/90 opacity-0"
      />

      <div
        ref={sheetRef}
        className="glass-strong absolute inset-x-0 bottom-0 mx-auto flex max-h-[92svh] flex-col rounded-t-[2.25rem] pb-safe will-change-transform md:bottom-6 md:max-w-md md:rounded-[2.25rem]"
      >
        <div className="no-scrollbar min-h-0 overflow-y-auto overscroll-contain px-6 pt-3 pb-5">
          <div className="mx-auto h-1.5 w-11 rounded-full bg-cream/25" />

          <div className="mt-5 flex items-start justify-between gap-4" data-auth-item>
            <div>
              <h2 className="font-display text-[1.9rem] leading-none text-cream">
                {t.auth[mode]}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-mist">
                {localCount > 0 ? t.auth.localCount(localCount) : t.auth.noLocal}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismissRef.current()}
              aria-label={t.common.close}
              className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/60"
            >
              <X size={16} />
            </button>
          </div>

          {/* Bascule inscription / connexion */}
          <div className="glass mt-5 grid grid-cols-2 rounded-full p-1" role="tablist" data-auth-item>
            {(['register', 'login'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => switchMode(item)}
                className={`rounded-full py-2.5 text-xs font-medium transition-colors duration-300 ${
                  mode === item ? 'bg-cream text-void' : 'text-cream/60'
                }`}
              >
                {t.auth[item]}
              </button>
            ))}
          </div>

          {/* `noValidate` : la validation native afficherait sa bulle dans la langue du
              NAVIGATEUR, pas celle de l'app. On valide nous-mêmes, messages traduits. */}
          <form onSubmit={submit} noValidate className="mt-5 space-y-3.5">
            {mode === 'register' && (
              <Field
                label={t.auth.displayName}
                type="text"
                value={displayName}
                onChange={setDisplayName}
                autoComplete="nickname"
                placeholder={t.auth.displayNamePlaceholder}
              />
            )}
            <Field
              label={t.auth.email}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder={t.auth.emailPlaceholder}
              required
            />
            <Field
              label={t.auth.password}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={mode === 'register' ? t.auth.passwordPlaceholder : ''}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />

            {error && (
              <p role="alert" className="rounded-2xl bg-nope/10 px-4 py-3 text-xs text-nope">
                {error}
              </p>
            )}

            <div data-auth-item>
              <Pressable
                type="submit"
                disabled={pending}
                press={0.96}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3.5 text-sm font-medium text-void disabled:opacity-60"
              >
                {pending && <LoaderCircle size={16} className="animate-spin" />}
                {t.auth[mode]}
              </Pressable>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
