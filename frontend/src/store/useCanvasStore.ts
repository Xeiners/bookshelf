import { create } from 'zustand'
import type { BrushDef, Limits, PeerInfo, ToolId } from '../lib/canvas/types'

/*
 * L'état de la toile que l'interface affiche : outil et style courants, sélection, qui est là,
 * état de la connexion. Les objets et la caméra, eux, restent dans le moteur (`lib/canvas/engine`) :
 * ils changent à chaque image, pas l'interface.
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export interface Me {
  conn: number
  userId: string
  name: string | null
  color: string
  admin: boolean
  draw: boolean
  reason: 'young' | 'banned' | null
  waitMs: number
}

export interface Style {
  ink: string
  fill: string
  fillOn: boolean
  width: number
  opacity: number
  brush: string
  dash: 0 | 1 | 2
  radius: number
  fontSize: number
  bold: boolean
  align: 0 | 1 | 2
}

export interface Notice {
  id: number
  kind: 'error' | 'info'
  /** Clé du message (`t.canvas.errors[code]`) ou texte déjà prêt. */
  code: string
}

interface CanvasState extends Style {
  status: ConnectionStatus
  me: Me | null
  limits: Limits | null
  season: string | null
  tool: ToolId
  selection: string[]
  /** Pinceaux utilisables (hors départ). */
  brushes: string[]
  peers: Record<number, PeerInfo>
  zoom: number
  mode: 'vector' | 'tiles'
  canUndo: boolean
  canRedo: boolean
  notice: Notice | null
  /** Couleurs récentes (les plus récentes d'abord). */
  recent: string[]
  /** Plume ou polygone en cours : un geste est ouvert (Entrée termine, Échap annule). */
  drawing: boolean
  /** Le joueur suivi (curseur d'un autre), s'il y en a un. */
  following: number | null
  online: number
  /** Un cadre à rejoindre dès l'ouverture (venu d'une notification). */
  pendingTarget: { x: number; y: number } | null

  set: (patch: Partial<CanvasState>) => void
  setTool: (tool: ToolId) => void
  setStyle: (patch: Partial<Style>) => void
  pushRecent: (color: string) => void
  notify: (code: string, kind?: Notice['kind']) => void
  reset: () => void
}

const STORAGE = 'bookshelf.canvas.style'

const DEFAULT_STYLE: Style = { ink: '#1b1b1f', fill: '#ffd166', fillOn: false, width: 4, opacity: 1, brush: 'pen', dash: 0, radius: 0, fontSize: 28, bold: false, align: 0 }

function savedStyle(): Style {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return DEFAULT_STYLE
    return { ...DEFAULT_STYLE, ...(JSON.parse(raw) as Partial<Style>) }
  } catch {
    return DEFAULT_STYLE
  }
}

let noticeId = 0

const initial = {
  status: 'connecting' as ConnectionStatus,
  me: null,
  limits: null,
  season: null,
  tool: 'pen' as ToolId,
  selection: [] as string[],
  brushes: [] as string[],
  peers: {} as Record<number, PeerInfo>,
  zoom: 1,
  mode: 'vector' as const,
  canUndo: false,
  canRedo: false,
  notice: null,
  recent: [] as string[],
  drawing: false,
  following: null,
  online: 0,
  pendingTarget: null as { x: number; y: number } | null,
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  ...initial,
  ...savedStyle(),
  set: (patch) => set(patch),
  setTool: (tool) => set({ tool, drawing: false }),
  setStyle: (patch) => {
    set(patch)
    try {
      const { ink, fill, fillOn, width, opacity, brush, dash, radius, fontSize, bold, align } = get()
      localStorage.setItem(STORAGE, JSON.stringify({ ink, fill, fillOn, width, opacity, brush, dash, radius, fontSize, bold, align }))
    } catch {
      // Stockage indisponible : le style ne survit pas au rechargement, c'est tout.
    }
  },
  pushRecent: (color) => set((state) => ({ recent: [color, ...state.recent.filter((entry) => entry !== color)].slice(0, 10) })),
  notify: (code, kind = 'error') => set({ notice: { id: (noticeId += 1), kind, code } }),
  reset: () => set({ ...initial }),
}))

export type { BrushDef }
