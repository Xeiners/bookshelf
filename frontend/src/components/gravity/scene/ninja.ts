/*
 * Le ninja de Gravity Ninja, dessiné au Canvas 2D (aucune image) : tenue d'encre, bandeau frontal à
 * plaque d'acier, masque, sabre dans le dos, et une longue écharpe écarlate simulée (chaîne de
 * Verlet) qui flotte au vent de la course. Course « à la ninja » (bras rejetés en arrière), boule
 * en vol, bras ouverts quand il plane sous la lune, écrasement à l'atterrissage.
 *
 * Repère local : unité = taille du ninja, pieds en (0, 0), tête vers −y, regard vers +x.
 */

const OUTFIT = '#1f2547'
const OUTFIT_LIGHT = '#33407a'
const OUTFIT_DARK = '#121630'
const SKIN = '#f3c9a6'
const MASK = '#161b36'
const HAIR = '#151829'
const HAIR_LIGHT = '#3c4f94'
const BELT = '#d39a2f'
const BANDAGE = '#ebe5d6'
const PLATE = '#dfe5ef'
const PLATE_DARK = '#8792a8'
const SCARF = '#e3313f'
const SCARF_DARK = '#8a0f1f'
const STEEL = '#c9d2e3'

interface Point {
  x: number
  y: number
  px: number
  py: number
}

/** Une chaîne souple (écharpe, pans du bandeau) : points reliés, entraînés par le vent. */
class Ribbon {
  points: Point[]
  readonly segment: number

  constructor(count: number, segment: number) {
    this.segment = segment
    this.points = Array.from({ length: count }, (_, index) => ({ x: -index * segment, y: 0, px: -index * segment, py: 0 }))
  }

  /** `anchor` : point d'attache (repère local) ; `wind` : poussée vers l'arrière ; `lift` : vers le haut. */
  step(anchor: { x: number; y: number }, time: number, wind: number, lift: number, flutter: number): void {
    const [head] = this.points
    head!.x = anchor.x
    head!.y = anchor.y
    for (let index = 1; index < this.points.length; index += 1) {
      const point = this.points[index]!
      const vx = (point.x - point.px) * 0.86
      const vy = (point.y - point.py) * 0.86
      point.px = point.x
      point.py = point.y
      const wave = Math.sin(time * 14 - index * 0.75) * flutter * (index / this.points.length)
      point.x += vx - wind * 0.012
      point.y += vy + 0.004 - lift * 0.006 + wave * 0.02
    }
    // Contraintes de longueur (plusieurs passes : une écharpe qui ne s'étire pas).
    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 1; index < this.points.length; index += 1) {
        const a = this.points[index - 1]!
        const b = this.points[index]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 1
        const pull = (distance - this.segment) / distance
        if (index === 1) {
          b.x -= dx * pull
          b.y -= dy * pull
        } else {
          a.x += dx * pull * 0.5
          a.y += dy * pull * 0.5
          b.x -= dx * pull * 0.5
          b.y -= dy * pull * 0.5
        }
      }
      this.points[0]!.x = anchor.x
      this.points[0]!.y = anchor.y
    }
  }

  /** Ruban effilé (largeur `width` à l'attache). */
  draw(ctx: CanvasRenderingContext2D, width: number, light: string, dark: string): void {
    const points = this.points
    const left: [number, number][] = []
    const right: [number, number][] = []
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!
      const next = points[Math.min(points.length - 1, index + 1)]!
      const prev = points[Math.max(0, index - 1)]!
      const angle = Math.atan2(next.y - prev.y, next.x - prev.x)
      const half = (width * (1 - (index / points.length) * 0.7)) / 2
      left.push([point.x + Math.sin(angle) * half, point.y - Math.cos(angle) * half])
      right.push([point.x - Math.sin(angle) * half, point.y + Math.cos(angle) * half])
    }
    const tail = points[points.length - 1]!
    const gradient = ctx.createLinearGradient(points[0]!.x, points[0]!.y, tail.x, tail.y)
    gradient.addColorStop(0, light)
    gradient.addColorStop(1, dark)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(left[0]![0], left[0]![1])
    for (let index = 1; index < left.length; index += 1) {
      const [x, y] = left[index]!
      const [px, py] = left[index - 1]!
      ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2)
    }
    ctx.lineTo(tail.x, tail.y)
    for (let index = right.length - 1; index >= 0; index -= 1) {
      const [x, y] = right[index]!
      ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
}

export interface NinjaPose {
  /** Course (s) : la phase des jambes. */
  time: number
  grounded: boolean
  /** Planer sous la lune. */
  floating: boolean
  /** Vitesse verticale dans le repère du ninja (positive : il « tombe » vers ses pieds). */
  fall: number
  /** Écrasement de l'atterrissage (0 → 1). */
  squash: number
  /** Vitesse de course (pour la cadence). */
  speed: number
}

/** Un membre en deux segments (cuisse-jambe, bras-avant-bras), épaisseur `width`. */
function limb(ctx: CanvasRenderingContext2D, x: number, y: number, a1: number, l1: number, a2: number, l2: number, width: number, color: string, end?: string): { x: number; y: number } {
  const kx = x + Math.sin(a1) * l1
  const ky = y + Math.cos(a1) * l1
  const fx = kx + Math.sin(a1 + a2) * l2
  const fy = ky + Math.cos(a1 + a2) * l2
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(kx, ky)
  ctx.lineTo(fx, fy)
  ctx.stroke()
  if (end) {
    // Bandages au bout (poignet, cheville).
    ctx.strokeStyle = end
    ctx.lineWidth = width * 0.92
    ctx.beginPath()
    ctx.moveTo(kx + (fx - kx) * 0.62, ky + (fy - ky) * 0.62)
    ctx.lineTo(kx + (fx - kx) * 0.88, ky + (fy - ky) * 0.88)
    ctx.stroke()
  }
  return { x: fx, y: fy }
}

export class Ninja {
  private scarf = new Ribbon(11, 0.085)
  private scarfTwin = new Ribbon(8, 0.08)
  private band = new Ribbon(6, 0.06)
  private bandTwin = new Ribbon(5, 0.06)
  private clock = 0

  /** Avance l'animation (écharpe, pans du bandeau). */
  update(dt: number, pose: NinjaPose): void {
    this.clock += dt
    const wind = pose.grounded ? 1 + pose.speed * 0.08 : 1.6
    const lift = pose.fall * 0.06 + (pose.floating ? 0.8 : 0)
    // Plusieurs sous-pas : une écharpe stable même à 30 images/s.
    const steps = Math.max(1, Math.round(dt / (1 / 120)))
    for (let step = 0; step < steps; step += 1) {
      const t = this.clock - (dt * (steps - step - 1)) / steps
      this.scarf.step({ x: -0.06, y: -0.79 }, t, wind, lift, 1.2)
      this.scarfTwin.step({ x: -0.04, y: -0.77 }, t + 0.4, wind * 0.9, lift, 1.5)
      this.band.step({ x: -0.15, y: -1.07 }, t + 0.2, wind, lift, 1.8)
      this.bandTwin.step({ x: -0.15, y: -1.04 }, t + 0.7, wind * 0.85, lift, 2)
    }
  }

  /**
   * Dessine le ninja ; le contexte est déjà placé (pieds en 0, unité = sa taille). `tint` : une
   * silhouette d'une seule couleur (images rémanentes).
   */
  draw(ctx: CanvasRenderingContext2D, pose: NinjaPose, tint?: string): void {
    const run = pose.time * (6 + pose.speed * 0.55)
    const airborne = !pose.grounded
    const bob = airborne ? 0 : Math.abs(Math.sin(run)) * 0.035
    const lean = airborne ? (pose.floating ? 0.05 : 0.18) : 0.36
    const color = (value: string) => tint ?? value

    ctx.save()
    // Écrasement à l'atterrissage, depuis les pieds.
    const squash = pose.squash
    ctx.scale(1 + squash * 0.18, 1 - squash * 0.2)
    ctx.translate(0, -bob)

    if (!tint) {
      this.scarfTwin.draw(ctx, 0.07, SCARF_DARK, '#5a0814')
      this.bandTwin.draw(ctx, 0.04, MASK, OUTFIT_DARK)
      this.band.draw(ctx, 0.045, OUTFIT_LIGHT, MASK)
    }

    // Hanche et épaules : le buste penché en avant.
    const hipX = 0
    const hipY = -0.5
    const shoulderX = hipX + Math.sin(lean) * 0.34
    const shoulderY = hipY - Math.cos(lean) * 0.34

    // Jambes et bras : course, boule en vol, ou bras ouverts sous la lune.
    let legBack: [number, number]
    let legFront: [number, number]
    let armBack: [number, number]
    let armFront: [number, number]
    // Angles : 0 vers le bas, positif vers l'avant. Jambes : [cuisse, pliure du genou vers l'arrière].
    if (pose.floating) {
      legBack = [-0.35, 0.6]
      legFront = [0.3, 0.4]
      armBack = [-Math.PI * 0.68, 0.1]
      armFront = [Math.PI * 0.62 + Math.sin(this.clock * 4) * 0.1, -0.15]
    } else if (airborne) {
      legBack = [0.9, 1.9]
      legFront = [1.3, 2.1]
      armBack = [-Math.PI * 0.7, 0.3]
      armFront = [-Math.PI * 0.62, 0.35]
    } else {
      const swing = Math.sin(run)
      legBack = [swing * 0.95, Math.max(0, Math.sin(run + 1.2)) * 1.4 + 0.15]
      legFront = [-swing * 0.95, Math.max(0, Math.sin(run + 1.2 + Math.PI)) * 1.4 + 0.15]
      // La course du ninja : bras tendus en arrière, qui battent à peine.
      armBack = [-Math.PI * 0.46 + swing * 0.06, 0.12]
      armFront = [-Math.PI * 0.53 - swing * 0.06, 0.1]
    }

    // Membres de l'arrière (plus sombres).
    limb(ctx, hipX - 0.02, hipY, legBack[0], 0.27, -legBack[1], 0.27, 0.13, color(OUTFIT_DARK), color('#c9c2b2'))
    limb(ctx, shoulderX - 0.03, shoulderY + 0.03, armBack[0], 0.2, armBack[1], 0.2, 0.09, color(OUTFIT_DARK), color('#c9c2b2'))

    // Sabre dans le dos.
    ctx.save()
    ctx.translate(shoulderX - 0.08, shoulderY + 0.05)
    ctx.rotate(-0.9 + lean)
    ctx.fillStyle = color('#2b1a14')
    ctx.fillRect(-0.03, -0.05, 0.06, 0.62)
    ctx.fillStyle = color(BELT)
    ctx.fillRect(-0.04, -0.06, 0.08, 0.035)
    ctx.fillStyle = color('#3a2a50')
    ctx.fillRect(-0.025, -0.24, 0.05, 0.18)
    ctx.restore()

    // Buste.
    ctx.save()
    ctx.translate(hipX, hipY)
    ctx.rotate(lean)
    const torso = ctx.createLinearGradient(-0.15, 0, 0.15, 0)
    torso.addColorStop(0, color(OUTFIT_DARK))
    torso.addColorStop(0.55, color(OUTFIT))
    torso.addColorStop(1, color(OUTFIT_LIGHT))
    ctx.fillStyle = torso
    ctx.beginPath()
    ctx.moveTo(-0.13, 0.04)
    ctx.quadraticCurveTo(-0.17, -0.2, -0.12, -0.38)
    ctx.lineTo(0.13, -0.38)
    ctx.quadraticCurveTo(0.17, -0.18, 0.12, 0.04)
    ctx.closePath()
    ctx.fill()
    // Col croisé et ceinture.
    if (!tint) {
      ctx.strokeStyle = OUTFIT_LIGHT
      ctx.lineWidth = 0.025
      ctx.beginPath()
      ctx.moveTo(-0.1, -0.36)
      ctx.lineTo(0.05, -0.12)
      ctx.stroke()
      ctx.fillStyle = BELT
      ctx.fillRect(-0.145, -0.05, 0.29, 0.06)
      ctx.fillStyle = '#7a4f12'
      ctx.fillRect(0.07, -0.05, 0.04, 0.06)
    }
    ctx.restore()

    // Écharpe : nouée au cou, devant le dos.
    if (!tint) this.scarf.draw(ctx, 0.11, SCARF, SCARF_DARK)

    // Tête.
    const headX = shoulderX + Math.sin(lean) * 0.12
    const headY = shoulderY - 0.17
    ctx.save()
    ctx.translate(headX, headY)
    ctx.rotate(lean * 0.4)
    // Cheveux en mèches rejetées vers l'arrière.
    ctx.fillStyle = color(HAIR)
    ctx.beginPath()
    ctx.moveTo(0.1, -0.12)
    ctx.lineTo(-0.02, -0.23)
    ctx.lineTo(-0.06, -0.15)
    ctx.lineTo(-0.2, -0.2)
    ctx.lineTo(-0.16, -0.1)
    ctx.lineTo(-0.3, -0.08)
    ctx.lineTo(-0.17, -0.02)
    ctx.lineTo(-0.27, 0.05)
    ctx.lineTo(-0.12, 0.06)
    ctx.closePath()
    ctx.fill()
    // Visage.
    ctx.fillStyle = color(SKIN)
    ctx.beginPath()
    ctx.ellipse(0.01, -0.02, 0.135, 0.15, 0, 0, Math.PI * 2)
    ctx.fill()
    // Masque jusqu'au nez.
    ctx.fillStyle = color(MASK)
    ctx.beginPath()
    ctx.moveTo(-0.13, -0.01)
    ctx.quadraticCurveTo(0.03, -0.035, 0.15, -0.005)
    ctx.quadraticCurveTo(0.13, 0.11, 0.02, 0.135)
    ctx.quadraticCurveTo(-0.11, 0.12, -0.13, -0.01)
    ctx.fill()
    if (!tint) {
      // Œil : regard aigu, reflet.
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(0.03, -0.055)
      ctx.quadraticCurveTo(0.09, -0.085, 0.125, -0.06)
      ctx.quadraticCurveTo(0.09, -0.04, 0.03, -0.055)
      ctx.fill()
      ctx.fillStyle = '#1a1d3a'
      ctx.beginPath()
      ctx.arc(0.09, -0.06, 0.019, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0.094, -0.07, 0.008, 0.008)
      // Sourcil.
      ctx.strokeStyle = HAIR
      ctx.lineWidth = 0.014
      ctx.beginPath()
      ctx.moveTo(0.03, -0.085)
      ctx.lineTo(0.12, -0.095)
      ctx.stroke()
    }
    // Bandeau et sa plaque d'acier.
    ctx.fillStyle = color(MASK)
    ctx.beginPath()
    ctx.moveTo(-0.15, -0.1)
    ctx.quadraticCurveTo(0, -0.165, 0.145, -0.12)
    ctx.lineTo(0.14, -0.075)
    ctx.quadraticCurveTo(0, -0.115, -0.15, -0.055)
    ctx.closePath()
    ctx.fill()
    if (!tint) {
      const plate = ctx.createLinearGradient(0, -0.16, 0, -0.08)
      plate.addColorStop(0, '#ffffff')
      plate.addColorStop(0.5, PLATE)
      plate.addColorStop(1, PLATE_DARK)
      ctx.fillStyle = plate
      ctx.beginPath()
      ctx.moveTo(-0.01, -0.143)
      ctx.lineTo(0.12, -0.12)
      ctx.lineTo(0.118, -0.083)
      ctx.lineTo(-0.012, -0.1)
      ctx.closePath()
      ctx.fill()
      // Emblème gravé : une spirale.
      ctx.strokeStyle = '#5c6680'
      ctx.lineWidth = 0.008
      ctx.beginPath()
      for (let step = 0; step <= 18; step += 1) {
        const angle = step * 0.55
        const radius = 0.003 + step * 0.0011
        const x = 0.055 + Math.cos(angle) * radius
        const y = -0.112 + Math.sin(angle) * radius
        if (step === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      // Reflet dans les cheveux.
      ctx.strokeStyle = HAIR_LIGHT
      ctx.lineWidth = 0.012
      ctx.beginPath()
      ctx.moveTo(-0.05, -0.19)
      ctx.lineTo(-0.15, -0.16)
      ctx.stroke()
    }
    ctx.restore()

    // Membres de l'avant.
    limb(ctx, hipX + 0.02, hipY, legFront[0], 0.27, -legFront[1], 0.27, 0.14, color(OUTFIT), color(BANDAGE))
    const hand = limb(ctx, shoulderX + 0.02, shoulderY + 0.03, armFront[0], 0.2, armFront[1], 0.2, 0.1, color(OUTFIT_LIGHT), color(BANDAGE))
    if (!tint) {
      // Kunaï tenu à l'envers dans la main avant.
      ctx.save()
      ctx.translate(hand.x, hand.y)
      ctx.rotate(armFront[0] + armFront[1] + Math.PI / 2)
      ctx.fillStyle = STEEL
      ctx.beginPath()
      ctx.moveTo(0, -0.02)
      ctx.lineTo(0.16, 0)
      ctx.lineTo(0, 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#2b1a14'
      ctx.fillRect(-0.07, -0.012, 0.07, 0.024)
      ctx.restore()
    }
    ctx.restore()
  }
}
