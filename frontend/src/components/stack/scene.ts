/*
 * Page Stack : les tomes et le bureau. Un tome est un livre couché, vu de côté : on voit son dos.
 * La tranche reprend la couverture du manga (l'image, teintée pour rester lisible), son titre et
 * son numéro de volume, avec le relief d'une reliure arrondie (lumière au centre, ombre aux bords).
 * Un tome coupé (ce qui dépasse tombe) ne montre que sa part de dos : l'image et le titre se prolongent
 * d'un morceau à l'autre. Sans couverture, un dos dessiné prend la place.
 */

export interface View {
  width: number
  height: number
  /** Largeur de la scène (colonne de jeu) et marge gauche, en pixels. */
  stage: number
  left: number
  /** Ordonnée du sol, en pixels. */
  ground: number
  /** Décalage de la caméra vers le bas, en pixels (la pile monte, le monde descend). */
  cam: number
}

export function makeView(width: number, height: number, cam: number): View {
  const stage = Math.min(width, 520)
  return { width, height, stage, left: (width - stage) / 2, ground: height * 0.8, cam }
}

/** Ordonnée du dessus d'un empilement de hauteur `level` (en largeurs de scène). */
export const levelY = (view: View, level: number): number => view.ground - level * view.stage + view.cam

/** Décalage de caméra voulu : le tome qui glisse garde son haut vers 42 % de la hauteur. */
export const camTarget = (view: Omit<View, 'cam'>, topLevel: number, movingHeight: number): number =>
  Math.max(0, view.height * 0.42 - (view.ground - (topLevel + movingHeight) * view.stage))

/** Le bureau sur lequel repose la pile : une planche large, un peu de grain, une ombre. */
export function drawDesk(ctx: CanvasRenderingContext2D, view: View): void {
  const y = view.ground + view.cam
  if (y > view.height + 10) return
  const gradient = ctx.createLinearGradient(0, y, 0, y + view.stage * 0.3)
  gradient.addColorStop(0, '#6b3f2a')
  gradient.addColorStop(1, '#2a1612')
  ctx.fillStyle = gradient
  ctx.fillRect(0, y, view.width, view.height - y + 10)
  ctx.fillStyle = 'rgba(255,220,170,0.3)'
  ctx.fillRect(0, y, view.width, 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 1
  for (let index = 1; index < 5; index += 1) {
    ctx.beginPath()
    ctx.moveTo(0, y + view.stage * 0.045 * index)
    ctx.lineTo(view.width, y + view.stage * 0.045 * index)
    ctx.stroke()
  }
}

interface DrawTome {
  /** Partie visible du tome (pixels). */
  x: number
  y: number
  w: number
  h: number
  /** Dos entier d'origine : sa gauche et sa largeur (pixels) ; la hauteur est celle du tome. */
  spanLeft: number
  spanWidth: number
  image: HTMLImageElement | null
  title: string
  index: number
  alpha?: number
  angle?: number
}

/** Teinte dominante d'une couverture (moyenne sur une miniature) ; `null` si le navigateur refuse de lire l'image. */
const tints = new WeakMap<HTMLImageElement, [number, number, number] | null>()
function tintOf(image: HTMLImageElement): [number, number, number] | null {
  if (tints.has(image)) return tints.get(image) ?? null
  let tint: [number, number, number] | null = null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(image, 0, 0, 8, 8)
      const data = ctx.getImageData(0, 0, 8, 8).data
      let r = 0
      let g = 0
      let b = 0
      for (let index = 0; index < data.length; index += 4) {
        r += data[index]!
        g += data[index + 1]!
        b += data[index + 2]!
      }
      const count = data.length / 4
      tint = [r / count, g / count, b / count]
    }
  } catch {
    // Image d'une autre origine : pas de lecture des pixels, une teinte par défaut ira.
  }
  tints.set(image, tint)
  return tint
}

/** Part de la hauteur de la couverture montrée sur le dos : change d'un tome à l'autre. */
const verticalOf = (index: number): number => 0.12 + ((index * 0.6180339) % 1) * 0.55

/** Un tome couché, vu par son dos. */
export function drawTome(ctx: CanvasRenderingContext2D, tome: DrawTome): void {
  const { x, y, w, h, spanLeft, spanWidth, image, index } = tome
  if (w < 1 || h < 1) return
  const radius = Math.min(h * 0.28, w / 2)
  ctx.save()
  ctx.globalAlpha = tome.alpha ?? 1
  if (tome.angle) {
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate(tome.angle)
    ctx.translate(-(x + w / 2), -(y + h / 2))
  }
  // Ombre portée : le dos se détache du tome du dessous.
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = Math.max(5, h * 0.35)
  ctx.shadowOffsetY = 2
  const hue = (index * 47 + 15) % 360
  const tint = image && image.naturalWidth > 0 ? tintOf(image) : null
  const base: [number, number, number] = tint ? [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8] : [0, 0, 0]
  ctx.fillStyle = tint ? `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})` : `hsl(${hue} 60% 38%)`
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.save()
  ctx.clip()

  if (image && image.naturalWidth > 0) {
    // La couverture, étalée sur la largeur du dos : on en voit la bande où se trouve le titre.
    const scale = spanWidth / image.naturalWidth
    const dh = image.naturalHeight * scale
    const top = Math.min(y, Math.max(y + h - dh, y + h / 2 - verticalOf(index) * dh))
    ctx.drawImage(image, spanLeft, top, spanWidth, dh)
    // Un voile de la couleur du livre pour que le titre se lise, plus dense à gauche.
    const veil = ctx.createLinearGradient(spanLeft, 0, spanLeft + spanWidth, 0)
    const [r, g, b] = base
    veil.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},0.78)`)
    veil.addColorStop(0.55, `rgba(${r | 0},${g | 0},${b | 0},0.4)`)
    veil.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0.12)`)
    ctx.fillStyle = veil
    ctx.fillRect(x, y, w, h)
  } else {
    const fill = ctx.createLinearGradient(spanLeft, y, spanLeft + spanWidth, y + h)
    fill.addColorStop(0, `hsl(${hue} 70% 55%)`)
    fill.addColorStop(1, `hsl(${(hue + 50) % 360} 65% 30%)`)
    ctx.fillStyle = fill
    ctx.fillRect(x, y, w, h)
  }

  // Filets dorés près des bords, comme sur un dos de livre relié.
  ctx.fillStyle = 'rgba(255,226,150,0.85)'
  const line = Math.max(1, h * 0.05)
  ctx.fillRect(x, y + h * 0.17, w, line)
  ctx.fillRect(x, y + h * 0.83 - line, w, line)

  // Titre, et numéro de volume dans un cartouche.
  const fontSize = Math.max(8, Math.round(h * 0.4))
  const pad = spanWidth * 0.05
  const badge = h * 0.62
  const textLeft = spanLeft + pad
  const room = spanWidth - pad * 2 - badge - pad
  let label = tome.title.toUpperCase()
  if (label && room > fontSize * 2) {
    ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
    let size = fontSize
    const width = ctx.measureText(label).width
    if (width > room) size = Math.max(7, Math.floor((fontSize * room) / width))
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
    if (ctx.measureText(label).width > room) {
      const ellipsis = '…' // i18n-ignore : signe de ponctuation
      while (label.length > 3 && ctx.measureText(`${label}${ellipsis}`).width > room) label = label.slice(0, -1)
      label = `${label}${ellipsis}`
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, size * 0.22)
    ctx.strokeStyle = 'rgba(10,4,24,0.85)'
    ctx.strokeText(label, textLeft, y + h / 2 + 1)
    ctx.fillStyle = '#fffaf0'
    ctx.fillText(label, textLeft, y + h / 2 + 1)
  }
  if (spanWidth > badge * 3) {
    const bx = spanLeft + spanWidth - pad - badge
    ctx.fillStyle = 'rgba(255,248,230,0.95)'
    ctx.beginPath()
    ctx.roundRect(bx, y + (h - badge) / 2, badge, badge, badge * 0.28)
    ctx.fill()
    ctx.fillStyle = '#2a1830'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(badge * 0.58)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
    ctx.fillText(String((index % 30) + 1), bx + badge / 2, y + h / 2 + 1)
  }

  // Dos arrondi : lumière au centre, ombre aux bords, et un reflet fin sur le dessus.
  const round = ctx.createLinearGradient(0, y, 0, y + h)
  round.addColorStop(0, 'rgba(0,0,0,0.38)')
  round.addColorStop(0.22, 'rgba(255,255,255,0.2)')
  round.addColorStop(0.5, 'rgba(255,255,255,0)')
  round.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = round
  ctx.fillRect(x, y, w, h)
  ctx.restore()

  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius)
  ctx.strokeStyle = 'rgba(12,6,24,0.85)'
  ctx.lineWidth = Math.max(1.4, h * 0.06)
  ctx.stroke()
  ctx.restore()
}

/** Repères discrets : les bords du tome du dessus, prolongés vers le haut, pour viser. */
export function drawGuides(ctx: CanvasRenderingContext2D, view: View, centre: number, width: number, topY: number, length: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  for (const side of [-1, 1]) {
    const x = view.left + (centre + (side * width) / 2) * view.stage
    ctx.moveTo(x, topY)
    ctx.lineTo(x, Math.max(0, topY - length))
  }
  ctx.stroke()
  ctx.setLineDash([])
}
