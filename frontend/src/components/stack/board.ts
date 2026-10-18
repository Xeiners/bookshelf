import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playStackCut, playStackMilestone, playStackOver, playStackPerfect, playStackPlace } from '../../lib/sfx'
import { INITIAL_WIDTH } from '../../lib/stack/constants'
import { createStack, drain, pageCount, step, tap, type StackEvent, type StackState } from '../../lib/stack/engine'
import { PAGES_PER_SKY, camTarget, drawDesk, drawGuides, drawPage, drawPetals, drawSky, makePetals, makeView, rowTop, type PageArt, type Petal, type View } from './scene'

/*
 * Une pile : le moteur (`lib/stack/engine.ts`), sa caméra et tous les effets d'une partie (pages
 * qui tombent, étincelles, anneaux, messages), dessinés dans un rectangle quelconque. Le jeu
 * solo en montre une plein écran ; l'arène multijoueur en montre jusqu'à quatre côte à côte,
 * dont celles des autres joueurs, rejouées à partir de leurs gestes (`remoteTap`, `sync`).
 */

interface Piece {
  x: number
  y: number
  w: number
  vx: number
  vy: number
  angle: number
  spin: number
  index: number
  art: PageArt | null
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

interface Ring {
  x: number
  y: number
  w: number
  h: number
  life: number
}

interface Float {
  text: string
  sub: string
  x: number
  y: number
  life: number
}

export interface BoardOptions {
  /** Sons et vibrations : la pile du joueur seulement. */
  sound: boolean
  /** Moins d'effets (préférence système, ou petit panneau). */
  reduced?: boolean
  petals?: number
  perfectLabel: string
}

/** Portion de scène (centre, largeur) couverte par chaque page à sa pose : l'affiche s'y prolonge sur le morceau coupé. */
interface Span {
  x: number
  w: number
}

/** Point de la hauteur d'une affiche montré dans la page de rang `index` : change à chaque page. */
const verticalOf = (index: number): number => 0.22 + ((index * 0.6180339) % 1) * 0.5

export class Board {
  state: StackState = createStack()
  /** Affiches chargées, et décalage de la première : toutes les piles d'une partie partagent la même suite. */
  images: (HTMLImageElement | undefined)[] = []
  coverOffset = 0
  cam = 0
  time = 0
  /** Secondes écoulées depuis la page ratée ; `null` tant que la partie dure. */
  overFor: number | null = null
  /** Dernière pose (pour le tableau de bord du jeu solo). */
  placed = 0
  private spans: Span[] = [{ x: 0.5, w: INITIAL_WIDTH }]
  private pieces: Piece[] = []
  private sparks: Spark[] = []
  private rings: Ring[] = []
  private floats: Float[] = []
  private shake = 0
  private petals: Petal[]
  private readonly options: BoardOptions
  /** Appelé à chaque pose et à la chute finale (mise à jour du tableau de bord). */
  onChange: ((state: StackState) => void) | null = null

  constructor(options: BoardOptions) {
    this.options = options
    this.petals = makePetals(options.reduced ? 6 : (options.petals ?? 30))
  }

  /** Solo : une affiche de plus (l'ordre n'a pas d'importance). */
  addImage(image: HTMLImageElement): void {
    if (!this.images.includes(image)) this.images.push(image)
  }

  /** Multijoueur : l'affiche de la case `slot` de la suite du salon (les autres cases restent vides jusqu'à leur arrivée). */
  setImage(slot: number, count: number, image: HTMLImageElement): void {
    this.images.length = count
    this.images[slot] = image
  }

  private art(index: number, span: Span): PageArt | null {
    if (this.images.length === 0) return null
    const image = this.images[(index + this.coverOffset) % this.images.length]
    return image ? { image, x: span.x, w: span.w, v: verticalOf(index) } : null
  }

  /** Geste du joueur : la page se pose. `false` si la partie est déjà finie. */
  tap(): boolean {
    if (this.state.over) return false
    tap(this.state)
    return true
  }

  /** Geste d'un autre joueur, rejoué ici : la page est posée là où elle se trouvait chez lui. */
  remoteTap(x: number): void {
    const moving = this.state.moving
    if (this.state.over || !moving) return
    moving.x = x
    tap(this.state)
  }

  /** Position annoncée par l'autre joueur : on se recale sans à-coup (ou d'un coup si l'écart est grand). */
  sync(x: number, dir: 1 | -1): void {
    const moving = this.state.moving
    if (!moving) return
    if (Math.abs(x - moving.x) > 0.12 || dir !== moving.dir) {
      moving.x = x
      moving.dir = dir
    } else {
      moving.x += (x - moving.x) * 0.6
    }
  }

  /** Fin de partie annoncée par l'autre joueur alors que sa chute n'a pas été rejouée ici. */
  forceOver(): void {
    if (this.state.over) return
    this.state.over = true
    this.state.moving = null
    this.overFor ??= 0
  }

  private burst(x: number, y: number, count: number, colors: string[], power: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
      const speed = power * (0.4 + Math.random() * 0.8)
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, max: 0.55 + Math.random() * 0.5, size: 2 + Math.random() * 3, color: colors[index % colors.length]! })
    }
  }

  /** Met en scène ce que le moteur vient de produire. */
  private stage(view: View, events: StackEvent[]): void {
    const { sound, reduced } = this.options
    for (const event of events) {
      if (event.type === 'place') {
        const top = rowTop(view, event.index)
        const centre = view.left + event.x * view.stage
        const span: Span = event.cut
          ? { x: (Math.min(event.x - event.w / 2, event.cut.x - event.cut.w / 2) + Math.max(event.x + event.w / 2, event.cut.x + event.cut.w / 2)) / 2, w: Math.max(event.x + event.w / 2, event.cut.x + event.cut.w / 2) - Math.min(event.x - event.w / 2, event.cut.x - event.cut.w / 2) }
          : { x: event.x, w: event.w }
        this.spans[event.index] = span
        this.placed = event.index
        if (event.perfect) {
          if (sound) {
            playStackPerfect(event.combo)
            vibrate(event.combo >= 3 ? [8, 20, 12] : 8)
          }
          this.rings.push({ x: centre, y: top + view.page / 2, w: event.w * view.stage, h: view.page, life: 0 })
          if (!reduced) this.burst(centre, top, 10 + Math.min(14, event.combo * 2), ['#ffd35c', '#ffffff', '#ff8fb8', '#7ad7ff'], view.stage * 0.9)
          // Un seul message à la fois : une nouvelle parfaite remplace la précédente.
          this.floats = [{ text: this.options.perfectLabel, sub: event.combo > 1 ? `×${event.combo}` : '', x: centre, y: top - view.page * 0.4, life: 0 }]
        } else if (sound) {
          playStackPlace()
          vibrate(5)
        }
        if (event.cut && event.cut.w > 0.004) {
          if (sound) playStackCut()
          const dir = event.cut.x > event.x ? 1 : -1
          this.pieces.push({ x: view.left + event.cut.x * view.stage, y: top, w: event.cut.w * view.stage, vx: dir * view.stage * 0.25, vy: -view.stage * 0.1, angle: 0, spin: dir * 1.6, index: event.index, art: this.art(event.index, span) })
        }
        if (event.index % PAGES_PER_SKY === 0) {
          if (sound) playStackMilestone()
          if (!reduced) this.burst(view.width / 2, view.height * 0.35, 36, ['#ff8fb8', '#ffd1e3', '#ffffff'], view.stage * 1.1)
        }
      } else {
        if (sound) {
          playStackOver()
          vibrate([30, 40, 60])
        }
        this.shake = 0.55
        this.overFor = 0
        const index = pageCount(this.state) + 1
        const span: Span = { x: event.x, w: event.w }
        const right = event.x > 0.5
        // La page ratée tombe de côté, depuis l'endroit où elle glissait.
        this.pieces.push({ x: view.left + (event.x - event.w / 2) * view.stage, y: rowTop(view, index), w: event.w * view.stage, vx: (right ? 1 : -1) * view.stage * 0.18, vy: -view.stage * 0.2, angle: 0, spin: (right ? 1 : -1) * 1.2, index, art: this.art(index, span) })
      }
    }
    if (events.length > 0) this.onChange?.(this.state)
  }

  /** Avance la pile de `dt` secondes, dans un panneau de `width` × `height` pixels. */
  update(dt: number, width: number, height: number): void {
    this.time += dt
    const probe = makeView(width, height, this.cam)
    this.cam += (camTarget(probe, pageCount(this.state)) - this.cam) * (1 - Math.exp(-6 * dt))
    const view = makeView(width, height, this.cam)
    step(this.state, dt)
    this.stage(view, drain(this.state))
    if (this.overFor !== null) this.overFor += dt

    const gravity = view.stage * 4.2
    for (const piece of this.pieces) {
      piece.vy += gravity * dt
      piece.x += piece.vx * dt
      piece.y += piece.vy * dt
      piece.angle += piece.spin * dt
    }
    this.pieces = this.pieces.filter((piece) => piece.y < view.height + view.page * 3)
    for (const spark of this.sparks) {
      spark.life += dt
      spark.vy += view.stage * 1.6 * dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
    }
    this.sparks = this.sparks.filter((spark) => spark.life < spark.max)
    for (const ring of this.rings) ring.life += dt
    this.rings = this.rings.filter((ring) => ring.life < 0.5)
    for (const float of this.floats) float.life += dt
    this.floats = this.floats.filter((float) => float.life < 0.9)
    this.shake = Math.max(0, this.shake - dt * 1.6)
  }

  /** Dessine la pile dans le coin haut-gauche d'un contexte déjà translaté et rogné sur le panneau. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const view = makeView(width, height, this.cam)
    const { state } = this
    const count = pageCount(state)
    ctx.save()
    if (this.shake > 0 && !this.options.reduced) ctx.translate((Math.random() - 0.5) * 16 * this.shake, (Math.random() - 0.5) * 16 * this.shake)
    const sky = drawSky(ctx, view, count, this.time)
    drawPetals(ctx, view, this.petals, this.time, sky)
    drawDesk(ctx, view)

    const first = Math.max(0, Math.floor((view.cam - view.page * 2) / view.page))
    for (let row = first; row <= count; row += 1) {
      const top = rowTop(view, row)
      if (top > view.height + view.page) continue
      if (top < -view.page * 2) break
      const page = state.pages[row]!
      drawPage(ctx, view, page.x, page.w, top, row, { art: this.art(row, this.spans[row] ?? { x: page.x, w: page.w }) })
    }
    if (state.moving) {
      drawGuides(ctx, view, state)
      drawPage(ctx, view, state.moving.x, state.moving.w, rowTop(view, count + 1), count + 1, { art: this.art(count + 1, { x: state.moving.x, w: state.moving.w }) })
    }

    for (const ring of this.rings) {
      const grow = ring.life / 0.5
      ctx.strokeStyle = `rgba(255,236,170,${1 - grow})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(ring.x - (ring.w / 2) * (1 + grow * 0.25), ring.y - (ring.h / 2) * (1 + grow * 0.9), ring.w * (1 + grow * 0.25), ring.h * (1 + grow * 0.9), 8)
      ctx.stroke()
    }
    for (const piece of this.pieces) {
      drawPage(ctx, view, (piece.x + piece.w / 2 - view.left) / view.stage, piece.w / view.stage, piece.y, piece.index, {
        alpha: Math.max(0, 1 - Math.max(0, piece.y - view.height * 0.9) / 200),
        angle: piece.angle,
        art: piece.art,
      })
    }
    for (const spark of this.sparks) {
      const fade = 1 - spark.life / spark.max
      ctx.globalAlpha = Math.max(0, fade)
      ctx.fillStyle = spark.color
      ctx.beginPath()
      ctx.arc(spark.x, spark.y, spark.size * (0.4 + fade * 0.6), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (const float of this.floats) {
      const progress = float.life / 0.9
      ctx.globalAlpha = Math.max(0, 1 - progress * progress)
      ctx.textAlign = 'center'
      ctx.lineJoin = 'round'
      ctx.font = `800 ${Math.round(view.page * 0.62)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      ctx.strokeStyle = 'rgba(40,10,60,0.75)'
      ctx.lineWidth = 5
      const y = float.y - progress * view.page * 1.4
      ctx.strokeText(float.text, float.x, y)
      ctx.fillStyle = '#ffe8a0'
      ctx.fillText(float.text, float.x, y)
      if (float.sub) {
        ctx.font = `800 ${Math.round(view.page * 0.5)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
        ctx.strokeText(float.sub, float.x, y + view.page * 0.6)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(float.sub, float.x, y + view.page * 0.6)
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }
}

/** Pour les écrans qui animent un chiffre quand il change. */
export const popScore = (element: HTMLElement | null, perfect: boolean): void => {
  if (element) gsap.fromTo(element, { scale: perfect ? 1.3 : 1.12 }, { scale: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true })
}
