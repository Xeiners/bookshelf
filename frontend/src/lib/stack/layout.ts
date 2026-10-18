/** Un rectangle de l'écran, en pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Poids du panneau du joueur dans une rangée de panneaux : il y est plus large que les autres. */
const OWN_WEIGHT = 1.6
/** Part de la hauteur donnée à la pile du joueur quand les panneaux s'empilent (téléphone). */
const OWN_HEIGHT = 0.56

/** Découpe `total` pixels en parts proportionnelles à `weights`, séparées de `gap`. */
function split(total: number, weights: number[], gap: number): [number, number][] {
  const free = total - gap * (weights.length - 1)
  const sum = weights.reduce((a, b) => a + b, 0)
  let at = 0
  return weights.map((weight) => {
    const size = (free * weight) / sum
    const part: [number, number] = [at, size]
    at += size + gap
    return part
  })
}

/**
 * Découpe l'écran en `count` panneaux (1 à 4), un par joueur, dans l'ordre des joueurs ; `own` est
 * celui du joueur : il a toujours le plus grand panneau, et au centre quand on est trois sur un
 * écran large (les autres de part et d'autre). Sur un écran large : côte à côte (à quatre, trop
 * étroit : le sien à gauche, les trois autres empilés à droite) ; sur un écran haut (téléphone) : le
 * sien en haut, les autres en dessous. Les panneaux sont séparés de `gap` pixels et couvrent tout l'écran.
 */
export function layoutPanels(count: number, width: number, height: number, gap = 4, own = 0): Rect[] {
  const n = Math.min(4, Math.max(1, Math.floor(count)))
  const mine = Math.min(n - 1, Math.max(0, Math.floor(own)))
  if (n === 1) return [{ x: 0, y: 0, w: width, h: height }]
  const landscape = width > height * 1.1
  const others = Array.from({ length: n }, (_, index) => index).filter((index) => index !== mine)
  const rects: Rect[] = new Array<Rect>(n)

  if (landscape && (n < 4 || width >= 4 * 320)) {
    // Côte à côte : à trois, le sien au milieu ; sinon, le sien le premier à gauche (à quatre, le deuxième).
    const left = n === 3 ? 1 : n === 4 ? 1 : 0
    const order = [...others.slice(0, left), mine, ...others.slice(left)]
    const weights = order.map((slot) => (slot === mine ? OWN_WEIGHT : 1))
    split(width, weights, gap).forEach(([x, w], column) => {
      rects[order[column]!] = { x, y: 0, w, h: height }
    })
    return rects
  }
  if (landscape) {
    // Écran large mais pas assez pour quatre colonnes : le sien à gauche, les autres en pile à droite.
    const [[x0, w0], [x1, w1]] = split(width, [OWN_WEIGHT, 1], gap) as [[number, number], [number, number]]
    rects[mine] = { x: x0, y: 0, w: w0, h: height }
    split(height, others.map(() => 1), gap).forEach(([y, h], row) => {
      rects[others[row]!] = { x: x1, y, w: w1, h }
    })
    return rects
  }
  // Écran haut : le sien en haut, les autres côte à côte en dessous.
  const [[y0, h0], [y1, h1]] = split(height, [OWN_HEIGHT, 1 - OWN_HEIGHT], gap) as [[number, number], [number, number]]
  rects[mine] = { x: 0, y: y0, w: width, h: h0 }
  split(width, others.map(() => 1), gap).forEach(([x, w], column) => {
    rects[others[column]!] = { x, y: y1, w, h: h1 }
  })
  return rects
}
