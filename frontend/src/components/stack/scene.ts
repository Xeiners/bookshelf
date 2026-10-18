import { INITIAL_WIDTH, PAGE_HEIGHT } from '../../lib/stack/constants'
import { limits, pageCount, type StackState } from '../../lib/stack/engine'

/*
 * Page Stack : le décor et les pages, dessinés en Canvas 2D (aucune image à charger). Le ciel
 * change de palette toutes les 10 pages (aube, jour, crépuscule, nuit, aurore) ; deux rangées de
 * montagnes, des nuages, des étoiles et des pétales défilent à des vitesses différentes quand la
 * caméra monte. Les pages sont des pages de manga : papier, bandeau coloré, cases encrées.
 */

type Rgb = [number, number, number]

interface Palette {
  top: Rgb
  bottom: Rgb
  far: Rgb
  near: Rgb
  sun: Rgb
  stars: number
}

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]

const PALETTES: Palette[] = [
  { top: hex('#3b2a6e'), bottom: hex('#ff9e7d'), far: hex('#6a3f8a'), near: hex('#3d2466'), sun: hex('#ffd9a8'), stars: 0.25 },
  { top: hex('#4fa8f5'), bottom: hex('#d8f1ff'), far: hex('#7fb4d9'), near: hex('#4c86b5'), sun: hex('#fff6c9'), stars: 0 },
  { top: hex('#5b3aa8'), bottom: hex('#ff8fb8'), far: hex('#9a4fa0'), near: hex('#5a2b7a'), sun: hex('#ffd1a0'), stars: 0.1 },
  { top: hex('#080c26'), bottom: hex('#2a2a6b'), far: hex('#1d1f55'), near: hex('#10123a'), sun: hex('#e8ecff'), stars: 1 },
  { top: hex('#06182a'), bottom: hex('#1f8a78'), far: hex('#16525c'), near: hex('#0b3040'), sun: hex('#c9fff0'), stars: 0.8 },
]

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const css = (color: Rgb, alpha = 1): string => `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha})`
const smooth = (t: number): number => t * t * (3 - 2 * t)

/** Pages posées par palette : au bout de ce nombre, le ciel passe à la suivante. */
export const PAGES_PER_SKY = 10

/** Palette courante, fondue vers la suivante au fil des pages. */
export function skyAt(pages: number): Palette {
  const position = pages / PAGES_PER_SKY
  const index = Math.floor(position)
  const t = smooth(Math.min(1, Math.max(0, (position - index - 0.35) / 0.65)))
  const from = PALETTES[index % PALETTES.length]!
  const to = PALETTES[(index + 1) % PALETTES.length]!
  return { top: mix(from.top, to.top, t), bottom: mix(from.bottom, to.bottom, t), far: mix(from.far, to.far, t), near: mix(from.near, to.near, t), sun: mix(from.sun, to.sun, t), stars: from.stars + (to.stars - from.stars) * t }
}

/** Petit générateur déterministe : le décor est le même à chaque partie. */
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

function ridge(seed: number, points: number, amplitude: number): number[] {
  const random = rng(seed)
  const values: number[] = []
  let value = 0.5
  for (let index = 0; index <= points; index += 1) {
    value = Math.min(1, Math.max(0, value + (random() - 0.5) * 0.7))
    values.push(value * amplitude)
  }
  return values
}

const FAR_RIDGE = ridge(11, 14, 0.16)
const NEAR_RIDGE = ridge(29, 11, 0.12)
const STARS = (() => {
  const random = rng(5)
  return Array.from({ length: 70 }, () => ({ x: random(), y: random() * 0.7, size: 0.6 + random() * 1.4, phase: random() * 6.28 }))
})()
const CLOUDS = (() => {
  const random = rng(17)
  return Array.from({ length: 6 }, () => ({ x: random(), y: 0.08 + random() * 0.5, size: 0.5 + random() * 0.9, speed: 0.004 + random() * 0.008 }))
})()

export interface Petal {
  x: number
  y: number
  vx: number
  vy: number
  phase: number
  size: number
  spin: number
}

export function makePetals(count: number): Petal[] {
  const random = rng(41)
  return Array.from({ length: count }, () => ({ x: random(), y: random(), vx: 0.01 + random() * 0.02, vy: 0.03 + random() * 0.04, phase: random() * 6.28, size: 3 + random() * 3.5, spin: 1 + random() * 2 }))
}

export interface View {
  width: number
  height: number
  /** Largeur de la scène (colonne de jeu) et marge gauche, en pixels. */
  stage: number
  left: number
  /** Hauteur d'une page, et ordonnée du sol, en pixels. */
  page: number
  ground: number
  /** Décalage de la caméra vers le haut, en pixels. */
  cam: number
}

export function makeView(width: number, height: number, cam: number): View {
  const stage = Math.min(width, 520)
  return { width, height, stage, left: (width - stage) / 2, page: PAGE_HEIGHT * stage, ground: height * 0.8, cam }
}

/** Ordonnée du dessus d'une page de la pile (rang 0 : la base). */
export const rowTop = (view: View, row: number): number => view.ground - (row + 1) * view.page + view.cam

/** Décalage de caméra voulu : la page qui glisse reste vers 42 % de la hauteur. */
export const camTarget = (view: Omit<View, 'cam'>, pages: number): number => Math.max(0, view.height * 0.42 - view.ground + (pages + 2) * view.page)

export function drawSky(ctx: CanvasRenderingContext2D, view: View, pages: number, time: number): Palette {
  const sky = skyAt(pages)
  const gradient = ctx.createLinearGradient(0, 0, 0, view.height)
  gradient.addColorStop(0, css(sky.top))
  gradient.addColorStop(1, css(sky.bottom))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, view.width, view.height)

  if (sky.stars > 0.02) {
    ctx.fillStyle = '#fff'
    for (const star of STARS) {
      const twinkle = 0.55 + 0.45 * Math.sin(time * 1.7 + star.phase)
      ctx.globalAlpha = sky.stars * twinkle * (1 - (star.y * 0.5))
      ctx.fillRect(star.x * view.width, (star.y * view.height + view.cam * 0.03) % view.height, star.size, star.size)
    }
    ctx.globalAlpha = 1
  }

  // Soleil ou lune : un disque lumineux qui descend lentement quand on monte.
  const sunX = view.width * 0.72
  const sunY = view.height * 0.22 + Math.min(view.cam * 0.05, view.height * 0.3)
  const radius = view.stage * 0.13
  const glow = ctx.createRadialGradient(sunX, sunY, radius * 0.2, sunX, sunY, radius * 3)
  glow.addColorStop(0, css(sky.sun, 0.55))
  glow.addColorStop(1, css(sky.sun, 0))
  ctx.fillStyle = glow
  ctx.fillRect(sunX - radius * 3, sunY - radius * 3, radius * 6, radius * 6)
  ctx.fillStyle = css(sky.sun)
  ctx.beginPath()
  ctx.arc(sunX, sunY, radius, 0, Math.PI * 2)
  ctx.fill()

  // Nuages : des bancs doux qui dérivent, plus lents que la caméra.
  ctx.fillStyle = css(mix(sky.bottom, [255, 255, 255], 0.55), 0.35)
  for (const cloud of CLOUDS) {
    const x = (((cloud.x + time * cloud.speed) % 1.3) - 0.15) * view.width
    const y = cloud.y * view.height + view.cam * 0.12
    if (y > view.height + 40) continue
    const size = cloud.size * view.stage * 0.18
    for (const [dx, dy, scale] of [[0, 0, 1], [0.7, 0.12, 0.75], [-0.7, 0.14, 0.7], [0.2, -0.22, 0.65]] as const) {
      ctx.beginPath()
      ctx.ellipse(x + dx * size, y + dy * size, size * scale, size * scale * 0.52, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  drawRidge(ctx, view, FAR_RIDGE, sky.far, view.height * 0.7, view.cam * 0.14)
  drawRidge(ctx, view, NEAR_RIDGE, sky.near, view.height * 0.8, view.cam * 0.28)
  return sky
}

function drawRidge(ctx: CanvasRenderingContext2D, view: View, values: number[], color: Rgb, baseline: number, shift: number): void {
  const base = baseline + shift
  if (base - view.height * 0.2 > view.height) return
  ctx.fillStyle = css(color)
  ctx.beginPath()
  ctx.moveTo(0, view.height + 4)
  values.forEach((value, index) => ctx.lineTo((index / (values.length - 1)) * view.width, base - value * view.height))
  ctx.lineTo(view.width, view.height + 4)
  ctx.closePath()
  ctx.fill()
}

/** Pétales de cerisier : une dérive lente en diagonale, avec un léger balancement. */
export function drawPetals(ctx: CanvasRenderingContext2D, view: View, petals: Petal[], time: number, sky: Palette): void {
  ctx.fillStyle = css(mix([255, 170, 200], mix(sky.bottom, [255, 255, 255], 0.3), 0.25), 0.7)
  for (const petal of petals) {
    const x = (((petal.x + time * petal.vx + Math.sin(time * 0.8 + petal.phase) * 0.02) % 1.1) + 1.1) % 1.1
    const y = ((petal.y + time * petal.vy) % 1.1)
    ctx.save()
    ctx.translate((x - 0.05) * view.width, (y - 0.05) * view.height)
    ctx.rotate(time * petal.spin + petal.phase)
    ctx.beginPath()
    ctx.ellipse(0, 0, petal.size, petal.size * 0.55, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Le bureau sur lequel repose la pile : une planche large, un peu de grain. */
export function drawDesk(ctx: CanvasRenderingContext2D, view: View): void {
  const y = rowTop(view, 0) + view.page
  if (y > view.height + 10) return
  const gradient = ctx.createLinearGradient(0, y, 0, y + view.page * 1.6)
  gradient.addColorStop(0, '#6b3f2a')
  gradient.addColorStop(1, '#2a1612')
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(view.width / 2, y + 2, view.stage * 0.45, view.page * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = gradient
  ctx.fillRect(0, y, view.width, view.height - y + 10)
  ctx.fillStyle = 'rgba(255,220,170,0.28)'
  ctx.fillRect(0, y, view.width, Math.max(2, view.page * 0.06))
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 1
  for (let index = 1; index < 5; index += 1) {
    ctx.beginPath()
    ctx.moveTo(0, y + view.page * 0.32 * index)
    ctx.lineTo(view.width, y + view.page * 0.32 * index)
    ctx.stroke()
  }
}

const INK = 'rgba(24,18,44,0.82)'

/** Affiche d'anime d'une page : l'image, la portion de scène qu'elle couvre (centre et largeur d'origine) et le point de la hauteur montré. */
export interface PageArt {
  image: HTMLImageElement
  x: number
  w: number
  /** 0 → 1 : la partie de la hauteur de l'affiche qui se trouve dans la page. */
  v: number
}

/**
 * Une page : l'affiche d'anime (une tranche, qui se prolonge sur le morceau coupé), ou, sans
 * affiche, une page de manga — papier, bandeau coloré (la teinte change à chaque page), cases
 * encrées. `index` fixe le motif des cases.
 */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  view: View,
  centre: number,
  width: number,
  top: number,
  index: number,
  options: { alpha?: number; angle?: number; pivot?: { x: number; y: number }; art?: PageArt | null } = {},
): void {
  const x = view.left + (centre - width / 2) * view.stage
  const w = width * view.stage
  const h = view.page
  if (w < 1) return
  const radius = Math.min(h * 0.2, w / 2)
  ctx.save()
  ctx.globalAlpha = options.alpha ?? 1
  if (options.angle) {
    const pivot = options.pivot ?? { x: x + w / 2, y: top + h / 2 }
    ctx.translate(pivot.x, pivot.y)
    ctx.rotate(options.angle)
    ctx.translate(-pivot.x, -pivot.y)
  }
  ctx.beginPath()
  ctx.roundRect(x, top, w, h, radius)
  const paper = ctx.createLinearGradient(0, top, 0, top + h)
  paper.addColorStop(0, '#fffdf4')
  paper.addColorStop(1, '#eadfc6')
  ctx.fillStyle = paper
  ctx.fill()
  ctx.save()
  ctx.clip()

  const art = options.art
  if (art && art.image.naturalWidth > 0) {
    // L'affiche couvre la page d'origine ; la page coupée n'en montre que sa part.
    const artWidth = art.w * view.stage
    const artLeft = view.left + (art.x - art.w / 2) * view.stage
    const artHeight = (art.image.naturalHeight / art.image.naturalWidth) * artWidth
    const artTop = Math.min(top, Math.max(top + h - artHeight, top + h / 2 - art.v * artHeight))
    ctx.drawImage(art.image, artLeft, artTop, artWidth, artHeight)
    // Un peu d'épaisseur : reflet en haut, ombre en bas.
    const shade = ctx.createLinearGradient(0, top, 0, top + h)
    shade.addColorStop(0, 'rgba(255,255,255,0.28)')
    shade.addColorStop(0.18, 'rgba(255,255,255,0)')
    shade.addColorStop(0.75, 'rgba(0,0,0,0)')
    shade.addColorStop(1, 'rgba(0,0,0,0.38)')
    ctx.fillStyle = shade
    ctx.fillRect(x, top, w, h)
    ctx.restore()
    ctx.beginPath()
    ctx.roundRect(x, top, w, h, radius)
    ctx.strokeStyle = 'rgba(16,10,34,0.8)'
    ctx.lineWidth = Math.max(1.2, h * 0.05)
    ctx.stroke()
    ctx.restore()
    return
  }

  // Bandeau coloré, façon ruban adhésif.
  const hue = (index * 37 + 12) % 360
  const tape = ctx.createLinearGradient(x, 0, x + w, 0)
  tape.addColorStop(0, `hsl(${hue} 85% 64%)`)
  tape.addColorStop(1, `hsl(${(hue + 40) % 360} 85% 58%)`)
  ctx.fillStyle = tape
  ctx.fillRect(x, top, w, h * 0.27)

  // Cases encrées.
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(1, h * 0.05)
  ctx.lineCap = 'round'
  const body = top + h * 0.27
  const bodyHeight = h * 0.73
  const pattern = index % 4
  ctx.beginPath()
  if (pattern === 0) {
    ctx.moveTo(x + w * 0.46, body + bodyHeight * 0.12)
    ctx.lineTo(x + w * 0.46, top + h - bodyHeight * 0.12)
  } else if (pattern === 1) {
    for (const share of [0.33, 0.66]) {
      ctx.moveTo(x + w * share, body + bodyHeight * 0.12)
      ctx.lineTo(x + w * share, top + h - bodyHeight * 0.12)
    }
  } else if (pattern === 2) {
    ctx.moveTo(x + w * 0.08, body + bodyHeight * 0.5)
    ctx.lineTo(x + w * 0.92, body + bodyHeight * 0.5)
    ctx.moveTo(x + w * 0.6, body + bodyHeight * 0.5)
    ctx.lineTo(x + w * 0.6, top + h - bodyHeight * 0.12)
  } else {
    for (const share of [0.2, 0.45, 0.7]) {
      ctx.moveTo(x + w * share, top + h - bodyHeight * 0.15)
      ctx.lineTo(x + w * (share + 0.18), body + bodyHeight * 0.15)
    }
  }
  ctx.stroke()
  if (pattern === 2) {
    ctx.beginPath()
    ctx.ellipse(x + w * 0.28, body + bodyHeight * 0.28, Math.min(w * 0.12, h * 0.3), h * 0.15, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Reflet en haut, ombre en bas : un peu d'épaisseur.
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fillRect(x, top, w, Math.max(1, h * 0.05))
  ctx.fillStyle = 'rgba(40,20,0,0.16)'
  ctx.fillRect(x, top + h * 0.86, w, h * 0.14)
  ctx.restore()

  ctx.beginPath()
  ctx.roundRect(x, top, w, h, radius)
  ctx.strokeStyle = 'rgba(24,18,44,0.7)'
  ctx.lineWidth = Math.max(1.2, h * 0.045)
  ctx.stroke()
  ctx.restore()
}

/** Repères discrets : les bords de la page du dessus, prolongés vers le haut, pour viser. */
export function drawGuides(ctx: CanvasRenderingContext2D, view: View, state: StackState): void {
  const top = state.pages[state.pages.length - 1]!
  const y = rowTop(view, pageCount(state))
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  for (const side of [-1, 1]) {
    const x = view.left + (top.x + (side * top.w) / 2) * view.stage
    ctx.moveTo(x, y)
    ctx.lineTo(x, Math.max(0, y - view.page * 3.2))
  }
  ctx.stroke()
  ctx.setLineDash([])
}

export { INITIAL_WIDTH, limits }
