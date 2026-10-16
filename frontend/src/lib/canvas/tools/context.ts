import type { Style } from '../../../store/useCanvasStore'
import type { Camera } from '../camera'
import type { Entry } from '../history'
import type { Scene } from '../scene'
import type { CanvasObject, Common, Data, Limits, TextData } from '../types'

/*
 * Ce que le moteur met à la disposition des outils, et ce qu'un outil sait faire. Un outil ne
 * touche jamais au réseau ni à l'écran directement : il lit la scène, propose des aperçus
 * (`live…`, calque du dessus) et, à la fin du geste, `commit` une entrée d'historique que le
 * moteur applique (tout de suite chez lui) et envoie.
 */

export interface PointerInfo {
  /** Position à l'écran (pixels CSS, dans le canvas). */
  sx: number
  sy: number
  /** Position dans le monde. */
  x: number
  y: number
  pressure: number
  pointerType: string
  shift: boolean
  alt: boolean
  /** Ctrl ou ⌘. */
  mod: boolean
  button: number
  /** 1 clic, 2 double-clic… */
  detail: number
  time: number
  /** Points intermédiaires du stylet (monde, pression) depuis le dernier événement. */
  coalesced: { x: number; y: number; pressure: number }[]
}

export interface Overlay {
  ctx: CanvasRenderingContext2D
  world: () => void
  screen: () => void
}

export interface TextEditOptions {
  /** Position (monde) du coin supérieur gauche du texte. */
  x: number
  y: number
  size: number
  color: string
  bold: boolean
  align: 0 | 1 | 2
  value: string
  multiline: boolean
  /** Texte validé (non vide) ; `null` : annulé. */
  done: (value: string | null) => void
}

export interface ToolContext {
  readonly camera: Camera
  readonly scene: Scene
  readonly limits: Limits
  readonly container: HTMLElement
  style(): Style
  state(): { selection: string[]; tool: string }
  meId(): string
  isAdmin(): boolean
  canDraw(): boolean
  newId(): string
  /** Un objet que je peux modifier (le mien, ou n'importe lequel pour un administrateur). */
  canEdit(object: CanvasObject): boolean
  /** Un cadre réservé recouvre ce point sans que j'y aie droit ? */
  lockedAt(x: number, y: number, box?: { minX: number; minY: number; maxX: number; maxY: number }): boolean
  /** Tolérance de clic en unités du monde. */
  tolerance(): number
  commit(entry: Entry): void
  /** Applique localement (aperçu qui reste), sans rien envoyer ni noter dans l'historique. */
  previewObject(object: CanvasObject): void
  liveStroke(id: string, points: number[], style: Common & { b?: string }): void
  liveObject(id: string, data: Data): void
  liveEnd(id: string): void
  redraw(): void
  notify(code: string): void
  select(ids: string[]): void
  setDrawing(drawing: boolean): void
  setTool(tool: 'select' | 'hand' | 'pen'): void
  setStyle(patch: Partial<Style>): void
  pickColor(sx: number, sy: number): string | null
  editText(options: TextEditOptions): void
  like(id: string, x: number, y: number): void
  /** Aller à une position (monde) sans rien d'autre. */
  panBy(dx: number, dy: number): void
}

export interface Tool {
  cursor: string
  down(e: PointerInfo): void
  move(e: PointerInfo): void
  up(e: PointerInfo): void
  /** Le geste est interrompu (deuxième doigt, perte du focus…). */
  cancel(): void
  /** Touche pressée : rend `true` si l'outil l'a prise. */
  key?(e: KeyboardEvent): boolean
  /** Le pointeur bouge sans appui (aperçu du pinceau, survol). */
  hover?(e: PointerInfo): void
  overlay?(api: Overlay): void
  /** Quitte l'outil. */
  dispose?(): void
}

/** Les champs de style communs d'après le style courant. */
export function commonStyle(style: Style, kind: 'shape' | 'line' | 'stroke'): Common {
  const common: Common = { c: style.ink, sw: style.width }
  if (kind === 'shape' && style.fillOn) common.f = style.fill
  else if (kind === 'shape') common.f = null
  if (style.opacity < 1) common.a = Math.round(style.opacity * 100) / 100
  if (style.dash !== 0 && kind !== 'stroke') common.d = style.dash
  return common
}

export const textData = (style: Style, x: number, y: number, value: string): TextData => {
  const data: TextData = { t: 'x', c: style.ink, sw: 0, x, y, s: style.fontSize, tx: value }
  if (style.align) data.al = style.align
  if (style.bold) data.bd = 1
  if (style.opacity < 1) data.a = Math.round(style.opacity * 100) / 100
  return data
}
