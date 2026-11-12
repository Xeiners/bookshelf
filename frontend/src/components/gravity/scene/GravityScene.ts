import { MINI_SCALE, PLAYER_H, PLAYER_W, TICK, WORLD_HEIGHT, MOON_SECONDS } from '../../../lib/gravity/constants'
import { respawnRun, restartRun, sizeOf, startRun, stepRun, type Checkpoint, type GravityEvent, type GravityInput, type GravityRun, type GravityWorld } from '../../../lib/gravity/engine'
import type { SolveReport } from '../../../lib/gravity/solver'
import { themeOf, type GravityTheme } from '../../../lib/gravity/themes'
import { Backdrop } from './backdrop'
import { Ninja, type NinjaPose } from './ninja'
import { GATE_COLORS, KEKKAI_COLOR, SPRING_COLOR, WARP_COLOR, WorldPainter } from './world'

/*
 * La scène de Gravity Ninja : la simulation (pas fixe) et son rendu (à chaque image), interpolés
 * pour rester fluides à 60, 90 ou 120 Hz. Elle transforme les événements du moteur en effets :
 * images rémanentes à l'inversion, poussière à l'atterrissage, fumée quand le ninja disparaît (et
 * quand il réapparaît), étincelles des bonus, tremblement à la chute.
 */

/** Largeur minimale visible (unités) : sur un écran étroit, le couloir rapetisse plutôt que de cacher la suite. */
const MIN_VIEW_WIDTH = 20
/** Durée de la bascule du ninja à l'inversion (s). */
const FLIP_TURN = 0.2
/** Taille du ninja dessiné, par rapport à sa boîte de collision ; hauteur du dessin dans son repère. */
const DRAW_SCALE = 1.3
const FIGURE_HEIGHT = 1.22

interface Effect {
  kind: 'dust' | 'smoke' | 'spark' | 'ring' | 'leaf' | 'log'
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  spin: number
}

interface Ghost {
  x: number
  y: number
  /** 1 : taille normale ; moins : mini-ninja. */
  scale: number
  scaleY: number
  age: number
}

export interface Layout {
  width: number
  height: number
  unit: number
  offsetY: number
}

export function layoutFor(width: number, height: number): Layout {
  const unit = Math.min(height / (WORLD_HEIGHT + 0.6), width / MIN_VIEW_WIDTH)
  return { width, height, unit, offsetY: (height - WORLD_HEIGHT * unit) / 2 }
}

export class GravityScene {
  run: GravityRun
  readonly theme: GravityTheme
  private backdrop: Backdrop
  private painter: WorldPainter
  private ninja = new Ninja()
  private prev: { x: number; y: number; cameraX: number }
  private effects: Effect[] = []
  private ghosts: Ghost[] = []
  private ghostClock = 0
  private squash = 0
  private shake = 0
  private clock = 0
  /** Après une téléportation, la caméra rattrape le ninja en glissant (unités de retard, vers 0). */
  private glide = 0
  /** Le ninja a disparu (fumée) : il n'est plus dessiné jusqu'à sa réapparition. */
  private vanished = false

  readonly world: GravityWorld

  constructor(world: GravityWorld) {
    this.world = world
    this.theme = themeOf(world.level.theme)
    this.backdrop = new Backdrop(this.theme)
    this.painter = new WorldPainter(this.theme)
    this.run = startRun(world)
    this.prev = { x: this.run.x, y: this.run.y, cameraX: this.run.cameraX }
  }

  /** Un pas de simulation ; renvoie ses événements (sons, interface). */
  step(input: GravityInput): GravityEvent[] {
    this.prev = { x: this.run.x, y: this.run.y, cameraX: this.run.cameraX }
    stepRun(this.world, this.run, this.solution ? this.solutionInput() : input)
    const events = this.run.events
    for (const event of events) this.react(event)
    return events
  }

  /** Démonstration : le chemin du solveur rejoué d'une traite (atelier, « Voir la solution »). */
  private solution: { decisions: Map<number, { press: boolean; hold: boolean }>; hold: boolean } | null = null

  playSolution(report: Pick<SolveReport, 'decisions'>): void {
    this.solution = { decisions: new Map(report.decisions.map((decision) => [decision.tick, decision])), hold: false }
  }

  private solutionInput(): GravityInput {
    const solution = this.solution!
    const decision = solution.decisions.get(this.run.tick)
    if (decision) solution.hold = decision.hold
    return { press: decision?.press ?? false, hold: solution.hold }
  }

  /** Une nouvelle tentative : retour au départ (ou, dans le tutoriel, au point de reprise), dans un nuage de fumée. */
  restart(at?: Checkpoint): void {
    if (at) respawnRun(this.world, this.run, at)
    else restartRun(this.world, this.run)
    if (this.solution) this.solution.hold = false
    this.prev = { x: this.run.x, y: this.run.y, cameraX: this.run.cameraX }
    this.vanished = false
    this.ghosts = []
    this.glide = 0
    const { w, h } = sizeOf(this.run)
    this.puff(this.run.x + w / 2, this.run.y + h / 2, 10)
  }

  private react(event: GravityEvent): void {
    const run = this.run
    const { w, h } = sizeOf(run)
    const cx = run.x + w / 2
    switch (event.kind) {
      case 'flip':
      case 'pad':
        this.ring(cx, run.g === 1 ? run.y : run.y + h, event.kind === 'pad' ? this.theme.accent : '#ffffff')
        break
      case 'land': {
        this.squash = Math.min(1, event.speed / 22)
        const head = run.g === 1 ? run.y + h : run.y
        for (let index = 0; index < 6; index += 1) {
          const side = index % 2 ? 1 : -1
          this.effects.push({ kind: 'dust', x: cx + side * 0.2, y: head, vx: side * (0.8 + Math.random() * 1.6) - 2, vy: -run.g * Math.random() * 0.6, age: 0, life: 0.45, size: 0.18 + Math.random() * 0.15, color: 'rgba(255,255,255,0.55)', spin: 0 })
        }
        break
      }
      case 'scroll':
        this.sparks(cx, run.y + h / 2, '#ffd66b', 18)
        break
      case 'moon':
        this.sparks(cx, run.y + h / 2, '#cfd8ff', 22)
        break
      case 'shrink':
      case 'grow': {
        const color = event.kind === 'shrink' ? GATE_COLORS.mini : GATE_COLORS.full
        this.ring(cx, run.y + h / 2, color)
        this.sparks(cx, run.y + h / 2, color, 16)
        break
      }
      case 'log':
        this.sparks(cx, run.y + h / 2, '#e2b277', 16)
        break
      case 'substitute':
        // La bûche reste à sa place et tombe, le ninja file dans la fumée.
        this.puff(cx, run.y + h / 2, 12)
        this.effects.push({ kind: 'log', x: cx, y: run.y + h / 2, vx: -3, vy: -run.g * 2.5, age: 0, life: 0.9, size: 1, color: '', spin: 0 })
        break
      case 'die':
        this.vanished = true
        this.shake = 0.5
        this.puff(cx, Math.max(-0.5, Math.min(WORLD_HEIGHT + 0.5, run.y + h / 2)), 18)
        break
      case 'finish':
        this.sparks(cx, run.y + h / 2, this.theme.accent, 40)
        break
      case 'spring': {
        // Le tremplin claque : un anneau vert sous les pieds, de la poussière.
        const feet = run.g === 1 ? run.y + h : run.y
        this.ring(cx, feet, SPRING_COLOR)
        this.sparks(cx, feet, SPRING_COLOR, 10)
        this.squash = 0.6
        break
      }
      case 'key':
        // Le talisman s'embrase : la barrière de son canal se dissout plus loin.
        this.sparks(cx, run.y + h / 2, KEKKAI_COLOR, 22)
        this.ring(cx, run.y + h / 2, KEKKAI_COLOR)
        break
      case 'warp': {
        // Un éclair doré au départ et à l'arrivée ; pas d'interpolation à travers la téléportation, la
        // caméra glisse pour rattraper.
        this.sparks(event.x, event.y, WARP_COLOR, 16)
        this.ring(event.x, event.y, WARP_COLOR)
        this.sparks(cx, run.y + h / 2, WARP_COLOR, 20)
        this.ring(cx, run.y + h / 2, WARP_COLOR)
        this.glide -= run.cameraX - this.prev.cameraX - this.world.speed * TICK
        this.prev = { x: run.x, y: run.y, cameraX: run.cameraX }
        this.ghosts = []
        break
      }
      case 'crumble':
        break
    }
  }

  private ring(x: number, y: number, color: string): void {
    this.effects.push({ kind: 'ring', x, y, vx: 0, vy: 0, age: 0, life: 0.35, size: 0.3, color, spin: 0 })
  }

  private sparks(x: number, y: number, color: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.4
      const speed = 2 + Math.random() * 4
      this.effects.push({ kind: 'spark', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: 0.5 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.06, color, spin: 0 })
    }
  }

  /** Fumée de ninja et feuilles qui tourbillonnent. */
  private puff(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.6 + Math.random() * 2.2
      this.effects.push({ kind: 'smoke', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: 0.6 + Math.random() * 0.4, size: 0.35 + Math.random() * 0.35, color: index % 3 ? 'rgba(235,235,245,0.85)' : 'rgba(180,180,200,0.8)', spin: 0 })
    }
    for (let index = 0; index < 5; index += 1) {
      const angle = Math.random() * Math.PI * 2
      this.effects.push({ kind: 'leaf', x, y, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, age: 0, life: 1, size: 0.16, color: this.theme.particles.color, spin: Math.random() * 6 })
    }
  }

  /** Dessine une image ; `alpha` : fraction du pas en cours (interpolation), `dt` : temps réel écoulé. */
  render(ctx: CanvasRenderingContext2D, layout: Layout, alpha: number, dt: number): void {
    this.clock += dt
    const run = this.run
    const { width, height, unit, offsetY } = layout
    const lerp = (a: number, b: number) => a + (b - a) * alpha
    const x = lerp(this.prev.x, run.x)
    const y = lerp(this.prev.y, run.y)
    this.glide *= Math.exp(-dt * 9)
    if (Math.abs(this.glide) < 0.01) this.glide = 0
    let cameraX = lerp(this.prev.cameraX, run.cameraX) + this.glide
    this.shake = Math.max(0, this.shake - dt * 1.4)
    if (this.shake > 0) cameraX += (Math.random() - 0.5) * this.shake * 0.4
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.4 * unit : 0

    this.backdrop.draw(ctx, { width, height, unit, cameraX, time: this.clock })

    ctx.save()
    ctx.translate(-cameraX * unit, offsetY + shakeY)
    ctx.scale(unit, unit)
    const view = { left: cameraX, right: cameraX + width / unit, time: this.clock }

    // Hors du couloir : une ombre qui dit « danger ».
    const edge = ctx.createLinearGradient(0, -2, 0, 0.6)
    edge.addColorStop(0, 'rgba(0,0,0,0.55)')
    edge.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = edge
    ctx.fillRect(view.left, -4, view.right - view.left, 4.6)
    const bottom = ctx.createLinearGradient(0, WORLD_HEIGHT - 0.6, 0, WORLD_HEIGHT + 2)
    bottom.addColorStop(0, 'rgba(0,0,0,0)')
    bottom.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = bottom
    ctx.fillRect(view.left, WORLD_HEIGHT - 0.6, view.right - view.left, 4.6)

    const renderTick = run.tick - 1 + alpha
    this.painter.draw(ctx, this.world, run, view, renderTick)

    // Images rémanentes en vol.
    this.ghostClock += dt
    if (!run.grounded && !this.vanished && this.ghostClock > 0.035) {
      this.ghostClock = 0
      this.ghosts.push({ x, y, scale: run.mini ? MINI_SCALE : 1, scaleY: this.orientation(run), age: 0 })
    }
    for (const ghost of this.ghosts) ghost.age += dt
    this.ghosts = this.ghosts.filter((ghost) => ghost.age < 0.22)
    const pose = this.pose(run)
    for (const ghost of this.ghosts) {
      ctx.globalAlpha = 0.28 * (1 - ghost.age / 0.22)
      this.placeNinja(ctx, ghost.x, ghost.y, ghost.scale, ghost.scaleY, 0, () => this.ninja.draw(ctx, pose, this.theme.accent))
    }
    ctx.globalAlpha = 1

    // Le ninja.
    this.ninja.update(dt, pose)
    this.squash = Math.max(0, this.squash - dt * 5)
    if (!this.vanished) {
      const { w, h } = sizeOf(run)
      if (run.moonLeft > 0) {
        const cx = x + w / 2
        const cy = y + h / 2
        const strength = run.lunar ? 0.75 : 0.35 * Math.min(1, run.moonLeft / MOON_SECONDS + 0.3)
        const aura = ctx.createRadialGradient(cx, cy, 0.2, cx, cy, 1.6)
        aura.addColorStop(0, `rgba(200,215,255,${strength.toFixed(2)})`)
        aura.addColorStop(1, 'rgba(200,215,255,0)')
        ctx.fillStyle = aura
        ctx.fillRect(cx - 1.6, cy - 1.6, 3.2, 3.2)
      }
      const turning = Math.min(1, ((run.tick - run.flippedAt) * TICK) / FLIP_TURN)
      const tilt = Math.sin(turning * Math.PI) * 0.5
      // Kawarimi en réserve : la bûche, petite, flotte dans son dos.
      if (run.shield) {
        ctx.save()
        ctx.translate(x - 0.2, y + h / 2 + Math.sin(this.clock * 3) * 0.1)
        ctx.scale(0.55, 0.55)
        this.painter.log(ctx, 0, 0, this.clock)
        ctx.restore()
      }
      // Intouchable juste après une substitution : il clignote.
      if (run.safe > 0) ctx.globalAlpha = Math.floor(this.clock * 14) % 2 ? 0.35 : 0.9
      this.placeNinja(ctx, x, y, run.mini ? MINI_SCALE : 1, this.orientation(run), tilt, () => this.ninja.draw(ctx, pose))
      ctx.globalAlpha = 1
    }

    this.drawEffects(ctx, dt)
    ctx.restore()
  }

  /** Échelle verticale du ninja : 1 debout sur un sol, −1 la tête en bas sous un plafond, et la bascule entre les deux. */
  private orientation(run: GravityRun): number {
    const turning = Math.min(1, ((run.tick - run.flippedAt) * TICK) / FLIP_TURN)
    return -run.g * Math.cos(turning * Math.PI)
  }

  private pose(run: GravityRun): NinjaPose {
    return {
      time: this.clock,
      grounded: run.grounded,
      floating: run.lunar,
      fall: run.vy * run.g,
      squash: this.squash,
      speed: this.world.speed,
    }
  }

  /** Place le repère du ninja : centré sur sa boîte, pieds vers la gravité. */
  private placeNinja(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, scaleY: number, tilt: number, draw: () => void): void {
    const height = PLAYER_H * scale
    const size = (height * DRAW_SCALE) / FIGURE_HEIGHT
    ctx.save()
    ctx.translate(x + (PLAYER_W * scale) / 2, y + height / 2)
    ctx.rotate(tilt)
    ctx.scale(size, size * (Math.abs(scaleY) < 0.08 ? Math.sign(scaleY || 1) * 0.08 : scaleY))
    // Les pieds du dessin sont à son origine : on les descend au bas de la boîte.
    ctx.translate(0, height / 2 / size)
    draw()
    ctx.restore()
  }

  private drawEffects(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const effect of this.effects) {
      effect.age += dt
      effect.x += effect.vx * dt
      effect.y += effect.vy * dt
      effect.vx *= 0.94
      effect.vy *= 0.94
      const t = effect.age / effect.life
      if (t >= 1) continue
      ctx.globalAlpha = 1 - t
      switch (effect.kind) {
        case 'dust':
        case 'smoke':
          ctx.fillStyle = effect.color
          ctx.beginPath()
          ctx.arc(effect.x, effect.y, effect.size * (1 + t * (effect.kind === 'smoke' ? 1.6 : 0.8)), 0, Math.PI * 2)
          ctx.fill()
          break
        case 'spark':
          ctx.fillStyle = effect.color
          ctx.fillRect(effect.x - effect.size / 2, effect.y - effect.size / 2, effect.size, effect.size)
          break
        case 'ring':
          ctx.strokeStyle = effect.color
          ctx.lineWidth = 0.08 * (1 - t)
          ctx.beginPath()
          ctx.ellipse(effect.x, effect.y, effect.size + t * 1.4, (effect.size + t * 1.4) * 0.35, 0, 0, Math.PI * 2)
          ctx.stroke()
          break
        case 'log':
          ctx.save()
          ctx.translate(effect.x, effect.y)
          ctx.rotate(effect.age * 5)
          ctx.scale(0.8, 0.8)
          this.painter.log(ctx, 0, 0, 0)
          ctx.restore()
          break
        case 'leaf':
          ctx.save()
          ctx.translate(effect.x, effect.y)
          ctx.rotate(effect.spin + effect.age * 8)
          ctx.fillStyle = effect.color
          ctx.beginPath()
          ctx.ellipse(0, 0, effect.size, effect.size * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
          break
      }
    }
    ctx.globalAlpha = 1
    this.effects = this.effects.filter((effect) => effect.age < effect.life)
  }
}
