import { useEffect, type RefObject } from 'react'

/** Inclinaison maximale d'une carte, en degrés. */
const MAX_TILT = 14

/**
 * Inclinaison et reflet holographique d'une carte, à la souris ou à
 * l'inclinaison du téléphone (gyroscope). Écrit des variables CSS sur
 * l'élément (`--rx`, `--ry` en degrés, `--mx`, `--my` en %, `--holo` 0 → 1),
 * une fois par image au plus (`requestAnimationFrame`) et sans aucun rendu
 * React : l'animation reste à 60 images/s même avec plusieurs cartes.
 *
 * Rien ne bouge si l'utilisateur a demandé moins d'animations.
 */
export function useHoloTilt(ref: RefObject<HTMLElement | null>, enabled: boolean, options: { gyro?: boolean } = {}): void {
  const gyro = options.gyro ?? false

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let target = { x: 0.5, y: 0.5, active: 0 }
    const apply = () => {
      frame = 0
      node.style.setProperty('--ry', `${((target.x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
      node.style.setProperty('--rx', `${((0.5 - target.y) * 2 * MAX_TILT).toFixed(2)}deg`)
      node.style.setProperty('--mx', `${(target.x * 100).toFixed(1)}%`)
      node.style.setProperty('--my', `${(target.y * 100).toFixed(1)}%`)
      node.style.setProperty('--holo', target.active.toFixed(2))
    }
    const schedule = (next: typeof target) => {
      target = next
      frame ||= requestAnimationFrame(apply)
    }

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect()
      schedule({
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        active: 1,
      })
    }
    const onLeave = () => schedule({ x: 0.5, y: 0.5, active: 0 })

    // Gyroscope : bêta (avant / arrière) et gamma (gauche / droite), ramenés à [0, 1] autour de la tenue naturelle.
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return
      schedule({
        x: Math.min(1, Math.max(0, 0.5 + event.gamma / 50)),
        y: Math.min(1, Math.max(0, 0.5 + (event.beta - 45) / 50)),
        active: 0.85,
      })
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    if (gyro) window.addEventListener('deviceorientation', onOrientation)
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('deviceorientation', onOrientation)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, enabled, gyro])
}

/**
 * iOS demande l'autorisation d'accéder au gyroscope, et seulement pendant un
 * geste de l'utilisateur : à appeler dans un gestionnaire de clic. Ailleurs,
 * ne fait rien.
 */
export function requestTiltPermission(): void {
  if (typeof DeviceOrientationEvent === 'undefined') return
  const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission
  if (typeof request === 'function') void request().catch(() => undefined)
}
