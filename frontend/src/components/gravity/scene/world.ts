import { CRUMBLE_DELAY, PICKUP_R, SPIKE_H, TICK, WORLD_HEIGHT } from '../../../lib/gravity/constants'
import { scrollRank, shurikenAt, solidAt, type GravityRun, type GravityWorld, type Solid } from '../../../lib/gravity/engine'
import type { GravityTheme, Material } from '../../../lib/gravity/themes'

/*
 * Les éléments d'un niveau, dessinés dans le repère du monde (une unité = une unité de jeu) :
 * blocs selon la matière du thème (tuiles de toit, pierre, mousse, bois, neige), fragiles qui
 * tremblent puis tombent, plateformes mobiles à runes, pics, shurikens qui tournent, sceaux
 * d'inversion, portes de taille, bûches de substitution, lune, rouleaux et torii d'arrivée.
 */

/** Couleurs des portes de taille : rapetisser (violet), grandir (ambre). */
export const GATE_COLORS = { mini: '#c08bff', full: '#ffb84d' } as const

export interface View {
  /** Bord gauche et droit visibles (unités). */
  left: number
  right: number
  /** Temps d'affichage (s), pour les animations décoratives. */
  time: number
}

const shade = (hex: string, amount: number) => {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))))
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`
}

/** Petit hasard fixe d'un nombre (fissures, touffes : toujours les mêmes). */
const noise = (value: number) => {
  const x = Math.sin(value * 91.7 + 13.3) * 43758.5453
  return x - Math.floor(x)
}

export class WorldPainter {
  private patterns = new Map<string, CanvasPattern | null>()

  readonly theme: GravityTheme

  constructor(theme: GravityTheme) {
    this.theme = theme
  }

  /** Motif du corps des blocs (briques, planches…), en coordonnées du monde. */
  private pattern(ctx: CanvasRenderingContext2D, material: Material): CanvasPattern | null {
    if (this.patterns.has(material)) return this.patterns.get(material)!
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const g = canvas.getContext('2d')
    let pattern: CanvasPattern | null = null
    if (g) {
      g.strokeStyle = 'rgba(0,0,0,0.35)'
      g.lineWidth = 2
      g.fillStyle = 'rgba(255,255,255,0.06)'
      if (material === 'wood' || material === 'tiles') {
        for (let x = 0; x < size; x += 16) {
          g.fillRect(x + 1, 0, 6, size)
          g.beginPath()
          g.moveTo(x, 0)
          g.lineTo(x, size)
          g.stroke()
        }
      } else {
        for (let row = 0; row < 4; row += 1) {
          const y = row * 16
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(size, y)
          g.stroke()
          for (let x = row % 2 ? 0 : 16; x < size; x += 32) {
            g.beginPath()
            g.moveTo(x, y)
            g.lineTo(x, y + 16)
            g.stroke()
            g.fillRect(x + 3, y + 3, 10, 4)
          }
        }
      }
      pattern = ctx.createPattern(canvas, 'repeat')
      pattern?.setTransform(new DOMMatrix().scale(2 / size))
    }
    this.patterns.set(material, pattern)
    return pattern
  }

  draw(ctx: CanvasRenderingContext2D, world: GravityWorld, run: GravityRun, view: View, renderTick: number): void {
    const t = renderTick * TICK
    const visible = (x0: number, x1: number) => x1 > view.left - 2 && x0 < view.right + 2

    // Le chemin des pièges mobiles, discret.
    for (const shuriken of world.shurikens) {
      if ((shuriken.dx || shuriken.dy) && visible(Math.min(shuriken.x, shuriken.x + shuriken.dx), Math.max(shuriken.x, shuriken.x + shuriken.dx))) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 0.06
        ctx.setLineDash([0.2, 0.25])
        ctx.beginPath()
        ctx.moveTo(shuriken.x, shuriken.y)
        ctx.lineTo(shuriken.x + shuriken.dx, shuriken.y + shuriken.dy)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    this.finish(ctx, world, view)

    world.solids.forEach((solid, index) => {
      const at = solidAt(solid, t)
      const span = solid.kind === 'mover' ? [Math.min(solid.x, solid.x + solid.dx), Math.max(solid.x, solid.x + solid.dx) + solid.w] : [solid.x, solid.x + solid.w]
      if (!visible(span[0]!, span[1]!)) return
      if (solid.kind === 'crumble') this.crumble(ctx, solid, index, run, renderTick)
      else if (solid.kind === 'mover') this.mover(ctx, solid, at.x, at.y, view.time)
      else this.block(ctx, at.x, at.y, solid.w, solid.h)
    })

    for (const spike of world.spikes) if (visible(spike.x, spike.x + spike.w)) this.spikes(ctx, spike.x, spike.y, spike.w, spike.dir)
    for (const flip of world.flips) if (visible(flip.x, flip.x + flip.w)) this.seal(ctx, flip.x, flip.y, flip.w, flip.h, view.time)
    for (const gate of world.gates) if (visible(gate.x, gate.x + gate.w)) this.gate(ctx, gate.x, gate.y, gate.w, gate.h, gate.mini, view.time)
    world.pickups.forEach((pickup, index) => {
      if (!visible(pickup.x - 1, pickup.x + 1)) return
      if (pickup.kind === 'moon') {
        if (!run.moons.includes(index)) this.moon(ctx, pickup.x, pickup.y + Math.sin(view.time * 3 + index) * 0.12, view.time)
      } else if (pickup.kind === 'log') {
        if (!run.logs.includes(index)) this.log(ctx, pickup.x, pickup.y + Math.sin(view.time * 2.8 + index) * 0.12, view.time)
      } else if (!(run.scrolls & (1 << scrollRank(world, index)))) this.scroll(ctx, pickup.x, pickup.y + Math.sin(view.time * 2.6 + index) * 0.12, view.time)
    })
    for (const shuriken of world.shurikens) {
      const at = shurikenAt(shuriken, t)
      if (visible(at.x - shuriken.r, at.x + shuriken.r)) this.shuriken(ctx, at.x, at.y, shuriken.r, view.time * 11)
    }
  }

  /** Un bloc : corps texturé, côtés ombrés, et la matière du thème sur ses faces praticables. */
  block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, palette = this.theme.platform): void {
    ctx.fillStyle = palette.body
    ctx.fillRect(x, y, w, h)
    const pattern = this.pattern(ctx, palette.material)
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(x, y, w, h)
    }
    // Côtés : un dégradé d'ombre.
    const side = Math.min(0.35, w / 3)
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fillRect(x, y, side * 0.5, h)
    ctx.fillRect(x + w - side * 0.5, y, side * 0.5, h)
    if (y > -1 && y < WORLD_HEIGHT + 1) this.cap(ctx, x, y, w, 1, palette)
    if (y + h > -1 && y + h < WORLD_HEIGHT + 1) this.cap(ctx, x, y + h, w, -1, palette)
  }

  /** La face praticable : `face` 1 pour un dessus (sol), −1 pour un dessous (plafond). */
  private cap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, face: 1 | -1, palette = this.theme.platform): void {
    const inward = face // vers l'intérieur du bloc
    const band = 0.42
    const top = face === 1 ? y : y - band
    ctx.fillStyle = palette.top
    ctx.fillRect(x, top, w, band)
    const lighter = shade(palette.top.startsWith('#') ? palette.top : '#888888', 0.25)
    const darker = shade(palette.top.startsWith('#') ? palette.top : '#888888', -0.35)
    switch (palette.material) {
      case 'tiles': {
        // Tuiles de toit en écailles, débordant un peu.
        for (let tx = x; tx < x + w - 0.05; tx += 0.4) {
          ctx.fillStyle = darker
          ctx.beginPath()
          ctx.arc(tx + 0.2, y + inward * 0.24, 0.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = lighter
          ctx.beginPath()
          ctx.arc(tx + 0.2, y + inward * 0.2, 0.15, face === 1 ? Math.PI : 0, face === 1 ? Math.PI * 2 : Math.PI)
          ctx.fill()
        }
        break
      }
      case 'stone':
        ctx.fillStyle = darker
        for (let tx = x + 0.9; tx < x + w; tx += 1.1) ctx.fillRect(tx, top, 0.05, band)
        ctx.fillStyle = lighter
        ctx.fillRect(x, face === 1 ? y : y - 0.06, w, 0.06)
        break
      case 'moss': {
        // Herbe dressée (dessus) ou mousse qui pend (dessous).
        ctx.fillStyle = lighter
        for (let tx = x; tx < x + w; tx += 0.22) {
          const tall = 0.12 + noise(tx) * 0.2
          ctx.beginPath()
          ctx.moveTo(tx, y)
          ctx.lineTo(tx + 0.07, y - face * tall)
          ctx.lineTo(tx + 0.14, y)
          ctx.fill()
        }
        break
      }
      case 'wood':
        ctx.fillStyle = darker
        for (let tx = x + 1.3; tx < x + w; tx += 1.6) ctx.fillRect(tx, top, 0.04, band)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        for (let tx = x + 0.3; tx < x + w; tx += 0.8) ctx.fillRect(tx, top + band * 0.4, 0.05, 0.05)
        break
      case 'snow': {
        // Neige bombée dessus, stalactites de glace dessous.
        ctx.fillStyle = '#ffffff'
        if (face === 1) {
          for (let tx = x; tx < x + w; tx += 0.5) {
            ctx.beginPath()
            ctx.arc(tx + 0.25, y + 0.05, 0.27 + noise(tx) * 0.08, Math.PI, Math.PI * 2)
            ctx.fill()
          }
        } else {
          ctx.fillStyle = 'rgba(210,238,255,0.92)'
          for (let tx = x + 0.1; tx < x + w - 0.1; tx += 0.45) {
            const long = 0.2 + noise(tx) * 0.35
            ctx.beginPath()
            ctx.moveTo(tx, y)
            ctx.lineTo(tx + 0.09, y + long)
            ctx.lineTo(tx + 0.18, y)
            ctx.fill()
          }
        }
        break
      }
    }
    // Liseré lumineux : la surface où l'on court se lit d'un coup d'œil.
    ctx.strokeStyle = palette.edge
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y)
    ctx.stroke()
    ctx.globalAlpha = 0.95
    ctx.lineWidth = 0.05
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  /** Fragile : pierre fissurée ; touchée, elle tremble, puis tombe en tournant. */
  private crumble(ctx: CanvasRenderingContext2D, solid: Solid, index: number, run: GravityRun, renderTick: number): void {
    const touched = run.crumbles.get(index)
    const elapsed = touched === undefined ? -1 : (renderTick - touched) * TICK
    ctx.save()
    if (elapsed >= CRUMBLE_DELAY) {
      const fall = elapsed - CRUMBLE_DELAY
      if (fall > 1.2) {
        ctx.restore()
        return
      }
      ctx.globalAlpha = Math.max(0, 1 - fall / 1.2)
      ctx.translate(solid.x + solid.w / 2, solid.y + solid.h / 2 + 18 * fall * fall * (solid.y < WORLD_HEIGHT / 2 ? -1 : 1))
      ctx.rotate(fall * 1.6)
      ctx.translate(-(solid.x + solid.w / 2), -(solid.y + solid.h / 2))
    } else if (elapsed >= 0) {
      ctx.translate(Math.sin(renderTick * 1.7) * 0.05, 0)
    }
    const palette = { ...this.theme.platform, body: shade(this.theme.platform.body, 0.35), material: 'stone' as const }
    this.block(ctx, solid.x, solid.y, solid.w, solid.h, palette)
    // Fissures.
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 0.05
    ctx.beginPath()
    for (let crack = 0; crack < Math.max(1, Math.floor(solid.w / 1.5)); crack += 1) {
      const cx = solid.x + (crack + 0.5) * (solid.w / Math.max(1, Math.floor(solid.w / 1.5)))
      ctx.moveTo(cx, solid.y)
      ctx.lineTo(cx + (noise(cx) - 0.5) * 0.5, solid.y + solid.h * 0.4)
      ctx.lineTo(cx + (noise(cx + 1) - 0.5) * 0.6, solid.y + solid.h)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** Plateforme mobile : métal sombre, runes allumées aux deux bouts. */
  private mover(ctx: CanvasRenderingContext2D, solid: Solid, x: number, y: number, time: number): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 0.05
    ctx.setLineDash([0.18, 0.22])
    ctx.strokeRect(Math.min(solid.x, solid.x + solid.dx), Math.min(solid.y, solid.y + solid.dy), solid.w + Math.abs(solid.dx), solid.h + Math.abs(solid.dy))
    ctx.setLineDash([])
    this.block(ctx, x, y, solid.w, solid.h, { ...this.theme.platform, body: '#2a2f45', top: '#7b86a8', material: 'stone' })
    const pulse = 0.6 + Math.sin(time * 4) * 0.3
    for (const rx of [x + 0.45, x + solid.w - 0.45]) {
      const glow = ctx.createRadialGradient(rx, y + solid.h / 2, 0, rx, y + solid.h / 2, 0.6)
      glow.addColorStop(0, this.theme.accent)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = pulse
      ctx.fillStyle = glow
      ctx.fillRect(rx - 0.6, y + solid.h / 2 - 0.6, 1.2, 1.2)
      ctx.globalAlpha = 1
      ctx.strokeStyle = this.theme.accent
      ctx.lineWidth = 0.05
      ctx.beginPath()
      ctx.arc(rx, y + solid.h / 2, 0.22, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  /** Rangée de pics d'acier. */
  private spikes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, dir: 'up' | 'down'): void {
    const count = Math.max(1, Math.round(w / 0.42))
    const step = w / count
    const tip = dir === 'up' ? -SPIKE_H : SPIKE_H
    const gradient = ctx.createLinearGradient(0, y, 0, y + tip)
    gradient.addColorStop(0, shade(this.theme.hazard, -0.55))
    gradient.addColorStop(1, this.theme.hazard)
    ctx.fillStyle = gradient
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.lineWidth = 0.055
    ctx.beginPath()
    for (let index = 0; index < count; index += 1) {
      const sx = x + index * step
      ctx.moveTo(sx, y)
      ctx.lineTo(sx + step / 2, y + tip)
      ctx.lineTo(sx + step, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  /** Shuriken géant (centre, rayon), qui tourne. */
  shuriken(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void {
    ctx.save()
    ctx.translate(x, y)
    // Halo de mouvement.
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2)
    ctx.fill()
    ctx.rotate(angle)
    const gradient = ctx.createLinearGradient(-r, -r, r, r)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.5, this.theme.hazard)
    gradient.addColorStop(1, shade(this.theme.hazard, -0.5))
    ctx.fillStyle = gradient
    ctx.beginPath()
    for (let blade = 0; blade < 4; blade += 1) {
      const a = (blade * Math.PI) / 2
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.3, Math.sin(a + Math.PI / 4) * r * 0.3)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 0.035
    ctx.stroke()
    ctx.fillStyle = '#1b1d2b'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** Sceau d'inversion : colonne de lumière, cercle de runes et flèches. */
  private seal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number): void {
    const accent = this.theme.accent
    const column = ctx.createLinearGradient(x, 0, x + w, 0)
    column.addColorStop(0, 'rgba(0,0,0,0)')
    column.addColorStop(0.5, accent)
    column.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.35 + Math.sin(time * 5) * 0.12
    ctx.fillStyle = column
    ctx.fillRect(x - 0.3, y, w + 0.6, h)
    ctx.globalAlpha = 1
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(time * 1.4)
    ctx.strokeStyle = accent
    ctx.lineWidth = 0.06
    ctx.beginPath()
    ctx.arc(0, 0, 0.62, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([0.12, 0.1])
    ctx.beginPath()
    ctx.arc(0, 0, 0.45, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.07
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy - 0.32)
    ctx.lineTo(cx, cy + 0.32)
    ctx.moveTo(cx - 0.14, cy - 0.18)
    ctx.lineTo(cx, cy - 0.32)
    ctx.lineTo(cx + 0.14, cy - 0.18)
    ctx.moveTo(cx - 0.14, cy + 0.18)
    ctx.lineTo(cx, cy + 0.32)
    ctx.lineTo(cx + 0.14, cy + 0.18)
    ctx.stroke()
  }

  /** Porte de taille : un anneau vertical ; flèches vers le centre pour rapetisser, vers l'extérieur pour grandir. */
  private gate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mini: boolean, time: number): void {
    const color = mini ? GATE_COLORS.mini : GATE_COLORS.full
    const cx = x + w / 2
    const cy = y + h / 2
    const column = ctx.createLinearGradient(x - 0.4, 0, x + w + 0.4, 0)
    column.addColorStop(0, 'rgba(0,0,0,0)')
    column.addColorStop(0.5, color)
    column.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.28 + Math.sin(time * 4) * 0.08
    ctx.fillStyle = column
    ctx.fillRect(x - 0.4, y, w + 0.8, h)
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 0.09
    ctx.beginPath()
    ctx.ellipse(cx, cy, w * 0.45 + 0.15, h / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([0.14, 0.12])
    ctx.lineDashOffset = -time * 0.8
    ctx.beginPath()
    ctx.ellipse(cx, cy, w * 0.3 + 0.08, h / 2 - 0.25, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.07
    ctx.lineCap = 'round'
    const pulse = Math.sin(time * 6) * 0.05
    for (const side of [-1, 1]) {
      const tip = cy + side * (mini ? 0.25 - pulse : 0.65 + pulse)
      const back = side * (mini ? 1 : -1) * 0.16
      ctx.beginPath()
      ctx.moveTo(cx - 0.16, tip + back)
      ctx.lineTo(cx, tip)
      ctx.lineTo(cx + 0.16, tip + back)
      ctx.stroke()
    }
  }

  /** Bûche de substitution (kawarimi) : un rondin, son bout clair et un sceau de papier. */
  log(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 1)
    glow.addColorStop(0, 'rgba(226,178,119,0.55)')
    glow.addColorStop(1, 'rgba(226,178,119,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - 1, y - 1, 2, 2)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.25 + Math.sin(time * 2) * 0.08)
    ctx.fillStyle = '#8a5a2b'
    ctx.fillRect(-0.4, -0.19, 0.78, 0.38)
    ctx.strokeStyle = '#5e3a1a'
    ctx.lineWidth = 0.04
    ctx.beginPath()
    ctx.moveTo(-0.36, -0.07)
    ctx.lineTo(0.3, -0.07)
    ctx.moveTo(-0.32, 0.08)
    ctx.lineTo(0.34, 0.08)
    ctx.stroke()
    ctx.fillStyle = '#d9a868'
    ctx.beginPath()
    ctx.ellipse(0.38, 0, 0.1, 0.19, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#8a5a2b'
    ctx.beginPath()
    ctx.ellipse(0.38, 0, 0.05, 0.1, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#f3e3bd'
    ctx.fillRect(-0.14, -0.24, 0.16, 0.48)
    ctx.fillStyle = '#d6263b'
    ctx.fillRect(-0.09, -0.07, 0.06, 0.14)
    ctx.restore()
  }

  /** Bonus de la lune : un croissant lumineux. */
  moon(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 1.1)
    glow.addColorStop(0, 'rgba(200,215,255,0.65)')
    glow.addColorStop(1, 'rgba(200,215,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - 1.1, y - 1.1, 2.2, 2.2)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.sin(time * 2) * 0.2)
    ctx.fillStyle = '#f2f4ff'
    ctx.beginPath()
    ctx.arc(0, 0, PICKUP_R * 0.75, Math.PI * 0.35, Math.PI * 1.65)
    ctx.arc(PICKUP_R * 0.32, 0, PICKUP_R * 0.62, Math.PI * 1.5, Math.PI * 0.5, true)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** Rouleau à collectionner : papier, ruban rouge, éclat doré. */
  scroll(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 1)
    glow.addColorStop(0, 'rgba(255,214,107,0.6)')
    glow.addColorStop(1, 'rgba(255,214,107,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - 1, y - 1, 2, 2)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.35 + Math.sin(time * 2) * 0.1)
    ctx.fillStyle = '#f3e3bd'
    ctx.fillRect(-0.36, -0.16, 0.72, 0.32)
    ctx.fillStyle = '#8a5a2b'
    ctx.fillRect(-0.42, -0.2, 0.09, 0.4)
    ctx.fillRect(0.33, -0.2, 0.09, 0.4)
    ctx.fillStyle = '#d6263b'
    ctx.fillRect(-0.04, -0.17, 0.08, 0.34)
    ctx.restore()
  }

  /** L'arrivée : un grand torii sur toute la hauteur du couloir. */
  private finish(ctx: CanvasRenderingContext2D, world: GravityWorld, view: View): void {
    const x = world.length
    if (x < view.left - 6 || x > view.right + 6) return
    const glow = ctx.createLinearGradient(x - 3, 0, x + 6, 0)
    glow.addColorStop(0, 'rgba(255,240,200,0)')
    glow.addColorStop(0.5, 'rgba(255,240,200,0.25)')
    glow.addColorStop(1, 'rgba(255,240,200,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - 3, -2, 9, WORLD_HEIGHT + 4)
    ctx.fillStyle = '#d6263b'
    ctx.fillRect(x - 0.1, -2, 0.55, WORLD_HEIGHT + 4)
    ctx.fillRect(x + 3.2, -2, 0.55, WORLD_HEIGHT + 4)
    ctx.fillStyle = '#1b1020'
    ctx.fillRect(x - 1.1, 1.4, 6, 0.55)
    ctx.fillStyle = '#d6263b'
    ctx.fillRect(x - 0.6, 2.4, 5, 0.4)
    ctx.fillRect(x - 0.6, WORLD_HEIGHT - 2.8, 5, 0.4)
    ctx.fillStyle = '#1b1020'
    ctx.fillRect(x - 1.1, WORLD_HEIGHT - 1.95, 6, 0.55)
  }
}
