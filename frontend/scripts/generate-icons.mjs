/**
 * Génère toutes les icônes de Bookshelf depuis `public/favicon.svg`.
 *
 * La forme sombre du dessin original est éclaircie pour rester lisible sur le
 * fond d'application. Le SVG source reste ainsi l'unique source de géométrie.
 *
 *   npm run icons
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SOURCE_PATH = join(PUBLIC_DIR, 'favicon.svg')
const BACKGROUND = '#09090b'
const LIGHT_INK = '#f7f5f0'

const source = await readFile(SOURCE_PATH, 'utf8')
// Le violet reste celui du fichier fourni ; seul l'encre presque noire change.
const contrastedSource = source.replaceAll('#111316', LIGHT_INK)

async function logoPng(size, contentRatio, background = BACKGROUND) {
  const contentSize = Math.round(size * contentRatio)
  const mark = await sharp(Buffer.from(contrastedSource))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: contentSize, height: contentSize, fit: 'inside' })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

/** ICO moderne contenant deux images PNG, prises en charge par les navigateurs. */
function encodeIco(images) {
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = headerSize
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

const targets = [
  { file: 'apple-touch-icon.png', size: 180, ratio: 0.72 },
  { file: 'pwa-192x192.png', size: 192, ratio: 0.76 },
  { file: 'pwa-512x512.png', size: 512, ratio: 0.76 },
  // 58 % : la marque reste entièrement dans la zone sûre maskable Android.
  { file: 'pwa-maskable-512x512.png', size: 512, ratio: 0.58 },
]

for (const target of targets) {
  const png = await logoPng(target.size, target.ratio)
  await writeFile(join(PUBLIC_DIR, target.file), png)
  console.log(`${target.file.padEnd(28)} ${target.size}×${target.size}`)
}

const faviconImages = await Promise.all(
  [16, 32].map(async (size) => ({ size, png: await logoPng(size, 0.78) })),
)
await writeFile(join(PUBLIC_DIR, 'favicon.ico'), encodeIco(faviconImages))
console.log('favicon.ico                  16×16, 32×32')
