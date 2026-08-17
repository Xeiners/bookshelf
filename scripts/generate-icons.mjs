/**
 * Génération des icônes PWA — sans aucune dépendance.
 *
 * Encode des PNG à la main (IHDR / IDAT zlib / IEND + CRC32) et dessine le
 * motif par calcul de pixels, suréchantillonné ×4 puis moyenné : les angles
 * arrondis ressortent parfaitement lissés.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/* ------------------------------------------------------------------ *
 * Encodeur PNG
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4
  // Chaque scanline est préfixée de son octet de filtre (0 = aucun).
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 * Dessin
 * ------------------------------------------------------------------ */

const SS = 4 // facteur de suréchantillonnage

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
]

/** Palette de la marque. */
const VOID = hex('#06060a')
const INK = hex('#16131f')
const CREAM = hex('#f7f5f0')
const SPINES = [hex('#7c5cff'), hex('#3fe0a0'), hex('#ffc46b'), hex('#ff5c7a')]

/** Toile RGBA en flottants : l'alpha permet de vrais coins transparents. */
function createCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) }
}

/** Composition « source-over » en alpha droit. */
function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0) return
  const index = (y * canvas.size + x) * 4
  const dstAlpha = canvas.data[index + 3]
  const outAlpha = alpha + dstAlpha * (1 - alpha)
  if (outAlpha <= 0) return

  for (let c = 0; c < 3; c += 1) {
    canvas.data[index + c] =
      (color[c] * alpha + canvas.data[index + c] * dstAlpha * (1 - alpha)) / outAlpha
  }
  canvas.data[index + 3] = outAlpha
}

/** `true` si le point est dans le carré à coins arrondis. */
function insideRounded(px, py, size, corner) {
  if (corner <= 0) return true
  const dx = Math.max(corner - px, px - (size - corner), 0)
  const dy = Math.max(corner - py, py - (size - corner), 0)
  return !(dx > 0 && dy > 0 && Math.hypot(dx, dy) > corner)
}

/** Fond dégradé, confiné à la forme (arrondie ou pleine). */
function paintBackground(canvas, corner) {
  const size = canvas.size
  for (let y = 0; y < size; y += 1) {
    const t = y / (size - 1)
    const color = [
      INK[0] * (1 - t) + VOID[0] * t,
      INK[1] * (1 - t) + VOID[1] * t,
      INK[2] * (1 - t) + VOID[2] * t,
    ]
    for (let x = 0; x < size; x += 1) {
      if (!insideRounded(x + 0.5, y + 0.5, size, corner)) continue
      blend(canvas, x, y, color, 1)
    }
  }
}

/** Rectangle à coins arrondis, en coordonnées de la toile suréchantillonnée. */
function roundRect(canvas, x0, y0, x1, y1, radius, color, alpha = 1) {
  const left = Math.max(0, Math.floor(x0))
  const right = Math.min(canvas.size - 1, Math.ceil(x1))
  const top = Math.max(0, Math.floor(y0))
  const bottom = Math.min(canvas.size - 1, Math.ceil(y1))

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      if (px < x0 || px > x1 || py < y0 || py > y1) continue

      // Distance au coin le plus proche pour l'arrondi.
      const dx = Math.max(x0 + radius - px, px - (x1 - radius), 0)
      const dy = Math.max(y0 + radius - py, py - (y1 - radius), 0)
      if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > radius) continue

      blend(canvas, x, y, color, alpha)
    }
  }
}

/**
 * Motif : quatre tranches de livres debout sur une étagère — l'identité de
 * l'app en un coup d'œil.
 *
 * @param inset marge de sécurité relative (les icônes maskable sont rognées
 *              par le système jusqu'à 20 % de chaque côté).
 */
function drawIcon(size, { inset, rounded }) {
  const S = size * SS
  const canvas = createCanvas(S)

  // « any » : coins arrondis transparents. Maskable / iOS : carré plein bord.
  paintBackground(canvas, rounded ? S * 0.22 : 0)

  const pad = S * inset
  const boxLeft = pad
  const boxRight = S - pad
  const boxWidth = boxRight - boxLeft
  const shelfY = S - pad - boxWidth * 0.1

  // Quatre tranches, largeurs et hauteurs volontairement irrégulières.
  const widths = [0.2, 0.16, 0.24, 0.18]
  const heights = [0.72, 0.86, 0.62, 0.79]
  const gap = boxWidth * 0.045

  const totalWidth = widths.reduce((sum, w) => sum + w * boxWidth, 0) + gap * (widths.length - 1)
  let cursor = boxLeft + (boxWidth - totalWidth) / 2

  widths.forEach((widthRatio, index) => {
    const width = widthRatio * boxWidth
    const height = heights[index] * (shelfY - pad)
    const top = shelfY - height
    roundRect(canvas, cursor, top, cursor + width, shelfY, width * 0.16, SPINES[index])

    // Deux filets clairs : c'est ce qui fait lire « dos de livre » plutôt que
    // « barre d'histogramme ».
    for (const offset of [0.1, 0.84]) {
      roundRect(
        canvas,
        cursor + width * 0.18,
        top + height * offset,
        cursor + width * 0.82,
        top + height * offset + S * 0.008,
        S * 0.004,
        CREAM,
        offset < 0.5 ? 0.55 : 0.4,
      )
    }

    cursor += width + gap
  })

  // La planche.
  roundRect(canvas, boxLeft, shelfY, boxRight, shelfY + boxWidth * 0.055, S * 0.012, CREAM, 0.92)

  // Réduction : moyenne des SS×SS sous-pixels, couleur pondérée par l'alpha.
  const out = Buffer.alloc(size * size * 4)
  const count = SS * SS

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * S + (x * SS + sx)) * 4
          const alpha = canvas.data[index + 3]
          r += canvas.data[index] * alpha
          g += canvas.data[index + 1] * alpha
          b += canvas.data[index + 2] * alpha
          a += alpha
        }
      }

      const offset = (y * size + x) * 4
      out[offset] = a > 0 ? Math.round(r / a) : 0
      out[offset + 1] = a > 0 ? Math.round(g / a) : 0
      out[offset + 2] = a > 0 ? Math.round(b / a) : 0
      out[offset + 3] = Math.round((a / count) * 255)
    }
  }

  return encodePng(size, out)
}

/* ------------------------------------------------------------------ *
 * Sortie
 * ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true })

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0.16, rounded: true },
  { file: 'icon-512.png', size: 512, inset: 0.16, rounded: true },
  // Maskable : le contenu tient dans le carré inscrit au cercle de sécurité
  // (80 % de diamètre → côté 80/√2 ≈ 56,6 %, soit une marge de 21,7 %).
  { file: 'icon-maskable-512.png', size: 512, inset: 0.22, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.16, rounded: false },
]

for (const target of TARGETS) {
  const png = drawIcon(target.size, target)
  writeFileSync(join(OUT_DIR, target.file), png)
  console.log(`${target.file.padEnd(26)} ${target.size}×${target.size}  ${png.length} o`)
}
