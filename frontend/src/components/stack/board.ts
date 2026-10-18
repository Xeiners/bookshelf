import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playStackCut, playStackMilestone, playStackOver, playStackPerfect, playStackPlace } from '../../lib/sfx'
import { INITIAL_WIDTH, PAGE_HEIGHT } from '../../lib/stack/constants'
import { createStack, drain, pageCount, slide, step, tap, type StackEvent, type StackState } from '../../lib/stack/engine'
import { camTarget, drawDesk, drawGuides, drawTome, levelY, makeView, type View } from './scene'
import { PAGES_PER_WORLD, WorldBackdrop, worldIndexOf, worldNumber } from './worlds'

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
  h: number
  vx: number
  vy: number
  angle: number
  spin: number
  index: number
  /** Couverture d'origine du tome : sa gauche et sa largeur (pixels) au moment de la chute. */
  spanLeft: number
  spanWidth: number
  /** Abscisse de départ de la pièce : la couverture la suit pendant la chute. */
  originX: number
  image: HTMLImageElement | null
  title: string
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
  perfectLabel: string
  /** Nom de chaque monde, dans l'ordre, et la façon de l'annoncer (« Monde 2 · … »). */
  worldNames: readonly string[]
  worldLabel: (number: number) => string
}

/** Portion de scène (centre, largeur) couverte par chaque page à sa pose : l'affiche s'y prolonge sur le morceau coupé. */
interface Span {
  x: number
  w: number
}

export class Board {
  state: StackState = createStack()
  /** Affiches chargées, et décalage de la première : toutes les piles d'une partie partagent la même suite. */
  images: (HTMLImageElement | undefined)[] = []
  titles: (string | undefined)[] = []
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
  /** Hauteur de chaque tome posé, et hauteur cumulée jusqu'à son sommet (largeurs de scène). */
  private heights: number[] = [PAGE_HEIGHT]
  private levels: number[] = [PAGE_HEIGHT]
  /** Nombre de tomes, lissé : le monde change en douceur. */
  private skyPages = 0
  private readonly backdrop = new WorldBackdrop()
  private banner: { text: string; sub: string; life: number } | null = null
  private readonly options: BoardOptions
  /** Appelé à chaque pose et à la chute finale (mise à jour du tableau de bord). */
  onChange: ((state: StackState) => void) | null = null

  constructor(options: BoardOptions) {
    this.options = options
  }

  /** Qualité du décor (voir `WorldBackdrop.setQuality`). */
  setBackdropQuality(maxSide: number, fps: number): void {
    this.backdrop.setQuality(maxSide, fps)
  }

  /** Solo : une affiche de plus (l'ordre n'a pas d'importance). */
  addImage(image: HTMLImageElement, title: string): void {
    if (this.images.includes(image)) return
    this.images.push(image)
    this.titles.push(title)
  }

  /** Multijoueur : l'affiche de la case `slot` de la suite du salon (les autres cases restent vides jusqu'à leur arrivée). */
  setImage(slot: number, count: number, image: HTMLImageElement, title: string): void {
    this.images.length = count
    this.titles.length = count
    this.images[slot] = image
    this.titles[slot] = title
  }

  /** Couverture du tome de rang `index` : la même suite pour tous les joueurs d'une partie. */
  private imageOf(index: number): HTMLImageElement | null {
    if (this.images.length === 0) return null
    return this.images[(index + this.coverOffset) % this.images.length] ?? null
  }

  private titleOf(index: number): string {
    if (this.titles.length === 0) return ''
    return this.titles[(index + this.coverOffset) % this.titles.length] ?? ''
  }

  /** Geste du joueur : la page se pose. `false` si la partie est déjà finie. */
  tap(): boolean {
    if (this.state.over) return false
    tap(this.state)
    return true
  }

  /** Geste d'un autre joueur, rejoué ici : la page est posée là où elle se trouvait chez lui. */
  remoteTap(x: number, lag = 0): void {
    const moving = this.state.moving
    if (this.state.over || !moving) return
    moving.x = x
    tap(this.state)
    // La page suivante est déjà partie chez lui : on la rattrape du temps de trajet.
    if (this.state.moving && lag > 0) slide(this.state.moving, lag)
  }

  /** Position annoncée par l'autre joueur : on se recale sans à-coup (ou d'un coup si l'écart est grand). */
  sync(x: number, dir: 1 | -1, lag = 0): void {
    const moving = this.state.moving
    if (!moving) return
    // La position date d'il y a `lag` s : on la fait avancer d'autant pour viser où la page est vraiment.
    const target = { x, dir, w: moving.w, speed: moving.speed }
    if (lag > 0) slide(target, lag)
    const gap = Math.abs(target.x - moving.x)
    if (gap > 0.2 || (dir !== moving.dir && gap > 0.04)) {
      moving.x = target.x
      moving.dir = target.dir
    } else {
      moving.dir = target.dir
      moving.x += (target.x - moving.x) * 0.5
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

  /** Hauteur (pixels) du tome de rang `row`, et ordonnée de son sommet. */
  private tomeBox(view: View, row: number): { top: number; height: number } {
    return { top: levelY(view, this.levels[row]!), height: this.heights[row]! * view.stage }
  }

  /** Le tome qui glisse : posé sur le sommet de la pile, il en prend la largeur du moment. */
  private movingBox(view: View): { top: number; height: number } {
    const count = pageCount(this.state)
    const height = PAGE_HEIGHT
    return { top: levelY(view, this.levels[count]! + height), height: height * view.stage }
  }

  /** Met en scène ce que le moteur vient de produire. */
  private stage(view: View, events: StackEvent[]): void {
    const { sound, reduced } = this.options
    for (const event of events) {
      if (event.type === 'place') {
        const span: Span = event.cut
          ? { x: (Math.min(event.x - event.w / 2, event.cut.x - event.cut.w / 2) + Math.max(event.x + event.w / 2, event.cut.x + event.cut.w / 2)) / 2, w: Math.max(event.x + event.w / 2, event.cut.x + event.cut.w / 2) - Math.min(event.x - event.w / 2, event.cut.x - event.cut.w / 2) }
          : { x: event.x, w: event.w }
        this.spans[event.index] = span
        this.heights[event.index] = PAGE_HEIGHT
        this.levels[event.index] = this.levels[event.index - 1]! + this.heights[event.index]!
        this.placed = event.index
        const box = this.tomeBox(view, event.index)
        const centre = view.left + event.x * view.stage
        if (event.perfect) {
          if (sound) {
            playStackPerfect(event.combo)
            vibrate(event.combo >= 3 ? [8, 20, 12] : 8)
          }
          this.rings.push({ x: centre, y: box.top + box.height / 2, w: event.w * view.stage, h: box.height, life: 0 })
          if (!reduced) this.burst(centre, box.top + box.height * 0.1, 10 + Math.min(14, event.combo * 2), ['#ffd35c', '#ffffff', '#ff8fb8', '#7ad7ff'], view.stage * 0.9)
          // Un seul message à la fois : une nouvelle parfaite remplace la précédente.
          this.floats = [{ text: this.options.perfectLabel, sub: event.combo > 1 ? `×${event.combo}` : '', x: centre, y: box.top - view.stage * 0.06, life: 0 }]
        } else if (sound) {
          playStackPlace()
          vibrate(5)
        }
        if (event.cut && event.cut.w > 0.004) {
          if (sound) playStackCut()
          const dir = event.cut.x > event.x ? 1 : -1
          this.pieces.push({
            x: view.left + (event.cut.x - event.cut.w / 2) * view.stage,
            y: box.top,
            w: event.cut.w * view.stage,
            h: box.height,
            vx: dir * view.stage * 0.25,
            vy: -view.stage * 0.1,
            angle: 0,
            spin: dir * 1.4,
            index: event.index,
            spanLeft: view.left + (span.x - span.w / 2) * view.stage,
            spanWidth: span.w * view.stage,
            originX: view.left + (event.cut.x - event.cut.w / 2) * view.stage,
            image: this.imageOf(event.index),
            title: this.titleOf(event.index),
          })
        }
        // Nouveau monde : son nom s'affiche, une pluie de pétales l'accompagne.
        if (event.index % PAGES_PER_WORLD === 0) {
          if (sound) playStackMilestone()
          if (!reduced) this.burst(view.width / 2, view.height * 0.4, 36, ['#ff8fb8', '#ffd1e3', '#ffffff'], view.stage * 1.1)
          const number = worldNumber(event.index)
          this.banner = { text: this.options.worldNames[worldIndexOf(event.index)] ?? '', sub: this.options.worldLabel(number + 1), life: 0 }
        }
      } else {
        if (sound) {
          playStackOver()
          vibrate([30, 40, 60])
        }
        this.shake = 0.55
        this.overFor = 0
        const index = pageCount(this.state) + 1
        const box = this.movingBox(view)
        const right = event.x > 0.5
        // Le tome raté tombe de côté, depuis l'endroit où il glissait.
        this.pieces.push({
          x: view.left + (event.x - event.w / 2) * view.stage,
          y: box.top,
          w: event.w * view.stage,
          h: box.height,
          vx: (right ? 1 : -1) * view.stage * 0.18,
          vy: -view.stage * 0.2,
          angle: 0,
          spin: (right ? 1 : -1) * 1.1,
          index,
          spanLeft: view.left + (event.x - event.w / 2) * view.stage,
          spanWidth: event.w * view.stage,
          originX: view.left + (event.x - event.w / 2) * view.stage,
          image: this.imageOf(index),
          title: this.titleOf(index),
        })
      }
    }
    if (events.length > 0) this.onChange?.(this.state)
  }

  /** Avance la pile de `dt` secondes, dans un panneau de `width` × `height` pixels. */
  update(dt: number, width: number, height: number): void {
    this.time += dt
    // D'abord ce qui vient de se passer (une pose met à jour les hauteurs), puis la caméra.
    step(this.state, dt)
    this.stage(makeView(width, height, this.cam), drain(this.state))
    const count = pageCount(this.state)
    this.skyPages += (count - this.skyPages) * (1 - Math.exp(-2.4 * dt))
    const movingHeight = PAGE_HEIGHT
    this.cam += (camTarget(makeView(width, height, this.cam), this.levels[count]!, movingHeight) - this.cam) * (1 - Math.exp(-5 * dt))
    const view = makeView(width, height, this.cam)
    if (this.overFor !== null) this.overFor += dt
    if (this.banner) {
      this.banner.life += dt
      if (this.banner.life > 2.8) this.banner = null
    }

    const gravity = view.stage * 4.2
    for (const piece of this.pieces) {
      piece.vy += gravity * dt
      piece.x += piece.vx * dt
      piece.y += piece.vy * dt
      piece.angle += piece.spin * dt
    }
    this.pieces = this.pieces.filter((piece) => piece.y < view.height + piece.h * 1.5)
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
    this.backdrop.draw(ctx, view, this.skyPages, this.time)
    drawDesk(ctx, view)

    // Du plus haut visible au plus bas : les tomes s'empilent sans se recouvrir.
    for (let row = count; row >= 0; row -= 1) {
      const box = this.tomeBox(view, row)
      if (box.top > view.height) break
      if (box.top + box.height < 0) continue
      const page = state.pages[row]!
      const span = this.spans[row] ?? { x: page.x, w: page.w }
      drawTome(ctx, {
        x: view.left + (page.x - page.w / 2) * view.stage,
        y: box.top,
        w: page.w * view.stage,
        h: box.height,
        spanLeft: view.left + (span.x - span.w / 2) * view.stage,
        spanWidth: span.w * view.stage,
        image: this.imageOf(row),
        title: this.titleOf(row),
        index: row,
      })
    }
    if (state.moving) {
      const box = this.movingBox(view)
      const topBox = this.tomeBox(view, count)
      const top = state.pages[count]!
      drawGuides(ctx, view, top.x, top.w, topBox.top, box.height + view.stage * 0.2)
      drawTome(ctx, {
        x: view.left + (state.moving.x - state.moving.w / 2) * view.stage,
        y: box.top,
        w: state.moving.w * view.stage,
        h: box.height,
        spanLeft: view.left + (state.moving.x - state.moving.w / 2) * view.stage,
        spanWidth: state.moving.w * view.stage,
        image: this.imageOf(count + 1),
        title: this.titleOf(count + 1),
        index: count + 1,
      })
    }

    for (const ring of this.rings) {
      const grow = ring.life / 0.5
      ctx.strokeStyle = `rgba(255,236,170,${1 - grow})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(ring.x - (ring.w / 2) * (1 + grow * 0.2), ring.y - (ring.h / 2) * (1 + grow * 0.08), ring.w * (1 + grow * 0.2), ring.h * (1 + grow * 0.08), 8)
      ctx.stroke()
    }
    for (const piece of this.pieces) {
      drawTome(ctx, {
        x: piece.x,
        y: piece.y,
        w: piece.w,
        h: piece.h,
        spanLeft: piece.spanLeft + (piece.x - piece.originX),
        spanWidth: piece.spanWidth,
        image: piece.image,
        title: piece.title,
        index: piece.index,
        alpha: Math.max(0, 1 - Math.max(0, piece.y - view.height * 0.9) / 200),
        angle: piece.angle,
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
      const unit = view.stage * 0.06
      ctx.font = `800 ${Math.round(unit * 1.1)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      ctx.strokeStyle = 'rgba(40,10,60,0.75)'
      ctx.lineWidth = 5
      const y = float.y - progress * unit * 2.2
      ctx.strokeText(float.text, float.x, y)
      ctx.fillStyle = '#ffe8a0'
      ctx.fillText(float.text, float.x, y)
      if (float.sub) {
        ctx.font = `800 ${Math.round(unit * 0.9)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
        ctx.strokeText(float.sub, float.x, y + unit * 1.05)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(float.sub, float.x, y + unit * 1.05)
      }
    }
    ctx.globalAlpha = 1
    // Annonce du monde : son nom, comme un titre de chapitre.
    if (this.banner) {
      const t = this.banner.life / 2.8
      const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1
      const unit = view.stage * 0.07
      ctx.globalAlpha = Math.max(0, alpha)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.fillStyle = 'rgba(14,6,36,0.45)'
      ctx.fillRect(0, height * 0.36 - unit * 1.9, width, unit * 3.8)
      ctx.font = `600 ${Math.round(unit * 0.62)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      ctx.fillStyle = 'rgba(255,225,170,0.95)'
      ctx.fillText(this.banner.sub, width / 2, height * 0.36 - unit * 0.8)
      // Le titre tient toujours dans la largeur du panneau.
      let size = Math.round(unit * 1.05)
      ctx.font = `800 ${size}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      const fit = (width * 0.9) / Math.max(1, ctx.measureText(this.banner.text).width)
      if (fit < 1) {
        size = Math.floor(size * fit)
        ctx.font = `800 ${size}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      }
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(30,10,50,0.7)'
      ctx.strokeText(this.banner.text, width / 2, height * 0.36 + unit * 0.45)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(this.banner.text, width / 2, height * 0.36 + unit * 0.45)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }
}

/** Pour les écrans qui animent un chiffre quand il change. */
export const popScore = (element: HTMLElement | null, perfect: boolean): void => {
  if (element) gsap.fromTo(element, { scale: perfect ? 1.3 : 1.12 }, { scale: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true })
}
