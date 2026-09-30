/**
 * Page qui tourne, pour les romans (EPUB) : la scène posée sur epub.js. La
 * géométrie de la feuille qui se plie est dans `pageTurn.ts` (pure, testée).
 *
 * epub.js tourne une page en décalant son conteneur, sans transition. Pour
 * qu'une feuille puisse tourner, il faut une image de la page quittée : une
 * COPIE du chapitre (seconde iframe, même document, mêmes styles, mêmes
 * polices) est préparée à l'avance puis figée sur cette page, par-dessus le
 * vrai texte. La vraie page change tout de suite dessous — un tap répond sans
 * attendre, et un tap pendant qu'une feuille tourne l'achève d'un coup — puis
 * la copie se plie : son coin se soulève, le pli traverse la page et découvre
 * la page atteinte. En arrière (page simple), c'est la vraie page qui se
 * déplie par-dessus la copie de l'ancienne.
 *
 * Performance (mesurée au doigt sur téléphone) : pendant le geste, RIEN n'est
 * repeint. Pas de `clip-path` ni de dégradé recalculé : la découpe au pli est
 * un grand cadre pivoté en `overflow: hidden` (son contenu contre-pivoté reste
 * en place), les dégradés sont peints une fois en bandes fixes puis déplacés
 * et étirés. Chaque image ne change que des `transform`, composées par la
 * carte graphique ; les mouvements du doigt sont regroupés à une par image.
 *
 * Aucune copie prête (chapitre qui vient de s'ouvrir, réglages changés) : la
 * page tourne sans animation, comme avant. Jamais d'attente pour une image.
 */
import { gsap } from '../gsap'
import { READER_STYLE_ID, type ReaderTheme } from './epubStyle'
import {
  STRIP,
  dragPoint,
  foldLayout,
  pointAt,
  progressOf,
  restClip,
  turnPath,
  type FoldLayout,
  type Matrix,
  type Point,
  type TurnCorner,
  type TurnDirection,
  type TurnGeometry,
} from './pageTurn'

/** Durée d'une page tournée d'un tap, en secondes. */
const TURN_DURATION = 0.6
/** Départ vif (le tap répond aussitôt), arrivée posée. */
const TURN_EASE = 'power2.out'
/** Feuille lâchée : elle finit de tourner à partir de cet avancement, sinon elle retombe. */
const COMMIT_AT = 0.3
/** Vitesse (px/s) d'un geste bref qui suffit à décider. */
const FLICK_SPEED = 450
/** Regroupe les demandes de copie (redimensionnement, réglages, chapitre qui s'affiche). */
const REBUILD_DELAY_MS = 180
/** Une navigation d'epub.js qui ne répond plus ne bloque jamais les pages suivantes. */
const NAVIGATION_TIMEOUT_MS = 2000
/** Les polices de la copie qui tardent ne la retiennent pas plus longtemps. */
const FONTS_TIMEOUT_MS = 1500

/** Ordre des calques de la scène. */
const Z = { cover: 1, front: 2, under: 3, back: 4, verso: 5, crease: 6 } as const

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface PageTurnerOptions {
  /** Scène plein écran : reçoit les calques de la page qui tourne. */
  stage: HTMLElement
  /**
   * La vraie page (plein écran, contient `host`) et son cadre de découpe
   * (parent direct) : pour revenir en arrière, elle se déplie.
   */
  page: HTMLElement
  pageClip: HTMLElement
  /** Élément où epub.js affiche le livre. */
  host: HTMLElement
  /** Tourne vraiment la page (epub.js). */
  navigate: (direction: TurnDirection) => Promise<unknown>
  /** Il y a une page dans ce sens (pas au début ni à la fin du livre). */
  canTurn: (direction: TurnDirection) => boolean
  /** La page voisine est dans le même chapitre (sinon epub.js remplace l'iframe : un geste ne peut pas la suivre). */
  staysInChapter: (direction: TurnDirection) => boolean
  /** Double page affichée par epub.js. */
  isSpread: () => boolean
  /**
   * Feuille tenue au doigt : la page atteinte n'est pas encore décidée, sa
   * position ne doit pas partir (ni vers l'appareil, ni vers le compte).
   */
  onHoldChange: (holding: boolean) => void
}

interface Snapshot {
  frame: HTMLIFrameElement
  doc: Document
  /** Change dès que la mise en page change : chapitre, taille, réglages. */
  signature: string
}

interface Turn {
  geometry: TurnGeometry
  corner: TurnCorner
  /** Coin tiré, là où il est maintenant. */
  point: Point
  /** Animation en cours (0 → 1). */
  motion: { value: number }
  tween: gsap.core.Tween | null
  /** Zone de texte, page quittée et page atteinte (même chapitre), dans la scène. */
  host: Box
  before: Box
  after: Box | null
  /** iframe du chapitre au départ : si elle change, la page atteinte est dans un autre chapitre. */
  frame: HTMLIFrameElement
  /** Copie à plat, coupée au pli (page quittée ; en double page, avec la moitié opposée). */
  front: Ghost | null
  /** Page simple, en arrière : copie de l'ancienne page, sous la vraie qui se déplie. */
  cover: Ghost | null
  /** Double page : la page atteinte, au dos de la feuille. */
  verso: Ghost | null
  versoShown: boolean
  navigated: boolean
  navigation: Promise<void>
  /** Feuille tenue au doigt, puis lâchée. */
  interactive: boolean
  released: boolean
  /** Issue : la page tourne (`true`) ou retombe. */
  commit: boolean
}

const frameIds = new WeakMap<HTMLIFrameElement, number>()
let lastFrameId = 0

/** L'iframe du chapitre affiché, et une signature de sa mise en page. */
function snapshotOf(host: HTMLElement): Snapshot | null {
  const frame = host.querySelector('iframe')
  const doc = frame?.contentDocument
  if (!frame || !doc?.documentElement || !doc.body) return null
  let id = frameIds.get(frame)
  if (id === undefined) {
    lastFrameId += 1
    id = lastFrameId
    frameIds.set(frame, id)
  }
  const style = doc.getElementById(READER_STYLE_ID)?.textContent ?? ''
  // Colonnes et largeur : posées par epub.js sur <html> à chaque mise en page.
  const layout = doc.documentElement.getAttribute('style') ?? ''
  return { frame, doc, signature: `${id}|${frame.offsetWidth}x${frame.offsetHeight}|${layout}|${style}` }
}

const relative = (rect: DOMRect, origin: DOMRect): Box => ({
  left: rect.left - origin.left,
  top: rect.top - origin.top,
  width: rect.width,
  height: rect.height,
})

const opposite = (direction: TurnDirection): TurnDirection => (direction === 'next' ? 'prev' : 'next')

const settleWithin = (promise: Promise<unknown>, ms: number): Promise<void> =>
  Promise.race([promise.then(noop, noop), new Promise<void>((resolve) => window.setTimeout(resolve, ms))])

function noop() {}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const matrixOf = (m: Matrix) => `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`

/** Ombre de la feuille soulevée sur la page qu'elle découvre : dense au pli, vite fondue (bande étirée ensuite). */
const underShade = (theme: ReaderTheme) =>
  `linear-gradient(to right, rgba(0,0,0,${theme.dark ? 0.6 : 0.32}), rgba(0,0,0,${theme.dark ? 0.28 : 0.12}) 35%, rgba(0,0,0,0))`

/**
 * Relief du dos de la feuille, du pli (à gauche de la bande) vers le coin :
 * creux sombre au pli, reflet sur la courbe du papier, légère ombre au bout.
 * Sur fond sombre, un reflet clair dessine le rabat (une ombre ne s'y verrait pas).
 */
const creaseShade = (theme: ReaderTheme) =>
  theme.dark
    ? 'linear-gradient(to right, rgba(0,0,0,0.55), rgba(255,255,255,0.03) 8%, rgba(255,255,255,0.1) 55%, rgba(255,255,255,0.04))'
    : 'linear-gradient(to right, rgba(0,0,0,0.3), rgba(0,0,0,0.06) 8%, rgba(255,255,255,0.22) 55%, rgba(0,0,0,0.1))'

/** Papier du dos de la feuille : le fond du thème, à peine éclairci sur fond sombre. */
const paperOf = (theme: ReaderTheme) =>
  theme.dark ? `linear-gradient(rgba(255,255,255,0.05), rgba(255,255,255,0.05)), ${theme.background}` : theme.background

/** Élément positionné en haut à gauche de son parent, transformé depuis ce coin. */
function box(parent: HTMLElement, clipped: boolean): HTMLDivElement {
  const element = document.createElement('div')
  Object.assign(element.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    overflow: clipped ? 'hidden' : 'visible',
  })
  parent.append(element)
  return element
}

/** Cadre de découpe (carré pivoté, `overflow: hidden`) : un calque de la scène. */
function clipFrame(stage: HTMLElement, z: number): HTMLDivElement {
  const element = box(stage, true)
  element.style.visibility = 'hidden'
  element.style.zIndex = String(z)
  element.setAttribute('aria-hidden', 'true')
  return element
}

const px = (value: number) => `${value}px`

/** Prépare un cadre de découpe pour ce tour de page : sa taille, et la promotion en calque GPU. */
function openClip(element: HTMLElement, size: number, z: number): void {
  Object.assign(element.style, { width: px(size), height: px(size), zIndex: String(z), visibility: 'visible', willChange: 'transform' })
}

/**
 * Copie d'un chapitre, figée sur une page : une iframe sans script (même
 * document que celle d'epub.js), cadrée sur la zone de texte. Emboîtement,
 * créé une fois (déplacer une iframe dans le DOM la rechargerait) :
 * cadre de découpe > page > miroir (dos de la feuille) > fenêtre > iframe.
 */
class Ghost {
  readonly clip: HTMLDivElement
  readonly body: HTMLDivElement
  private readonly mirror: HTMLDivElement
  private readonly window: HTMLDivElement
  private readonly frame = document.createElement('iframe')
  /** Mise en page affichable (chargée, polices comprises). */
  signature: string | null = null
  /** Mise en page en cours de chargement. */
  private target: string | null = null

  constructor(stage: HTMLElement) {
    this.clip = clipFrame(stage, Z.front)
    this.body = box(this.clip, true)
    this.mirror = box(this.body, false)
    this.window = box(this.mirror, true)
    Object.assign(this.frame.style, { position: 'absolute', border: '0', pointerEvents: 'none' })
    // Aucun script du livre, comme dans l'iframe d'epub.js ; même origine pour attendre ses polices.
    this.frame.setAttribute('sandbox', 'allow-same-origin')
    this.frame.tabIndex = -1
    this.window.append(this.frame)
  }

  setBackground(color: string): void {
    this.body.style.background = color
  }

  /** Recopie le chapitre. La copie ne sert qu'une fois chargée, feuilles de style et polices comprises. */
  load(html: string, width: number, height: number, signature: string): void {
    if (this.target === signature) return
    this.target = signature
    this.signature = null
    this.frame.style.width = px(width)
    this.frame.style.height = px(height)
    this.frame.onload = () => {
      if (this.target !== signature) return
      const fonts = this.frame.contentDocument?.fonts.ready ?? Promise.resolve()
      void settleWithin(fonts, FONTS_TIMEOUT_MS).then(() => {
        if (this.target === signature) this.signature = signature
      })
    }
    this.frame.srcdoc = html
  }

  /** Copie périmée (livre refermé, rouvert). */
  forget(): void {
    this.target = null
    this.signature = null
  }

  /** Montre la page `frame` dans la zone de texte `host` (coordonnées de la scène). */
  place(host: Box, frame: Box): void {
    Object.assign(this.window.style, { left: px(host.left), top: px(host.top), width: px(host.width), height: px(host.height) })
    this.frame.style.left = px(frame.left - host.left)
    this.frame.style.top = px(frame.top - host.top)
  }

  /** Page à plat, de la taille de la scène ; `clip` coupe au pli (ou couvre tout). */
  showFlat(layout: FoldLayout, geometry: TurnGeometry, z: number): void {
    openClip(this.clip, layout.size, z)
    Object.assign(this.body.style, { width: px(geometry.width), height: px(geometry.height), willChange: 'transform' })
    this.mirror.style.transform = ''
  }

  /** Dos de la feuille (double page) : boîte de la taille de la feuille, page atteinte retournée. */
  showVerso(layout: FoldLayout, geometry: TurnGeometry): void {
    openClip(this.clip, layout.size, Z.verso)
    Object.assign(this.body.style, { width: px(layout.sheet.width), height: px(geometry.height), willChange: 'transform' })
  }

  /** Transformations de l'image courante : cadre, page, miroir. */
  move(clip: Matrix, body: Matrix, mirror?: Matrix): void {
    this.clip.style.transform = matrixOf(clip)
    this.body.style.transform = matrixOf(body)
    if (mirror) this.mirror.style.transform = matrixOf(mirror)
  }

  hide(): void {
    Object.assign(this.clip.style, { visibility: 'hidden', transform: '', willChange: '' })
    Object.assign(this.body.style, { transform: '', willChange: '' })
    this.mirror.style.transform = ''
  }

  destroy(): void {
    this.frame.onload = null
    this.clip.remove()
  }
}

export class PageTurner {
  private readonly options: PageTurnerOptions
  private readonly ghosts: Ghost[] = []
  /** Ombre sur la page découverte (bande étirée). */
  private readonly under: HTMLDivElement
  /** Dos de la feuille : cadre de découpe > papier. */
  private readonly backClip: HTMLDivElement
  private readonly paper: HTMLDivElement
  /** Relief du pli, au-dessus du dos (et de la page atteinte en double page) : cadre > boîte de la feuille > bande. */
  private readonly creaseClip: HTMLDivElement
  private readonly creaseSheet: HTMLDivElement
  private readonly crease: HTMLDivElement
  private theme: ReaderTheme | null = null
  private enabled = true
  private active: Turn | null = null
  /** Navigations d'epub.js en cours (pages tournées, feuilles retombées) : la suivante part de la page atteinte. */
  private idle: Promise<void> = Promise.resolve()
  private pending = 0
  private rebuildTimer: number | undefined
  /** Mouvements du doigt regroupés : une mise à jour par image affichée. */
  private frameRequest = 0

  constructor(options: PageTurnerOptions) {
    this.options = options
    const { stage } = options
    this.under = clipFrame(stage, Z.under)
    this.under.style.overflow = 'visible'
    this.backClip = clipFrame(stage, Z.back)
    this.paper = box(this.backClip, true)
    this.creaseClip = clipFrame(stage, Z.crease)
    this.creaseSheet = box(this.creaseClip, true)
    this.crease = box(this.creaseSheet, false)
    this.crease.style.width = px(STRIP)
  }

  setTheme(theme: ReaderTheme): void {
    this.theme = theme
    for (const ghost of this.ghosts) ghost.setBackground(theme.background)
    // Peints une fois par thème : pendant le geste, ils ne font que bouger.
    this.under.style.background = underShade(theme)
    this.paper.style.background = paperOf(theme)
    this.crease.style.background = creaseShade(theme)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) this.invalidate()
    else this.finish()
  }

  /** La mise en page a pu changer (chapitre affiché, taille, réglages) : copie refaite sous peu. */
  invalidate(): void {
    window.clearTimeout(this.rebuildTimer)
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), REBUILD_DELAY_MS)
  }

  /** Livre refermé ou rouvert : plus rien de ce qu'on a copié ne vaut. */
  reset(): void {
    this.finish()
    for (const ghost of this.ghosts) ghost.forget()
    this.idle = Promise.resolve()
    this.pending = 0
  }

  /**
   * Tap, flèche : la page tourne tout de suite, depuis le coin le plus proche
   * du tap ; une feuille encore en l'air finit d'un coup.
   */
  turn(direction: TurnDirection, corner: TurnCorner = 'bottom'): void {
    this.finish()
    if (!this.options.canTurn(direction)) return
    void this.idle.then(() => {
      const turn = this.start(direction, corner, false)
      if (turn) this.play(turn, true)
      else this.track(this.options.navigate(direction))
    })
  }

  /**
   * Début d'un geste : le coin de la feuille suivra le doigt. `false` si elle
   * ne le peut pas (chapitre voisin, copie pas prête) : le geste reste un
   * swipe, décidé au lâcher.
   */
  grab(direction: TurnDirection, corner: TurnCorner): boolean {
    this.finish()
    if (this.pending > 0 || !this.options.canTurn(direction) || !this.options.staysInChapter(direction)) return false
    return this.start(direction, corner, true) !== null
  }

  /** Le doigt bouge (déplacement depuis le début du geste) : dessiné à la prochaine image. */
  drag(dx: number, dy: number): void {
    const turn = this.active
    if (!turn?.interactive || turn.released) return
    turn.point = dragPoint(turn.geometry, turn.corner, dx, dy)
    if (this.frameRequest) return
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0
      if (this.active === turn && !turn.released) this.apply(turn)
    })
  }

  /** Doigt levé : la feuille finit de tourner, ou retombe. `velocity` en px/s, positive vers la droite. */
  release(velocity: number): void {
    const turn = this.active
    if (!turn?.interactive || turn.released) return
    turn.released = true
    const { start, end } = turnPath(turn.geometry, turn.corner)
    // Vitesse dans le sens où la feuille tourne.
    const speed = Math.sign(end.x - start.x) * velocity
    const progress = progressOf(turn.geometry, turn.corner, turn.point)
    this.play(turn, speed > FLICK_SPEED || (speed > -FLICK_SPEED && progress >= COMMIT_AT))
  }

  /** Achève tout de suite la feuille en cours (autre page demandée, sommaire, curseur…). */
  finish(): void {
    const turn = this.active
    if (!turn) return
    if (turn.interactive && !turn.released) turn.commit = progressOf(turn.geometry, turn.corner, turn.point) >= COMMIT_AT
    this.end(turn)
  }

  destroy(): void {
    window.clearTimeout(this.rebuildTimer)
    cancelAnimationFrame(this.frameRequest)
    this.finish()
    for (const ghost of this.ghosts) ghost.destroy()
    this.ghosts.length = 0
    this.under.remove()
    this.backClip.remove()
    this.creaseClip.remove()
  }

  /* ---- Copies du chapitre ------------------------------------------------ */

  private rebuild(): void {
    if (!this.enabled) return
    // La copie sert à la feuille en l'air : on la refera après.
    if (this.active) {
      this.invalidate()
      return
    }
    const snapshot = snapshotOf(this.options.host)
    if (!snapshot) return
    // Double page : une copie pour la page quittée, une autre pour le dos de la feuille.
    const count = this.options.isSpread() ? 2 : 1
    while (this.ghosts.length < count) {
      const ghost = new Ghost(this.options.stage)
      if (this.theme) ghost.setBackground(this.theme.background)
      this.ghosts.push(ghost)
    }
    const stale = this.ghosts.slice(0, count).filter((ghost) => ghost.signature !== snapshot.signature)
    if (stale.length === 0) return
    // Même mode de rendu que l'original (un chapitre sans doctype est en mode « quirks ») : mêmes lignes, même page.
    const doctype = snapshot.doc.compatMode === 'BackCompat' ? '' : '<!DOCTYPE html>' // i18n-ignore — balise HTML, jamais affichée
    const html = `${doctype}${snapshot.doc.documentElement.outerHTML}`
    for (const ghost of stale) ghost.load(html, snapshot.frame.offsetWidth, snapshot.frame.offsetHeight, snapshot.signature)
  }

  /* ---- Une page tournée -------------------------------------------------- */

  private start(direction: TurnDirection, corner: TurnCorner, interactive: boolean): Turn | null {
    const { stage, host, page, pageClip } = this.options
    if (!this.enabled || !this.theme || reducedMotion()) return null
    const snapshot = snapshotOf(host)
    const spread = this.options.isSpread()
    const count = spread ? 2 : 1
    const ready = snapshot && this.ghosts.length >= count && this.ghosts.slice(0, count).every((ghost) => ghost.signature === snapshot.signature)
    if (!snapshot || !ready) {
      this.invalidate()
      return null
    }

    const origin = stage.getBoundingClientRect()
    const hostBox = relative(host.getBoundingClientRect(), origin)
    const geometry: TurnGeometry = {
      mode: spread ? 'spread' : 'single',
      direction,
      width: origin.width,
      height: origin.height,
      spine: spread ? hostBox.left + hostBox.width / 2 : 0,
      swap: false,
    }
    const [first, second] = this.ghosts
    const unfolding = !spread && direction === 'prev'
    const turn: Turn = {
      geometry,
      corner,
      point: turnPath(geometry, corner).start,
      motion: { value: 0 },
      tween: null,
      host: hostBox,
      before: relative(snapshot.frame.getBoundingClientRect(), origin),
      after: null,
      frame: snapshot.frame,
      // Page simple : une copie, coupée au pli en avant, dessous en arrière (c'est la vraie page qui se déplie).
      front: unfolding ? null : (first ?? null),
      cover: unfolding ? (first ?? null) : null,
      verso: spread ? (second ?? null) : null,
      versoShown: false,
      navigated: false,
      navigation: Promise.resolve(),
      interactive,
      released: false,
      commit: true,
    }

    // Mise en place (une fois par page tournée) : tailles et calques GPU.
    const layout = foldLayout(geometry, corner, turn.point)
    for (const ghost of [turn.front, turn.cover]) ghost?.place(hostBox, turn.before)
    turn.front?.showFlat(layout, geometry, Z.front)
    if (turn.cover) {
      turn.cover.showFlat(layout, geometry, Z.cover)
      // Dessous, à plat, jamais coupée.
      const rest = restClip(geometry)
      turn.cover.move(rest.clip, rest.unclip)
    }
    if (unfolding) {
      openClip(pageClip, layout.size, Z.front)
      Object.assign(pageClip.style, { overflow: 'hidden', transformOrigin: '0 0' })
      Object.assign(page.style, { width: px(geometry.width), height: px(geometry.height), transformOrigin: '0 0', willChange: 'transform' })
    }
    this.backClip.style.width = px(layout.size)
    this.backClip.style.height = px(layout.size)
    this.creaseClip.style.width = px(layout.size)
    this.creaseClip.style.height = px(layout.size)
    for (const sheet of [this.paper, this.creaseSheet]) {
      Object.assign(sheet.style, { width: px(layout.sheet.width), height: px(geometry.height), willChange: 'transform' })
    }
    Object.assign(this.crease.style, { height: px(layout.size), willChange: 'transform' })
    Object.assign(this.under.style, { width: px(STRIP), height: px(layout.size), willChange: 'transform' })
    for (const element of [this.backClip, this.creaseClip]) element.style.willChange = 'transform'

    this.active = turn
    this.apply(turn)
    if (interactive) this.options.onHoldChange(true)

    // La vraie page tourne maintenant, sous la copie.
    const navigation = this.options.navigate(direction).then(() => {
      turn.navigated = true
      // Même chapitre : la copie sait aussi montrer la page atteinte (dos de la feuille, en double page).
      if (spread && snapshotOf(host)?.frame === turn.frame) {
        turn.after = relative(turn.frame.getBoundingClientRect(), stage.getBoundingClientRect())
        turn.geometry.swap = true
      }
      if (this.active === turn) this.apply(turn)
    })
    turn.navigation = settleWithin(navigation, NAVIGATION_TIMEOUT_MS)
    this.track(turn.navigation)
    return turn
  }

  /**
   * Anime la feuille jusqu'au bout (`commit`) ou jusqu'à sa place. Un tap suit
   * le chemin du coin (il se soulève en diagonale) ; une feuille lâchée part
   * d'où le doigt l'a laissée.
   */
  private play(turn: Turn, commit: boolean): void {
    turn.commit = commit
    cancelAnimationFrame(this.frameRequest)
    this.frameRequest = 0
    const { geometry, corner } = turn
    const { start, end } = turnPath(geometry, corner)
    const from = { ...turn.point }
    const to = commit ? end : start
    const remaining = Math.abs(to.x - from.x) / Math.max(1, Math.abs(end.x - start.x))
    const run = () => {
      if (this.active !== turn) return
      turn.motion.value = 0
      turn.tween = gsap.to(turn.motion, {
        value: 1,
        duration: Math.max(0.14, TURN_DURATION * (turn.interactive ? remaining : 1)),
        ease: TURN_EASE,
        overwrite: true,
        onUpdate: () => {
          const t = turn.motion.value
          turn.point = turn.interactive
            ? dragPoint(geometry, corner, from.x - start.x + (to.x - from.x) * t, from.y - start.y + (to.y - from.y) * t)
            : pointAt(geometry, corner, t)
          this.apply(turn)
        },
        onComplete: () => this.end(turn),
      })
    }
    // La page atteinte doit être affichée avant d'être découverte (chapitre suivant en chargement).
    if (commit && !turn.navigated) void turn.navigation.then(run)
    else run()
  }

  private end(turn: Turn): void {
    turn.tween?.kill()
    turn.tween = null
    if (this.active !== turn) return
    this.active = null
    const done = () => {
      this.clear(turn)
      if (turn.interactive) this.options.onHoldChange(false)
    }
    if (turn.commit) {
      done()
      return
    }
    // Feuille retombée : la vraie page revient d'abord à sa place, sous la copie encore posée.
    const undo = turn.navigation.then(() => settleWithin(this.options.navigate(opposite(turn.geometry.direction)), NAVIGATION_TIMEOUT_MS))
    this.track(undo)
    void undo.then(done)
  }

  private clear(turn: Turn): void {
    turn.front?.hide()
    turn.cover?.hide()
    turn.verso?.hide()
    const { page, pageClip } = this.options
    Object.assign(pageClip.style, { width: '', height: '', transform: '', transformOrigin: '', zIndex: '', overflow: '', willChange: '', visibility: '' })
    Object.assign(page.style, { width: '', height: '', transform: '', transformOrigin: '', willChange: '' })
    for (const element of [this.under, this.backClip, this.creaseClip]) {
      Object.assign(element.style, { visibility: 'hidden', transform: '', willChange: '' })
    }
    for (const element of [this.paper, this.creaseSheet, this.crease]) {
      Object.assign(element.style, { transform: '', willChange: '' })
    }
  }

  /** Suit une navigation d'epub.js : les pages suivantes partiront de la page qu'elle atteint. */
  private track(navigation: Promise<unknown>): void {
    this.pending += 1
    const settled = settleWithin(navigation, NAVIGATION_TIMEOUT_MS).then(() => {
      this.pending = Math.max(0, this.pending - 1)
    })
    this.idle = Promise.all([this.idle, settled]).then(noop)
  }

  /**
   * Dessine la scène pour la position courante du coin : des `transform`
   * seulement. Styles écrits directement (pas `gsap.set`) : la copie couvre
   * la page DANS LA MÊME image que le tap.
   */
  private apply(turn: Turn): void {
    const layout = foldLayout(turn.geometry, turn.corner, turn.point)
    const { clip, unclip, fold } = layout

    // Partie encore à plat : la copie de la page quittée, ou la vraie page qui se déplie.
    if (turn.front) turn.front.move(clip, unclip)
    else {
      this.options.pageClip.style.transform = matrixOf(clip)
      this.options.page.style.transform = matrixOf(unclip)
    }

    if (!fold) {
      for (const element of [this.under, this.backClip, this.creaseClip]) element.style.visibility = 'hidden'
      if (turn.versoShown) {
        turn.verso?.hide()
        turn.versoShown = false
      }
      return
    }

    const clipMatrix = matrixOf(clip)
    const backMatrix = matrixOf(fold.back)
    Object.assign(this.under.style, { visibility: 'visible', transform: matrixOf(fold.under) })
    Object.assign(this.backClip.style, { visibility: 'visible', transform: clipMatrix })
    this.paper.style.transform = backMatrix
    Object.assign(this.creaseClip.style, { visibility: 'visible', transform: clipMatrix })
    this.creaseSheet.style.transform = backMatrix
    this.crease.style.transform = matrixOf(fold.crease)

    // Double page : la page atteinte au dos de la feuille, dès qu'elle est connue.
    const verso = turn.verso
    if (verso && fold.verso && turn.after) {
      if (!turn.versoShown) {
        verso.place(turn.host, turn.after)
        verso.showVerso(layout, turn.geometry)
        turn.versoShown = true
      }
      verso.move(clip, fold.back, fold.verso.mirror)
    } else if (verso && turn.versoShown) {
      verso.hide()
      turn.versoShown = false
    }
  }
}
