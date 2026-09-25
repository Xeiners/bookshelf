import { useEffect, useRef, useState } from 'react'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useLanguage, useT } from '../../i18n'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import type { ViewId } from '../../store/useUiStore'
import { NAV_COLOR_ACTIVE, NAV_COLOR_IDLE, NAV_ITEMS } from './navItems'

/** Marge intérieure horizontale d'un onglet (px-3) et espace icône ↔ libellé (gap-1.5). */
const TAB_PADDING_X = 12
const ICON_LABEL_GAP = 6
/** Largeur minimale d'un onglet replié : son icône, avec un peu d'air. */
const COLLAPSED_MIN = 36

interface BottomNavProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

/**
 * Barre de navigation flottante (mobile), à onglet actif « déployé ».
 *
 * Avec cinq entrées, cinq libellés côte à côte se tassaient. Ici seul l'onglet
 * actif affiche son libellé, à côté de l'icône, dans une capsule plus large ;
 * les autres ne gardent que l'icône (et leur nom pour les lecteurs d'écran).
 *
 * L'onglet actif prend EXACTEMENT la largeur de son contenu (icône + libellé,
 * mesurés) ; les autres se partagent le reste à parts égales. Un ratio fixe
 * rognait les libellés longs (« Recherche », « Discover ») sur les petits
 * écrans : la largeur mesurée tient quelle que soit la langue.
 *
 * Au changement de vue, GSAP anime ensemble la largeur des onglets
 * (`flexBasis` / `flexGrow`), l'ouverture du libellé (`maxWidth`) et la capsule,
 * qui suit l'onglet actif image par image. Pas de dépassement d'easing :
 * l'`overflow-hidden` rognerait la capsule aux extrémités.
 */
export function BottomNav({ view, onChange }: BottomNavProps) {
  const t = useT()
  const language = useLanguage()
  const oracle = useOracleStatus()
  const navRef = useRef<HTMLElement>(null)
  /** Dernière vue / langue mises en page : sert à savoir s'il faut animer. */
  const laidOut = useRef<{ view: ViewId; language: string } | null>(null)

  /*
   * Deux causes de remise en page SANS animation : les polices web qui
   * arrivent après le premier rendu (Inter est plus large que la police de
   * secours : la largeur mesurée au montage rognait le libellé), et la
   * largeur de la barre qui change (rotation, fenêtre).
   */
  const [fontsReady, setFontsReady] = useState(false)
  const [navWidth, setNavWidth] = useState(0)

  useEffect(() => {
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) setFontsReady(true)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(([entry]) => setNavWidth(Math.round(entry?.contentRect.width ?? 0)))
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])

  /** Cale la capsule sur l'onglet actif (position et largeur réelles). */
  const syncIndicator = () => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    const indicator = nav?.querySelector<HTMLElement>('[data-indicator]')
    if (!active || !indicator) return
    gsap.set(indicator, { x: active.offsetLeft, width: active.offsetWidth })
  }

  useGSAP(
    () => {
      // On n'anime que les vrais changements de vue ou de langue.
      const previous = laidOut.current
      const animate = previous !== null && (previous.view !== view || previous.language !== language)
      laidOut.current = { view, language }
      const duration = animate ? 0.45 : 0

      const timeline = gsap.timeline({ defaults: { duration, ease: 'power3.out' }, onUpdate: syncIndicator, onComplete: syncIndicator })

      const nav = navRef.current
      // Place laissée à l'onglet actif : les autres gardent au moins leur icône.
      const inner = nav ? nav.clientWidth - 12 - 4 * (NAV_ITEMS.length - 1) : 0
      const room = inner - COLLAPSED_MIN * (NAV_ITEMS.length - 1)

      for (const item of NAV_ITEMS) {
        const active = item.id === view
        const label = nav?.querySelector<HTMLElement>(`[data-label="${item.id}"]`)
        const icon = nav?.querySelector<HTMLElement>(`[data-icon="${item.id}"]`)

        if (active && label && icon) {
          const natural = icon.offsetWidth + ICON_LABEL_GAP + label.scrollWidth + TAB_PADDING_X * 2
          timeline.to(`[data-tab="${item.id}"]`, { flexGrow: 0, flexBasis: Math.min(natural, room) }, 0)
        } else {
          timeline.to(`[data-tab="${item.id}"]`, { flexGrow: 1, flexBasis: 0 }, 0)
        }

        if (label) {
          timeline.to(
            label,
            // `scrollWidth` : largeur réelle du texte, même replié à 0.
            { maxWidth: active ? label.scrollWidth : 0, autoAlpha: active ? 1 : 0, duration: active ? duration : duration * 0.6 },
            active ? duration * 0.25 : 0,
          )
        }
        timeline.to(`[data-tint="${item.id}"]`, { color: active ? NAV_COLOR_ACTIVE : NAV_COLOR_IDLE, duration: duration * 0.8 }, 0)
      }

      if (duration > 0) {
        // Échelle uniquement : un décalage vertical se lirait comme une barre qui saute.
        gsap.fromTo(`[data-icon="${view}"]`, { scale: 0.84 }, { scale: 1, duration: 0.45, ease: 'back.out(2)' })
      }
      syncIndicator()
    },
    // Vue, langue (longueur des libellés), polices chargées, largeur de la barre.
    { dependencies: [view, language, fontsReady, navWidth], scope: navRef },
  )

  return (
    <nav
      ref={navRef}
      aria-label={t.nav.label}
      className="glass-strong relative flex w-full items-stretch gap-1 overflow-hidden rounded-full p-1.5 shadow-lift"
    >
      {/* Capsule active : suit l'onglet déployé */}
      <span
        data-indicator
        aria-hidden
        className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-full bg-cream will-change-transform"
      />

      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const isActive = item.id === view
        return (
          <button
            key={item.id}
            data-tab={item.id}
            type="button"
            aria-label={t.nav[item.id]}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (isActive) return
              vibrate(8)
              onChange(item.id)
            }}
            // Largeurs posées par GSAP au premier rendu (avant la peinture), puis animées.
            className="relative z-10 flex h-12 min-w-0 shrink-0 grow basis-0 items-center justify-center gap-1.5 rounded-full px-3"
          >
            <span data-icon={item.id} data-tint={item.id} className="relative shrink-0 text-mist">
              <Icon size={20} strokeWidth={2} />
              {/* Le tirage du jour attend : une étincelle dorée sur l'Oracle. */}
              {item.id === 'oracle' && oracle.available && (
                <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-gold shadow-[0_0_8px_var(--color-gold)]" />
              )}
            </span>
            {/* Nom déjà porté par `aria-label` : le libellé visible est masqué aux lecteurs d'écran. */}
            <span
              data-label={item.id}
              data-tint={item.id}
              aria-hidden
              className="overflow-hidden text-[12px] font-semibold whitespace-nowrap text-mist"
              style={isActive ? undefined : { maxWidth: 0, opacity: 0, visibility: 'hidden' }}
            >
              {t.nav[item.id]}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
