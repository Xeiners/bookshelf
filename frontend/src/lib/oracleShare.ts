/**
 * Récapitulatif partageable du tirage : une image 1080 × 1350 (format 4:5,
 * natif Instagram) dessinée dans un canevas, dans l'esthétique de la page —
 * fond nuit, halo de la couleur de la pépite, cadre doré, ombre dure néon.
 *
 * Mobile : feuille de partage native (image + texte). Ordinateur : l'image est
 * téléchargée et le texte copié, prêt à coller sur X ou Discord.
 */
import type { Dictionary } from '../i18n/fr'
import { BRAND } from './brand'
import { initials } from './format'
import { rankTier } from './oracle'
import type { TodayDraw } from '../store/useOracleStore'

const WIDTH = 1080
const HEIGHT = 1350
const GOLD = '#d9b25f'
const CREAM = '#f7f5f0'
// Piles de polices CSS : des noms techniques, pas du texte d'interface.
const SERIF = '"Instrument Serif", Georgia, serif' // i18n-ignore
const SANS = 'Inter, system-ui, sans-serif' // i18n-ignore

export type ShareOutcome = 'shared' | 'saved' | 'cancelled'

interface ShareInput {
  draw: TodayDraw
  moodName: string
  paceName: string
  moodTone: string
  paceTone: string
  pepiteTone: string
  streak: number
  t: Dictionary
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/** Découpe un texte en lignes qui tiennent dans `maxWidth` (au plus `maxLines`, avec « … »). */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && current) lines.push(current)
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1] ?? ''
    // Troncature typographique : « … » n'appartient à aucune langue.
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1) // i18n-ignore
    lines[maxLines - 1] = `${last.trimEnd()}…` // i18n-ignore
  }
  return lines
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath()
  context.roundRect(x, y, w, h, r)
}

/** Pastille néo-brutaliste : bord de couleur, ombre dure décalée. */
function chip(context: CanvasRenderingContext2D, label: string, x: number, y: number, tone: string): number {
  context.font = `600 30px ${SANS}`
  const width = context.measureText(label).width + 56
  context.fillStyle = tone
  roundedRect(context, x + 7, y + 7, width, 64, 14)
  context.fill()
  context.fillStyle = '#0c0b11'
  roundedRect(context, x, y, width, 64, 14)
  context.fill()
  context.strokeStyle = tone
  context.lineWidth = 4
  context.stroke()
  context.fillStyle = CREAM
  context.textBaseline = 'middle'
  context.fillText(label, x + 28, y + 33)
  return width
}

/** Éclair de série, dessiné (un emoji dépendrait des polices du système). */
function bolt(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 24
  context.beginPath()
  context.moveTo(x + 13 * s, y + 2 * s)
  context.lineTo(x + 3 * s, y + 14 * s)
  context.lineTo(x + 12 * s, y + 14 * s)
  context.lineTo(x + 11 * s, y + 22 * s)
  context.lineTo(x + 21 * s, y + 10 * s)
  context.lineTo(x + 12 * s, y + 10 * s)
  context.closePath()
  context.fill()
}

async function render(input: ShareInput): Promise<Blob> {
  const { draw, t } = input
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas unavailable')

  // Polices de l'app, si elles sont disponibles.
  await Promise.all([document.fonts.load(`80px ${SERIF}`), document.fonts.load(`600 30px ${SANS}`)]).catch(() => undefined)

  // Fond nuit + halos (pépite en haut, ambiance en bas).
  context.fillStyle = '#07060c'
  context.fillRect(0, 0, WIDTH, HEIGHT)
  const halo = (x: number, y: number, radius: number, tone: string, alpha: number) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, tone)
    gradient.addColorStop(1, 'transparent')
    context.globalAlpha = alpha
    context.fillStyle = gradient
    context.fillRect(0, 0, WIDTH, HEIGHT)
    context.globalAlpha = 1
  }
  halo(540, 560, 620, input.pepiteTone, 0.45)
  halo(120, 1300, 520, input.moodTone, 0.3)

  // Cadre doré double.
  context.strokeStyle = GOLD
  context.lineWidth = 4
  roundedRect(context, 36, 36, WIDTH - 72, HEIGHT - 72, 36)
  context.stroke()
  context.globalAlpha = 0.35
  context.lineWidth = 2
  roundedRect(context, 52, 52, WIDTH - 104, HEIGHT - 104, 28)
  context.stroke()
  context.globalAlpha = 1

  // En-tête.
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillStyle = GOLD
  context.font = `600 26px ${SANS}`
  context.letterSpacing = '10px'
  context.fillText(`${BRAND.toUpperCase()} · ORACLE`, WIDTH / 2, 132) // i18n-ignore : marque + nom de la fonctionnalité
  context.letterSpacing = '0px'
  context.fillStyle = CREAM
  context.font = `84px ${SERIF}`
  context.fillText(t.oracle.shareTitle, WIDTH / 2, 226)
  context.fillStyle = 'rgba(247,245,240,0.55)'
  context.font = `500 28px ${SANS}`
  context.fillText(new Intl.DateTimeFormat(t.locale, { dateStyle: 'full' }).format(new Date(`${draw.day}T12:00:00`)), WIDTH / 2, 276)

  // Couverture : ombre dure néon + bord.
  const cover = { x: 330, y: 330, w: 420, h: 610 }
  context.fillStyle = input.pepiteTone
  roundedRect(context, cover.x + 16, cover.y + 16, cover.w, cover.h, 22)
  context.fill()
  context.save()
  roundedRect(context, cover.x, cover.y, cover.w, cover.h, 22)
  context.clip()
  const image = draw.pepite.cover ? await loadImage(draw.pepite.cover) : null
  if (image) {
    const scale = Math.max(cover.w / image.width, cover.h / image.height)
    const w = image.width * scale
    const h = image.height * scale
    context.drawImage(image, cover.x + (cover.w - w) / 2, cover.y + (cover.h - h) / 2, w, h)
  } else {
    const gradient = context.createLinearGradient(cover.x, cover.y, cover.x + cover.w, cover.y + cover.h)
    gradient.addColorStop(0, input.pepiteTone)
    gradient.addColorStop(1, '#0c0b11')
    context.fillStyle = gradient
    context.fillRect(cover.x, cover.y, cover.w, cover.h)
    context.fillStyle = 'rgba(247,245,240,0.8)'
    context.font = `160px ${SERIF}`
    context.fillText(initials(draw.pepite.title), WIDTH / 2, cover.y + cover.h / 2 + 50)
  }
  context.restore()
  context.strokeStyle = input.pepiteTone
  context.lineWidth = 6
  roundedRect(context, cover.x, cover.y, cover.w, cover.h, 22)
  context.stroke()

  // Rang.
  const rank = t.oracle.rank(rankTier(draw.pepite.rating)).toUpperCase()
  context.font = `800 26px ${SANS}`
  const rankWidth = context.measureText(rank).width + 36
  context.fillStyle = input.pepiteTone
  roundedRect(context, cover.x + cover.w - rankWidth - 18, cover.y + 18, rankWidth, 50, 10)
  context.fill()
  context.fillStyle = '#06060a'
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.fillText(rank, cover.x + cover.w - rankWidth, cover.y + 44)

  // Titre de la pépite.
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillStyle = CREAM
  context.font = `66px ${SERIF}`
  const titleLines = wrap(context, draw.pepite.title, 880, 2)
  titleLines.forEach((line, index) => context.fillText(line, WIDTH / 2, 1030 + index * 70))

  // Ambiance × rythme, centrés.
  const top = 1030 + titleLines.length * 70 + 8
  context.font = `600 30px ${SANS}`
  const moodWidth = context.measureText(input.moodName).width + 56
  const paceWidth = context.measureText(input.paceName).width + 56
  let x = (WIDTH - (moodWidth + paceWidth + 28)) / 2
  context.textAlign = 'left'
  x += chip(context, input.moodName, x, top, input.moodTone) + 28
  chip(context, input.paceName, x, top, input.paceTone)

  // Série.
  if (input.streak > 0) {
    const label = t.oracle.streak(input.streak)
    context.font = `700 30px ${SANS}`
    const width = context.measureText(label).width + 52
    const start = (WIDTH - width) / 2
    context.fillStyle = GOLD
    bolt(context, start, HEIGHT - 124, 36)
    context.textBaseline = 'middle'
    context.fillText(label, start + 52, HEIGHT - 105)
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'),
  )
}

export async function shareDraw(input: ShareInput): Promise<ShareOutcome> {
  const blob = await render(input)
  const file = new File([blob], `bookshelf-oracle-${input.draw.day}.png`, { type: 'image/png' })
  const text = input.t.oracle.shareText(input.draw.pepite.title, input.moodName, input.paceName, input.streak)

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: input.t.oracle.shareTitle })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Partage natif refusé : on retombe sur le téléchargement.
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  await navigator.clipboard?.writeText(text).catch(() => undefined)
  return 'saved'
}
