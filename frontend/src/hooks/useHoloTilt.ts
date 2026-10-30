import { useEffect, type RefObject } from 'react'

/** Inclinaison maximale d'une carte, en degrés. */
const MAX_TILT = 14

/** Amplitude du mouvement du téléphone (degrés) qui amène la carte en butée. */
const GYRO_RANGE = 22
/** Vitesses de rotation ignorées (°/s) : le bruit du capteur, la main qui tremble. */
const DEAD_ZONE = 3
/** Retour au repos de la carte après un mouvement du téléphone (constante de temps, s). */
const SETTLE_S = 1.4
/** Repli sans gyroscope : la tenue de référence rattrape la tenue réelle (constante de temps, s). */
const BASELINE_S = 2.5
/** Lissage de l'affichage, par image (0 → 1 : part du chemin parcourue). */
const SMOOTHING = 0.22

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Angle de l'écran (0, 90, 180, 270) : en paysage, les axes du téléphone ne sont plus ceux de l'écran. */
function screenAngle(): number {
  const angle = window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0
  return ((angle % 360) + 360) % 360
}

/**
 * Ramène un couple (autour de l'axe horizontal du téléphone, autour de son axe vertical) dans le
 * repère de l'écran : `[vertical, horizontal]` de l'écran tel qu'on le regarde.
 */
function toScreen(aroundX: number, aroundY: number): [number, number] {
  switch (screenAngle()) {
    case 90:
      return [-aroundY, aroundX]
    case 180:
      return [-aroundX, -aroundY]
    case 270:
      return [aroundY, -aroundX]
    default:
      return [aroundX, aroundY]
  }
}

/**
 * Inclinaison et reflet holographique d'une carte, au doigt / à la souris ou au gyroscope.
 * Écrit des variables CSS sur l'élément (`--rx`, `--ry` en degrés, `--mx`, `--my` en %,
 * `--holo` 0 → 1), une fois par image au plus et sans aucun rendu React.
 *
 * Gyroscope : la carte suit le MOUVEMENT du téléphone (vitesse de rotation, `devicemotion`),
 * puis revient doucement au repos — quelle que soit la façon dont on le tient (debout, à plat,
 * allongé, en paysage). L'angle absolu (`deviceorientation`) n'est qu'un repli, relatif à la
 * tenue du moment : sur Android, il supposait une tenue à 45° (carte penchée en permanence
 * sinon) et sautait de +90° à −90° près de la verticale (carte qui bascule d'un bord à l'autre).
 * Le doigt sur la carte a toujours la priorité.
 *
 * Rien ne bouge si l'utilisateur a demandé moins d'animations.
 */
export function useHoloTilt(ref: RefObject<HTMLElement | null>, enabled: boolean, options: { gyro?: boolean } = {}): void {
  const gyro = options.gyro ?? false

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /** Ce qu'on vise (0 → 1 sur chaque axe, 0,5 au centre) et ce qui est affiché (lissé). */
    let target = { x: 0.5, y: 0.5, active: 0 }
    const shown = { x: 0.5, y: 0.5, active: 0 }
    let frame = 0
    /** Un doigt (ou la souris) est sur la carte : le gyroscope attend. */
    let pointing = false

    const apply = () => {
      frame = 0
      shown.x += (target.x - shown.x) * SMOOTHING
      shown.y += (target.y - shown.y) * SMOOTHING
      shown.active += (target.active - shown.active) * SMOOTHING
      node.style.setProperty('--ry', `${((shown.x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
      node.style.setProperty('--rx', `${((0.5 - shown.y) * 2 * MAX_TILT).toFixed(2)}deg`)
      node.style.setProperty('--mx', `${(shown.x * 100).toFixed(1)}%`)
      node.style.setProperty('--my', `${(shown.y * 100).toFixed(1)}%`)
      node.style.setProperty('--holo', shown.active.toFixed(2))
      // Pas encore arrivé : on continue à la prochaine image.
      if (Math.abs(target.x - shown.x) + Math.abs(target.y - shown.y) + Math.abs(target.active - shown.active) > 0.002) frame = requestAnimationFrame(apply)
    }
    const schedule = (next: typeof target) => {
      target = next
      frame ||= requestAnimationFrame(apply)
    }

    const onMove = (event: PointerEvent) => {
      pointing = true
      const rect = node.getBoundingClientRect()
      schedule({
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
        active: 1,
      })
    }
    const onLeave = () => {
      pointing = false
      schedule({ x: 0.5, y: 0.5, active: 0 })
    }

    /** Inclinaison virtuelle de la carte (degrés), dans le repère de l'écran. */
    let tilt = { vertical: 0, horizontal: 0 }
    const show = () => {
      if (pointing) return
      const strength = Math.hypot(tilt.vertical, tilt.horizontal) / GYRO_RANGE
      schedule({
        x: 0.5 + tilt.horizontal / (2 * GYRO_RANGE),
        y: 0.5 + tilt.vertical / (2 * GYRO_RANGE),
        // Le reflet s'allume avec le mouvement, sans jamais s'éteindre tout à fait.
        active: clamp(0.35 + strength * 0.9, 0, 1),
      })
    }

    // Gyroscope : vitesse de rotation intégrée, avec un retour progressif au repos.
    let usingMotion = false
    let lastMotion = 0
    const onMotion = (event: DeviceMotionEvent) => {
      const rate = event.rotationRate
      if (!rate || rate.beta === null || rate.gamma === null) return
      usingMotion = true
      const dt = lastMotion ? clamp((event.timeStamp - lastMotion) / 1000, 0, 0.05) : 0
      lastMotion = event.timeStamp
      const [vertical, horizontal] = toScreen(rate.beta, rate.gamma)
      const quiet = (value: number) => (Math.abs(value) < DEAD_ZONE ? 0 : value)
      const settle = Math.exp(-dt / SETTLE_S)
      tilt = {
        vertical: clamp((tilt.vertical + quiet(vertical) * dt) * settle, -GYRO_RANGE, GYRO_RANGE),
        horizontal: clamp((tilt.horizontal + quiet(horizontal) * dt) * settle, -GYRO_RANGE, GYRO_RANGE),
      }
      show()
    }

    // Repli (pas de gyroscope) : l'angle, relatif à une tenue de référence qui suit lentement la tenue réelle.
    let baseline: { vertical: number; horizontal: number } | null = null
    let lastOrientation = 0
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (usingMotion || event.beta === null || event.gamma === null) return
      const [vertical, horizontal] = toScreen(event.beta, event.gamma)
      const dt = lastOrientation ? clamp((event.timeStamp - lastOrientation) / 1000, 0, 0.1) : 0
      lastOrientation = event.timeStamp
      // Première mesure, ou saut brutal (bascule près de la verticale) : la tenue actuelle devient la référence.
      if (!baseline || Math.abs(vertical - baseline.vertical) > 60 || Math.abs(horizontal - baseline.horizontal) > 60) {
        baseline = { vertical, horizontal }
      }
      const follow = 1 - Math.exp(-dt / BASELINE_S)
      baseline = { vertical: baseline.vertical + (vertical - baseline.vertical) * follow, horizontal: baseline.horizontal + (horizontal - baseline.horizontal) * follow }
      tilt = {
        vertical: clamp(vertical - baseline.vertical, -GYRO_RANGE, GYRO_RANGE),
        horizontal: clamp(horizontal - baseline.horizontal, -GYRO_RANGE, GYRO_RANGE),
      }
      show()
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    node.addEventListener('pointercancel', onLeave)
    if (gyro) {
      window.addEventListener('devicemotion', onMotion)
      window.addEventListener('deviceorientation', onOrientation)
    }
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      node.removeEventListener('pointercancel', onLeave)
      window.removeEventListener('devicemotion', onMotion)
      window.removeEventListener('deviceorientation', onOrientation)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, enabled, gyro])
}

/**
 * iOS demande l'autorisation d'accéder aux capteurs de mouvement, et seulement pendant un
 * geste de l'utilisateur : à appeler dans un gestionnaire de clic. Ailleurs, ne fait rien.
 */
export function requestTiltPermission(): void {
  for (const sensor of [typeof DeviceMotionEvent === 'undefined' ? null : DeviceMotionEvent, typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent]) {
    const request = (sensor as unknown as { requestPermission?: () => Promise<string> } | null)?.requestPermission
    if (typeof request === 'function') void request.call(sensor).catch(() => undefined)
  }
}
