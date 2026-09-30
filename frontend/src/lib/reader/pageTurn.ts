/**
 * Page qui tourne (romans EPUB) : géométrie d'une feuille qui se PLIE —
 * pure, testée (`frontend/test/pageTurn.test.ts`). La scène qui l'affiche est
 * `pageTurner.ts`.
 *
 * Pas de rotation d'un bloc (la feuille paraîtrait rigide) : un coin de la
 * feuille est tiré vers un point `F` (le doigt). Le pli est la médiatrice du
 * segment coin → `F` ; la partie de la feuille au-delà du pli se rabat
 * par-dessus (symétrie par rapport au pli), et découvre la page suivante. Le
 * coin monte en diagonale puis la feuille se couche : c'est ce qui la rend
 * souple.
 *
 * Coordonnées de la scène (l'écran de lecture), en pixels, y vers le bas.
 */

export type TurnDirection = 'next' | 'prev'
/** `single` : une page à l'écran ; `spread` : double page (écran large). */
export type TurnMode = 'single' | 'spread'
/** Coin tiré : celui du haut ou du bas du bord libre de la feuille. */
export type TurnCorner = 'top' | 'bottom'

export interface Point {
  x: number
  y: number
}

/** Transformation affine, dans l'ordre de CSS `matrix(a, b, c, d, e, f)` : x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface TurnGeometry {
  mode: TurnMode
  direction: TurnDirection
  width: number
  height: number
  /** Abscisse de la reliure : 0 en page simple, le milieu de la double page sinon. */
  spine: number
  /**
   * Double page : la page atteinte est affichable au dos de la feuille (même
   * chapitre). Sinon, le dos reste du papier nu.
   */
  swap: boolean
}

/**
 * Mise en place de la scène pour une position du coin : uniquement des
 * transformations (`matrix()`), composées par la carte graphique sans rien
 * repeindre. Chaque matrice va de l'espace propre d'un calque (origine en
 * haut à gauche, `transform-origin: 0 0`) vers son parent.
 *
 * - `clip` : grand carré de côté `size`, `overflow: hidden`, dont le bord droit
 *   est le pli ; tout ce qu'il contient s'arrête au pli (partie à plat). Au
 *   repos, il couvre simplement la scène.
 * - `unclip` : son inverse, pour qu'un contenu placé dedans reste à sa place.
 * - `back` : le dos de la feuille (boîte de la taille de la feuille), rabattu
 *   par-dessus, dans le carré de découpe (il ne dépasse pas le pli).
 * - `crease` : relief du pli, bande de `STRIP` px de large dans le dos de la feuille.
 * - `under` : ombre sur la page découverte, bande de `STRIP` px dans la scène.
 * - `verso` : double page, la page atteinte au dos de la feuille.
 */
export interface FoldLayout {
  size: number
  /** Feuille : abscisse de son bord gauche et largeur, dans la scène. */
  sheet: { left: number; width: number }
  clip: Matrix
  unclip: Matrix
  /** `null` : rien n'est plié. */
  fold: {
    back: Matrix
    crease: Matrix
    under: Matrix
    /** `mirror` place la page atteinte (coordonnées de la scène) dans la boîte du dos de la feuille. */
    verso: { mirror: Matrix } | null
  } | null
}

/** Largeur de dessin des bandes de dégradé : peintes une fois, étirées ensuite. */
export const STRIP = 100

const EPSILON = 1e-6
const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** La feuille qui tourne : son bord de reliure et son bord libre. */
function sheetOf(geometry: TurnGeometry): { spine: number; outer: number } {
  const { mode, direction, width, spine } = geometry
  if (mode === 'single') return { spine: 0, outer: width }
  // En avant, la page de droite part vers la gauche ; en arrière, celle de gauche part vers la droite.
  return direction === 'next' ? { spine, outer: width } : { spine, outer: 0 }
}

/** Le coin tiré, à plat (feuille pas encore tournée). */
function cornerOf(geometry: TurnGeometry, corner: TurnCorner): Point {
  return { x: sheetOf(geometry).outer, y: corner === 'top' ? 0 : geometry.height }
}

/** Le même coin, feuille entièrement tournée : de l'autre côté de la reliure. */
function turnedCornerOf(geometry: TurnGeometry, corner: TurnCorner): Point {
  const { spine, outer } = sheetOf(geometry)
  return { x: 2 * spine - outer, y: corner === 'top' ? 0 : geometry.height }
}

/**
 * Position du coin au début et à la fin de la page tournée. En page simple,
 * revenir en arrière, c'est la page précédente qui se « déplie » : même
 * feuille, chemin inverse.
 */
export function turnPath(geometry: TurnGeometry, corner: TurnCorner): { start: Point; end: Point } {
  const flat = cornerOf(geometry, corner)
  const turned = turnedCornerOf(geometry, corner)
  return geometry.mode === 'single' && geometry.direction === 'prev' ? { start: turned, end: flat } : { start: flat, end: turned }
}

/**
 * Une feuille ne s'étire pas : le coin tiré reste à distance de la reliure au
 * plus la largeur de la feuille (depuis le coin de reliure du même bord), et
 * au plus sa diagonale (depuis l'autre). Les deux coins de reliure restent
 * ainsi toujours à plat.
 */
export function constrain(geometry: TurnGeometry, corner: TurnCorner, point: Point): Point {
  const { spine, outer } = sheetOf(geometry)
  const width = Math.abs(outer - spine)
  const near: Point = { x: spine, y: corner === 'top' ? 0 : geometry.height }
  const far: Point = { x: spine, y: corner === 'top' ? geometry.height : 0 }
  const diagonal = Math.hypot(width, geometry.height)
  let result = point
  for (const [anchor, radius] of [
    [near, width],
    [far, diagonal],
  ] as const) {
    const length = distance(result, anchor)
    // Un rien en deçà : le coin de reliure reste strictement du côté à plat.
    const limit = radius * (1 - 1e-4)
    if (length > limit) {
      result = { x: anchor.x + ((result.x - anchor.x) * limit) / length, y: anchor.y + ((result.y - anchor.y) * limit) / length }
    }
  }
  return result
}

/**
 * Coin d'une page tournée d'un tap : il part en diagonale (il se soulève
 * d'abord), traverse la page puis se couche de l'autre côté de la reliure.
 */
export function pointAt(geometry: TurnGeometry, corner: TurnCorner, progress: number): Point {
  const p = clamp01(progress)
  const { start, end } = turnPath(geometry, corner)
  // Levée maximale à mi-course, vers l'intérieur de la page (vers le haut pour le coin du bas).
  const lift = Math.sin(Math.PI * p) * geometry.height * 0.18 * (corner === 'bottom' ? -1 : 1)
  return constrain(geometry, corner, { x: start.x + (end.x - start.x) * p, y: start.y + (end.y - start.y) * p + lift })
}

/** Avancement (0 → 1) d'un coin tenu au doigt, le long de son chemin. */
export function progressOf(geometry: TurnGeometry, corner: TurnCorner, point: Point): number {
  const { start, end } = turnPath(geometry, corner)
  const span = end.x - start.x
  return Math.abs(span) < EPSILON ? 0 : clamp01((point.x - start.x) / span)
}

/** Coin tenu au doigt : il suit le déplacement du doigt depuis le début du geste. */
export function dragPoint(geometry: TurnGeometry, corner: TurnCorner, dx: number, dy: number): Point {
  const { start } = turnPath(geometry, corner)
  return constrain(geometry, corner, { x: start.x + dx, y: start.y + dy })
}

/* ---- Transformations ---------------------------------------------------------------------- */

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const translate = (x: number, y: number): Matrix => ({ ...IDENTITY, e: x, f: y })
const rotate = (radians: number): Matrix => {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}
const scale = (x: number, y: number): Matrix => ({ ...IDENTITY, a: x, d: y })

/** Applique une transformation affine à un point. */
export function transformPoint(matrix: Matrix, point: Point): Point {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }
}

/** Composition, de gauche à droite : `compose(A, B, C)` applique C, puis B, puis A (comme CSS `transform: A B C`). */
export function compose(...matrices: Matrix[]): Matrix {
  return matrices.reduce((outer, inner) => ({
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  }), IDENTITY)
}

export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  }
}

/* ---- Pli ---------------------------------------------------------------------------------- */

/** Côté du carré de découpe : il couvre toute la scène, quel que soit l'angle du pli. */
export const clipSize = (geometry: TurnGeometry) => 2 * Math.ceil(Math.hypot(geometry.width, geometry.height)) + 4

/** Au repos, rien de coupé : le carré de découpe, centré, couvre toute la scène. */
export function restClip(geometry: TurnGeometry): { clip: Matrix; unclip: Matrix } {
  const size = clipSize(geometry)
  const clip = translate(geometry.width / 2 - size / 2, geometry.height / 2 - size / 2)
  return { clip, unclip: invert(clip) }
}

/**
 * La scène quand le coin tiré est en `point`. Le pli est la médiatrice du
 * segment coin → `point` ; la partie de la feuille au-delà (côté coin) se
 * rabat par-dessus, par symétrie autour du pli.
 */
export function foldLayout(geometry: TurnGeometry, corner: TurnCorner, point: Point): FoldLayout {
  const { height, spine, mode, swap } = geometry
  const size = clipSize(geometry)
  const { spine: sheetSpine, outer } = sheetOf(geometry)
  const sheet = { left: Math.min(sheetSpine, outer), width: Math.abs(outer - sheetSpine) }
  const pulled = cornerOf(geometry, corner)
  const length = distance(pulled, point)

  if (length < 0.5) return { size, sheet, ...restClip(geometry), fold: null }

  // Repère du pli : origine au milieu du segment, axe x vers le coin tiré (la partie rabattue).
  const middle = { x: (pulled.x + point.x) / 2, y: (pulled.y + point.y) / 2 }
  const normal = { x: (pulled.x - point.x) / length, y: (pulled.y - point.y) / length }
  const foldFrame = compose(translate(middle.x, middle.y), rotate(Math.atan2(normal.y, normal.x)))

  // Carré de découpe : x ∈ [−size, 0] dans le repère du pli, soit tout ce qui est en deçà du pli.
  const clip = compose(foldFrame, translate(-size, -size / 2))
  const unclip = invert(clip)

  // Symétrie autour du pli : X' = X − 2·((X − M)·n)·n.
  const offset = 2 * (middle.x * normal.x + middle.y * normal.y)
  const reflect: Matrix = {
    a: 1 - 2 * normal.x * normal.x,
    b: -2 * normal.x * normal.y,
    c: -2 * normal.x * normal.y,
    d: 1 - 2 * normal.y * normal.y,
    e: offset * normal.x,
    f: offset * normal.y,
  }
  const toSheet = translate(sheet.left, 0)

  // Profondeur de la partie rabattue : distance au pli du coin de la feuille le plus éloigné.
  const corners = [
    { x: sheet.left, y: 0 },
    { x: sheet.left + sheet.width, y: 0 },
    { x: sheet.left, y: height },
    { x: sheet.left + sheet.width, y: height },
  ]
  const depth = Math.max(1, ...corners.map((c) => (c.x - middle.x) * normal.x + (c.y - middle.y) * normal.y))
  const reach = Math.min(64, Math.max(18, depth * 0.45))
  const strip = (span: number) => compose(foldFrame, translate(0, -size / 2), scale(span / STRIP, 1))

  // Double page : dos de la feuille = la page atteinte, retournée par rapport à la reliure
  // (une fois la feuille couchée, les deux symétries s'annulent : elle est à l'endroit).
  const mirror: Matrix = { a: -1, b: 0, c: 0, d: 1, e: 2 * spine, f: 0 }

  return {
    size,
    sheet,
    clip,
    unclip,
    fold: {
      back: compose(unclip, reflect, toSheet),
      crease: compose(invert(toSheet), strip(depth)),
      under: strip(reach),
      verso: mode === 'spread' && swap ? { mirror: compose(invert(toSheet), mirror) } : null,
    },
  }
}
