/** Un rectangle de l'écran, en pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Découpe l'écran en `count` panneaux (1 à 4), un par joueur : deux piles l'une sur l'autre (ou côte à
 * côte sur un écran large), quatre en grille 2 × 2 (ou en colonnes sur un grand écran), trois en
 * deux rangées. Les panneaux sont séparés de `gap` pixels et couvrent tout l'écran.
 */
export function layoutPanels(count: number, width: number, height: number, gap = 4): Rect[] {
  const n = Math.min(4, Math.max(1, Math.floor(count)))
  const landscape = width > height * 1.1
  const cut = (columns: number, rows: number, spans: number[] = []): Rect[] => {
    const rects: Rect[] = []
    const cellW = (width - gap * (columns - 1)) / columns
    const cellH = (height - gap * (rows - 1)) / rows
    let index = 0
    for (let row = 0; row < rows; row += 1) {
      const inRow = spans[row] ?? columns
      // Une rangée incomplète se répartit sur toute la largeur.
      const w = (width - gap * (inRow - 1)) / inRow
      for (let column = 0; column < inRow && index < n; column += 1) {
        rects.push({ x: column * (w + gap), y: row * (cellH + gap), w: inRow === columns ? cellW : w, h: cellH })
        index += 1
      }
    }
    return rects
  }
  if (n === 1) return [{ x: 0, y: 0, w: width, h: height }]
  if (n === 2) return landscape ? cut(2, 1) : cut(1, 2)
  if (n === 3) return landscape ? cut(3, 1) : cut(2, 2, [2, 1])
  return landscape && width >= 4 * 320 ? cut(4, 1) : cut(2, 2)
}
