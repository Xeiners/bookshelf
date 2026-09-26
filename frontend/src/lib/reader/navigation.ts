/**
 * Navigation du lecteur — fonctions pures, testées (`frontend/test/navigation.test.ts`).
 */
import type { ReaderChapter, ReadingDirection } from '../../types/reader'

/**
 * Découpe en « planches » : une page seule, ou deux côte à côte (double page).
 * En double page, la couverture reste seule (`coverAlone`), comme dans un
 * volume imprimé : les pages 2-3, 4-5… se font face.
 */
export function buildSpreads(pageCount: number, double: boolean, coverAlone = true): number[][] {
  const spreads: number[][] = []
  if (pageCount <= 0) return spreads
  if (!double) {
    for (let page = 0; page < pageCount; page += 1) spreads.push([page])
    return spreads
  }
  let page = 0
  if (coverAlone) {
    spreads.push([0])
    page = 1
  }
  for (; page < pageCount; page += 2) spreads.push(page + 1 < pageCount ? [page, page + 1] : [page])
  return spreads
}

/** Planche qui contient une page (la dernière si la page est hors limites). */
export function spreadIndexOf(spreads: readonly number[][], page: number): number {
  const index = spreads.findIndex((spread) => spread.includes(page))
  if (index !== -1) return index
  return page < 0 ? 0 : Math.max(0, spreads.length - 1)
}

export type NavAction = 'prev' | 'next' | 'menu'

/**
 * Tap sur l'écran, en trois tiers : le centre affiche / masque les commandes ;
 * les bords tournent la page. En sens japonais (RTL), le bord GAUCHE avance.
 */
export function tapAction(x: number, width: number, direction: ReadingDirection): NavAction {
  if (width <= 0) return 'menu'
  const third = x / width
  if (third > 1 / 3 && third < 2 / 3) return 'menu'
  const leftSide = third <= 1 / 3
  const forward = direction === 'rtl' ? leftSide : !leftSide
  return forward ? 'next' : 'prev'
}

/**
 * Touche clavier → sens de lecture. Les flèches suivent le sens de la page
 * (← avance en RTL) ; Espace / Page suivante avancent toujours.
 */
export function keyAction(key: string, direction: ReadingDirection, shift = false): 'prev' | 'next' | null {
  switch (key) {
    case 'ArrowRight':
      return direction === 'rtl' ? 'prev' : 'next'
    case 'ArrowLeft':
      return direction === 'rtl' ? 'next' : 'prev'
    case 'ArrowDown':
    case 'PageDown':
      return 'next'
    case 'ArrowUp':
    case 'PageUp':
      return 'prev'
    case ' ':
      return shift ? 'prev' : 'next'
    default:
      return null
  }
}

/**
 * Swipe horizontal (`dx` = déplacement du doigt, positif vers la droite).
 * En LTR, pousser la page vers la gauche avance ; en RTL, c'est l'inverse.
 * Un geste rapide mais court compte aussi (`velocity` en px/s).
 */
export function swipeAction(dx: number, direction: ReadingDirection, velocity = 0, threshold = 56): 'prev' | 'next' | null {
  const flick = Math.abs(velocity) > 450 && Math.abs(dx) > 16
  if (Math.abs(dx) < threshold && !flick) return null
  const towardLeft = dx < 0
  const forward = direction === 'rtl' ? !towardLeft : towardLeft
  return forward ? 'next' : 'prev'
}

/**
 * Ordre de lecture : une seule version par numéro de chapitre. Plusieurs
 * équipes traduisent souvent le même chapitre ; on garde de préférence celle
 * qui traduit déjà (`preferredGroups`), sinon la plus complète, sinon la plus
 * ancienne. `keep` force une version précise (le chapitre ouvert).
 * La liste reçue est déjà triée par l'API.
 */
export function readingOrder(
  chapters: readonly ReaderChapter[],
  preferredGroups: readonly string[] = [],
  keep?: string | null,
): ReaderChapter[] {
  const preferred = new Set(preferredGroups)
  const score = (chapter: ReaderChapter) =>
    (chapter.id === keep ? 1_000_000 : 0) +
    (chapter.groups.some((group) => preferred.has(group.id)) ? 10_000 : 0) +
    Math.min(chapter.pages, 9_999)

  const order: ReaderChapter[] = []
  const slotOf = new Map<string, number>()
  for (const chapter of chapters) {
    // Sans numéro (one-shot, extra) : chaque version est distincte.
    const key = chapter.number ?? `id:${chapter.id}`
    const slot = slotOf.get(key)
    if (slot === undefined) {
      slotOf.set(key, order.length)
      order.push(chapter)
      continue
    }
    const current = order[slot]
    // À score égal, la première (la plus ancienne) reste.
    if (current && score(chapter) > score(current)) order[slot] = chapter
  }
  return order
}

/** Chapitres voisins dans l'ordre de lecture. */
export function neighbours(order: readonly ReaderChapter[], chapterId: string | null) {
  const index = chapterId === null ? -1 : order.findIndex((chapter) => chapter.id === chapterId)
  return {
    index,
    prev: index > 0 ? order[index - 1] : undefined,
    next: index !== -1 ? order[index + 1] : undefined,
  }
}

/** Tri « naturel » des noms de fichiers d'une archive : page2 avant page10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
