import type { GravityTheme } from '../../../lib/gravity/themes'

/*
 * Le décor de Gravity Ninja, en plans qui défilent à des vitesses différentes (parallaxe) : ciel,
 * astre, étoiles, montagnes lointaines, collines et silhouettes du thème (pagodes, bambous, tours,
 * citrouilles, sapins), brume, puis particules (sakura, lucioles, feuilles, braises, neige). Tout
 * est dessiné en coordonnées d'écran (pixels CSS), à partir de la position de la caméra.
 */

export interface Screen {
  width: number
  height: number
  /** Pixels par unité du monde. */
  unit: number
  /** Position de la caméra (unités). */
  cameraX: number
  time: number
}

/** Hasard déterministe d'un entier (silhouettes toujours à la même place). */
const hash = (value: number) => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Relief : une somme de sinus, lisse et sans répétition visible. */
const ridge = (u: number, seed: number) =>
  Math.sin(u * 0.11 + seed) * 0.5 + Math.sin(u * 0.27 + seed * 2.1) * 0.28 + Math.sin(u * 0.63 + seed * 3.7) * 0.12 + Math.sin(u * 1.4 + seed) * 0.05

interface Particle {
  x: number
  y: number
  depth: number
  spin: number
  size: number
  phase: number
}

export class Backdrop {
  private particles: Particle[] = []
  private stars: { x: number; y: number; size: number; phase: number }[] = []
  private lastCamera: number | null = null

  readonly theme: GravityTheme

  constructor(theme: GravityTheme) {
    this.theme = theme
    const count = theme.particles.kind === 'snow' ? 70 : theme.particles.kind === 'fireflies' ? 28 : 40
    for (let index = 0; index < count; index += 1) {
      this.particles.push({ x: hash(index * 3.1), y: hash(index * 7.7), depth: 0.3 + hash(index * 1.3) * 0.9, spin: hash(index * 5.3) * Math.PI * 2, size: 0.6 + hash(index * 2.9) * 0.8, phase: hash(index * 9.1) * 10 })
    }
    if (theme.orb.kind === 'moon') {
      for (let index = 0; index < 90; index += 1) this.stars.push({ x: hash(index * 11.3), y: hash(index * 17.9) * 0.62, size: 0.5 + hash(index * 4.1) * 1.3, phase: hash(index * 6.7) * 6 })
    }
  }

  draw(ctx: CanvasRenderingContext2D, screen: Screen): void {
    const { width, height, unit, cameraX, time } = screen
    const theme = this.theme

    // Ciel.
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, theme.sky[0])
    sky.addColorStop(0.55, theme.sky[1])
    sky.addColorStop(1, theme.sky[2])
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    // Étoiles (nuits).
    for (const star of this.stars) {
      const alpha = 0.35 + Math.sin(time * 1.6 + star.phase) * 0.3
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`
      const x = (((star.x * width - cameraX * unit * 0.01) % width) + width) % width
      ctx.fillRect(x, star.y * height, star.size, star.size)
    }

    // L'astre et son halo.
    const orb = theme.orb
    const radius = Math.min(width, height) * orb.size
    const ox = orb.x * width - ((cameraX * unit * 0.015) % (width * 0.2))
    const oy = orb.y * height
    const glow = ctx.createRadialGradient(ox, oy, radius * 0.4, ox, oy, radius * 3.2)
    glow.addColorStop(0, orb.glow)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(ox - radius * 3.2, oy - radius * 3.2, radius * 6.4, radius * 6.4)
    ctx.fillStyle = orb.color
    ctx.beginPath()
    ctx.arc(ox, oy, radius, 0, Math.PI * 2)
    ctx.fill()
    if (orb.kind === 'moon') {
      // Cratères.
      ctx.fillStyle = 'rgba(0,0,0,0.08)'
      for (const [dx, dy, r] of [
        [-0.3, -0.2, 0.22],
        [0.25, 0.1, 0.16],
        [-0.05, 0.38, 0.12],
        [0.35, -0.35, 0.08],
      ] as const) {
        ctx.beginPath()
        ctx.arc(ox + dx * radius, oy + dy * radius, r * radius, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      // Bandes de nuages devant le soleil couchant.
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      for (let band = 0; band < 3; band += 1) ctx.fillRect(ox - radius * 1.4, oy + radius * (0.2 + band * 0.28), radius * (2.8 - band * 0.5), radius * 0.07)
    }

    this.mountains(ctx, screen, 0.08, theme.far, height * 0.58, height * 0.17, 1.3)
    this.mountains(ctx, screen, 0.18, theme.mid, height * 0.74, height * 0.12, 4.2)
    this.silhouettes(ctx, screen, 0.3)

    // Brume au pied du décor.
    const fog = ctx.createLinearGradient(0, height * 0.55, 0, height)
    fog.addColorStop(0, 'rgba(0,0,0,0)')
    fog.addColorStop(1, theme.fog)
    ctx.fillStyle = fog
    ctx.fillRect(0, height * 0.55, width, height * 0.45)

    this.drift(ctx, screen)
  }

  private mountains(ctx: CanvasRenderingContext2D, screen: Screen, parallax: number, color: string, base: number, amplitude: number, seed: number): void {
    const { width, height, unit, cameraX } = screen
    const step = 8
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let x = 0; x <= width + step; x += step) {
      const u = x / unit + cameraX * parallax
      ctx.lineTo(x, base - (ridge(u, seed) + 0.5) * amplitude)
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fill()
  }

  /** Silhouettes du thème, posées à intervalles réguliers dans leur plan. */
  private silhouettes(ctx: CanvasRenderingContext2D, screen: Screen, parallax: number): void {
    const { width, height, unit, cameraX, time } = screen
    const theme = this.theme
    const spacing = theme.silhouette === 'bamboo' ? 2.2 : theme.silhouette === 'pines' ? 4 : 9
    const offset = cameraX * parallax
    const first = Math.floor(offset / spacing) - 1
    const last = Math.ceil((offset + width / unit) / spacing) + 1
    const ground = height * 0.86
    ctx.fillStyle = theme.near
    ctx.fillRect(0, ground, width, height - ground)
    for (let index = first; index <= last; index += 1) {
      const seed = hash(index)
      if (theme.silhouette !== 'bamboo' && seed < 0.25) continue
      const x = (index * spacing + seed * spacing * 0.6 - offset) * unit
      const scale = (0.75 + hash(index + 0.5) * 0.6) * unit
      switch (theme.silhouette) {
        case 'pagoda':
          drawPagoda(ctx, x, ground, scale, theme.near, theme.accent, seed)
          break
        case 'bamboo':
          drawBamboo(ctx, x, ground, scale, theme.near, time, seed)
          break
        case 'towers':
          drawTower(ctx, x, ground, scale, theme.near, seed)
          break
        case 'pumpkins':
          drawSpooky(ctx, x, ground, scale, theme.near, theme.accent, time, seed)
          break
        case 'pines':
          drawPine(ctx, x, ground, scale, theme.near, theme.accent, time, seed)
          break
      }
    }
  }

  /** Particules : elles défilent avec la caméra selon leur profondeur. */
  private drift(ctx: CanvasRenderingContext2D, screen: Screen): void {
    const { width, height, unit, cameraX, time } = screen
    const moved = this.lastCamera === null ? 0 : cameraX - this.lastCamera
    this.lastCamera = cameraX
    const { kind, color } = this.theme.particles
    for (const particle of this.particles) {
      particle.x -= (moved * unit * particle.depth) / width
      const fall = kind === 'embers' ? -0.0012 : kind === 'fireflies' ? Math.sin(time + particle.phase) * 0.0004 : 0.0011 * particle.depth
      particle.y += fall
      particle.x += kind === 'snow' ? Math.sin(time + particle.phase) * 0.0004 : -0.0006 * particle.depth
      if (particle.x < -0.05) particle.x += 1.1
      if (particle.y > 1.05) particle.y -= 1.1
      if (particle.y < -0.05) particle.y += 1.1
      const x = particle.x * width
      const y = particle.y * height
      const size = particle.size * (2 + particle.depth * 2.5)
      ctx.save()
      ctx.translate(x, y)
      switch (kind) {
        case 'sakura':
        case 'leaves':
          ctx.rotate(particle.spin + time * (0.8 + particle.depth))
          ctx.fillStyle = color
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.ellipse(0, 0, size, size * (kind === 'sakura' ? 0.55 : 0.4), 0, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'snow':
          ctx.fillStyle = color
          ctx.globalAlpha = 0.5 + particle.depth * 0.4
          ctx.beginPath()
          ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'embers':
        case 'fireflies': {
          const blink = kind === 'fireflies' ? Math.max(0, Math.sin(time * 2 + particle.phase)) : 0.6 + Math.sin(time * 5 + particle.phase) * 0.4
          const light = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.2)
          light.addColorStop(0, color)
          light.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.globalAlpha = blink
          ctx.fillStyle = light
          ctx.fillRect(-size * 2.2, -size * 2.2, size * 4.4, size * 4.4)
          break
        }
      }
      ctx.restore()
    }
  }
}

/* ---- Silhouettes ------------------------------------------------------------------------------ */

function drawPagoda(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, color: string, lantern: string, seed: number): void {
  const tiers = 2 + Math.floor(seed * 3)
  ctx.fillStyle = color
  let y = ground
  let half = 1.6 * s
  for (let tier = 0; tier < tiers; tier += 1) {
    const height = 1.1 * s
    ctx.fillRect(x - half * 0.62, y - height, half * 1.24, height)
    // Toit recourbé.
    ctx.beginPath()
    ctx.moveTo(x - half * 1.15, y - height + 0.1 * s)
    ctx.quadraticCurveTo(x - half * 0.7, y - height - 0.05 * s, x - half * 0.55, y - height - 0.45 * s)
    ctx.lineTo(x + half * 0.55, y - height - 0.45 * s)
    ctx.quadraticCurveTo(x + half * 0.7, y - height - 0.05 * s, x + half * 1.15, y - height + 0.1 * s)
    ctx.closePath()
    ctx.fill()
    // Fenêtres éclairées.
    ctx.fillStyle = lantern
    ctx.globalAlpha = 0.55
    ctx.fillRect(x - 0.12 * s, y - height * 0.7, 0.24 * s, 0.32 * s)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    y -= height + 0.45 * s
    half *= 0.78
  }
  ctx.fillRect(x - 0.04 * s, y - 0.9 * s, 0.08 * s, 0.9 * s)
}

function drawBamboo(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, color: string, time: number, seed: number): void {
  const height = (5 + seed * 6) * s
  const sway = Math.sin(time * 0.8 + seed * 10) * 0.25 * s
  ctx.strokeStyle = color
  ctx.lineWidth = 0.16 * s
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, ground)
  ctx.quadraticCurveTo(x, ground - height * 0.6, x + sway, ground - height)
  ctx.stroke()
  // Nœuds et feuilles.
  ctx.fillStyle = color
  for (let node = 1; node < 6; node += 1) {
    const t = node / 6
    const nx = x + sway * t * t
    const ny = ground - height * t
    ctx.fillRect(nx - 0.12 * s, ny, 0.24 * s, 0.05 * s)
    if (node % 2 === 0) {
      ctx.beginPath()
      ctx.ellipse(nx + 0.5 * s, ny - 0.1 * s, 0.6 * s, 0.1 * s, -0.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, color: string, seed: number): void {
  ctx.fillStyle = color
  if (seed > 0.7) {
    // La grande tour : un fût élancé, une couronne au sommet.
    const height = 9.5 * s
    ctx.beginPath()
    ctx.moveTo(x - 0.9 * s, ground)
    ctx.lineTo(x - 0.45 * s, ground - height)
    ctx.lineTo(x + 0.45 * s, ground - height)
    ctx.lineTo(x + 0.9 * s, ground)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(x - 0.8 * s, ground - height - 0.6 * s, 1.6 * s, 0.6 * s)
    ctx.fillRect(x - 0.08 * s, ground - height - 1.6 * s, 0.16 * s, 1 * s)
  } else {
    // Arbres géants de la forêt.
    const height = (3 + seed * 3) * s
    ctx.fillRect(x - 0.18 * s, ground - height, 0.36 * s, height)
    for (const [dx, dy, r] of [
      [0, -1, 1.3],
      [-0.9, -0.5, 0.95],
      [0.9, -0.6, 1],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x + dx * s, ground - height + dy * s, r * s, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawSpooky(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, color: string, glow: string, time: number, seed: number): void {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  if (seed > 0.55) {
    // Arbre mort aux branches crochues.
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.3 * s
    const height = (3 + seed * 2) * s
    ctx.beginPath()
    ctx.moveTo(x, ground)
    ctx.lineTo(x + 0.2 * s, ground - height)
    ctx.stroke()
    ctx.lineWidth = 0.12 * s
    for (const [fy, dx, dy] of [
      [0.55, -1.2, -0.8],
      [0.75, 1.1, -0.9],
      [0.9, -0.7, -0.7],
    ] as const) {
      ctx.beginPath()
      ctx.moveTo(x + 0.15 * s, ground - height * fy)
      ctx.quadraticCurveTo(x + dx * 0.5 * s, ground - height * fy + dy * 0.2 * s, x + dx * s, ground - height * fy + dy * s)
      ctx.stroke()
    }
  } else {
    // Citrouille au visage allumé, près d'une tombe.
    ctx.fillRect(x + 1 * s, ground - 1.1 * s, 0.7 * s, 1.1 * s)
    ctx.beginPath()
    ctx.arc(x + 1.35 * s, ground - 1.1 * s, 0.35 * s, Math.PI, 0)
    ctx.fill()
    const pumpkin = 0.55 * s
    ctx.fillStyle = '#e8741c'
    ctx.beginPath()
    ctx.ellipse(x, ground - pumpkin * 0.8, pumpkin * 1.2, pumpkin * 0.85, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = glow
    ctx.globalAlpha = 0.6 + Math.sin(time * 6 + seed * 20) * 0.3
    ctx.beginPath()
    ctx.moveTo(x - pumpkin * 0.5, ground - pumpkin)
    ctx.lineTo(x - pumpkin * 0.25, ground - pumpkin * 1.25)
    ctx.lineTo(x - pumpkin * 0.05, ground - pumpkin)
    ctx.moveTo(x + pumpkin * 0.05, ground - pumpkin)
    ctx.lineTo(x + pumpkin * 0.25, ground - pumpkin * 1.25)
    ctx.lineTo(x + pumpkin * 0.5, ground - pumpkin)
    ctx.fill()
    ctx.fillRect(x - pumpkin * 0.45, ground - pumpkin * 0.6, pumpkin * 0.9, pumpkin * 0.16)
    ctx.globalAlpha = 1
  }
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, color: string, lights: string, time: number, seed: number): void {
  const height = (2.6 + seed * 2.2) * s
  ctx.fillStyle = color
  for (let layer = 0; layer < 3; layer += 1) {
    const top = ground - height + layer * height * 0.25
    const half = (0.7 + layer * 0.45) * s
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x + half, top + height * 0.42)
    ctx.lineTo(x - half, top + height * 0.42)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillRect(x - 0.12 * s, ground - 0.4 * s, 0.24 * s, 0.4 * s)
  // Neige sur les branches et guirlande lumineuse.
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.moveTo(x, ground - height)
  ctx.lineTo(x + 0.3 * s, ground - height + 0.35 * s)
  ctx.lineTo(x - 0.3 * s, ground - height + 0.35 * s)
  ctx.closePath()
  ctx.fill()
  for (let bulb = 0; bulb < 5; bulb += 1) {
    const t = (bulb + 1) / 6
    const bx = x + Math.sin(bulb * 2.4) * (0.4 + t * 0.9) * s
    const by = ground - height + t * height * 0.85
    ctx.fillStyle = bulb % 2 ? lights : '#ffd56b'
    ctx.globalAlpha = 0.55 + Math.sin(time * 3 + bulb + seed * 9) * 0.45
    ctx.beginPath()
    ctx.arc(bx, by, 0.08 * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
