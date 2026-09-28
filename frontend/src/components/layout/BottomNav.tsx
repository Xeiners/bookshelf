import { useEffect, useLayoutEffect, useRef } from 'react'
import { useActivitiesStatus } from '../../hooks/useActivitiesStatus'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import type { ViewId } from '../../store/useUiStore'
import { NAV_ITEMS } from './navItems'

/** Durée et courbe des transitions (≈ `power3.out`). */
const DURATION = 450
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** Rebond de l'icône activée (≈ `back.out(2)`). */
const BOUNCE = 'cubic-bezier(0.34, 1.8, 0.64, 1)'

interface BottomNavProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

/** Pose de la capsule : bord gauche et largeur de l'onglet actif, diamètre de ses bouts. */
interface PillPose {
  x: number
  w: number
  cap: number
}

/*
 * La capsule est faite de trois pièces pour ne bouger qu'en `transform` : deux
 * bouts ronds translatés et un segment central étiré en `scaleX` (couleur
 * unie : l'étirement ne se voit pas, les bouts ne sont jamais déformés).
 */
const pillTransforms = ({ x, w, cap }: PillPose) => [
  `translateX(${x}px)`,
  `translateX(${x + cap / 2}px) scaleX(${Math.max(0, w - cap)})`,
  `translateX(${x + Math.max(w, cap) - cap}px)`,
]

/**
 * Mesure la barre (offsets : insensibles aux animations en vol) et pose la
 * capsule sur l'onglet actif, sans animation. Rend la position de repos du
 * contenu de chaque onglet, point de départ du FLIP suivant.
 */
function layOut(nav: HTMLElement, parts: HTMLElement[]) {
  const lefts = new Map<ViewId, number>()
  let pill: PillPose | null = null
  for (const item of NAV_ITEMS) {
    const tab = nav.querySelector<HTMLElement>(`[data-tab="${item.id}"]`)
    const content = tab?.querySelector<HTMLElement>('[data-tab-content]')
    if (!tab || !content) continue
    lefts.set(item.id, tab.offsetLeft + content.offsetLeft)
    if (tab.getAttribute('aria-current') === 'page') {
      pill = { x: tab.offsetLeft, w: tab.offsetWidth, cap: parts[0]?.offsetWidth ?? 0 }
    }
  }
  if (pill) {
    pillTransforms(pill).forEach((transform, index) => {
      const part = parts[index]
      if (part) part.style.transform = transform
    })
  }
  return { lefts, pill }
}

/** Décalage horizontal courant d'un élément (animation en vol comprise). */
function translateXOf(node: HTMLElement): number {
  const transform = getComputedStyle(node).transform
  return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Barre de navigation flottante (mobile), à onglet actif « déployé ».
 *
 * Avec cinq entrées, cinq libellés côte à côte se tassaient. Ici seul l'onglet
 * actif affiche son libellé, à côté de l'icône ; les autres ne gardent que
 * l'icône (et leur nom pour les lecteurs d'écran).
 *
 * Largeurs en flex STATIQUE : l'onglet actif prend la largeur de son contenu
 * (le libellé se tronque s'il manque de place), les autres se partagent le
 * reste. Le navigateur fait une seule mise en page par changement d'onglet.
 *
 * Le mouvement est un FLIP en Web Animations, uniquement `transform` et
 * `opacity` : le compositeur le joue seul, même si le thread principal est
 * occupé à monter la nouvelle vue. Auparavant, GSAP animait `flexBasis`,
 * `maxWidth` et la largeur de la capsule en relisant `offsetLeft` à chaque
 * frame : une mise en page forcée par image, pile pendant la transition de vue.
 */
export function BottomNav({ view, onChange }: BottomNavProps) {
  const t = useT()
  const activities = useActivitiesStatus()
  const navRef = useRef<HTMLElement>(null)
  /** Position de repos du contenu de chaque onglet, depuis le bord de la barre. */
  const restLefts = useRef(new Map<ViewId, number>())
  /** Vue déjà mise en page : sert à savoir s'il faut animer. */
  const shownView = useRef<ViewId | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const parts = [...nav.querySelectorAll<HTMLElement>('[data-pill]')]
    const contents = new Map(
      NAV_ITEMS.map((item) => [item.id, nav.querySelector<HTMLElement>(`[data-tab="${item.id}"] [data-tab-content]`)]),
    )

    const previous = shownView.current
    shownView.current = view
    const animate = previous !== null && previous !== view && !reducedMotion()

    // État VISUEL de départ, animations en vol comprises : un tap pendant une
    // transition repart d'où en sont les éléments, sans saut.
    const fromPill = animate ? parts.map((part) => getComputedStyle(part).transform) : []
    const fromLefts = new Map<ViewId, number>()
    if (animate) {
      for (const [id, content] of contents) {
        const rest = restLefts.current.get(id)
        if (content && rest !== undefined) fromLefts.set(id, rest + translateXOf(content))
      }
    }

    const { lefts, pill } = layOut(nav, parts)
    restLefts.current = lefts
    if (!animate || !pill) return

    const timing = { duration: DURATION, easing: EASING }
    pillTransforms(pill).forEach((to, index) => {
      const part = parts[index]
      if (!part) return
      part.getAnimations().forEach((running) => running.cancel())
      part.animate({ transform: [fromPill[index] ?? to, to] }, timing)
    })

    for (const [id, content] of contents) {
      if (!content) continue
      content.getAnimations().forEach((running) => running.cancel())
      const from = fromLefts.get(id)
      const to = lefts.get(id)
      if (from === undefined || to === undefined || Math.abs(from - to) < 0.5) continue
      content.animate({ transform: [`translateX(${from - to}px)`, 'translateX(0)'] }, timing)
    }

    nav
      .querySelector(`[data-label="${view}"]`)
      ?.animate(
        { opacity: [0, 1], transform: ['translateX(-6px)', 'translateX(0)'] },
        { duration: 300, delay: 90, easing: EASING, fill: 'backwards' },
      )
    nav
      .querySelector(`[data-icon="${view}"]`)
      ?.animate({ transform: ['scale(0.84)', 'scale(1)'] }, { duration: DURATION, easing: BOUNCE })
  }, [view])

  // Polices web qui arrivent, langue, rotation : le flex se recale seul, la
  // capsule suit sans animation.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const parts = [...nav.querySelectorAll<HTMLElement>('[data-pill]')]
    const observer = new ResizeObserver(() => {
      restLefts.current = layOut(nav, parts).lefts
    })
    observer.observe(nav)
    for (const tab of nav.querySelectorAll('[data-tab]')) observer.observe(tab)
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      ref={navRef}
      aria-label={t.nav.label}
      className="glass-strong relative flex w-full items-stretch gap-1 overflow-hidden rounded-full p-1.5 shadow-lift"
    >
      {/* Capsule active : deux bouts ronds + un segment central, posés par `layOut`. */}
      <span aria-hidden className="pointer-events-none absolute top-1.5 bottom-1.5 left-0">
        <span data-pill className="absolute inset-y-0 left-0 w-12 rounded-full bg-cream" />
        <span data-pill className="absolute inset-y-0 left-0 w-px origin-left bg-cream" />
        <span data-pill className="absolute inset-y-0 left-0 w-12 rounded-full bg-cream" />
      </span>

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
            className={`relative z-10 flex h-12 items-center justify-center rounded-full px-3 ${
              isActive ? 'min-w-0 shrink grow-0 basis-auto' : 'min-w-9 shrink-0 grow basis-0'
            }`}
          >
            <span data-tab-content className="flex min-w-0 items-center gap-1.5">
              <span
                data-icon={item.id}
                className={`relative shrink-0 transition-colors duration-300 ${isActive ? 'text-void' : 'text-mist'}`}
              >
                <Icon size={20} strokeWidth={2} />
                {/* Tirage du jour ou booster prêt : une étincelle dorée sur les Activités. */}
                {item.id === 'activities' && activities.attention && (
                  <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-gold shadow-[0_0_8px_var(--color-gold)]" />
                )}
              </span>
              {/* Nom déjà porté par `aria-label` : le libellé visible est masqué aux lecteurs d'écran. */}
              {isActive && (
                <span data-label={item.id} aria-hidden className="truncate text-[12px] font-semibold text-void">
                  {t.nav[item.id]}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
