/*
 * Les objets de la toile côté client. Mêmes formes que celles que le serveur valide
 * (`backend/src/modules/canvas/canvas.schema.ts`) : s trait, r rectangle, e ellipse, l ligne,
 * a flèche, g polygone, b courbe de Bézier, x texte, f cadre. Style commun : c trait,
 * f remplissage (ou null), a opacité, sw épaisseur du trait, d pointillés.
 */

export type ObjectType = 's' | 'r' | 'e' | 'l' | 'a' | 'g' | 'b' | 'x' | 'f'

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Common {
  c: string
  f?: string | null
  a?: number
  sw: number
  d?: 0 | 1 | 2
}

/** Trait à main levée : x, y, pression à la suite. */
export interface StrokeData extends Common {
  t: 's'
  p: number[]
  b?: string
}
export interface RectData extends Common {
  t: 'r'
  x: number
  y: number
  w: number
  h: number
  /** Rotation (radians) autour du centre. */
  r?: number
  /** Rayon des coins. */
  k?: number
}
export interface EllipseData extends Common {
  t: 'e'
  x: number
  y: number
  w: number
  h: number
  r?: number
}
export interface LineData extends Common {
  t: 'l' | 'a'
  q: number[]
}
export interface PolyData extends Common {
  t: 'g'
  q: number[]
  cl?: 1
}
/** Courbe : par nœud x, y, poignée d'entrée x, y, poignée de sortie x, y (absolues). */
export interface BezierData extends Common {
  t: 'b'
  n: number[]
  cl?: 1
}
export interface TextData extends Common {
  t: 'x'
  x: number
  y: number
  s: number
  tx: string
  al?: 1 | 2
  r?: number
  bd?: 1
}
export interface FrameData extends Common {
  t: 'f'
  x: number
  y: number
  w: number
  h: number
  tt: string
  co: string[]
}

export type Data = StrokeData | RectData | EllipseData | LineData | PolyData | BezierData | TextData | FrameData

export interface CanvasObject {
  id: string
  owner: string
  data: Data
  z: number
  /** Numéro de version : une opération plus ancienne que celle connue est ignorée. */
  v: number
  likes: number
  /** Masqué par des signalements (visible pour les administrateurs seulement). */
  hidden: boolean
  box: Box
}

/** Aperçu d'un autre joueur : trait ou forme en cours de tracé. */
export interface Ghost {
  conn: number
  id: string
  data: Data
  at: number
}

export type ToolId = 'hand' | 'select' | 'pen' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'bezier' | 'text' | 'frame' | 'pick' | 'heart'

export interface PeerInfo {
  conn: number
  userId: string
  name: string | null
  avatar: string | null
  color: string
  tool: ToolId
  ink: string
  size: number
}

export interface BrushDef {
  id: string
  price: number
  likes: number
}

export interface Limits {
  cell: number
  world: number
  extent: number
  strokePoints: number
  inkMax: number
  frames: { max: number; collaborators: number }
  tile: { base: number; maxLevel: number }
  reactions: string[]
  chat: number
  brushes: BrushDef[]
}
