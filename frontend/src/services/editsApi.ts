import { api } from './api'

/** Univers proposés en filtre (cf. `backend/src/modules/edits/edits.logic.ts`). */
export const EDIT_UNIVERSES = [
  'naruto',
  'onepiece',
  'jojo',
  'demonslayer',
  'jjk',
  'aot',
  'dragonball',
  'bleach',
  'hxh',
  'chainsawman',
  'mha',
  'sololeveling',
  'frieren',
  'deathnote',
  'tokyoghoul',
  'vinland',
  'bluelock',
  'haikyuu',
  'berserk',
  'spyxfamily',
] as const
export type EditUniverse = (typeof EDIT_UNIVERSES)[number]

/** Un edit : une vidéo verticale de YouTube Shorts. */
export interface EditVideo {
  id: string
  title: string
  channel: string | null
  seconds: number | null
  universe: EditUniverse | null
}

export interface EditsPage {
  items: EditVideo[]
  /** Position de la page suivante ; `null` : tout a été vu. */
  next: number | null
}

export const editsApi = {
  page: (options: { universe: EditUniverse | null; seed: string; offset: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ seed: options.seed, offset: String(options.offset) })
    if (options.universe) params.set('universe', options.universe)
    return api<EditsPage>(`/edits?${params}`, { signal })
  },
}
