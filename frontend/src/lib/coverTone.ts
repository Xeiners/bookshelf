/**
 * Teinte dominante d'une couverture — sert aux halos, aux reflets sur les
 * étagères et à la tranche des livres 3D.
 *
 * La couverture est réduite dans un canevas minuscule (24 × 36) et chaque pixel
 * pèse selon sa saturation : un fond noir ou blanc ne l'emporte jamais sur la
 * couleur qui fait l'identité de la couverture. Le résultat est ensuite ramené
 * dans une plage lumineuse et saturée, lisible sur le fond « Obsidian ».
 *
 * Les couvertures passent par notre API (même origine) : le canevas n'est pas
 * « teinté » et reste lisible. Pour une image étrangère sans CORS, ou sans
 * couverture, on retombe sur une teinte déterministe dérivée de l'id.
 */
import type { Book } from '../types/book'
import { hueFromString } from './format'

const STORAGE_KEY = 'bookshelf:tones:v1'
const SAMPLE_WIDTH = 24
const SAMPLE_HEIGHT = 36
/** Borne du cache persistant : au-delà, les plus anciennes teintes sont oubliées. */
const MAX_STORED = 600

type Rgb = [number, number, number]

const tones = new Map<string, string>(readStored())
const pending = new Map<string, Promise<string>>()

function readStored(): [string, string][] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as [string, string][]) : []
  } catch {
    return []
  }
}

let saveTimer: number | undefined
function persistSoon() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...tones].slice(-MAX_STORED)))
    } catch {
      // Stockage plein ou bloqué : le cache mémoire suffit pour la session.
    }
  }, 400)
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4
  return [hue * 60, saturation, lightness]
}

/** Ramène une teinte dans une plage qui « brille » sur fond sombre. */
function vivid(hue: number, saturation: number, lightness: number): string {
  const s = Math.min(0.85, Math.max(0.42, saturation * 1.25))
  const l = Math.min(0.64, Math.max(0.5, lightness))
  return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

/** Teinte de secours, stable pour une œuvre donnée. */
export function fallbackTone(id: string): string {
  return vivid(hueFromString(id), 0.5, 0.56)
}

function dominantTone(image: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_WIDTH
  canvas.height = SAMPLE_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)

  let data: Uint8ClampedArray
  try {
    data = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data
  } catch {
    return null // Canevas teinté (image étrangère sans CORS).
  }

  let red = 0
  let green = 0
  let blue = 0
  let total = 0
  for (let index = 0; index < data.length; index += 4) {
    const pixel: Rgb = [data[index], data[index + 1], data[index + 2]]
    const [, saturation, lightness] = rgbToHsl(pixel)
    // Saturé ET ni noir ni blanc : c'est la couleur qui porte la couverture.
    const weight = saturation * saturation * (1 - Math.abs(lightness - 0.5) * 1.6) + 0.002
    if (weight <= 0) continue
    red += pixel[0] * weight
    green += pixel[1] * weight
    blue += pixel[2] * weight
    total += weight
  }
  if (total === 0) return null

  const [hue, saturation, lightness] = rgbToHsl([red / total, green / total, blue / total])
  return vivid(hue, saturation, lightness)
}

/** Teinte déjà connue (synchrone) : évite un flash de couleur par défaut. */
export function cachedTone(book: Book): string | undefined {
  return tones.get(book.id)
}

/** Teinte dominante de la couverture, calculée une fois puis mémorisée. */
export function coverTone(book: Book): Promise<string> {
  const known = tones.get(book.id)
  if (known) return Promise.resolve(known)
  const inflight = pending.get(book.id)
  if (inflight) return inflight

  const settle = (tone: string) => {
    tones.set(book.id, tone)
    pending.delete(book.id)
    persistSoon()
    return tone
  }

  if (!book.cover) return Promise.resolve(settle(fallbackTone(book.id)))

  const promise = (async () => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.src = book.cover as string
    try {
      await image.decode()
      return settle(dominantTone(image) ?? fallbackTone(book.id))
    } catch {
      return settle(fallbackTone(book.id))
    }
  })()

  pending.set(book.id, promise)
  return promise
}
