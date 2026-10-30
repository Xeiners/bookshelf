import { FEATHER_SECONDS, GRAVITY, MAGNET_SECONDS, PLATFORM_WIDTH, STAR_POINTS, STOMP_POINTS, WIDE_FACTOR, WIDE_SECONDS, WORLD_WIDTH } from '../../lib/jump/constants'
import { climbed, createJump, outcomeOf, stepJump, type Enemy, type Item, type JumpOutcome, type JumpState, type Platform, type TimedPower } from '../../lib/jump/engine'
import { WORLD_SPAN, blendAt, worldIndexAt, worldOf, type Ambient, type Landmark, type Skin, type World } from '../../lib/jump/worlds'
import type { JumpCharacterId } from '../../lib/jump/characters'
import { paintCharacter } from './characters'
import { playJumpBounce, playJumpBreak, playJumpHit, playJumpOver, playJumpPower, playJumpSpring, playJumpStar, playJumpStomp } from '../../lib/sfx'

/*
 * Page Jump : le rendu (canvas 2D) d'une partie simulée par `lib/jump/engine.ts`, dans le style
 * d'un manga : contours d'encre épais, trames de points, aplats. Aucun flou, aucune ombre portée,
 * aucune particule. Les plateformes et le héros (la lune) sont dessinés une fois dans des images
 * hors écran, puis simplement recopiés à chaque image. Les univers se succèdent à l'infini avec
 * l'altitude (ciel, silhouette à l'horizon, ce qui flotte dans le ciel), en fondu de l'un à l'autre.
 */

const INK = '#140c22'
/** Hauteur dessinée d'une plateforme (un peu plus épaisse que sa zone d'appui), du héros. */
const PLATFORM_DRAWN = 17
const HERO_HEIGHT = 50
/** Images hors écran gardées au plus (plateformes, plans des univers récents, monstres…). */
const SPRITE_LIMIT = 28

const hex = (color: string) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
function mix(from: string, to: string, amount: number): string {
  const a = hex(from)
  const b = hex(to)
  return `rgb(${a.map((value, index) => Math.round(value + (b[index]! - value) * amount)).join(',')})`
}
/** Une teinte assombrie (`amount` < 0) ou éclaircie (> 0). */
function shade(color: string, amount: number): string {
  return amount < 0 ? mix(color, '#000000', -amount) : mix(color, '#ffffff', amount)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Ce qui flotte dans le ciel : positions fixes, rejouées en boucle sur `DECOR_LOOP` unités. */
const DECOR_LOOP = 1400
const DECOR = Array.from({ length: 16 }, (_, index) => ({
  x: (index * 151.3) % WORLD_WIDTH,
  y: (index * 389) % DECOR_LOOP,
  size: 0.7 + ((index * 53) % 10) / 16,
  phase: index * 1.7,
}))

/** Un texte qui monte et s'efface (« +50 »). */
interface Floater {
  text: string
  x: number
  y: number
  age: number
}

export interface BoardOptions {
  seed?: number
  sound: boolean
  reduced: boolean
  skin: Skin
  /** Le personnage joué (la Lune par défaut). */
  character: JumpCharacterId
}

export class JumpBoard {
  state: JumpState
  /** Temps écoulé depuis la fin (s) ; `null` tant que la partie court. */
  overFor: number | null = null
  /** Mises à jour du score et de la hauteur affichés. */
  onChange: ((score: number, height: number) => void) | null = null
  /** Un nouvel univers commence (0, 1, 2…). */
  onWorld: ((index: number) => void) | null = null
  /** Un bonus est pris (ressort, envol, bulle) : l'écran peut dire à quoi il sert. */
  onPower: ((kind: 'spring' | 'rocket' | 'shield' | TimedPower) => void) | null = null
  /** Densité de pixels de l'écran : les images hors écran sont dessinées à cette finesse. */
  pixelRatio = 1
  private floaters: Floater[] = []
  private squashAt = -1
  /** Force de l'écrasement du dernier atterrissage (plus forte sur un ressort). */
  private squashPower = 0.34
  private springAt = new Map<number, number>()
  private lastScore = -1
  private lastHeight = -1
  private world = 0
  private sprites = new Map<string, HTMLCanvasElement>()
  private moon: HTMLImageElement | null = null
  private options: BoardOptions

  constructor(options: BoardOptions) {
    this.options = options
    this.state = createJump(options.seed ?? Math.floor(Math.random() * 2 ** 31))
  }

  get outcome(): JumpOutcome {
    return outcomeOf(this.state)
  }

  /** Le héros : la lune (`assets/moon-soul-eater.svg`), une fois l'image chargée. */
  setMoon(image: HTMLImageElement): void {
    this.moon = image
    for (const key of [...this.sprites.keys()]) if (key.startsWith('moon')) this.sprites.delete(key)
  }

  /** Avance la partie ; `input` de -1 à 1 ; `viewHeight` en unités du monde. */
  update(dt: number, input: number, viewHeight: number): void {
    if (this.overFor !== null) this.overFor += dt
    stepJump(this.state, dt, input, viewHeight)
    if (this.state.over && this.overFor === null) this.overFor = 0
    this.drain()
    for (const floater of this.floaters) floater.age += dt
    this.floaters = this.floaters.filter((floater) => floater.age < 0.9)
    const outcome = outcomeOf(this.state)
    if (outcome.score !== this.lastScore || outcome.height !== this.lastHeight) {
      this.lastScore = outcome.score
      this.lastHeight = outcome.height
      this.onChange?.(outcome.score, outcome.height)
    }
    const world = worldIndexAt(this.state.camera + viewHeight / 2)
    if (world !== this.world) {
      this.world = world
      this.onWorld?.(world)
    }
  }

  /** Les événements de la simulation : sons, textes, écrasements. */
  private drain(): void {
    const sound = this.options.sound
    for (const event of this.state.events) {
      switch (event.type) {
        case 'bounce':
          this.squashAt = this.state.time
          this.squashPower = 0.34
          if (sound) playJumpBounce(climbed(this.state))
          break
        case 'spring':
          this.squashAt = this.state.time
          this.squashPower = 0.46
          for (const item of this.state.items) if (item.kind === 'spring' && Math.abs(item.y - event.y) < 1) this.springAt.set(item.id, this.state.time)
          if (sound) playJumpSpring()
          this.onPower?.('spring')
          break
        case 'break':
          if (sound) playJumpBreak()
          break
        case 'rocket':
        case 'shield':
          if (sound) playJumpPower()
          this.onPower?.(event.type)
          break
        case 'power':
          if (sound) playJumpPower()
          this.onPower?.(event.kind)
          break
        case 'star':
          this.floaters.push({ text: `+${STAR_POINTS}`, x: event.x, y: event.y, age: 0 })
          if (sound) playJumpStar()
          break
        case 'stomp':
          this.floaters.push({ text: `+${STOMP_POINTS}`, x: event.x, y: event.y, age: 0 })
          if (sound) playJumpStomp()
          break
        case 'shieldPop':
          if (sound) playJumpStomp()
          break
        case 'hit':
          if (sound) playJumpHit()
          break
        case 'over':
          if (sound) playJumpOver()
          break
      }
    }
    this.state.events.length = 0
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const scale = width / WORLD_WIDTH
    const camera = this.state.camera
    const viewHeight = height / scale
    const toY = (y: number) => height - (y - camera) * scale
    const time = this.state.time
    const reduced = this.options.reduced
    const skin = this.options.skin

    // L'univers du moment, et le suivant pendant le fondu.
    const middle = camera + viewHeight / 2
    const index = worldIndexAt(middle)
    const blend = blendAt(middle)
    const current = worldOf(skin, index)
    const next = worldOf(skin, index + 1)

    // Ciel.
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, mix(current.sky[0], next.sky[0], blend))
    sky.addColorStop(1, mix(current.sky[1], next.sky[1], blend))
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    // Trame de manga en haut du ciel (une image, recopiée).
    const tone = this.sprite('tone', width, height * 0.45, (layer) => paintScreentone(layer, width, height * 0.45, scale))
    ctx.globalAlpha = 0.9
    ctx.drawImage(tone, 0, 0, width, height * 0.45)
    ctx.globalAlpha = 1

    // Plans du décor, du plus lointain au plus proche ; pendant le fondu, l'univers suivant
    // apparaît par-dessus. Chaque plan est une image dessinée une fois par univers.
    const band = Math.min(height * 0.34, 270)
    for (const [world, alpha, start] of [
      [current, 1, index * WORLD_SPAN],
      [next, blend, (index + 1) * WORLD_SPAN],
    ] as const) {
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha
      const sink = (middle - start) * scale
      // L'astre : il descend très lentement.
      if (world.orb) drawOrb(ctx, world.orb, world.light, width * 0.74, height * 0.2 + Math.max(-30, sink * 0.02), Math.min(width, height) * 0.13)
      // Le lointain (montagnes, ville voilée), puis l'horizon détaillé.
      const far = this.sprite(`far:${world.id}`, width, band * 1.2, (layer) => paintDistance(layer, world, width, band * 1.2))
      ctx.drawImage(far, 0, height - band * 1.55 + Math.max(-20, sink * 0.025), width, band * 1.2)
      this.drawAmbient(ctx, world.ambient, alpha, height, scale, camera, time, reduced)
      const near = this.sprite(`near:${world.id}`, width, band + 4, (layer) => drawLandmark(layer, world.landmark, world.land, world.light, width, band + 4, band))
      ctx.globalAlpha = alpha
      ctx.drawImage(near, 0, height - band - 4 + Math.max(-40, sink * 0.05), width, band + 4)
    }
    ctx.globalAlpha = 1

    // Plateformes, bonus, ennemis : seulement ce qui est à l'écran.
    const visible = (y: number) => y > camera - 80 && y < camera + viewHeight + 80
    for (const platform of this.state.platforms) if (visible(platform.y)) this.drawPlatform(ctx, platform, scale, toY)
    for (const item of this.state.items) if (!item.taken && visible(item.y)) this.drawItem(ctx, item, scale, toY, reduced)
    for (const enemy of this.state.enemies) if (enemy.alive && visible(enemy.y)) this.drawEnemy(ctx, enemy, scale, toY, time, reduced)

    // Le héros, et son double s'il passe d'un bord à l'autre.
    const p = this.state.player
    const px = p.x * scale
    this.drawHero(ctx, px, toY(p.y), scale)
    if (p.x < 26) this.drawHero(ctx, px + width, toY(p.y), scale)
    else if (p.x > WORLD_WIDTH - 26) this.drawHero(ctx, px - width, toY(p.y), scale)

    // Bonus en cours : leur icône et un anneau qui se vide, en bas à gauche.
    const durations: Record<TimedPower, number> = { wide: WIDE_SECONDS, magnet: MAGNET_SECONDS, feather: FEATHER_SECONDS }
    let slot = 0
    for (const kind of ['wide', 'magnet', 'feather'] as const) {
      const left = p.timers[kind]
      if (left <= 0) continue
      const cx = 26 + slot * 40
      const cy = height - 30
      slot += 1
      ctx.beginPath()
      ctx.arc(cx, cy, 16, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(20,12,34,0.72)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + (left / durations[kind]) * Math.PI * 2)
      ctx.strokeStyle = POWER_TINT[kind]
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.stroke()
      drawPowerIcon(ctx, kind, cx, cy + 1.5, 8)
    }

    // Textes qui montent.
    ctx.textAlign = 'center'
    ctx.font = `900 ${Math.round(17 * scale)}px system-ui, sans-serif` // i18n-ignore : police du canvas
    ctx.lineJoin = 'round'
    for (const floater of this.floaters) {
      ctx.globalAlpha = 1 - floater.age / 0.9
      const fy = toY(floater.y) - floater.age * 50 * scale
      ctx.strokeStyle = INK
      ctx.lineWidth = 4
      ctx.strokeText(floater.text, floater.x * scale, fy)
      ctx.fillStyle = '#fff6c8'
      ctx.fillText(floater.text, floater.x * scale, fy)
    }
    ctx.globalAlpha = 1
  }

  /* ---- Images hors écran ------------------------------------------------------------------ */

  private sprite(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const ratio = this.pixelRatio
    const full = `${key}:${Math.round(w * 10)}:${Math.round(h * 10)}:${ratio}`
    let canvas = this.sprites.get(full)
    if (canvas) {
      // Récemment servie : elle passe en fin de file (la plus ancienne part la première).
      this.sprites.delete(full)
      this.sprites.set(full, canvas)
      return canvas
    }
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(w * ratio))
    canvas.height = Math.max(1, Math.ceil(h * ratio))
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    paint(ctx)
    // Mémoire bornée : les images les moins récemment servies (univers passés, ancienne taille) partent.
    while (this.sprites.size >= SPRITE_LIMIT) this.sprites.delete(this.sprites.keys().next().value!)
    this.sprites.set(full, canvas)
    return canvas
  }

  /** Une plateforme : une barre bien ronde, contour d'encre, reflet, trame de points en bas. */
  private platformSprite(color: string, kind: Platform['kind'], scale: number): { image: HTMLCanvasElement; w: number; h: number; pad: number } {
    const w = PLATFORM_WIDTH * scale
    const h = PLATFORM_DRAWN * scale
    const pad = 3
    const image = this.sprite(`platform:${kind}:${color}`, w + pad * 2, h + pad * 2, (ctx) => {
      roundRect(ctx, pad, pad, w, h, h / 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.save()
      ctx.clip()
      // Trame (points du manga) sur la moitié basse.
      ctx.fillStyle = shade(color, -0.32)
      const step = 3.6 * scale
      for (let row = 0, y = pad + h * 0.52; y < pad + h + step; row += 1, y += step) {
        for (let x = pad + (row % 2 ? step / 2 : 0); x < pad + w + step; x += step) {
          ctx.beginPath()
          ctx.arc(x, y, 0.85 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // Reflet en haut.
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      roundRect(ctx, pad + h * 0.45, pad + h * 0.17, w - h * 0.9, h * 0.22, h * 0.11)
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = INK
      ctx.lineWidth = Math.max(2, 2.3 * scale)
      roundRect(ctx, pad, pad, w, h, h / 2)
      ctx.stroke()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (kind === 'moving') {
        // Deux flèches : elle se déplace.
        ctx.lineWidth = Math.max(1.6, 1.8 * scale)
        for (const side of [-1, 1]) {
          const cx = pad + w / 2 + side * w * 0.3
          ctx.beginPath()
          ctx.moveTo(cx - side * 2.5 * scale, pad + h * 0.38)
          ctx.lineTo(cx + side * 1.5 * scale, pad + h * 0.58)
          ctx.lineTo(cx - side * 2.5 * scale, pad + h * 0.78)
          ctx.stroke()
        }
      } else if (kind === 'fragile') {
        // Fissure.
        ctx.lineWidth = Math.max(1.4, 1.6 * scale)
        ctx.beginPath()
        ctx.moveTo(pad + w * 0.46, pad)
        ctx.lineTo(pad + w * 0.54, pad + h * 0.42)
        ctx.lineTo(pad + w * 0.46, pad + h * 0.66)
        ctx.lineTo(pad + w * 0.53, pad + h)
        ctx.stroke()
      }
    })
    return { image, w, h, pad }
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, platform: Platform, scale: number, toY: (y: number) => number): void {
    const skin = this.options.skin
    const color = platform.kind === 'fragile' ? skin.fragile : platform.kind === 'moving' ? skin.moving : skin.platforms[platform.tint % skin.platforms.length]!
    const { image, w, h, pad } = this.platformSprite(color, platform.kind, scale)
    const x = platform.x * scale - w / 2 - pad
    const y = toY(platform.y) - pad
    if (platform.brokeAt === null) {
      // Grand tome : toutes les plateformes s'allongent (l'image est étirée en largeur).
      const stretch = this.state.player.timers.wide > 0 ? WIDE_FACTOR : 1
      ctx.drawImage(image, platform.x * scale - (w * stretch) / 2 - pad, y, w * stretch + pad * 2, h + pad * 2)
      return
    }
    // La plateforme fragile se brise en deux moitiés qui tombent en tournant.
    const age = this.state.time - platform.brokeAt
    if (age > 0.7) return
    const fall = 0.5 * GRAVITY * age * age * scale * 0.6
    ctx.globalAlpha = 1 - age / 0.7
    const half = (w + pad * 2) / 2
    const ratio = image.width / (w + pad * 2)
    for (const side of [0, 1]) {
      ctx.save()
      ctx.translate(x + half * side + half / 2, y + h / 2 + fall)
      ctx.rotate((side ? 1 : -1) * age * 1.8)
      ctx.drawImage(image, half * side * ratio, 0, half * ratio, image.height, -half / 2, -h / 2 - pad, half, h + pad * 2)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  private drawItem(ctx: CanvasRenderingContext2D, item: Item, scale: number, toY: (y: number) => number, reduced: boolean): void {
    const x = item.x * scale
    const time = this.state.time
    const bob = reduced ? 0 : Math.sin(time * 3 + item.id) * 3 * scale
    ctx.lineJoin = 'round'
    if (item.kind === 'spring') {
      // Ressort : détendu un instant quand on vient de rebondir dessus.
      const used = this.springAt.get(item.id)
      const stretch = used !== undefined && time - used < 0.25 ? 1.7 : 1
      const base = toY(item.y) + 2 * scale
      const h = 11 * scale * stretch
      ctx.lineCap = 'round'
      const coil = () => {
        ctx.beginPath()
        ctx.moveTo(x - 6 * scale, base)
        for (let index = 1; index <= 4; index += 1) ctx.lineTo(x + (index % 2 ? 6 : -6) * scale, base - (h * index) / 4)
        ctx.stroke()
      }
      ctx.strokeStyle = INK
      ctx.lineWidth = 4.5 * scale
      coil()
      ctx.strokeStyle = '#e8ecf6'
      ctx.lineWidth = 2.2 * scale
      coil()
      roundRect(ctx, x - 10 * scale, base - h - 5 * scale, 20 * scale, 6 * scale, 3 * scale)
      ctx.fillStyle = '#ff4d6d'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 2
      ctx.stroke()
      return
    }
    const y = toY(item.y) + bob
    if (item.kind === 'star') {
      const r = 10 * scale * (reduced ? 1 : 1 + 0.1 * Math.sin(time * 5 + item.id))
      ctx.beginPath()
      for (let index = 0; index < 8; index += 1) {
        const radius = index % 2 === 0 ? r : r * 0.4
        const angle = (index * Math.PI) / 4 - Math.PI / 2
        ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
      }
      ctx.closePath()
      ctx.fillStyle = '#ffd35c'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.2
      ctx.stroke()
    } else if (item.kind === 'shield') {
      ctx.beginPath()
      ctx.arc(x, y, 13 * scale, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(76,201,240,0.35)'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.4 * scale
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(x - 4.5 * scale, y - 5 * scale, 3.2 * scale, 2 * scale, -0.6, 0, Math.PI * 2)
      ctx.fill()
    } else if (item.kind === 'wide' || item.kind === 'magnet' || item.kind === 'feather') {
      // Bonus à durée : son icône sur un disque clair cerclé d'encre.
      ctx.beginPath()
      ctx.arc(x, y, 15 * scale, 0, Math.PI * 2)
      ctx.fillStyle = '#fff6dc'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.4 * scale
      ctx.stroke()
      drawPowerIcon(ctx, item.kind, x, y + 2 * scale, 9 * scale)
    } else {
      // L'envol : un rouleau de papier à réaction.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-0.25)
      ctx.fillStyle = '#ffb347'
      ctx.beginPath()
      ctx.moveTo(-4.5 * scale, 12 * scale)
      ctx.lineTo(0, (21 + (reduced ? 0 : Math.sin(time * 30) * 3)) * scale)
      ctx.lineTo(4.5 * scale, 12 * scale)
      ctx.fill()
      roundRect(ctx, -7 * scale, -13 * scale, 14 * scale, 26 * scale, 7 * scale)
      ctx.fillStyle = '#fff4dc'
      ctx.fill()
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.2 * scale
      ctx.stroke()
      ctx.fillStyle = '#ff4d6d'
      ctx.fillRect(-6 * scale, -2.5 * scale, 12 * scale, 5 * scale)
      ctx.restore()
    }
  }

  /**
   * Le héros : le personnage choisi, dessiné une fois (un peu de marge au-dessus pour les
   * cheveux, les oreilles, les bois), ou la Lune.
   */
  private moonSprite(scale: number): { image: HTMLCanvasElement; w: number; h: number } {
    const character = this.options.character
    if (character !== 'moon') {
      const size = HERO_HEIGHT * scale
      const box = size * 1.2
      const image = this.sprite(`hero:${character}`, box, box, (ctx) => {
        ctx.translate(size * 0.1, size * 0.2)
        paintCharacter(ctx, character, size)
      })
      return { image, w: box, h: box }
    }
    const h = HERO_HEIGHT * scale
    const moon = this.moon
    const w = moon ? (h * moon.naturalWidth) / Math.max(1, moon.naturalHeight) : h * 0.9
    const image = this.sprite(moon ? 'moon' : 'moon-fallback', w, h, (ctx) => {
      if (moon) {
        ctx.drawImage(moon, 0, 0, w, h)
        return
      }
      ctx.fillStyle = '#ffe14d'
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(w * 0.5, h * 0.5, h * 0.45, -Math.PI * 0.55, Math.PI * 0.55)
      ctx.arc(w * 0.32, h * 0.5, h * 0.38, Math.PI * 0.45, -Math.PI * 0.45, true)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    })
    return { image, w, h }
  }

  private drawHero(ctx: CanvasRenderingContext2D, x: number, feet: number, scale: number): void {
    const p = this.state.player
    const time = this.state.time
    // À l'atterrissage, la lune s'écrase puis rebondit comme une gelée (ressort amorti) ; en
    // montée, elle s'étire un peu.
    const sinceBounce = time - this.squashAt
    const squash = sinceBounce >= 0 && sinceBounce < 0.5 ? 1 - this.squashPower * Math.exp(-sinceBounce / 0.09) * Math.cos(sinceBounce * 34) : 1
    const stretch = sinceBounce >= 0 && sinceBounce < 0.5 ? 1 : 1 + Math.max(-0.06, Math.min(0.08, p.vy / 8000))
    const sy = squash * stretch
    const sx = Math.max(0.86, 1 + (1 - sy) * 0.85)
    const { image, w, h } = this.moonSprite(scale)

    ctx.save()
    ctx.translate(x, feet)
    // Flamme de l'envol, sous la lune.
    if (p.rocket > 0) {
      const flicker = 0.85 + Math.sin(time * 40) * 0.15
      ctx.fillStyle = '#ff8a1f'
      ctx.beginPath()
      ctx.moveTo(-10 * scale, -4 * scale)
      ctx.lineTo(0, 28 * scale * flicker)
      ctx.lineTo(10 * scale, -4 * scale)
      ctx.fill()
      ctx.fillStyle = '#fff1a8'
      ctx.beginPath()
      ctx.moveTo(-5 * scale, -4 * scale)
      ctx.lineTo(0, 16 * scale * flicker)
      ctx.lineTo(5 * scale, -4 * scale)
      ctx.fill()
    }
    if (p.dead) ctx.rotate(Math.min(Math.PI, time * 6) * 0.5)
    // La lune penche un peu dans le sens de la course.
    else ctx.rotate(Math.max(-0.25, Math.min(0.25, p.vx / 1600)))
    ctx.scale(sx * -p.facing, sy)
    // Plume : deux petites ailes derrière le héros, qui battent.
    if (p.timers.feather > 0) {
      const flap = Math.sin(time * 14) * 0.35
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(side * w * 0.3, -h * 0.55)
        ctx.rotate(side * (0.5 + flap))
        ctx.beginPath()
        ctx.ellipse(side * w * 0.22, 0, w * 0.26, h * 0.12, 0, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.strokeStyle = INK
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()
      }
    }
    ctx.drawImage(image, -w / 2, -h, w, h)
    ctx.restore()

    // La bulle protectrice.
    if (p.shield) {
      ctx.beginPath()
      ctx.arc(x, feet - h / 2, h * 0.72, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(76,201,240,0.18)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(76,201,240,0.95)'
      ctx.lineWidth = 2.5 * scale
      ctx.stroke()
    }
  }

  /** Un monstre (image dessinée une fois) qui flotte, se dandine et regarde où il va. */
  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, scale: number, toY: (y: number) => number, time: number, reduced: boolean): void {
    const kind = this.options.skin.enemy
    const size = 58 * scale
    const image = this.sprite(`enemy:${kind}`, size, size, (layer) => paintMonster(layer, kind, size))
    const x = enemy.x * scale
    const y = toY(enemy.y) + (reduced ? 0 : Math.sin(time * 4 + enemy.phase) * 4 * scale)
    // Il va à droite quand son va-et-vient l'y emmène : il se tourne dans ce sens.
    const facing = Math.cos(time * 1.6 + enemy.phase) >= 0 ? 1 : -1
    const wobble = reduced ? 1 : 1 + Math.sin(time * 7 + enemy.phase) * 0.05
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(reduced ? 0 : Math.sin(time * 3 + enemy.phase) * 0.08)
    ctx.scale(facing * (2 - wobble), wobble)
    ctx.drawImage(image, -size / 2, -size / 2, size, size)
    ctx.restore()
  }

  /* ---- Le ciel ------------------------------------------------------------------------------ */

  private drawAmbient(ctx: CanvasRenderingContext2D, kind: Ambient, alpha: number, height: number, scale: number, camera: number, time: number, reduced: boolean): void {
    if (alpha <= 0) return
    const viewHeight = height / scale
    const drift = reduced ? 0 : time
    for (const decor of DECOR) {
      const fallBy = kind === 'petals' ? drift * 22 : 0
      const y = (((decor.y - camera * 0.3 - fallBy) % DECOR_LOOP) + DECOR_LOOP) % DECOR_LOOP
      if (y > viewHeight + 40) continue
      const sx = ((decor.x + (kind === 'clouds' ? drift * 6 : kind === 'bats' ? drift * 30 : 0)) % WORLD_WIDTH) * scale
      const sy = height - y * scale
      const size = decor.size * scale
      ctx.globalAlpha = alpha
      switch (kind) {
        case 'clouds': {
          // Nuage de manga : une image (contour d'encre, ombre en trame), recopiée.
          const w = 74 * scale
          const h = 34 * scale
          const cloud = this.sprite('cloud', w, h, (layer) => paintCloud(layer, w, h))
          ctx.globalAlpha = alpha * 0.85
          ctx.drawImage(cloud, sx - (w * decor.size) / 2, sy - (h * decor.size) / 2, w * decor.size, h * decor.size)
          break
        }
        case 'petals':
          ctx.fillStyle = '#ffd1e6'
          ctx.beginPath()
          ctx.ellipse(sx, sy, 4.5 * size, 2.6 * size, decor.phase + drift * 1.5, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'stars':
          ctx.globalAlpha = alpha * (0.45 + 0.55 * Math.abs(Math.sin(drift * 1.5 + decor.phase)))
          ctx.fillStyle = '#fff6d8'
          ctx.fillRect(sx, sy, 2.4 * size, 2.4 * size)
          break
        case 'lanterns':
          ctx.globalAlpha = alpha * 0.25
          ctx.fillStyle = '#ffb347'
          ctx.beginPath()
          ctx.arc(sx, sy, 11 * size, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = alpha
          ctx.fillStyle = '#ff6b4a'
          roundRect(ctx, sx - 4.5 * size, sy - 6 * size, 9 * size, 12 * size, 4 * size)
          ctx.fill()
          ctx.fillStyle = INK
          ctx.fillRect(sx - 3 * size, sy - 7.5 * size, 6 * size, 2 * size)
          break
        case 'bats': {
          const flap = reduced ? 1 : 0.4 + Math.abs(Math.sin(drift * 9 + decor.phase)) * 0.6
          ctx.fillStyle = '#0b0612'
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.quadraticCurveTo(sx - 6 * size, sy - 7 * size * flap, sx - 13 * size, sy - 3 * size * flap)
          ctx.quadraticCurveTo(sx - 8 * size, sy + size, sx, sy + 3 * size)
          ctx.quadraticCurveTo(sx + 8 * size, sy + size, sx + 13 * size, sy - 3 * size * flap)
          ctx.quadraticCurveTo(sx + 6 * size, sy - 7 * size * flap, sx, sy)
          ctx.fill()
          break
        }
      }
    }
    ctx.globalAlpha = 1
  }
}

/** La silhouette d'un univers, posée sur `baseline`, sur `band` pixels de haut. */
function drawLandmark(ctx: CanvasRenderingContext2D, kind: Landmark, land: string, light: string, width: number, baseline: number, band: number): void {
  const top = baseline - band
  ctx.fillStyle = land
  // Un sol commun : une colline basse sur toute la largeur.
  ctx.beginPath()
  ctx.moveTo(0, baseline)
  ctx.lineTo(0, baseline - band * 0.18)
  ctx.quadraticCurveTo(width * 0.3, baseline - band * 0.3, width * 0.55, baseline - band * 0.2)
  ctx.quadraticCurveTo(width * 0.8, baseline - band * 0.1, width, baseline - band * 0.22)
  ctx.lineTo(width, baseline)
  ctx.closePath()
  ctx.fill()
  // Liseré de lumière sur la crête, et quelques touffes d'herbe en contre-jour.
  ctx.beginPath()
  ctx.moveTo(0, baseline - band * 0.18)
  ctx.quadraticCurveTo(width * 0.3, baseline - band * 0.3, width * 0.55, baseline - band * 0.2)
  ctx.quadraticCurveTo(width * 0.8, baseline - band * 0.1, width, baseline - band * 0.22)
  ctx.strokeStyle = light
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.strokeStyle = land
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let index = 0; index < 18; index += 1) {
    const x = ((index * 61) % 100) / 100 * width
    const y = baseline - band * (0.2 + 0.08 * Math.sin((x / width) * Math.PI * 1.3))
    ctx.moveTo(x, y + 2)
    ctx.lineTo(x - 3, y - 6)
    ctx.moveTo(x, y + 2)
    ctx.lineTo(x + 2, y - 8)
  }
  ctx.stroke()

  switch (kind) {
    case 'rooftops': {
      // Toits japonais aux bords relevés, fenêtres éclairées.
      for (let index = 0; index < 5; index += 1) {
        const w = width / 5
        const x = index * w + w * 0.08
        const h = band * (0.35 + ((index * 37) % 5) * 0.07)
        const y = baseline - h
        ctx.fillStyle = land
        ctx.fillRect(x + w * 0.1, y + h * 0.25, w * 0.64, h)
        ctx.beginPath()
        ctx.moveTo(x - w * 0.04, y + h * 0.3)
        ctx.quadraticCurveTo(x + w * 0.2, y + h * 0.18, x + w * 0.42, y)
        ctx.quadraticCurveTo(x + w * 0.64, y + h * 0.18, x + w * 0.88, y + h * 0.3)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = light
        ctx.fillRect(x + w * 0.3, y + h * 0.45, w * 0.1, h * 0.12)
        if (index % 2) ctx.fillRect(x + w * 0.5, y + h * 0.45, w * 0.1, h * 0.12)
      }
      break
    }
    case 'sakura': {
      for (const [cx, size] of [
        [0.18, 1],
        [0.62, 1.25],
        [0.9, 0.8],
      ] as const) {
        const x = width * cx
        const s = band * 0.3 * size
        ctx.strokeStyle = land
        ctx.lineWidth = s * 0.14
        ctx.beginPath()
        ctx.moveTo(x, baseline - band * 0.15)
        ctx.lineTo(x, baseline - band * 0.15 - s)
        ctx.stroke()
        ctx.fillStyle = light
        for (const [dx, dy, r] of [
          [0, -1.25, 0.55],
          [-0.45, -1, 0.42],
          [0.45, -1, 0.42],
        ] as const) {
          ctx.beginPath()
          ctx.arc(x + dx * s, baseline - band * 0.15 + dy * s, r * s, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    case 'fuji': {
      const peak = width * 0.5
      ctx.fillStyle = land
      ctx.beginPath()
      ctx.moveTo(-width * 0.1, baseline)
      ctx.lineTo(peak - width * 0.09, top + band * 0.05)
      ctx.lineTo(peak + width * 0.09, top + band * 0.05)
      ctx.lineTo(width * 1.1, baseline)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.moveTo(peak - width * 0.09, top + band * 0.05)
      ctx.lineTo(peak + width * 0.09, top + band * 0.05)
      ctx.lineTo(peak + width * 0.2, top + band * 0.3)
      for (let index = 0; index < 5; index += 1) ctx.lineTo(peak + width * (0.14 - index * 0.07), top + band * (index % 2 ? 0.36 : 0.26))
      ctx.lineTo(peak - width * 0.2, top + band * 0.3)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'city': {
      for (let index = 0; index < 9; index += 1) {
        const w = width / 9
        const h = band * (0.35 + ((index * 53) % 7) * 0.09)
        const x = index * w
        ctx.fillStyle = land
        ctx.fillRect(x + 1, baseline - h, w - 2, h)
        ctx.fillStyle = light
        for (let row = 0; row < 6; row += 1) {
          for (let col = 0; col < 2; col += 1) {
            if ((index * 7 + row * 3 + col) % 4 === 0) continue
            ctx.fillRect(x + w * (0.22 + col * 0.36), baseline - h + 8 + row * (h / 7), w * 0.2, 3)
          }
        }
      }
      break
    }
    case 'pagoda': {
      const cx = width * 0.5
      for (let tier = 0; tier < 4; tier += 1) {
        const y = baseline - band * 0.15 - tier * band * 0.19
        const w = width * (0.3 - tier * 0.05)
        ctx.fillStyle = land
        ctx.fillRect(cx - w * 0.32, y - band * 0.16, w * 0.64, band * 0.16)
        ctx.beginPath()
        ctx.moveTo(cx - w * 0.6, y - band * 0.13)
        ctx.quadraticCurveTo(cx - w * 0.2, y - band * 0.16, cx, y - band * 0.25)
        ctx.quadraticCurveTo(cx + w * 0.2, y - band * 0.16, cx + w * 0.6, y - band * 0.13)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = light
        ctx.fillRect(cx - w * 0.06, y - band * 0.11, w * 0.12, band * 0.06)
      }
      ctx.fillStyle = land
      ctx.fillRect(cx - 1.5, top - band * 0.05, 3, band * 0.2)
      break
    }
    case 'waves': {
      ctx.fillStyle = land
      ctx.beginPath()
      ctx.moveTo(0, baseline)
      for (let index = 0; index <= 4; index += 1) {
        const x = (index / 4) * width
        const crest = baseline - band * (0.35 + (index % 2) * 0.25)
        ctx.quadraticCurveTo(x - width * 0.12, crest, x, baseline - band * 0.2)
      }
      ctx.lineTo(width, baseline)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = light
      for (let index = 0; index < 8; index += 1) {
        ctx.beginPath()
        ctx.arc((index / 8) * width + width / 16, baseline - band * (0.38 + (index % 3) * 0.08), band * 0.025, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'planets': {
      const cx = width * 0.68
      const cy = top + band * 0.45
      const r = band * 0.32
      ctx.fillStyle = land
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = light
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(cx, cy, r * 1.6, r * 0.38, -0.3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.arc(width * 0.2, top + band * 0.25, band * 0.06, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'pumpkins': {
      for (let index = 0; index < 4; index += 1) {
        const cx = width * (0.14 + index * 0.25)
        const r = band * (0.12 + (index % 2) * 0.04)
        const cy = baseline - band * 0.18 - r * 0.7
        ctx.fillStyle = land
        for (const dx of [-0.45, 0, 0.45]) {
          ctx.beginPath()
          ctx.ellipse(cx + dx * r, cy, r * 0.62, r * 0.8, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillRect(cx - r * 0.08, cy - r * 1.05, r * 0.16, r * 0.3)
        // Visage qui luit.
        ctx.fillStyle = light
        for (const side of [-1, 1]) {
          ctx.beginPath()
          ctx.moveTo(cx + side * r * 0.35, cy - r * 0.3)
          ctx.lineTo(cx + side * r * 0.15, cy - r * 0.05)
          ctx.lineTo(cx + side * r * 0.5, cy - r * 0.05)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.moveTo(cx - r * 0.45, cy + r * 0.15)
        ctx.lineTo(cx, cy + r * 0.45)
        ctx.lineTo(cx + r * 0.45, cy + r * 0.15)
        ctx.lineTo(cx, cy + r * 0.28)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'graves': {
      ctx.fillStyle = land
      for (let index = 0; index < 6; index += 1) {
        const x = width * (0.06 + index * 0.16)
        const h = band * (0.22 + (index % 3) * 0.06)
        if (index % 3 === 1) {
          ctx.fillRect(x + band * 0.045, baseline - band * 0.15 - h, band * 0.035, h)
          ctx.fillRect(x, baseline - band * 0.15 - h * 0.75, band * 0.125, band * 0.035)
        } else {
          roundRect(ctx, x, baseline - band * 0.15 - h, band * 0.13, h + band * 0.05, band * 0.06)
          ctx.fill()
        }
      }
      // Un arbre mort.
      ctx.strokeStyle = land
      ctx.lineCap = 'round'
      ctx.lineWidth = band * 0.04
      const tx = width * 0.86
      ctx.beginPath()
      ctx.moveTo(tx, baseline - band * 0.2)
      ctx.lineTo(tx, top + band * 0.15)
      ctx.moveTo(tx, top + band * 0.45)
      ctx.lineTo(tx - band * 0.18, top + band * 0.22)
      ctx.moveTo(tx, top + band * 0.35)
      ctx.lineTo(tx + band * 0.14, top + band * 0.12)
      ctx.stroke()
      break
    }
    case 'castle': {
      const cx = width * 0.5
      ctx.fillStyle = land
      ctx.fillRect(cx - width * 0.2, baseline - band * 0.55, width * 0.4, band * 0.55)
      for (const [dx, h] of [
        [-0.2, 0.85],
        [0, 1],
        [0.2, 0.8],
      ] as const) {
        const x = cx + dx * width
        const w = width * 0.07
        ctx.fillRect(x - w / 2, baseline - band * h * 0.85, w, band * h * 0.85)
        ctx.beginPath()
        ctx.moveTo(x - w * 0.7, baseline - band * h * 0.85)
        ctx.lineTo(x, baseline - band * h * 1.05)
        ctx.lineTo(x + w * 0.7, baseline - band * h * 0.85)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = light
      for (const dx of [-0.2, 0, 0.2]) ctx.fillRect(cx + dx * width - 2, baseline - band * 0.6, 4, 7)
      break
    }
  }
}


/** Couleur de chaque bonus à durée (anneau du compteur, halo). */
const POWER_TINT: Record<TimedPower, string> = { wide: '#7bd34a', magnet: '#ff4d6d', feather: '#bfe6ff' }

/** L'icône d'un bonus à durée, centrée en (x, y), de rayon ≈ `s`. */
function drawPowerIcon(ctx: CanvasRenderingContext2D, kind: TimedPower, x: number, y: number, s: number): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(1.6, s * 0.16)
  if (kind === 'wide') {
    // Grand tome : une plateforme et deux flèches qui l'écartent.
    roundRect(ctx, x - s, y - s * 0.28, s * 2, s * 0.56, s * 0.28)
    ctx.fillStyle = POWER_TINT.wide
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    for (const side of [-1, 1]) {
      ctx.moveTo(x + side * s * 0.25, y - s * 0.75)
      ctx.lineTo(x + side * s * 0.95, y - s * 0.75)
      ctx.moveTo(x + side * s * 0.7, y - s * 1)
      ctx.lineTo(x + side * s * 0.95, y - s * 0.75)
      ctx.lineTo(x + side * s * 0.7, y - s * 0.5)
    }
    ctx.stroke()
  } else if (kind === 'magnet') {
    // Aimant en U, pôles blancs.
    ctx.beginPath()
    ctx.arc(x, y - s * 0.1, s * 0.62, Math.PI, 0, true)
    ctx.lineWidth = s * 0.62
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.lineWidth = s * 0.4
    ctx.strokeStyle = POWER_TINT.magnet
    ctx.stroke()
    ctx.lineCap = 'butt'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.62, y - s * 0.12)
      ctx.lineTo(x + side * s * 0.62, y - s * 0.75)
      ctx.lineWidth = s * 0.62
      ctx.strokeStyle = INK
      ctx.stroke()
      ctx.lineWidth = s * 0.4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }
    ctx.lineCap = 'round'
  } else {
    // Plume : une palme blanche, sa tige d'encre.
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.6)
    ctx.beginPath()
    ctx.moveTo(0, -s * 1.05)
    ctx.quadraticCurveTo(s * 0.7, -s * 0.2, 0, s * 0.85)
    ctx.quadraticCurveTo(-s * 0.7, -s * 0.2, 0, -s * 1.05)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -s * 0.8)
    ctx.lineTo(0, s * 1.15)
    ctx.lineWidth = Math.max(1.2, s * 0.12)
    ctx.stroke()
    ctx.restore()
  }
}

/* ---- Le décor lointain -------------------------------------------------------------------- */

/** Trame de manga : des points d'encre très légers, plus serrés en haut du ciel. */
function paintScreentone(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number): void {
  const step = 7 * scale
  for (let row = 0, y = step / 2; y < height; row += 1, y += step) {
    const fade = 1 - y / height
    const radius = 1.25 * scale * fade
    if (radius < 0.25) break
    ctx.fillStyle = `rgba(20,12,34,${(0.12 * fade).toFixed(3)})`
    for (let x = row % 2 ? step / 2 : 0; x < width + step; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * Le lointain d'un univers : deux crêtes voilées par la brume (couleur entre la silhouette et le
 * ciel), un liseré de lumière sur leurs arêtes, et quelques détails selon l'univers.
 */
function paintDistance(ctx: CanvasRenderingContext2D, world: World, width: number, height: number): void {
  const haze = mix(world.land, world.sky[1], 0.62)
  const mid = mix(world.land, world.sky[1], 0.42)
  const urban = world.landmark === 'city'
  for (const [color, top, peaks, seed] of [
    [haze, 0.18, 7, 3],
    [mid, 0.42, 5, 11],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, height)
    if (urban) {
      // Ville voilée : des tours à toits plats, une antenne parfois.
      const count = peaks * 2
      for (let index = 0; index < count; index += 1) {
        const x = (index / count) * width
        const h = height * (top + ((index * seed) % 7) * 0.06)
        ctx.lineTo(x, height)
        ctx.lineTo(x, h)
        ctx.lineTo(x + width / count - 2, h)
        ctx.lineTo(x + width / count - 2, height)
      }
    } else {
      // Montagnes : des pics aux pentes irrégulières.
      ctx.lineTo(0, height * (top + 0.25))
      for (let index = 0; index <= peaks; index += 1) {
        const x = (index / peaks) * width
        const peak = height * (top + ((index * seed) % 5) * 0.06)
        ctx.lineTo(x - width / peaks / 2, peak + height * 0.16)
        ctx.lineTo(x - width / peaks / 4, peak + height * 0.05)
        ctx.lineTo(x, peak)
      }
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fill()
    // Liseré de lumière sur les arêtes.
    ctx.strokeStyle = world.light
    ctx.globalAlpha = 0.22
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // Quelques fenêtres ou lanternes au loin.
  ctx.fillStyle = world.light
  ctx.globalAlpha = 0.5
  for (let index = 0; index < 14; index += 1) {
    const x = ((index * 97) % 100) / 100 * width
    const y = height * (0.62 + ((index * 41) % 30) / 100)
    ctx.fillRect(x, y, 2, 2)
  }
  ctx.globalAlpha = 1
}

/** Le soleil ou la lune de l'univers : un disque, des anneaux de lumière et, pour le soleil, des rayons. */
function drawOrb(ctx: CanvasRenderingContext2D, kind: 'sun' | 'moon', light: string, x: number, y: number, radius: number): void {
  const base = ctx.globalAlpha
  ctx.fillStyle = light
  for (const [scale, alpha] of [
    [2.1, 0.08],
    [1.55, 0.14],
  ] as const) {
    ctx.globalAlpha = base * alpha
    ctx.beginPath()
    ctx.arc(x, y, radius * scale, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = base
  if (kind === 'sun') {
    ctx.strokeStyle = light
    ctx.lineWidth = 2
    ctx.globalAlpha = base * 0.35
    ctx.beginPath()
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2
      ctx.moveTo(x + Math.cos(angle) * radius * 1.25, y + Math.sin(angle) * radius * 1.25)
      ctx.lineTo(x + Math.cos(angle) * radius * (index % 2 ? 1.6 : 1.85), y + Math.sin(angle) * radius * (index % 2 ? 1.6 : 1.85))
    }
    ctx.stroke()
    ctx.globalAlpha = base
  }
  ctx.fillStyle = light
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  if (kind === 'moon') {
    // Cratères.
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    for (const [dx, dy, r] of [
      [-0.3, -0.2, 0.22],
      [0.25, 0.25, 0.16],
      [0.3, -0.35, 0.1],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x + dx * radius, y + dy * radius, r * radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Un nuage de manga : rond, blanc, contour d'encre léger. */
function paintCloud(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const puffs = [
    [0.25, 0.62, 0.22],
    [0.45, 0.42, 0.3],
    [0.68, 0.5, 0.24],
    [0.82, 0.66, 0.16],
  ] as const
  const draw = () => {
    ctx.beginPath()
    for (const [x, y, r] of puffs) {
      ctx.moveTo(w * x + h * r * 1.4, h * y)
      ctx.arc(w * x, h * y, h * r * 1.4, 0, Math.PI * 2)
    }
    ctx.rect(w * 0.22, h * 0.6, w * 0.6, h * 0.3)
  }
  ctx.strokeStyle = 'rgba(20,12,34,0.45)'
  ctx.lineWidth = 3
  draw()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  draw()
  ctx.fill()
  // Ombre de trame sous le nuage.
  ctx.fillStyle = 'rgba(120,140,190,0.25)'
  ctx.fillRect(w * 0.22, h * 0.78, w * 0.6, h * 0.12)
}

/* ---- Les monstres ------------------------------------------------------------------------- */

/**
 * Un monstre, dessiné une fois : à Halloween, un spectre encapuchonné (cape en lambeaux, yeux
 * verts qui luisent, gueule dentée, griffes) ; sinon un oni rouge (cornes, sourcils froncés, crocs).
 * Le cadre fait `size` × `size` ; le centre du corps est au milieu.
 */
function paintMonster(ctx: CanvasRenderingContext2D, kind: 'oni' | 'ghost', size: number): void {
  const c = size / 2
  const r = size * 0.3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(2, size * 0.035)

  if (kind === 'ghost') {
    // Halo verdâtre (anneaux pleins, aucun flou).
    for (const [scale, alpha] of [
      [1.55, 0.1],
      [1.3, 0.14],
    ] as const) {
      ctx.fillStyle = `rgba(160,255,120,${alpha})`
      ctx.beginPath()
      ctx.arc(c, c, r * scale, 0, Math.PI * 2)
      ctx.fill()
    }
    // Bras griffus, de part et d'autre.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#2b1640'
      ctx.beginPath()
      ctx.moveTo(c + side * r * 0.7, c - r * 0.1)
      ctx.quadraticCurveTo(c + side * r * 1.45, c - r * 0.2, c + side * r * 1.55, c + r * 0.35)
      ctx.lineTo(c + side * r * 1.25, c + r * 0.3)
      ctx.lineTo(c + side * r * 1.35, c + r * 0.55)
      ctx.lineTo(c + side * r * 1.05, c + r * 0.35)
      ctx.quadraticCurveTo(c + side * r * 0.9, c + r * 0.2, c + side * r * 0.65, c + r * 0.25)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    // La cape : capuche en pointe, bas en lambeaux.
    ctx.beginPath()
    ctx.moveTo(c, c - r * 1.45)
    ctx.quadraticCurveTo(c + r * 1.05, c - r * 1.1, c + r * 0.95, c + r * 0.2)
    const rags = 6
    for (let index = 0; index <= rags; index += 1) {
      const x = c + r * 0.95 - (1.9 * r * index) / rags
      ctx.lineTo(x + r * 0.08, c + r * (index % 2 ? 0.95 : 1.35))
    }
    ctx.quadraticCurveTo(c - r * 1.05, c - r * 1.1, c, c - r * 1.45)
    ctx.closePath()
    const cloak = ctx.createLinearGradient(c, c - r * 1.4, c, c + r * 1.3)
    cloak.addColorStop(0, '#4a2a6a')
    cloak.addColorStop(1, '#1c0c2c')
    ctx.fillStyle = cloak
    ctx.fill()
    ctx.stroke()
    // Le creux de la capuche : le visage dans l'ombre.
    ctx.fillStyle = '#0a0410'
    ctx.beginPath()
    ctx.ellipse(c, c - r * 0.35, r * 0.62, r * 0.66, 0, 0, Math.PI * 2)
    ctx.fill()
    // Yeux qui luisent.
    for (const side of [-1, 1]) {
      ctx.fillStyle = 'rgba(198,255,74,0.35)'
      ctx.beginPath()
      ctx.arc(c + side * r * 0.26, c - r * 0.48, r * 0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#c6ff4a'
      ctx.beginPath()
      ctx.moveTo(c + side * r * 0.1, c - r * 0.55)
      ctx.lineTo(c + side * r * 0.42, c - r * 0.6)
      ctx.lineTo(c + side * r * 0.3, c - r * 0.4)
      ctx.closePath()
      ctx.fill()
    }
    // Gueule dentée.
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(c - r * 0.32, c - r * 0.12)
    for (let index = 0; index <= 6; index += 1) ctx.lineTo(c - r * 0.32 + (r * 0.64 * index) / 6, c - r * (index % 2 ? -0.08 : 0.12))
    ctx.lineTo(c + r * 0.26, c + r * 0.06)
    for (let index = 0; index <= 5; index += 1) ctx.lineTo(c + r * 0.26 - (r * 0.52 * index) / 5, c + r * (index % 2 ? -0.06 : 0.08))
    ctx.closePath()
    ctx.fill()
    return
  }

  // Oni : corps rond et rouge, ventre plus clair, cornes, sourcils, crocs.
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#fff1d6'
    ctx.beginPath()
    ctx.moveTo(c + side * r * 0.35, c - r * 0.8)
    ctx.quadraticCurveTo(c + side * r * 0.75, c - r * 1.35, c + side * r * 0.55, c - r * 1.6)
    ctx.quadraticCurveTo(c + side * r * 0.95, c - r * 1.2, c + side * r * 0.75, c - r * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#e23b4a'
  ctx.beginPath()
  ctx.ellipse(c, c, r * 1.05, r * 0.98, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ff7a84'
  ctx.beginPath()
  ctx.ellipse(c, c + r * 0.4, r * 0.55, r * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  // Trame d'ombre sur le côté.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(c, c, r * 1.05, r * 0.98, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(20,12,34,0.22)'
  for (let y = c - r; y < c + r; y += size * 0.05) {
    for (let x = c + r * 0.35; x < c + r * 1.1; x += size * 0.05) {
      ctx.beginPath()
      ctx.arc(x, y, size * 0.008, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  // Yeux furieux.
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(c + side * r * 0.4, c - r * 0.2, r * 0.25, r * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(c + side * r * 0.34, c - r * 0.15, r * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = Math.max(2.5, size * 0.05)
    ctx.beginPath()
    ctx.moveTo(c + side * r * 0.12, c - r * 0.42)
    ctx.lineTo(c + side * r * 0.68, c - r * 0.55)
    ctx.stroke()
    ctx.lineWidth = Math.max(2, size * 0.035)
  }
  // Gueule et crocs.
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.ellipse(c, c + r * 0.32, r * 0.4, r * 0.18, 0, 0, Math.PI)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(c + side * r * 0.3, c + r * 0.3)
    ctx.lineTo(c + side * r * 0.2, c + r * 0.52)
    ctx.lineTo(c + side * r * 0.1, c + r * 0.3)
    ctx.closePath()
    ctx.fill()
  }
}
