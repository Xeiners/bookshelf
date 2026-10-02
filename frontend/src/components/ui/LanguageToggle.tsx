import { useRef } from 'react'
import { useLanguage, useT, LANGUAGES, DICTIONARIES } from '../../i18n'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useSettingsStore } from '../../store/useSettingsStore'

const COLOR_ACTIVE = '#06060a'
const COLOR_IDLE = '#9d9aab'

/**
 * Sélecteur FR / EN : capsule glissante, même grammaire que les onglets de la
 * bibliothèque. Change la langue de l'interface ET du catalogue.
 */
export function LanguageToggle() {
  const t = useT()
  const language = useLanguage()
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const rootRef = useRef<HTMLDivElement>(null)
  const placedRef = useRef(false)

  // GSAP est le SEUL propriétaire du transform de la capsule et des couleurs :
  // un `style` React en parallèle se cumulerait avec `xPercent` et décalerait
  // la capsule. Premier placement instantané (layout effect, avant la peinture).
  useGSAP(
    () => {
      const duration = placedRef.current ? 0.38 : 0
      placedRef.current = true
      gsap.to('[data-lang-thumb]', {
        xPercent: LANGUAGES.indexOf(language) * 100,
        duration,
        ease: 'power3.out',
        overwrite: 'auto',
      })
      for (const code of LANGUAGES) {
        gsap.to(`[data-lang="${code}"]`, {
          color: code === language ? COLOR_ACTIVE : COLOR_IDLE,
          duration: duration && 0.3,
          overwrite: 'auto',
        })
      }
    },
    { dependencies: [language], scope: rootRef },
  )

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={t.language.label}
      className="glass relative grid shrink-0 grid-cols-2 rounded-full p-1"
    >
      <span
        data-lang-thumb
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-cream"
      />
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={code === language}
          // Chaque langue est nommée dans SA langue (« Français », « English ») et
          // balisée \`lang\` : un lecteur d'écran la prononce correctement, et
          // quelqu'un perdu dans une langue qu'il ne lit pas retrouve la sienne.
          aria-label={DICTIONARIES[code].language.names[code]}
          title={t.language.switchTo(DICTIONARIES[code].language.names[code])}
          lang={code}
          data-lang={code}
          onClick={() => {
            if (code === language) return
            vibrate(8)
            setLanguage(code)
          }}
          // `w-full` : le bouton occupe toute sa moitié de grille. Avec une largeur fixe,
          // un sélecteur étiré (barre latérale) laissait le libellé décalé sous la capsule.
          className="relative z-10 w-full min-w-10 py-1.5 text-center text-[11px] font-semibold tracking-[0.12em] text-mist uppercase"
        >
          {code}
        </button>
      ))}
    </div>
  )
}

/**
 * Variante compacte (en-tête du téléphone) : une pastille qui affiche la langue
 * courante et bascule sur l'autre d'un tap — deux langues seulement, et la
 * place manque à côté de la musique et des notifications. Le code roule à la
 * bascule, comme un compteur mécanique.
 */
export function LanguageSwitch() {
  const t = useT()
  const language = useLanguage()
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const rootRef = useRef<HTMLButtonElement>(null)
  const next = LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]!
  const nextName = DICTIONARIES[next].language.names[next]
  const firstRun = useRef(true)

  useGSAP(
    () => {
      if (firstRun.current) {
        firstRun.current = false
        return
      }
      gsap.fromTo('[data-lang-code]', { yPercent: 70, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)' })
    },
    { dependencies: [language], scope: rootRef },
  )

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={() => {
        vibrate(8)
        setLanguage(next)
      }}
      // Nommée dans la langue de destination : on retrouve la sienne même perdu dans l'autre.
      aria-label={t.language.switchTo(nextName)}
      title={t.language.switchTo(nextName)}
      lang={next}
      className="glass grid size-10 shrink-0 place-items-center overflow-hidden rounded-full"
    >
      <span data-lang-code className="text-[11px] font-semibold tracking-[0.12em] text-cream uppercase">
        {language}
      </span>
    </button>
  )
}
