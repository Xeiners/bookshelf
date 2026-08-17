/**
 * Mise en rayon de la bibliothèque — logique pure, aucun DOM.
 *
 * Les livres deviennent des « unités » (tranche debout ou pile couchée), rangées
 * ensuite en rayons selon la largeur disponible. Toutes les dimensions dérivent
 * de l'id du livre : une bibliothèque garde la même allure d'une session à l'autre.
 */
import type { LibraryEntry } from '../types/book'
import { hueFromString } from './format'

export const SPINE_GAP = 3
export const SPINE_MIN_WIDTH = 26
export const SPINE_MAX_WIDTH = 52
export const SPINE_MIN_HEIGHT = 112
export const SPINE_MAX_HEIGHT = 156

/** Hauteur du rayon : la plus haute tranche + marge pour le soulèvement au tap. */
export const SHELF_HEIGHT = SPINE_MAX_HEIGHT + 16

export const FLAT_HEIGHT = 15
export const FLAT_MIN_WIDTH = 58
export const FLAT_MAX_WIDTH = 72

const clamp = (min: number, max: number, value: number) => Math.min(max, Math.max(min, value))

/** Pages par défaut quand l'API ne renseigne pas la pagination. */
const FALLBACK_PAGES = 220

export interface SpineMetrics {
  width: number
  height: number
  hue: number
}

/** L'épaisseur suit la pagination : un pavé est visiblement plus large. */
export function spineMetrics(entry: LibraryEntry): SpineMetrics {
  const { book } = entry
  const pages = book.pages ?? FALLBACK_PAGES
  // Graine distincte de la teinte, sinon hauteur et couleur seraient corrélées.
  const heightSeed = hueFromString(`${book.id}#h`)

  return {
    width: Math.round(clamp(SPINE_MIN_WIDTH, SPINE_MAX_WIDTH, 22 + pages / 12)),
    height: SPINE_MIN_HEIGHT + (heightSeed % (SPINE_MAX_HEIGHT - SPINE_MIN_HEIGHT)),
    hue: hueFromString(book.id),
  }
}

export function flatWidth(entry: LibraryEntry): number {
  const pages = entry.book.pages ?? FALLBACK_PAGES
  return Math.round(clamp(FLAT_MIN_WIDTH, FLAT_MAX_WIDTH, FLAT_MIN_WIDTH + pages / 45))
}

export type ShelfUnit =
  | { kind: 'spine'; id: string; entry: LibraryEntry; width: number }
  | { kind: 'stack'; id: string; entries: LibraryEntry[]; width: number }

/**
 * Découpe la liste en unités. Une pile couchée casse la ligne des tranches à
 * intervalle régulier, sauf sur une petite bibliothèque où tout reste debout.
 */
export function buildUnits(entries: LibraryEntry[]): ShelfUnit[] {
  const units: ShelfUnit[] = []
  const allowStacks = entries.length >= 6

  let index = 0
  while (index < entries.length) {
    const entry = entries[index]
    const remaining = entries.length - index
    const rhythm = hueFromString(entry.book.id) % 7

    if (allowStacks && rhythm === 0 && remaining >= 3) {
      const size = remaining >= 4 && rhythm % 2 === 0 ? 3 : 2
      const group = entries.slice(index, index + size)
      units.push({
        kind: 'stack',
        id: `stack-${group[0].book.id}`,
        entries: group,
        width: Math.max(...group.map(flatWidth)),
      })
      index += size
      continue
    }

    units.push({
      kind: 'spine',
      id: entry.book.id,
      entry,
      width: spineMetrics(entry).width,
    })
    index += 1
  }

  return units
}

/** Range les unités en rayons pour une largeur utile donnée. */
export function packShelves(units: ShelfUnit[], available: number): ShelfUnit[][] {
  if (available <= 0) return []

  const rows: ShelfUnit[][] = []
  let current: ShelfUnit[] = []
  let used = 0

  for (const unit of units) {
    const projected = current.length === 0 ? unit.width : used + SPINE_GAP + unit.width

    if (current.length > 0 && projected > available) {
      rows.push(current)
      current = [unit]
      used = unit.width
      continue
    }

    current.push(unit)
    used = projected
  }

  if (current.length > 0) rows.push(current)
  return rows
}

/** Place utile restante sur un rayon — sert à décider d'un serre-livres. */
export function rowFreeSpace(row: ShelfUnit[], available: number): number {
  const used = row.reduce((total, unit, index) => total + unit.width + (index > 0 ? SPINE_GAP : 0), 0)
  return available - used
}
