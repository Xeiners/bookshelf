import { KEY_CHANNELS, LEVEL_FORMAT, LIMITS, WORLD_HEIGHT } from './constants'
import { SECTION_KINDS, type LevelPlan } from './generator'
import { THEME_IDS, type GravityLevel, type LevelElement } from './types'

/*
 * Lecture d'un niveau venu d'ailleurs (fichier, presse-papiers, IA) : tout est vérifié et recopié
 * champ par champ ; le moindre écart est signalé par son chemin (`elements[12].w`). Le serveur
 * applique les mêmes bornes avant d'enregistrer.
 */

export type ParseResult = { ok: true; level: GravityLevel } | { ok: false; issues: string[] }

const X_RANGE: [number, number] = [-20, LIMITS.length[1] + 100]
const Y_RANGE: [number, number] = [-10, WORLD_HEIGHT + 10]
const SIZE_RANGE: [number, number] = [0.2, LIMITS.length[1] + 100]

export function parseLevel(input: unknown): ParseResult {
  const issues: string[] = []
  const root = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>

  const num = (value: unknown, path: string, [min, max]: readonly [number, number], fallback = 0) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      issues.push(path)
      return fallback
    }
    return Math.round(value * 1000) / 1000
  }
  const optional = (value: unknown, path: string, range: readonly [number, number]) => (value === undefined ? undefined : num(value, path, range))

  const id = typeof root.id === 'string' && /^[a-z0-9-]{1,48}$/.test(root.id) ? root.id : (issues.push('id'), 'niveau')
  const name = typeof root.name === 'string' && root.name.trim().length > 0 && root.name.length <= LIMITS.name ? root.name.trim() : (issues.push('name'), '')
  const theme = THEME_IDS.find((themeId) => themeId === root.theme) ?? (issues.push('theme'), 'konoha' as const)
  const difficulty = Math.round(num(root.difficulty, 'difficulty', LIMITS.difficulty, 1))
  const speed = num(root.speed, 'speed', LIMITS.speed, 8)
  const length = num(root.length, 'length', LIMITS.length, 100)
  if (root.format !== undefined && root.format !== LEVEL_FORMAT) issues.push('format')
  const start = (typeof root.start === 'object' && root.start !== null ? root.start : {}) as Record<string, unknown>
  const startY = num(start.y, 'start.y', Y_RANGE, 11)
  const startG = start.g === 1 || start.g === -1 ? start.g : (issues.push('start.g'), 1 as const)

  const elements: LevelElement[] = []
  const list = Array.isArray(root.elements) ? root.elements : (issues.push('elements'), [])
  if (list.length > LIMITS.elements) issues.push('elements.length')
  list.slice(0, LIMITS.elements).forEach((raw: unknown, index) => {
    const at = `elements[${index}]`
    const element = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const x = num(element.x, `${at}.x`, X_RANGE)
    const y = () => num(element.y, `${at}.y`, Y_RANGE)
    const size = (key: 'w' | 'h') => num(element[key], `${at}.${key}`, SIZE_RANGE, 1)
    switch (element.type) {
      case 'block':
      case 'crumble':
      case 'flip':
        elements.push({ type: element.type, x, y: y(), w: size('w'), h: size('h') })
        break
      case 'mover':
        elements.push({
          type: 'mover',
          x,
          y: y(),
          w: size('w'),
          h: size('h'),
          dx: num(element.dx ?? 0, `${at}.dx`, [-60, 60]),
          dy: num(element.dy ?? 0, `${at}.dy`, [-20, 20]),
          period: num(element.period, `${at}.period`, [0.5, 30], 2),
          ...(element.phase !== undefined ? { phase: num(element.phase, `${at}.phase`, [0, 1]) } : {}),
        })
        break
      case 'spikes':
        elements.push({ type: 'spikes', x, y: y(), w: size('w'), dir: element.dir === 'down' ? 'down' : element.dir === 'up' ? 'up' : (issues.push(`${at}.dir`), 'up') })
        break
      case 'shuriken': {
        const extra = {
          r: optional(element.r, `${at}.r`, [0.3, 3]),
          dx: optional(element.dx, `${at}.dx`, [-60, 60]),
          dy: optional(element.dy, `${at}.dy`, [-20, 20]),
          period: optional(element.period, `${at}.period`, [0.5, 30]),
          phase: optional(element.phase, `${at}.phase`, [0, 1]),
          orbit: optional(element.orbit, `${at}.orbit`, [0, 8]),
        }
        elements.push({ type: 'shuriken', x, y: y(), ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) })
        break
      }
      case 'warp':
        elements.push({ type: 'warp', x, y: y(), w: size('w'), h: size('h'), tx: num(element.tx, `${at}.tx`, X_RANGE), ty: num(element.ty, `${at}.ty`, Y_RANGE) })
        break
      case 'flame':
        elements.push({
          type: 'flame',
          x,
          y: y(),
          w: size('w'),
          reach: num(element.reach, `${at}.reach`, [0.3, WORLD_HEIGHT], 1),
          dir: element.dir === 'down' ? 'down' : element.dir === 'up' ? 'up' : (issues.push(`${at}.dir`), 'up'),
          period: num(element.period, `${at}.period`, [0.5, 30], 2),
          on: num(element.on, `${at}.on`, [0.05, 0.95], 0.5),
          ...(element.phase !== undefined ? { phase: num(element.phase, `${at}.phase`, [0, 1]) } : {}),
        })
        break
      case 'spring':
        elements.push({ type: 'spring', x, y: y(), w: size('w'), dir: element.dir === 'down' ? 'down' : element.dir === 'up' ? 'up' : (issues.push(`${at}.dir`), 'up') })
        break
      case 'cloud':
        elements.push({ type: 'cloud', x, y: y(), w: size('w'), h: size('h'), dir: element.dir === 'down' ? 'down' : element.dir === 'up' ? 'up' : (issues.push(`${at}.dir`), 'up') })
        break
      case 'key':
        elements.push({ type: 'key', x, y: y(), channel: Math.round(num(element.channel, `${at}.channel`, [0, KEY_CHANNELS - 1])) })
        break
      case 'barrier':
        elements.push({ type: 'barrier', x, y: y(), w: size('w'), h: size('h'), channel: Math.round(num(element.channel, `${at}.channel`, [0, KEY_CHANNELS - 1])) })
        break
      case 'kunai':
        elements.push({
          type: 'kunai',
          x,
          y: y(),
          speed: num(element.speed, `${at}.speed`, [2, 60], 15),
          range: num(element.range, `${at}.range`, [1, 120], 20),
          period: num(element.period, `${at}.period`, [0.5, 30], 3),
          ...(element.phase !== undefined ? { phase: num(element.phase, `${at}.phase`, [0, 1]) } : {}),
        })
        break
      case 'ghost':
        elements.push({
          type: 'ghost',
          x,
          y: y(),
          w: size('w'),
          h: size('h'),
          period: num(element.period, `${at}.period`, [0.5, 30], 2),
          on: num(element.on, `${at}.on`, [0.05, 0.95], 0.5),
          ...(element.phase !== undefined ? { phase: num(element.phase, `${at}.phase`, [0, 1]) } : {}),
        })
        break
      case 'moon':
      case 'scroll':
      case 'log':
        elements.push({ type: element.type, x, y: y() })
        break
      case 'size':
        elements.push({ type: 'size', x, y: y(), w: size('w'), h: size('h'), mini: typeof element.mini === 'boolean' ? element.mini : (issues.push(`${at}.mini`), true) })
        break
      case 'checkpoint':
        // Ancien format : les points de reprise n'existent plus (une chute renvoie au départ), on les écarte.
        break
      default:
        issues.push(`${at}.type`)
    }
  })

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, level: { format: LEVEL_FORMAT, id, name, theme, difficulty, speed, length, start: { y: startY, g: startG }, elements } }
}

/** Lecture d'un plan de niveau (celui qu'écrit une IA) ; `null` s'il ne tient pas debout. */
export function parsePlan(input: unknown): LevelPlan | null {
  const root = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const theme = THEME_IDS.find((themeId) => themeId === root.theme)
  const difficulty = typeof root.difficulty === 'number' ? Math.round(root.difficulty) : NaN
  if (!theme || !(difficulty >= 1 && difficulty <= 10) || typeof root.name !== 'string' || !root.name.trim() || !Array.isArray(root.sections)) return null
  const sections = root.sections.flatMap((raw: unknown) => {
    const section = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const kind = SECTION_KINDS.find((value) => value === section.kind)
    const intensity = typeof section.intensity === 'number' ? Math.round(section.intensity) : NaN
    return kind && intensity >= 1 && intensity <= 10 ? [{ kind, intensity }] : []
  })
  if (sections.length < 1 || sections.length > 80) return null
  return { name: root.name.trim().slice(0, LIMITS.name), theme, difficulty, sections }
}
