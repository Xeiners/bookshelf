import * as THREE from 'three'
import { Batch, uploadUsed } from './batch'
import { PALETTE } from './toon'

/*
 * Les vraies couvertures manga des tomes géants et des publicités des trains : seize
 * couvertures (les œuvres du BookshelfDLE), téléchargées en petite taille dès l'entrée dans
 * le Runner et réunies dans une seule texture (un atlas de 4 × 4). Chaque instance choisit
 * sa case (attribut `aCell`) : un seul appel de dessin pour toutes les couvertures.
 *
 * Avant l'arrivée des images (ou hors-ligne, sans cache), chaque case porte une couverture
 * dessinée : aplat de couleur, grand titre en kanji, numéro de tome. Les images sont mises
 * en cache par le service worker : la fois suivante, même sans réseau, elles sont là.
 */

export const COVER_COLUMNS = 4
export const COVER_ROWS = 4
export const COVER_CELLS = COVER_COLUMNS * COVER_ROWS
const CELL_WIDTH = 192
const CELL_HEIGHT = 288
/** Marge intérieure (px) : les mipmaps d'une case ne bavent pas sur la voisine. */
const GUTTER = 3

// i18n-ignore (titres décoratifs des couvertures dessinées)
const PLACEHOLDER_TITLES = ['冒険', '忍道', '剣心', '竜王', '魂', '夢幻', '炎', '星屑', '侍', '鬼', '海賊', '魔法', '雷', '桜', '狼', '光']

class CoverAtlas {
  readonly texture: THREE.CanvasTexture
  private readonly context: CanvasRenderingContext2D | null
  private loaded = ''

  constructor() {
    const canvas = document.createElement('canvas')
    canvas.width = CELL_WIDTH * COVER_COLUMNS
    canvas.height = CELL_HEIGHT * COVER_ROWS
    this.context = canvas.getContext('2d')
    for (let cell = 0; cell < COVER_CELLS; cell += 1) this.placeholder(cell)
    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
  }

  private origin(cell: number): [number, number] {
    return [(cell % COVER_COLUMNS) * CELL_WIDTH, Math.floor(cell / COVER_COLUMNS) * CELL_HEIGHT]
  }

  /** Une couverture dessinée, dans l'esprit d'un tome relié. */
  private placeholder(cell: number): void {
    const context = this.context
    if (!context) return
    const [x, y] = this.origin(cell)
    const color = PALETTE[cell % PALETTE.length]!
    const gradient = context.createLinearGradient(x, y, x, y + CELL_HEIGHT)
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, PALETTE[(cell + 3) % PALETTE.length]!)
    context.fillStyle = gradient
    context.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT)
    // Rayons de lumière derrière le titre.
    context.save()
    context.beginPath()
    context.rect(x, y, CELL_WIDTH, CELL_HEIGHT)
    context.clip()
    context.translate(x + CELL_WIDTH / 2, y + CELL_HEIGHT * 0.55)
    context.fillStyle = 'rgba(255,255,255,0.16)'
    for (let ray = 0; ray < 12; ray += 1) {
      context.rotate(Math.PI / 6)
      context.beginPath()
      context.moveTo(0, 0)
      context.lineTo(-18, -260)
      context.lineTo(18, -260)
      context.fill()
    }
    context.restore()
    // Bandeau blanc en haut, titre en kanji, numéro de tome.
    context.fillStyle = '#fffaf0'
    context.fillRect(x, y + 14, CELL_WIDTH, 46)
    context.fillStyle = '#1a1030'
    context.font = '900 34px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('MANGA', x + CELL_WIDTH / 2, y + 38) // i18n-ignore (couverture dessinée)
    context.font = '900 88px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif'
    context.lineWidth = 8
    context.strokeStyle = '#1a1030'
    const title = PLACEHOLDER_TITLES[cell % PLACEHOLDER_TITLES.length]!
    context.strokeText(title, x + CELL_WIDTH / 2, y + CELL_HEIGHT * 0.56)
    context.fillStyle = '#ffffff'
    context.fillText(title, x + CELL_WIDTH / 2, y + CELL_HEIGHT * 0.56)
    context.fillStyle = '#1a1030'
    context.beginPath()
    context.arc(x + CELL_WIDTH - 30, y + CELL_HEIGHT - 30, 20, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#ffffff'
    context.font = 'bold 22px system-ui, sans-serif'
    context.fillText(String(cell + 1), x + CELL_WIDTH - 30, y + CELL_HEIGHT - 29)
  }

  /** Télécharge les couvertures (une fois par liste) et les pose dans l'atlas à leur arrivée. */
  load(urls: readonly string[]): void {
    const key = urls.join('|')
    if (!this.context || key === this.loaded || urls.length === 0) return
    this.loaded = key
    urls.slice(0, COVER_CELLS).forEach((url, cell) => {
      const image = new Image()
      // L'API peut être sur un autre domaine : sans CORS, l'atlas serait « souillé » et refusé par WebGL.
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'
      image.onload = () => {
        if (this.loaded !== key || !this.context) return
        const [x, y] = this.origin(cell)
        // Recadrée pour remplir la case (une couverture est à peu près en 2:3).
        const scale = Math.max(CELL_WIDTH / image.width, CELL_HEIGHT / image.height)
        const width = image.width * scale
        const height = image.height * scale
        this.context.save()
        this.context.beginPath()
        this.context.rect(x, y, CELL_WIDTH, CELL_HEIGHT)
        this.context.clip()
        this.context.drawImage(image, x + (CELL_WIDTH - width) / 2, y + (CELL_HEIGHT - height) / 2, width, height)
        this.context.restore()
        // Liseré sombre : la marge entre deux cases reste neutre au loin (mipmaps).
        this.context.strokeStyle = '#1a1030'
        this.context.lineWidth = GUTTER * 2
        this.context.strokeRect(x, y, CELL_WIDTH, CELL_HEIGHT)
        this.texture.needsUpdate = true
      }
      image.src = url
    })
  }
}

let atlas: CoverAtlas | null = null

/** L'atlas partagé (créé au premier usage, gardé d'une course à l'autre). */
export function coverAtlas(): CoverAtlas {
  atlas ??= new CoverAtlas()
  return atlas
}

/** Les adresses des couvertures, en petite taille (256 px : vite chargées). */
export function smallCover(url: string): string {
  return url.replace(/([?&])size=\d+/, '$1size=256')
}

/**
 * Matériau des couvertures : l'atlas, avec la case choisie par l'attribut d'instance `aCell`.
 * Légèrement émissif : une couverture reste lisible à l'ombre comme en plein soleil.
 */
export function coverMaterial(): THREE.MeshLambertMaterial {
  const { texture } = coverAtlas()
  const material = new THREE.MeshLambertMaterial({ map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.28 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      // i18n-ignore (code GLSL)
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace(
        '#include <uv_vertex>',
        // i18n-ignore (code GLSL)
        `#include <uv_vertex>
        vec2 coverCell = vec2(mod(aCell, ${COVER_COLUMNS}.0), ${COVER_ROWS - 1}.0 - floor(aCell / ${COVER_COLUMNS}.0));
        vMapUv = (coverCell + vMapUv) / vec2(${COVER_COLUMNS}.0, ${COVER_ROWS}.0);
        vEmissiveMapUv = vMapUv;`,
      )
  }
  material.customProgramCacheKey = () => 'manga-cover'
  return material
}

/** Un lot de couvertures (des plans) : chaque instance porte sa case de l'atlas. */
export class CoverBatch extends Batch {
  private readonly cells: THREE.InstancedBufferAttribute

  constructor(width: number, height: number, max: number) {
    const geometry = new THREE.PlaneGeometry(width, height)
    const cells = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
    cells.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aCell', cells)
    super(geometry, coverMaterial(), max)
    this.cells = cells
  }

  /** Pose une couverture (case `cell` de l'atlas) ; mêmes repères que `Batch.push`. */
  cover(cell: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const index = this.size
    if (index >= this.max) return
    this.push(x, y, z, 1, 1, 1, undefined, rx, ry, rz)
    this.cells.setX(index, ((cell % COVER_CELLS) + COVER_CELLS) % COVER_CELLS)
  }

  override end(): void {
    super.end()
    uploadUsed(this.cells, this.size)
  }
}
