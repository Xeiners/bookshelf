import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MailCheck, RotateCcw, X } from 'lucide-react'
import { getT, useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { ApiError } from '../../services/api'
import type { PendingRegistration } from '../../services/accountApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'
import { CodeInput, type CodeStatus } from './CodeInput'

/** Libellé du mode : `t.auth.register` / `t.auth.login`. */
type Mode = 'register' | 'login'
/** Inscription : formulaire, puis saisie du code reçu par e-mail. */
type Step = 'form' | 'verify'

const MIN_PASSWORD = 8
const CODE_LENGTH = 6
/** Contrôle de forme minimal ; l'API reste seule juge (même règle côté serveur). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Erreurs qui invalident le code courant : on vide les cases pour la suite. */
const CODE_RESET = new Set(['code_invalid', 'code_locked', 'code_expired'])

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
 *
 * Inscription en deux temps : le formulaire envoie un code par e-mail (aucun
 * compte n'existe encore), puis la saisie du bon code crée le compte.
 */
export function AuthSheet() {
  const t = useT()
  const closeAuth = useUiStore((state) => state.closeAuth)
  const notify = useUiStore((state) => state.notify)
  const startRegistration = useAuthStore((state) => state.startRegistration)
  const confirmRegistration = useAuthStore((state) => state.confirmRegistration)
  const resendCode = useAuthStore((state) => state.resendCode)
  const login = useAuthStore((state) => state.login)
  const localCount = useLibraryStore((state) => Object.keys(state.entries).length)

  const [mode, setMode] = useState<Mode>('register')
  const [step, setStep] = useState<Step>('form')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Étape « code »
  const [registration, setRegistration] = useState<PendingRegistration | null>(null)
  const [code, setCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const backdropRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const stepRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const dismissRef = useRef<() => void>(() => {})

  const { contextSafe } = useGSAP(() => {
    gsap
      .timeline({ defaults: { ease: EASE.glide } })
      .set(sheetRef.current, { yPercent: 100 })
      .to(backdropRef.current, { autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, 0)
      .to(sheetRef.current, { yPercent: 0, duration: 0.7 }, 0)
      .from('[data-auth-item]', { y: 20, autoAlpha: 0, duration: 0.5, stagger: 0.05, ease: EASE.swift }, 0.15)
  })

  // Changement d'étape : le contenu glisse et apparaît, l'enveloppe se pose.
  useGSAP(
    () => {
      if (step !== 'verify') return
      gsap
        .timeline()
        // `opacity` et non `autoAlpha` : un élément en visibility: hidden ne peut pas
        // recevoir le focus, et le champ du code doit l'avoir dès l'arrivée.
        .from('[data-verify-item]', { y: 18, opacity: 0, duration: 0.5, stagger: 0.06, ease: EASE.swift })
        .from('[data-verify-mail]', { scale: 0.5, rotate: -12, duration: 0.6, ease: EASE.snap }, 0)
        .fromTo('[data-verify-halo]', { scale: 0.6, autoAlpha: 0.9 }, { scale: 1.8, autoAlpha: 0, duration: 1.2, ease: 'power2.out' }, 0.1)
    },
    { dependencies: [step], scope: stepRef },
  )

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

  // Horloge des comptes à rebours (renvoi, validité), seulement sur l'étape du code.
  useEffect(() => {
    if (step !== 'verify') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [step])

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
      if (mode === 'register') {
        const started = await startRegistration({ email, password, displayName })
        vibrate(10)
        setRegistration(started)
        setCode('')
        setCodeStatus('idle')
        setNotice(null)
        setNow(Date.now())
        setStep('verify')
        setPending(false)
        return
      }
      await login({ email, password })
      vibrate([10, 30, 14])
      // `getT()` et non `t` : la connexion a pu adopter la langue du compte entre-temps.
      notify(getT().auth.loggedIn, 'like')
      dismissRef.current()
    } catch (caught) {
      vibrate(20)
      setError(apiErrorMessage(caught, t))
      setPending(false)
    }
  }

  const verify = async (value: string) => {
    if (!registration || codeStatus === 'busy' || codeStatus === 'success') return
    setCodeStatus('busy')
    setError(null)
    setNotice(null)
    try {
      await confirmRegistration(registration.email, value)
      setCodeStatus('success')
      vibrate([10, 40, 10, 40, 18])
      // Le temps de voir la vague verte, puis la feuille se referme.
      window.setTimeout(() => {
        notify(getT().auth.registered, 'like')
        dismissRef.current()
      }, 900)
    } catch (caught) {
      vibrate([30, 40, 30])
      setCodeStatus('error')
      setError(apiErrorMessage(caught, t))
      // Inscription expirée côté serveur : retour au formulaire, champs conservés.
      if (caught instanceof ApiError && caught.code === 'registration_not_found') {
        setStep('form')
        return
      }
      if (caught instanceof ApiError && CODE_RESET.has(caught.code)) {
        window.setTimeout(() => {
          setCode('')
          setCodeStatus('idle')
        }, 650)
      } else {
        setCodeStatus('idle')
      }
    }
  }

  const resend = async () => {
    if (!registration || resending) return
    setResending(true)
    setError(null)
    try {
      const next = await resendCode(registration.email)
      vibrate(10)
      setRegistration(next)
      setCode('')
      setCodeStatus('idle')
      setNotice(t.auth.verify.resent)
      setNow(Date.now())
    } catch (caught) {
      setError(apiErrorMessage(caught, t))
      if (caught instanceof ApiError && caught.code === 'registration_not_found') setStep('form')
    } finally {
      setResending(false)
    }
  }

  const backToForm = () => {
    setStep('form')
    setError(null)
    setNotice(null)
    setCode('')
    setCodeStatus('idle')
  }

  const resendIn = registration ? Math.max(0, Math.ceil((registration.resendAt - now) / 1000)) : 0
  const minutesLeft = registration ? Math.max(0, Math.ceil((registration.expiresAt - now) / 60_000)) : 0
  const expired = registration !== null && registration.expiresAt <= now
  const title = step === 'verify' ? t.auth.verify.title : t.auth[mode]

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal aria-label={title}>
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

          {step === 'form' ? (
            <>
              <div className="mt-5 flex items-start justify-between gap-4" data-auth-item>
                <div>
                  <h2 className="font-display text-[1.9rem] leading-none text-cream">{t.auth[mode]}</h2>
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
                    {mode === 'register' ? t.auth.sendCode : t.auth.login}
                  </Pressable>
                </div>
              </form>
            </>
          ) : (
            <div ref={stepRef} className="pt-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => dismissRef.current()}
                  aria-label={t.common.close}
                  className="glass grid size-9 shrink-0 place-items-center rounded-full text-cream/60"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Enveloppe, avec une onde qui s'en échappe à l'arrivée */}
              <div className="relative mx-auto -mt-4 grid size-20 place-items-center">
                <span data-verify-halo aria-hidden className="absolute inset-0 rounded-full border-2 border-glow" />
                <span
                  data-verify-mail
                  className="grid size-16 place-items-center rounded-3xl bg-linear-to-br from-glow to-[#ff7eb6] text-cream shadow-[0_12px_40px_-10px_var(--color-glow)]"
                >
                  <MailCheck size={30} strokeWidth={2} />
                </span>
              </div>

              <div className="mt-5 text-center" data-verify-item>
                <p className="text-[10px] font-semibold tracking-[0.24em] text-glow uppercase">{t.auth.verify.eyebrow}</p>
                <h2 className="mt-2 font-display text-[1.9rem] leading-none text-cream">{t.auth.verify.title}</h2>
                <p className="mt-3 text-xs text-mist">{t.auth.verify.sentTo}</p>
                <p className="mt-1 flex items-center justify-center gap-2 text-sm">
                  <span className="max-w-[16rem] truncate font-semibold text-cream">{registration?.email}</span>
                  <button
                    type="button"
                    onClick={backToForm}
                    className="shrink-0 text-xs font-medium text-glow underline-offset-4 hover:underline"
                  >
                    {t.auth.verify.changeEmail}
                  </button>
                </p>
              </div>

              <div className="mt-7" data-verify-item>
                <CodeInput
                  value={code}
                  onChange={(next) => {
                    setCode(next)
                    if (codeStatus === 'error') setCodeStatus('idle')
                  }}
                  onComplete={(value) => void verify(value)}
                  status={codeStatus}
                  label={t.auth.verify.inputLabel}
                  length={CODE_LENGTH}
                />
              </div>

              {/* Une seule ligne d'état, hauteur réservée : les cases ne bougent pas. */}
              <div className="mt-4 flex min-h-10 items-center justify-center text-center" data-verify-item>
                {error ? (
                  <p role="alert" className="text-xs font-medium text-nope">
                    {error}
                  </p>
                ) : codeStatus === 'success' ? (
                  <p role="status" className="text-xs font-semibold text-like">
                    {t.auth.verify.success}
                  </p>
                ) : notice ? (
                  <p role="status" className="text-xs text-like">
                    {notice}
                  </p>
                ) : (
                  <p className="text-xs text-mist">
                    {expired ? t.auth.verify.expired : `${t.auth.verify.hint} ${t.auth.verify.expiresIn(minutesLeft)}.`}
                  </p>
                )}
              </div>

              <div data-verify-item>
                <Pressable
                  onClick={() => void verify(code)}
                  disabled={code.length < CODE_LENGTH || codeStatus === 'busy' || codeStatus === 'success'}
                  press={0.96}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3.5 text-sm font-medium text-void disabled:opacity-50"
                >
                  {codeStatus === 'busy' && <LoaderCircle size={16} className="animate-spin" />}
                  {codeStatus === 'busy' ? t.auth.verify.verifying : t.auth.verify.submit}
                </Pressable>

                <button
                  type="button"
                  onClick={() => void resend()}
                  disabled={resendIn > 0 || resending || codeStatus === 'success'}
                  className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-xs font-medium text-cream/75 transition-colors hover:text-cream disabled:text-mist/70"
                >
                  <RotateCcw size={13} className={resending ? 'animate-spin' : undefined} />
                  <span className="tabular-nums">
                    {resendIn > 0 ? t.auth.verify.resendIn(resendIn) : t.auth.verify.resend}
                  </span>
                </button>
                <p className="mt-1 text-center text-[11px] text-mist/70">{t.auth.verify.spam}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
