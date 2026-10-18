/*
 * Page Stack : les tomes et le bureau. Un tome est un livre debout vu de face : sa couverture
 * entière (image du manga), une reliure ombrée sur la tranche, un reflet de papier glacé, un bord
 * net. Un tome coupé (ce qui dépasse tombe) ne montre que sa part de couverture : l'image
 * se prolonge d'un morceau à l'autre. Sans couverture, un tome dessiné prend la place.
 */

/** Hauteur d'un tome par rapport à sa largeur (un tome de manga : environ 1 pour 1,5). */
export const TOME_RATIO = 1.5

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

/** Décalage de caméra voulu : le tome qui glisse garde son haut vers 30 % de la hauteur. */
export const camTarget = (view: Omit<View, 'cam'>, topLevel: number, movingHeight: number): number =>
  Math.max(0, view.height * 0.3 - (view.ground - (topLevel + movingHeight) * view.stage))

/** Couverture d'un tome : l'image et la part de scène qu'elle couvre (centre et largeur d'origine, en largeurs de scène). */
export interface TomeArt {
  image: HTMLImageElement | null
  x: number
  w: number
}

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
  /** Couverture entière d'origine : sa gauche et sa largeur (pixels) ; la hauteur est celle du tome. */
  spanLeft: number
  spanWidth: number
  image: HTMLImageElement | null
  index: number
  alpha?: number
  angle?: number
}

/** Un tome. */
export function drawTome(ctx: CanvasRenderingContext2D, tome: DrawTome): void {
  const { x, y, w, h, spanLeft, spanWidth, image, index } = tome
  if (w < 1 || h < 1) return
  const radius = Math.min(spanWidth * 0.025, w / 2)
  ctx.save()
  ctx.globalAlpha = tome.alpha ?? 1
  if (tome.angle) {
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate(tome.angle)
    ctx.translate(-(x + w / 2), -(y + h / 2))
  }
  // Ombre portée : le tome se détache de celui du dessous.
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = Math.max(6, spanWidth * 0.06)
  ctx.shadowOffsetY = 2
  ctx.fillStyle = '#1a1020'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.save()
  ctx.clip()

  if (image && image.naturalWidth > 0) {
    // Couverture entière, sans déformation (recadrée au besoin).
    const scale = Math.max(spanWidth / image.naturalWidth, h / image.naturalHeight)
    const dw = image.naturalWidth * scale
    const dh = image.naturalHeight * scale
    ctx.drawImage(image, spanLeft + (spanWidth - dw) / 2, y + (h - dh) / 2, dw, dh)
  } else {
    // Tome dessiné : dégradé de couleur, cadre de case, numéro.
    const hue = (index * 47 + 15) % 360
    const fill = ctx.createLinearGradient(spanLeft, y, spanLeft + spanWidth, y + h)
    fill.addColorStop(0, `hsl(${hue} 70% 58%)`)
    fill.addColorStop(1, `hsl(${(hue + 50) % 360} 65% 30%)`)
    ctx.fillStyle = fill
    ctx.fillRect(spanLeft, y, spanWidth, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(1.5, spanWidth * 0.02)
    ctx.strokeRect(spanLeft + spanWidth * 0.1, y + h * 0.08, spanWidth * 0.8, h * 0.84)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(spanWidth * 0.32)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
    ctx.fillText(String(index + 1), spanLeft + spanWidth / 2, y + h / 2)
  }

  // Reliure : un pli sombre côté gauche, avec son arête claire.
  const hinge = ctx.createLinearGradient(spanLeft, 0, spanLeft + spanWidth * 0.11, 0)
  hinge.addColorStop(0, 'rgba(0,0,0,0.5)')
  hinge.addColorStop(0.55, 'rgba(0,0,0,0.12)')
  hinge.addColorStop(0.62, 'rgba(255,255,255,0.28)')
  hinge.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = hinge
  ctx.fillRect(spanLeft, y, spanWidth * 0.11, h)
  // Papier glacé : un reflet en diagonale.
  const sheen = ctx.createLinearGradient(spanLeft, y, spanLeft + spanWidth, y + h * 0.9)
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)')
  sheen.addColorStop(0.32, 'rgba(255,255,255,0.05)')
  sheen.addColorStop(0.4, 'rgba(255,255,255,0.12)')
  sheen.addColorStop(0.55, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(x, y, w, h)
  // Le bas s'assombrit : on distingue les tomes empilés.
  const foot = ctx.createLinearGradient(0, y + h * 0.9, 0, y + h)
  foot.addColorStop(0, 'rgba(0,0,0,0)')
  foot.addColorStop(1, 'rgba(0,0,0,0.38)')
  ctx.fillStyle = foot
  ctx.fillRect(x, y + h * 0.9, w, h * 0.1)
  ctx.restore()

  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius)
  ctx.strokeStyle = 'rgba(12,6,24,0.8)'
  ctx.lineWidth = Math.max(1.4, spanWidth * 0.012)
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(x + 2, y + 2, w - 4, h - 4, Math.max(0, radius - 1))
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
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
