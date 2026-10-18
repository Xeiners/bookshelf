/*
 * Page Stack : les univers du jeu. Tous les 10 tomes, on change de monde — un crépuscule sur
 * un village, l'aube sur le Mont Fuji, un temple au-dessus d'une mer de nuages, une fête de
 * lanternes, la voie lactée de Tanabata, la lune et le cosmos — puis ça recommence. Tout est
 * dessiné en vectoriel (Canvas 2D), sans image, et sans état : chaque élément animé est une
 * fonction du temps, ce qui permet de fondre deux mondes l'un dans l'autre à la transition.
 * Les nuages sont des sprites de bouffées à dégradé radial (pas de blocs), préparés une fois.
 */

type Rgb = [number, number, number]

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]
const rgba = (color: Rgb, alpha = 1): string => `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha})`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Tomes posés par monde. */
export const PAGES_PER_WORLD = 10
export const WORLD_COUNT = 6
/** Part finale du monde pendant laquelle on fond vers le suivant. */
const BLEND_START = 0.7

export interface WorldView {
  width: number
  height: number
  stage: number
}

/** Monde courant, monde suivant, et part de fondu vers lui (0 → 1). */
export function worldAt(pages: number): { index: number; local: number; next: number; blend: number } {
  const index = Math.floor(pages / PAGES_PER_WORLD)
  const local = pages - index * PAGES_PER_WORLD
  const t = Math.min(1, Math.max(0, (local / PAGES_PER_WORLD - BLEND_START) / (1 - BLEND_START)))
  return { index: index % WORLD_COUNT, local, next: (index + 1) % WORLD_COUNT, blend: t * t * (3 - 2 * t) }
}

/** Numéro du monde (sans modulo) pour une page : l'annonce « Monde 3 » à chaque changement. */
export const worldNumber = (pages: number): number => Math.floor(pages / PAGES_PER_WORLD)
export const worldIndexOf = (pages: number): number => worldNumber(pages) % WORLD_COUNT

/* ---- Hasard déterministe -------------------------------------------------------------- */

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---- Nuages lisses ---------------------------------------------------------------------- */

const cloudCache = new Map<string, HTMLCanvasElement[]>()

/** Un nuage : des dizaines de bouffées à dégradé radial qui se fondent, bord inférieur effacé en douceur. */
function buildCloud(color: Rgb, seed: number): HTMLCanvasElement {
  const width = 360
  const height = 150
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const random = rng(seed)
  for (let index = 0; index < 26; index += 1) {
    const t = random()
    // Plus de bouffées au centre, et plus hautes : une masse bombée, pas une ligne.
    const x = width * (0.14 + 0.72 * t)
    const bulge = Math.sin(t * Math.PI)
    const radius = height * (0.16 + 0.22 * random()) * (0.6 + 0.6 * bulge)
    const y = height * 0.62 - bulge * height * 0.18 * random() - random() * height * 0.06
    const puff = ctx.createRadialGradient(x, y, 0, x, y, radius)
    puff.addColorStop(0, rgba(color, 0.42))
    puff.addColorStop(0.55, rgba(color, 0.18))
    puff.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = puff
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  // Le dessous s'estompe : un nuage plat en bas, vaporeux en haut.
  ctx.globalCompositeOperation = 'destination-out'
  const fade = ctx.createLinearGradient(0, height * 0.55, 0, height)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,0.95)')
  ctx.fillStyle = fade
  ctx.fillRect(0, height * 0.55, width, height * 0.45)
  return canvas
}

function cloudSprites(color: Rgb): HTMLCanvasElement[] {
  const key = color.map((channel) => Math.round(channel / 12)).join(',')
  let sprites = cloudCache.get(key)
  if (!sprites) {
    sprites = [1, 2, 3, 4].map((seed) => buildCloud(color, seed * 97))
    cloudCache.set(key, sprites)
  }
  return sprites
}

/** Une rangée de nuages qui dérive, plus ou moins haute, grosse et rapide selon la profondeur. */
function clouds(ctx: CanvasRenderingContext2D, view: WorldView, color: Rgb, options: { count: number; y: number; size: number; speed: number; alpha: number; time: number; seed: number }): void {
  const sprites = cloudSprites(color)
  const random = rng(options.seed)
  ctx.save()
  ctx.globalAlpha *= options.alpha
  for (let index = 0; index < options.count; index += 1) {
    const sprite = sprites[index % sprites.length]!
    const scale = (options.size * view.stage) / 360 * (0.7 + random() * 0.7)
    const span = view.width + sprite.width * scale
    const x = ((((random() * span + options.time * options.speed * view.stage) % span) + span) % span) - sprite.width * scale
    const y = options.y + (random() - 0.5) * view.height * 0.12
    ctx.drawImage(sprite, x, y, sprite.width * scale, sprite.height * scale)
  }
  ctx.restore()
}

/** Brume en bandes : un voile horizontal qui s'épaissit au milieu, comme entre deux plans d'une estampe. */
function mist(ctx: CanvasRenderingContext2D, view: WorldView, y: number, thickness: number, color: Rgb, alpha: number): void {
  const gradient = ctx.createLinearGradient(0, y - thickness, 0, y + thickness)
  gradient.addColorStop(0, rgba(color, 0))
  gradient.addColorStop(0.5, rgba(color, alpha))
  gradient.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = gradient
  ctx.fillRect(0, y - thickness, view.width, thickness * 2)
}

/* ---- Silhouettes ------------------------------------------------------------------------ */

const ridgeCache = new Map<number, number[]>()
function ridgeOf(seed: number, points: number): number[] {
  const key = seed * 100 + points
  let values = ridgeCache.get(key)
  if (!values) {
    const random = rng(seed)
    let value = 0.5
    values = Array.from({ length: points + 1 }, () => (value = Math.min(1, Math.max(0, value + (random() - 0.5) * 0.8))))
    ridgeCache.set(key, values)
  }
  return values
}

/** Une crête de collines aux courbes douces (jamais en dents de scie). */
function ridge(ctx: CanvasRenderingContext2D, view: WorldView, seed: number, color: Rgb, base: number, amplitude: number): void {
  const values = ridgeOf(seed, 9)
  ctx.fillStyle = rgba(color)
  ctx.beginPath()
  ctx.moveTo(0, view.height + 4)
  ctx.lineTo(0, base - values[0]! * amplitude)
  for (let index = 1; index < values.length; index += 1) {
    const x0 = ((index - 1) / (values.length - 1)) * view.width
    const x1 = (index / (values.length - 1)) * view.width
    const y0 = base - values[index - 1]! * amplitude
    const y1 = base - values[index]! * amplitude
    ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1)
  }
  ctx.lineTo(view.width, view.height + 4)
  ctx.closePath()
  ctx.fill()
}

/** Le Mont Fuji : flancs concaves, sommet tronqué, calotte de neige à bord déchiqueté. */
function fuji(ctx: CanvasRenderingContext2D, cx: number, base: number, width: number, height: number, color: Rgb, snow: Rgb | null): void {
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(cx - width / 2, base + 2)
    ctx.bezierCurveTo(cx - width * 0.3, base - height * 0.05, cx - width * 0.13, base - height * 0.78, cx - width * 0.055, base - height)
    ctx.lineTo(cx + width * 0.055, base - height)
    ctx.bezierCurveTo(cx + width * 0.13, base - height * 0.78, cx + width * 0.3, base - height * 0.05, cx + width / 2, base + 2)
    ctx.closePath()
  }
  ctx.fillStyle = rgba(color)
  path()
  ctx.fill()
  if (!snow) return
  ctx.save()
  path()
  ctx.clip()
  ctx.fillStyle = rgba(snow, 0.95)
  ctx.beginPath()
  ctx.moveTo(cx - width, base - height * 1.05)
  ctx.lineTo(cx + width, base - height * 1.05)
  const teeth = 9
  for (let index = 0; index <= teeth; index += 1) {
    const x = cx + width * 0.3 - (index / teeth) * width * 0.6
    ctx.lineTo(x, base - height * (index % 2 === 0 ? 0.7 : 0.78) - Math.sin(index * 1.7) * height * 0.025)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Une pagode à cinq étages, aux toits relevés aux coins. */
function pagoda(ctx: CanvasRenderingContext2D, x: number, base: number, size: number, color: Rgb, lit = false): void {
  ctx.fillStyle = rgba(color)
  let y = base
  for (let tier = 0; tier < 5; tier += 1) {
    const body = size * (0.62 - tier * 0.08)
    const bodyHeight = size * 0.16
    const roof = body * 1.55
    const roofHeight = size * 0.085
    ctx.fillRect(x - body / 2, y - bodyHeight, body, bodyHeight)
    const roofBase = y - bodyHeight
    ctx.beginPath()
    ctx.moveTo(x - roof / 2, roofBase - roofHeight * 0.45)
    ctx.quadraticCurveTo(x - roof * 0.3, roofBase + roofHeight * 0.1, x - body / 2, roofBase)
    ctx.lineTo(x + body / 2, roofBase)
    ctx.quadraticCurveTo(x + roof * 0.3, roofBase + roofHeight * 0.1, x + roof / 2, roofBase - roofHeight * 0.45)
    ctx.quadraticCurveTo(x + roof * 0.26, roofBase - roofHeight * 0.75, x + body * 0.2, roofBase - roofHeight)
    ctx.lineTo(x - body * 0.2, roofBase - roofHeight)
    ctx.quadraticCurveTo(x - roof * 0.26, roofBase - roofHeight * 0.75, x - roof / 2, roofBase - roofHeight * 0.45)
    ctx.closePath()
    ctx.fill()
    if (lit) {
      ctx.fillStyle = 'rgba(255,200,110,0.85)'
      ctx.fillRect(x - body * 0.12, y - bodyHeight * 0.75, body * 0.24, bodyHeight * 0.5)
      ctx.fillStyle = rgba(color)
    }
    y = roofBase - roofHeight * 0.85
  }
  ctx.fillRect(x - size * 0.012, y - size * 0.22, size * 0.024, size * 0.22)
  for (let ring = 0; ring < 4; ring += 1) ctx.fillRect(x - size * 0.04, y - size * (0.06 + ring * 0.04), size * 0.08, size * 0.012)
}

/** Un torii vermillon. */
function torii(ctx: CanvasRenderingContext2D, x: number, base: number, size: number, color: Rgb): void {
  ctx.fillStyle = rgba(color)
  const top = base - size
  const pillar = size * 0.075
  ctx.fillRect(x - size * 0.4 - pillar / 2, top + size * 0.1, pillar, size * 0.9)
  ctx.fillRect(x + size * 0.4 - pillar / 2, top + size * 0.1, pillar, size * 0.9)
  ctx.fillRect(x - size * 0.5, top + size * 0.24, size, size * 0.05)
  ctx.beginPath()
  ctx.moveTo(x - size * 0.66, top - size * 0.02)
  ctx.quadraticCurveTo(x, top + size * 0.1, x + size * 0.66, top - size * 0.02)
  ctx.lineTo(x + size * 0.6, top + size * 0.1)
  ctx.quadraticCurveTo(x, top + size * 0.2, x - size * 0.6, top + size * 0.1)
  ctx.closePath()
  ctx.fill()
}

/** Un pin taillé en nuages (niwaki) : un tronc tordu, des touffes plates étagées. */
function pine(ctx: CanvasRenderingContext2D, x: number, base: number, size: number, color: Rgb, lean = 0): void {
  ctx.strokeStyle = rgba(color)
  ctx.lineCap = 'round'
  ctx.lineWidth = size * 0.07
  ctx.beginPath()
  ctx.moveTo(x, base)
  ctx.bezierCurveTo(x + size * 0.08 + lean, base - size * 0.3, x - size * 0.1 + lean, base - size * 0.6, x + lean, base - size * 0.95)
  ctx.stroke()
  ctx.fillStyle = rgba(color)
  const clumps: [number, number, number][] = [[0.28, 0.86, 0.1], [-0.3, 0.62, 0.095], [0.34, 0.4, 0.085], [0, 1, 0.1]]
  for (const [dx, dy, ry] of clumps) {
    ctx.beginPath()
    ctx.ellipse(x + dx * size + lean * dy, base - dy * size, size * 0.3, size * ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Un bambou qui ploie, avec ses nœuds et quelques feuilles. */
function bamboo(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, color: Rgb, time: number, phase: number): void {
  const sway = Math.sin(time * 0.8 + phase) * height * 0.025
  ctx.strokeStyle = rgba(color)
  ctx.lineWidth = Math.max(2, height * 0.03)
  ctx.lineCap = 'butt'
  const segments = 7
  let px = x
  let py = base
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments
    const nx = x + sway * t * t
    const ny = base - height * t
    ctx.beginPath()
    ctx.moveTo(px, py + (index > 1 ? 2 : 0))
    ctx.lineTo(nx, ny)
    ctx.stroke()
    ctx.fillStyle = rgba(color)
    ctx.fillRect(nx - ctx.lineWidth * 0.8, ny - 1, ctx.lineWidth * 1.6, 2.5)
    if (index >= 3 && index % 2 === 1) {
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(nx + dir * height * 0.07, ny + height * 0.012, height * 0.07, height * 0.012, dir * -0.35, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    px = nx
    py = ny
  }
}

/** Une branche de cerisier en fleurs. */
function sakuraBranch(ctx: CanvasRenderingContext2D, view: WorldView, side: 1 | -1, time: number): void {
  const x0 = side === 1 ? view.width + 10 : -10
  const y0 = view.height * 0.1
  const reach = view.stage * 0.62
  ctx.strokeStyle = 'rgba(48,22,40,0.92)'
  ctx.lineCap = 'round'
  ctx.lineWidth = view.stage * 0.03
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.bezierCurveTo(x0 - side * reach * 0.4, y0 - 8, x0 - side * reach * 0.7, y0 + view.stage * 0.12, x0 - side * reach, y0 + view.stage * 0.08)
  ctx.stroke()
  ctx.lineWidth = view.stage * 0.012
  ctx.beginPath()
  ctx.moveTo(x0 - side * reach * 0.55, y0 + view.stage * 0.04)
  ctx.quadraticCurveTo(x0 - side * reach * 0.7, y0 - view.stage * 0.1, x0 - side * reach * 0.85, y0 - view.stage * 0.14)
  ctx.stroke()
  const random = rng(side === 1 ? 7 : 8)
  for (let index = 0; index < 34; index += 1) {
    const t = random()
    const x = x0 - side * reach * (0.1 + t * 0.9) + (random() - 0.5) * view.stage * 0.1
    const y = y0 + view.stage * (0.02 + Math.sin(t * 2.4) * 0.1) + (random() - 0.5) * view.stage * 0.16 - (t > 0.5 ? view.stage * 0.05 : 0)
    const r = view.stage * (0.012 + random() * 0.016) * (1 + Math.sin(time + index) * 0.04)
    const shade = 215 + Math.floor(random() * 30)
    ctx.fillStyle = `rgba(255,${shade - 30},${shade},0.9)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Une grue qui plane, ailes battantes. */
function crane(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, phase: number, color: string): void {
  const flap = Math.sin(time * 2.6 + phase) * 0.5
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = size * 0.07
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.ellipse(x, y, size * 0.32, size * 0.07, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + size * 0.28, y - size * 0.02)
  ctx.quadraticCurveTo(x + size * 0.5, y - size * 0.1, x + size * 0.55, y - size * 0.2)
  ctx.moveTo(x - size * 0.3, y)
  ctx.lineTo(x - size * 0.62, y + size * 0.06)
  ctx.stroke()
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + dir * size * 0.25, y - size * (0.35 + flap * 0.4), x + dir * size * 0.75, y - size * (0.05 + flap * 0.55))
    ctx.quadraticCurveTo(x + dir * size * 0.3, y - size * (0.08 + flap * 0.1), x, y + size * 0.02)
    ctx.fill()
  }
}

/** Une lanterne en papier, lumineuse. */
function lantern(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: Rgb, glow = 1): void {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 2.6)
  halo.addColorStop(0, rgba(color, 0.5 * glow))
  halo.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = halo
  ctx.fillRect(x - size * 2.6, y - size * 2.6, size * 5.2, size * 5.2)
  ctx.fillStyle = rgba(mix(color, [255, 255, 255], 0.2), 0.95)
  ctx.beginPath()
  ctx.ellipse(x, y, size * 0.7, size, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(80,20,10,0.55)'
  ctx.lineWidth = Math.max(1, size * 0.07)
  for (const f of [-0.35, 0, 0.35]) {
    ctx.beginPath()
    ctx.ellipse(x, y, size * 0.7 * Math.abs(1 - Math.abs(f) * 0.7), size, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(60,20,10,0.8)'
  ctx.fillRect(x - size * 0.3, y - size * 1.05, size * 0.6, size * 0.14)
  ctx.fillRect(x - size * 0.3, y + size * 0.93, size * 0.6, size * 0.14)
}

/** Un feu d'artifice (hanabi) : une gerbe qui s'ouvre, retombe et s'éteint ; un nouveau toutes les `period` secondes. */
function firework(ctx: CanvasRenderingContext2D, view: WorldView, time: number, slot: number, period: number): void {
  const phase = slot * 1.37
  const cycle = Math.floor((time + phase) / period)
  const age = (time + phase) - cycle * period
  const duration = 2.2
  if (age > duration) return
  const random = rng(cycle * 31 + slot * 7)
  const cx = view.width * (0.15 + random() * 0.7)
  const cy = view.height * (0.12 + random() * 0.3)
  const hue = Math.floor(random() * 360)
  const spokes = 28
  const t = age / duration
  const radius = view.stage * (0.1 + random() * 0.1) * (1 - Math.pow(1 - Math.min(1, t * 1.6), 3))
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI * 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius + t * t * view.stage * 0.18
    ctx.fillStyle = `hsla(${(hue + (index % 3) * 24) % 360},95%,68%,${Math.max(0, 1 - t) * 0.95})`
    ctx.beginPath()
    ctx.arc(x, y, view.stage * 0.007 * (1 - t * 0.5) + 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.8 + 4)
  flash.addColorStop(0, `hsla(${hue},90%,80%,${Math.max(0, 0.35 - t)})`)
  flash.addColorStop(1, `hsla(${hue},90%,80%,0)`)
  ctx.fillStyle = flash
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
}

/* ---- Particules sans état --------------------------------------------------------------- */

/** Pétales ou feuilles qui dérivent en diagonale, en se balançant. */
function drifters(ctx: CanvasRenderingContext2D, view: WorldView, time: number, count: number, color: string, options: { speed: number; size: number; leaf?: boolean }): void {
  const random = rng(count * 13 + (options.leaf ? 5 : 0))
  ctx.fillStyle = color
  for (let index = 0; index < count; index += 1) {
    const vx = (0.012 + random() * 0.02) * options.speed
    const vy = (0.03 + random() * 0.04) * options.speed
    const x = ((((random() + time * vx + Math.sin(time * 0.8 + index) * 0.02) % 1.1) + 1.1) % 1.1) - 0.05
    const y = (((random() + time * vy) % 1.1) + 1.1) % 1.1 - 0.05
    const size = (options.size * (0.6 + random() * 0.8))
    ctx.save()
    ctx.translate(x * view.width, y * view.height)
    ctx.rotate(time * (1 + random() * 2) + index)
    ctx.beginPath()
    if (options.leaf) {
      ctx.moveTo(0, -size)
      ctx.quadraticCurveTo(size * 0.9, 0, 0, size)
      ctx.quadraticCurveTo(-size * 0.9, 0, 0, -size)
    } else ctx.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Lucioles ou lanternes célestes : des points lumineux qui montent et clignent. */
function risers(ctx: CanvasRenderingContext2D, view: WorldView, time: number, count: number, color: Rgb, options: { speed: number; size: number; lantern?: boolean }): void {
  const random = rng(count * 17 + (options.lantern ? 3 : 0))
  for (let index = 0; index < count; index += 1) {
    const speed = (0.025 + random() * 0.03) * options.speed
    const x = random() + Math.sin(time * 0.5 + index * 2) * 0.02
    const y = 1.05 - ((((random() + time * speed) % 1.1) + 1.1) % 1.1)
    const size = options.size * (0.6 + random() * 0.8)
    if (options.lantern) lantern(ctx, x * view.width, y * view.height, size, color, 0.9)
    else {
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * (1 + random() * 2) + index))
      const halo = ctx.createRadialGradient(x * view.width, y * view.height, 0, x * view.width, y * view.height, size * 3)
      halo.addColorStop(0, rgba(color, 0.9 * twinkle))
      halo.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = halo
      ctx.fillRect(x * view.width - size * 3, y * view.height - size * 3, size * 6, size * 6)
    }
  }
}

const STARS = (() => {
  const random = rng(5)
  return Array.from({ length: 110 }, () => ({ x: random(), y: random() * 0.85, size: 0.5 + random() * 1.5, phase: random() * 6.28 }))
})()

function stars(ctx: CanvasRenderingContext2D, view: WorldView, time: number, alpha: number, shift: number): void {
  ctx.fillStyle = '#fff'
  for (const star of STARS) {
    ctx.globalAlpha *= 1
    const twinkle = 0.5 + 0.5 * Math.sin(time * 1.6 + star.phase)
    const previous = ctx.globalAlpha
    ctx.globalAlpha = previous * alpha * twinkle * (1 - star.y * 0.4)
    ctx.fillRect(star.x * view.width, (star.y * view.height + shift) % view.height, star.size, star.size)
    ctx.globalAlpha = previous
  }
}

function shootingStar(ctx: CanvasRenderingContext2D, view: WorldView, time: number, slot: number): void {
  const period = 5 + slot * 2.3
  const cycle = Math.floor((time + slot * 3.1) / period)
  const age = time + slot * 3.1 - cycle * period
  if (age > 0.9) return
  const random = rng(cycle * 7 + slot)
  const x = view.width * (0.3 + random() * 0.6)
  const y = view.height * (0.05 + random() * 0.3)
  const t = age / 0.9
  const length = view.stage * 0.3
  const hx = x - t * view.stage * 0.55
  const hy = y + t * view.stage * 0.3
  const tail = ctx.createLinearGradient(hx, hy, hx + length * 0.88, hy - length * 0.48)
  tail.addColorStop(0, `rgba(255,255,255,${1 - t})`)
  tail.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.strokeStyle = tail
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx + length * 0.88, hy - length * 0.48)
  ctx.stroke()
}

function aurora(ctx: CanvasRenderingContext2D, view: WorldView, time: number, alpha: number): void {
  const colors: Rgb[] = [hex('#3dffb8'), hex('#6b8dff'), hex('#c66bff')]
  colors.forEach((color, index) => {
    const base = view.height * (0.2 + index * 0.08)
    const gradient = ctx.createLinearGradient(0, base - view.height * 0.12, 0, base + view.height * 0.16)
    gradient.addColorStop(0, rgba(color, 0))
    gradient.addColorStop(0.45, rgba(color, 0.22 * alpha))
    gradient.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(0, base + view.height * 0.2)
    for (let x = 0; x <= view.width; x += 12) {
      const y = base + Math.sin(x * 0.012 + time * 0.5 + index * 1.7) * view.height * 0.03 + Math.sin(x * 0.005 - time * 0.3) * view.height * 0.04
      ctx.lineTo(x, y)
    }
    ctx.lineTo(view.width, base + view.height * 0.2)
    ctx.closePath()
    ctx.fill()
  })
}

function milkyWay(ctx: CanvasRenderingContext2D, view: WorldView, alpha: number, shift: number): void {
  const random = rng(77)
  ctx.save()
  ctx.translate(view.width * 0.5, view.height * 0.35 + shift)
  ctx.rotate(-0.55)
  for (let index = 0; index < 120; index += 1) {
    const x = (random() - 0.5) * view.height * 1.3
    const y = (random() + random() + random() - 1.5) * view.stage * 0.22
    const r = view.stage * (0.05 + random() * 0.1)
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, `rgba(190,200,255,${0.07 * alpha})`)
    blob.addColorStop(1, 'rgba(190,200,255,0)')
    ctx.fillStyle = blob
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()
}

function nebula(ctx: CanvasRenderingContext2D, view: WorldView, alpha: number, shift: number): void {
  const blobs: [number, number, number, Rgb][] = [[0.25, 0.3, 0.5, hex('#ff5ec4')], [0.75, 0.45, 0.55, hex('#3fd0ff')], [0.45, 0.7, 0.5, hex('#8a5cff')]]
  for (const [x, y, size, color] of blobs) {
    const r = view.stage * size
    const gradient = ctx.createRadialGradient(x * view.width, y * view.height + shift, 0, x * view.width, y * view.height + shift, r)
    gradient.addColorStop(0, rgba(color, 0.22 * alpha))
    gradient.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = gradient
    ctx.fillRect(x * view.width - r, y * view.height + shift - r, r * 2, r * 2)
  }
}

/** Astre : un disque et sa lueur. */
function body(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Rgb, glow: number, craters = false): void {
  const halo = ctx.createRadialGradient(x, y, radius * 0.4, x, y, radius * glow)
  halo.addColorStop(0, rgba(color, 0.6))
  halo.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = halo
  ctx.fillRect(x - radius * glow, y - radius * glow, radius * glow * 2, radius * glow * 2)
  const disc = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, radius * 0.1, x, y, radius)
  disc.addColorStop(0, rgba(mix(color, [255, 255, 255], 0.5)))
  disc.addColorStop(1, rgba(color))
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  if (craters) {
    ctx.fillStyle = 'rgba(120,130,180,0.18)'
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.3], [-0.1, 0.4, 0.15], [0.3, -0.35, 0.12]] as const) {
      ctx.beginPath()
      ctx.arc(x + dx * radius, y + dy * radius, r * radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/* ---- Les six mondes --------------------------------------------------------------------- */

interface Sky {
  stops: [number, Rgb][]
}

const SKIES: Sky[] = [
  { stops: [[0, hex('#2b1a5e')], [0.45, hex('#b8437f')], [0.75, hex('#ff8a5c')], [1, hex('#ffd08a')]] },
  { stops: [[0, hex('#6aa7f5')], [0.55, hex('#bfe0ff')], [1, hex('#ffe6cf')]] },
  { stops: [[0, hex('#1f5fc9')], [0.6, hex('#69b8f2')], [1, hex('#d7f0ff')]] },
  { stops: [[0, hex('#0a0720')], [0.55, hex('#2d1257')], [1, hex('#8a2f6e')]] },
  { stops: [[0, hex('#03051a')], [0.55, hex('#0f1a4a')], [1, hex('#2b3f8f')]] },
  { stops: [[0, hex('#07021a')], [0.5, hex('#1a0c40')], [1, hex('#40206b')]] },
]

/** Un monde, dessiné avec l'opacité courante du contexte. `local` : tomes posés dans ce monde, qui fait glisser les plans. */
function drawWorld(ctx: CanvasRenderingContext2D, view: WorldView, index: number, local: number, time: number): void {
  const { width, height, stage } = view
  const progress = local / PAGES_PER_WORLD
  const farShift = progress * height * 0.22
  const midShift = progress * height * 0.45
  const nearShift = progress * height * 0.85
  const sky = SKIES[index]!
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  for (const [stop, color] of sky.stops) gradient.addColorStop(stop, rgba(color))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  if (index === 0) {
    // Crépuscule sur un village : soleil bas, Fuji violet, pagode, torii, pins, branche de cerisier.
    body(ctx, width * 0.7, height * 0.62 + farShift * 0.5, stage * 0.2, hex('#ffe0a0'), 3.2)
    clouds(ctx, view, hex('#ffb6a0'), { count: 4, y: height * 0.3, size: 0.9, speed: 0.01, alpha: 0.85, time, seed: 3 })
    fuji(ctx, width * 0.28, height * 0.78 + farShift, stage * 1.25, stage * 0.62, hex('#6a3f8f'), hex('#ffd9d0'))
    ridge(ctx, view, 12, hex('#59307f'), height * 0.8 + farShift, stage * 0.14)
    mist(ctx, view, height * 0.78 + farShift, stage * 0.14, hex('#ffb68a'), 0.45)
    pagoda(ctx, width * 0.72, height * 0.86 + midShift, stage * 0.62, hex('#2c1650'))
    torii(ctx, width * 0.38, height * 0.9 + midShift, stage * 0.34, hex('#a3213c'))
    ridge(ctx, view, 31, hex('#26123f'), height * 0.9 + midShift, stage * 0.1)
    pine(ctx, width * 0.1, height * 0.98 + nearShift, stage * 0.5, hex('#170a2c'), stage * 0.05)
    pine(ctx, width * 0.94, height * 1.0 + nearShift, stage * 0.58, hex('#170a2c'), -stage * 0.06)
    clouds(ctx, view, hex('#ff9a80'), { count: 3, y: height * 0.72 + midShift * 0.5, size: 1.1, speed: 0.016, alpha: 0.6, time, seed: 9 })
    sakuraBranch(ctx, view, -1, time)
    drifters(ctx, view, time, 26, 'rgba(255,190,210,0.8)', { speed: 1, size: 3.6 })
    for (const [x, y, phase] of [[0.2, 0.18, 0], [0.34, 0.12, 1.5], [0.46, 0.2, 3]] as const) crane(ctx, x * width, y * height, stage * 0.06, time, phase, 'rgba(40,20,60,0.75)')
  } else if (index === 1) {
    // Aube sur le Mont Fuji : ciel pastel, sommet enneigé, lac, grues, brume.
    body(ctx, width * 0.5, height * 0.34 + farShift * 0.4, stage * 0.14, hex('#fff2c4'), 3)
    clouds(ctx, view, hex('#ffffff'), { count: 4, y: height * 0.22, size: 1, speed: 0.012, alpha: 0.9, time, seed: 5 })
    fuji(ctx, width * 0.5, height * 0.8 + farShift, stage * 1.7, stage * 0.95, hex('#5a76b8'), hex('#ffffff'))
    mist(ctx, view, height * 0.74 + farShift, stage * 0.16, hex('#ffe9d6'), 0.6)
    ridge(ctx, view, 44, hex('#3f5c9a'), height * 0.84 + midShift, stage * 0.12)
    // Le lac et le reflet du Fuji.
    const lake = ctx.createLinearGradient(0, height * 0.86 + midShift, 0, height * 1.02 + midShift)
    lake.addColorStop(0, 'rgba(180,215,255,0.9)')
    lake.addColorStop(1, 'rgba(120,160,220,0.9)')
    ctx.fillStyle = lake
    ctx.fillRect(0, height * 0.86 + midShift, width, height)
    torii(ctx, width * 0.62, height * 0.93 + midShift, stage * 0.3, hex('#c0243c'))
    pine(ctx, width * 0.06, height * 1.0 + nearShift, stage * 0.5, hex('#1c3a58'), stage * 0.05)
    clouds(ctx, view, hex('#ffffff'), { count: 3, y: height * 0.55 + midShift * 0.6, size: 1.3, speed: 0.018, alpha: 0.55, time, seed: 11 })
    drifters(ctx, view, time, 18, 'rgba(255,205,220,0.85)', { speed: 0.9, size: 3.4 })
    for (const [x, y, phase] of [[0.22, 0.2, 0.4], [0.3, 0.27, 2.1], [0.78, 0.15, 3.7], [0.7, 0.23, 5]] as const) crane(ctx, x * width, y * height, stage * 0.075, time, phase, 'rgba(255,255,255,0.95)')
  } else if (index === 2) {
    // Temple au-dessus d'une mer de nuages : bleu profond, rochers, pagode, feuilles d'érable.
    body(ctx, width * 0.28, height * 0.2 + farShift * 0.4, stage * 0.11, hex('#fff6cc'), 3.4)
    clouds(ctx, view, hex('#ffffff'), { count: 3, y: height * 0.2, size: 0.8, speed: 0.01, alpha: 0.7, time, seed: 21 })
    ridge(ctx, view, 52, hex('#3a6fb0'), height * 0.7 + farShift, stage * 0.28)
    clouds(ctx, view, hex('#ffffff'), { count: 6, y: height * 0.62 + farShift, size: 1.6, speed: 0.008, alpha: 0.9, time, seed: 23 })
    // Le piton rocheux et son temple.
    ctx.fillStyle = rgba(hex('#2f4f80'))
    ctx.beginPath()
    ctx.moveTo(width * 0.52, height * 1.05 + midShift)
    ctx.quadraticCurveTo(width * 0.6, height * 0.78 + midShift, width * 0.66, height * 0.68 + midShift)
    ctx.quadraticCurveTo(width * 0.72, height * 0.6 + midShift, width * 0.8, height * 0.7 + midShift)
    ctx.quadraticCurveTo(width * 0.95, height * 0.85 + midShift, width, height * 1.05 + midShift)
    ctx.closePath()
    ctx.fill()
    pagoda(ctx, width * 0.72, height * 0.66 + midShift, stage * 0.5, hex('#1d2f58'))
    pine(ctx, width * 0.6, height * 0.78 + midShift, stage * 0.3, hex('#16264a'), -stage * 0.04)
    clouds(ctx, view, hex('#ffffff'), { count: 6, y: height * 0.78 + midShift * 0.7, size: 1.8, speed: 0.014, alpha: 0.95, time, seed: 25 })
    torii(ctx, width * 0.18, height * 0.96 + nearShift, stage * 0.4, hex('#d02a3a'))
    clouds(ctx, view, hex('#ffffff'), { count: 5, y: height * 0.92 + nearShift * 0.6, size: 2.2, speed: 0.02, alpha: 0.9, time, seed: 27 })
    drifters(ctx, view, time, 16, 'rgba(226,84,40,0.9)', { speed: 1.1, size: 5, leaf: true })
    crane(ctx, width * 0.4, height * 0.3, stage * 0.08, time, 1, 'rgba(255,255,255,0.95)')
  } else if (index === 3) {
    // Fête des lanternes : nuit indigo, guirlandes, lanternes célestes, feux d'artifice.
    stars(ctx, view, time, 0.5, farShift * 0.2)
    body(ctx, width * 0.2, height * 0.2 + farShift * 0.3, stage * 0.09, hex('#fff1c8'), 3, true)
    clouds(ctx, view, hex('#8a60c8'), { count: 4, y: height * 0.28, size: 1, speed: 0.01, alpha: 0.55, time, seed: 31 })
    for (let slot = 0; slot < 3; slot += 1) firework(ctx, view, time, slot, 3.4 + slot * 0.7)
    ridge(ctx, view, 61, hex('#2a1450'), height * 0.8 + farShift, stage * 0.2)
    pagoda(ctx, width * 0.76, height * 0.88 + midShift, stage * 0.6, hex('#160a30'), true)
    ridge(ctx, view, 71, hex('#12082a'), height * 0.92 + midShift, stage * 0.1)
    risers(ctx, view, time, 10, hex('#ffb35c'), { speed: 1, size: stage * 0.022, lantern: true })
    // Guirlande de lanternes en travers.
    ctx.strokeStyle = 'rgba(30,10,40,0.8)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(-10, height * 0.08 + nearShift * 0.3)
    ctx.quadraticCurveTo(width * 0.5, height * 0.2 + nearShift * 0.3, width + 10, height * 0.06 + nearShift * 0.3)
    ctx.stroke()
    for (let index2 = 0; index2 < 7; index2 += 1) {
      const t = (index2 + 0.5) / 7
      const x = width * t
      const y = (1 - t) * (1 - t) * height * 0.08 + 2 * (1 - t) * t * height * 0.2 + t * t * height * 0.06 + nearShift * 0.3 + stage * 0.03
      lantern(ctx, x, y, stage * 0.035, hex(index2 % 2 === 0 ? '#ff5a3c' : '#ffb04a'), 0.9)
    }
    risers(ctx, view, time, 14, hex('#ffe58a'), { speed: 0.7, size: 1.8 })
  } else if (index === 4) {
    // Voie lactée de Tanabata : étoiles, bande lumineuse, étoiles filantes, bambous aux vœux.
    stars(ctx, view, time, 1, farShift * 0.25)
    milkyWay(ctx, view, 1, farShift * 0.4)
    aurora(ctx, view, time, 0.7)
    for (let slot = 0; slot < 2; slot += 1) shootingStar(ctx, view, time, slot)
    ridge(ctx, view, 81, hex('#0c1440'), height * 0.88 + midShift, stage * 0.16)
    const stalks = [0.06, 0.13, 0.9, 0.96, 0.82]
    stalks.forEach((x, slot) => bamboo(ctx, x * width, height * 1.02 + nearShift, stage * (0.9 + (slot % 3) * 0.2), hex('#070d2c'), time, slot * 1.3))
    // Tanzaku : des bandelettes colorées accrochées aux bambous.
    const strips = ['#ff7fa8', '#ffe27a', '#7ad7ff', '#9cff9a']
    for (let slot = 0; slot < 6; slot += 1) {
      const x = (stalks[slot % stalks.length]! + (slot % 2 === 0 ? 0.035 : -0.035)) * width
      const y = height * (0.5 + (slot % 3) * 0.08) + nearShift
      const sway = Math.sin(time * 1.2 + slot) * 3
      ctx.fillStyle = strips[slot % strips.length]!
      ctx.fillRect(x + sway, y, stage * 0.03, stage * 0.11)
    }
    risers(ctx, view, time, 16, hex('#d8ff9a'), { speed: 0.5, size: 1.8 })
  } else {
    // Lune et cosmos : lune géante, nébuleuses, torii flottants, poussière d'étoiles.
    stars(ctx, view, time, 1, farShift * 0.3)
    nebula(ctx, view, 1, farShift * 0.5)
    body(ctx, width * 0.68, height * 0.3 + farShift * 0.4, stage * 0.36, hex('#f2f1ff'), 2.4, true)
    clouds(ctx, view, hex('#9a78e0'), { count: 3, y: height * 0.7 + midShift * 0.5, size: 1.6, speed: 0.01, alpha: 0.45, time, seed: 91 })
    // Îles et torii qui flottent.
    for (const [x, y, size, phase] of [[0.2, 0.55, 0.3, 0], [0.82, 0.78, 0.22, 2], [0.46, 0.88, 0.18, 4]] as const) {
      const bob = Math.sin(time * 0.7 + phase) * stage * 0.02
      const px = x * width
      const py = y * height + midShift + bob
      ctx.fillStyle = rgba(hex('#241247'))
      ctx.beginPath()
      ctx.moveTo(px - stage * size * 0.6, py)
      ctx.quadraticCurveTo(px, py + stage * size * 0.75, px + stage * size * 0.6, py)
      ctx.closePath()
      ctx.fill()
      torii(ctx, px, py, stage * size * 0.9, hex('#c0243c'))
    }
    for (let slot = 0; slot < 2; slot += 1) shootingStar(ctx, view, time, slot + 3)
    risers(ctx, view, time, 18, hex('#ffd1f0'), { speed: 0.6, size: 1.8 })
    drifters(ctx, view, time, 14, 'rgba(210,190,255,0.7)', { speed: 0.5, size: 2.6 })
  }
}

/**
 * Le décor complet pour `pages` tomes posés (valeur lissée) : le monde courant, fondu vers le
 * suivant sur la fin du palier. Dessin direct, sans cache (les aperçus et les tests).
 */
export function drawWorlds(ctx: CanvasRenderingContext2D, view: WorldView, pages: number, time: number): void {
  const { index, local, next, blend } = worldAt(pages)
  drawWorld(ctx, view, index, local, time)
  if (blend > 0.001) {
    ctx.save()
    ctx.globalAlpha = blend
    drawWorld(ctx, view, next, 0, time)
    ctx.restore()
  }
}

/* ---- Décor en calques ------------------------------------------------------------------- */

/** Le décor bouge lentement et reste flou : il est redessiné 30 fois par seconde, sur un calque réduit. */
const BACKDROP_STEP = 1 / 30
/** Côté le plus long du calque (pixels) : au-delà, le décor est dessiné plus petit puis agrandi. */
const BACKDROP_MAX_SIDE = 640

interface Layer {
  canvas: HTMLCanvasElement
  world: number
  local: number
  width: number
  height: number
  /** Temps (du jeu) du dernier dessin ; `-Infinity` : à refaire. */
  painted: number
}

const newLayer = (): Layer => ({ canvas: document.createElement('canvas'), world: -1, local: 0, width: 0, height: 0, painted: -Infinity })

/**
 * Le décor d'un panneau. Chaque monde est dessiné dans un calque à part, à taille réduite et à
 * cadence réduite ; à l'écran, on ne fait que le recopier. Pendant le fondu entre deux mondes, le
 * calque du suivant se dessine une image sur deux (jamais les deux le même instant) : le coût ne
 * double plus, et la bascule ne fait plus ralentir le jeu.
 */
export class WorldBackdrop {
  private readonly layers: [Layer, Layer] = [newLayer(), newLayer()]
  /** Pendant le fondu : les deux mondes mêlés à taille réduite, pour ne recopier à l'écran (grand) qu'une seule image. */
  private readonly mixed = document.createElement('canvas')

  constructor() {
    warmWorlds()
  }

  draw(ctx: CanvasRenderingContext2D, view: WorldView, pages: number, time: number): void {
    const { index, local, next, blend } = worldAt(pages)
    const scale = Math.min(1, BACKDROP_MAX_SIDE / Math.max(view.width, view.height, 1))
    const [current, upcoming] = this.layers
    const painted = this.paint(current, view, scale, index, local, time, false)
    if (blend <= 0.001) {
      ctx.drawImage(current.canvas, 0, 0, current.width, current.height, 0, 0, view.width, view.height)
      return
    }
    this.paint(upcoming, view, scale, next, 0, time, painted)
    const mix = this.mixed
    if (mix.width !== current.width || mix.height !== current.height) {
      mix.width = current.width
      mix.height = current.height
    }
    const mctx = mix.getContext('2d')
    if (!mctx) return
    mctx.globalAlpha = 1
    mctx.drawImage(current.canvas, 0, 0)
    mctx.globalAlpha = blend
    mctx.drawImage(upcoming.canvas, 0, 0)
    ctx.drawImage(mix, 0, 0, mix.width, mix.height, 0, 0, view.width, view.height)
  }

  /** Redessine le calque si besoin ; `true` si c'est fait. Si l'autre calque vient d'être dessiné, celui-ci attend l'image suivante. */
  private paint(layer: Layer, view: WorldView, scale: number, world: number, local: number, time: number, busy: boolean): boolean {
    const width = Math.max(1, Math.round(view.width * scale))
    const height = Math.max(1, Math.round(view.height * scale))
    const resized = layer.width !== width || layer.height !== height
    const changed = layer.world !== world
    const stale = resized || changed || time - layer.painted >= BACKDROP_STEP || time < layer.painted || Math.abs(local - layer.local) > 0.02
    // Le premier dessin d'un calque (monde ou taille neufs) ne peut pas attendre : il serait vide.
    // Un calque en retard de plus de deux pas passe quand même (écrans à 30 images/s : l'autre calque se dessinerait toujours).
    if (!stale || (busy && !resized && !changed && time - layer.painted < BACKDROP_STEP * 2.5)) return false
    if (resized) {
      layer.canvas.width = width
      layer.canvas.height = height
      layer.width = width
      layer.height = height
    }
    const lctx = layer.canvas.getContext('2d')
    if (!lctx) return false
    lctx.setTransform(scale, 0, 0, scale, 0, 0)
    lctx.globalAlpha = 1
    drawWorld(lctx, view, world, local, time)
    layer.world = world
    layer.local = local
    layer.painted = time
    return true
  }
}

/* ---- Préparation à l'avance ------------------------------------------------------------- */

let warmed = false

/**
 * Les nuages de chaque monde sont des sprites préparés au premier usage (des dizaines de dégradés) :
 * le faire au moment de la bascule fait saccader. On les prépare une fois, monde après monde, dans
 * les temps morts qui suivent l'ouverture du jeu.
 */
function warmWorlds(): void {
  if (warmed || typeof document === 'undefined') return
  warmed = true
  const canvas = document.createElement('canvas')
  canvas.width = 90
  canvas.height = 160
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const view: WorldView = { width: 90, height: 160, stage: 72 }
  const later = (task: () => void): void => {
    const idle = (window as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
    if (idle) idle.call(window, task, { timeout: 1500 })
    else setTimeout(task, 120)
  }
  let index = 0
  const step = (): void => {
    if (index >= WORLD_COUNT) return
    drawWorld(ctx, view, index, 0, 0)
    index += 1
    later(step)
  }
  later(step)
}
