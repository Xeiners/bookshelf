import type { Box } from './types'

/*
 * La caméra de la toile : quelle partie du monde on voit. `x`, `y` : le coin supérieur gauche
 * de l'écran, en unités du monde ; `zoom` : pixels d'écran par unité. Le zoom se fait autour du
 * pointeur (le point sous le doigt ne bouge pas), se lisse, et la caméra glisse après un lancer.
 */

export const MIN_ZOOM = 0.0003
export const MAX_ZOOM = 64
/** En dessous, on affiche des tuiles raster ; au-dessus, les objets eux-mêmes (avec une marge : pas de bascule nerveuse). */
export const VECTOR_ENTER = 0.42
export const VECTOR_LEAVE = 0.3

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export class Camera {
  x = 0
  y = 0
  zoom = 1
  /** Taille de l'écran, en pixels CSS. */
  width = 1
  height = 1
  private targetZoom = 1
  private anchorX = 0
  private anchorY = 0
  private velocityX = 0
  private velocityY = 0
  private flight: { fromX: number; fromY: number; fromLog: number; toX: number; toY: number; toLog: number; at: number; duration: number } | null = null

  constructor() {
    this.targetZoom = this.zoom
  }

  setSize(width: number, height: number): void {
    // Le centre reste le centre quand la fenêtre change de taille.
    const cx = this.x + this.width / 2 / this.zoom
    const cy = this.y + this.height / 2 / this.zoom
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.x = cx - this.width / 2 / this.zoom
    this.y = cy - this.height / 2 / this.zoom
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + sx / this.zoom, this.y + sy / this.zoom]
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom, (wy - this.y) * this.zoom]
  }

  bounds(): Box {
    return { minX: this.x, minY: this.y, maxX: this.x + this.width / this.zoom, maxY: this.y + this.height / this.zoom }
  }

  center(): [number, number] {
    return [this.x + this.width / 2 / this.zoom, this.y + this.height / 2 / this.zoom]
  }

  /** Fait glisser la vue de `dx`, `dy` pixels d'écran. */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.zoom
    this.y -= dy / this.zoom
    this.flight = null
  }

  /** Un lancer : la vue continue sur sa lancée (pixels par seconde). */
  fling(vx: number, vy: number): void {
    this.velocityX = vx
    this.velocityY = vy
  }

  stop(): void {
    this.velocityX = this.velocityY = 0
    this.flight = null
    this.targetZoom = this.zoom
  }

  /** Zoom immédiat autour d'un point de l'écran. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.toWorld(sx, sy)
    this.zoom = clampZoom(this.zoom * factor)
    this.targetZoom = this.zoom
    this.x = wx - sx / this.zoom
    this.y = wy - sy / this.zoom
    this.flight = null
  }

  /** Zoom lissé (molette, boutons) : la vue y glisse en quelques dixièmes de seconde. */
  zoomSmooth(sx: number, sy: number, factor: number): void {
    this.targetZoom = clampZoom(this.targetZoom * factor)
    this.anchorX = sx
    this.anchorY = sy
    this.flight = null
  }

  /** Vol vers un point (et un zoom) : arrive en `duration` ms, en douceur. */
  flyTo(wx: number, wy: number, zoom = this.zoom, duration = 700, now = performance.now()): void {
    const [cx, cy] = this.center()
    this.flight = { fromX: cx, fromY: cy, fromLog: Math.log(this.zoom), toX: wx, toY: wy, toLog: Math.log(clampZoom(zoom)), at: now, duration }
    this.velocityX = this.velocityY = 0
  }

  /** Cadre une zone dans l'écran, avec un peu d'air. */
  fit(box: Box, margin = 0.12, duration = 700): void {
    const width = Math.max(1, box.maxX - box.minX)
    const height = Math.max(1, box.maxY - box.minY)
    const zoom = Math.min(this.width / width, this.height / height) * (1 - margin * 2)
    this.flyTo((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, zoom, duration)
  }

  setCenter(wx: number, wy: number): void {
    this.x = wx - this.width / 2 / this.zoom
    this.y = wy - this.height / 2 / this.zoom
  }

  get moving(): boolean {
    return this.flight !== null || Math.abs(this.velocityX) > 4 || Math.abs(this.velocityY) > 4 || Math.abs(Math.log(this.targetZoom / this.zoom)) > 0.0008
  }

  /** Avance d'un pas (`dt` secondes). Rend `true` si la vue a bougé. */
  tick(dt: number, now = performance.now()): boolean {
    let changed = false
    if (this.flight) {
      const { fromX, fromY, fromLog, toX, toY, toLog, at, duration } = this.flight
      const t = Math.min(1, (now - at) / duration)
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      this.zoom = clampZoom(Math.exp(fromLog + (toLog - fromLog) * eased))
      this.targetZoom = this.zoom
      this.setCenter(fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased)
      if (t >= 1) this.flight = null
      return true
    }
    if (Math.abs(Math.log(this.targetZoom / this.zoom)) > 0.0008) {
      const [wx, wy] = this.toWorld(this.anchorX, this.anchorY)
      this.zoom = clampZoom(this.zoom * (this.targetZoom / this.zoom) ** (1 - Math.exp(-dt * 16)))
      this.x = wx - this.anchorX / this.zoom
      this.y = wy - this.anchorY / this.zoom
      changed = true
    } else if (this.targetZoom !== this.zoom) {
      const [wx, wy] = this.toWorld(this.anchorX, this.anchorY)
      this.zoom = this.targetZoom
      this.x = wx - this.anchorX / this.zoom
      this.y = wy - this.anchorY / this.zoom
      changed = true
    }
    if (Math.abs(this.velocityX) > 4 || Math.abs(this.velocityY) > 4) {
      this.x -= (this.velocityX * dt) / this.zoom
      this.y -= (this.velocityY * dt) / this.zoom
      const damping = Math.exp(-dt * 5)
      this.velocityX *= damping
      this.velocityY *= damping
      changed = true
    } else {
      this.velocityX = this.velocityY = 0
    }
    return changed
  }
}

/** Niveau de tuile à afficher à ce zoom (cf. `canvas.tiles.ts` : 2 unités par pixel au niveau 0). */
export function tileLevelFor(zoom: number, maxLevel: number): number {
  const level = Math.floor(Math.log2(1 / (2 * zoom)))
  return Math.min(maxLevel, Math.max(0, level))
}
