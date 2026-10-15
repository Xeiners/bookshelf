import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Outfit, WardrobeItemId } from '../../lib/runner/wardrobe'
import { outlineMaterial, toonRamp } from './toon'

/*
 * L'aventurier habillé de sa garde-robe (cf. `lib/runner/wardrobe.ts`).
 *
 *  - Hauts et bas : la texture des vêtements du modèle est blanche, faite pour être teinte.
 *    Chaque pièce y peint ses couleurs et ses motifs (damier, emblème, sangles…), zone par
 *    zone (tunique, manches, pantalon, jambières), et l'ombrage d'origine est gardé : on
 *    multiplie la couleur par la luminosité de la texture d'origine. Les détails colorés
 *    (liserés) restent intacts.
 *  - Chapeaux, chaussures, accessoires : des volumes modelés ici, à la main, ombrés « cel »
 *    avec un contour d'encre, accrochés aux os du personnage (tête, pieds, tibias, bassin,
 *    torse) : ils suivent chaque mouvement capté.
 *
 * Les mesures sont celles du modèle au repos (mètres, face vers +z, la gauche du personnage
 * vers +x), relevées au chargement (`captureRest`) : l'habillage marche à tout moment, même
 * pendant une animation.
 */

/* ---- Repos du modèle ------------------------------------------------------------------ */

const REST_BONES = ['hips', 'chest', 'neck', 'head', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'] as const satisfies readonly VRMHumanBoneName[]
type RestBone = (typeof REST_BONES)[number]

interface Rest {
  /** Matrice de chaque os dans le repère du modèle, au repos. */
  bones: Partial<Record<RestBone, THREE.Matrix4>>
}

const REST_KEY = 'outfitRest'
const STATE_KEY = 'outfitState'

/** Relève la pose de repos (à appeler juste après le chargement, avant toute animation). */
export function captureRest(vrm: VRM): void {
  vrm.scene.updateMatrixWorld(true)
  const inverse = vrm.scene.matrixWorld.clone().invert()
  const bones: Rest['bones'] = {}
  for (const name of REST_BONES) {
    const node = vrm.humanoid.getRawBoneNode(name)
    if (node) bones[name] = inverse.clone().multiply(node.matrixWorld)
  }
  vrm.scene.userData[REST_KEY] = { bones } satisfies Rest
}

/* ---- Matériaux ------------------------------------------------------------------------ */

function toon(color: THREE.ColorRepresentation, options: { map?: THREE.Texture; emissive?: THREE.ColorRepresentation; glow?: number } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    map: options.map ?? null,
    gradientMap: toonRamp(),
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.glow ?? 0,
  })
}

/** Métal brillant (or, acier) : un peu d'émission, pour qu'il accroche la lumière. */
const metal = (color: THREE.ColorRepresentation, glow = 0.28) => toon(color, { emissive: color, glow })

function canvasMap(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...repeat)
  }
  return texture
}

/** Un volume ombré « cel », avec son contour d'encre (coque inversée). */
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, outline = 0.004): THREE.Mesh {
  const body = new THREE.Mesh(geometry, material)
  if (outline > 0) body.add(new THREE.Mesh(geometry, outlineMaterial(outline)))
  return body
}

/** Profil tourné autour de l'axe vertical (rayon, hauteur). */
const lathe = (points: [number, number][], segments = 32) => new THREE.LatheGeometry(points.map(([radius, height]) => new THREE.Vector2(radius, height)), segments)
/** Un bord de chapeau : profil fermé (dessus vers l'extérieur, dessous vers l'intérieur), normales vers le dehors. */
const brim = (points: [number, number][], segments = 40) => lathe([...points].reverse(), segments)

/* ---- Hauts et bas : la texture des vêtements --------------------------------------------- */

type Rect = readonly [number, number, number, number]

/** Zones de la texture des vêtements (pixels d'une texture de 1024, origine en haut à gauche). */
const ZONES = {
  tunic: [0, 75, 500, 475],
  back: [0, 75, 255, 475],
  front: [255, 75, 500, 475],
  sleeves: [495, 100, 600, 475],
  collar: [500, 0, 670, 105],
  arms: [670, 0, 1000, 295],
  pants: [0, 475, 670, 895],
  legwraps: [600, 895, 1024, 1024],
  belts: [0, 895, 395, 1024],
} as const satisfies Record<string, Rect>
/** La bande de ceinture de la tunique, au dos et devant. */
const BELT_BANDS: Rect[] = [
  [12, 230, 252, 284],
  [258, 240, 494, 280],
]
/** Le bas du pantalon (tibias) : sous ce trait, la jambe. */
const SHIN_LINE = 785

const TOP_ZONES: Rect[] = [ZONES.tunic, ZONES.sleeves, ZONES.collar, ZONES.arms]
const SKIN = '#f2c9a5'

const fill = (context: CanvasRenderingContext2D, color: string, ...rects: Rect[]) => {
  context.fillStyle = color
  for (const [x0, y0, x1, y1] of rects) context.fillRect(x0, y0, x1 - x0, y1 - y0)
}

function clip(context: CanvasRenderingContext2D, rects: readonly Rect[], draw: () => void): void {
  context.save()
  context.beginPath()
  for (const [x0, y0, x1, y1] of rects) context.rect(x0, y0, x1 - x0, y1 - y0)
  context.clip()
  draw()
  context.restore()
}

/** Emblème rond : disque clair, cerclé, un caractère au centre. */
function emblem(context: CanvasRenderingContext2D, x: number, y: number, radius: number, glyph: string, ink = '#141414'): void {
  context.fillStyle = '#f7f3ea'
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.lineWidth = radius * 0.1
  context.strokeStyle = ink
  context.stroke()
  context.fillStyle = ink
  // i18n-ignore (police)
  context.font = `900 ${radius * 1.25}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(glyph, x, y + radius * 0.06)
}

/** Ce que chaque haut et chaque bas peint sur la texture (couleurs à plat ; l'ombrage suit). */
const GARMENTS: Partial<Record<WardrobeItemId, (context: CanvasRenderingContext2D) => void>> = {
  // Haori à damier vert et noir.
  'top-tanjiro': (context) => {
    clip(context, TOP_ZONES, () => {
      fill(context, '#141414', ...TOP_ZONES)
      context.fillStyle = '#1f8f66'
      const size = 26
      for (let y = 0; y < 480; y += size) for (let x = 0; x < 1000; x += size) if ((x / size + y / size) % 2 === 0) context.fillRect(x, y, size, size)
    })
    fill(context, '#141414', ZONES.arms)
  },
  // Gi orange, ceinture et maillot bleus, emblème au dos et sur le cœur.
  'top-goku': (context) => {
    fill(context, '#f47a20', ZONES.tunic, ZONES.sleeves, ZONES.collar)
    fill(context, '#2443a8', ZONES.arms, ...BELT_BANDS)
    context.fillStyle = '#2443a8'
    context.beginPath()
    context.moveTo(335, 75)
    context.lineTo(410, 75)
    context.lineTo(372, 150)
    context.fill()
    emblem(context, 130, 165, 50, '亀') // i18n-ignore (emblème du gi)
    emblem(context, 430, 160, 22, '亀') // i18n-ignore (emblème du gi)
  },
  // Veste orange, épaules sombres, col blanc, spirale rouge au dos.
  'top-naruto': (context) => {
    fill(context, '#ff8a1f', ZONES.tunic)
    fill(context, '#1c2340', [0, 75, 500, 128], ZONES.sleeves, ZONES.arms)
    fill(context, '#f2f2f2', ZONES.collar)
    fill(context, '#ff8a1f', ...BELT_BANDS)
    context.strokeStyle = '#d6261f'
    context.lineWidth = 9
    context.lineCap = 'round'
    context.beginPath()
    for (let step = 0; step <= 60; step += 1) {
      const angle = step * 0.32
      const radius = 4 + step * 0.62
      const x = 128 + Math.cos(angle) * radius
      const y = 180 + Math.sin(angle) * radius
      if (step === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.stroke()
    // Fermeture éclair blanche devant.
    fill(context, '#f2f2f2', [368, 135, 376, 475])
  },
  // Veste courte beige, chemise blanche, ceinturon, ailes de la liberté au dos.
  'top-survey': (context) => {
    fill(context, '#8b6b4a', ZONES.tunic, ZONES.sleeves, ZONES.collar)
    fill(context, '#f1ece2', [342, 75, 402, 475])
    fill(context, '#4a2f1d', ZONES.arms, ...BELT_BANDS)
    // Écusson : deux ailes, bleue et blanche, sur un bouclier.
    context.fillStyle = '#f1ece2'
    context.beginPath()
    context.moveTo(80, 120)
    context.lineTo(178, 120)
    context.lineTo(178, 190)
    context.quadraticCurveTo(129, 232, 80, 190)
    context.closePath()
    context.fill()
    const wing = (color: string, flip: number) => {
      context.fillStyle = color
      context.beginPath()
      context.moveTo(129, 205)
      for (let feather = 0; feather < 4; feather += 1) {
        context.lineTo(129 + flip * (12 + feather * 10), 140 + feather * 12)
        context.lineTo(129 + flip * (6 + feather * 10), 150 + feather * 12)
      }
      context.closePath()
      context.fill()
    }
    wing('#2f5fa8', -1)
    wing('#ffffff', 1)
    context.strokeStyle = '#2f5fa8'
    context.lineWidth = 3
    context.strokeRect(80, 120, 98, 70)
  },
  // Gilet rouge ouvert, quatre boutons, ceinture jaune, bras nus.
  'top-luffy': (context) => {
    fill(context, '#d1232a', ZONES.tunic, ZONES.collar)
    fill(context, SKIN, ZONES.sleeves)
    context.fillStyle = SKIN
    context.beginPath()
    context.moveTo(352, 75)
    context.lineTo(392, 75)
    context.lineTo(384, 240)
    context.lineTo(360, 240)
    context.fill()
    fill(context, '#f2c53d', ...BELT_BANDS)
    context.fillStyle = '#f2c53d'
    for (let button = 0; button < 4; button += 1) {
      context.beginPath()
      context.arc(398, 100 + button * 32, 6, 0, Math.PI * 2)
      context.fill()
    }
  },
  // Pantalon de gi orange, ceinture et bandes bleues.
  'bottom-goku': (context) => {
    fill(context, '#f47a20', ZONES.pants)
    fill(context, '#2443a8', ZONES.legwraps, ZONES.belts)
  },
  // Pantalon orange, chevilles bandées de bleu nuit.
  'bottom-naruto': (context) => {
    fill(context, '#ff8a1f', ZONES.pants)
    fill(context, '#24305e', ZONES.legwraps, ZONES.belts, [0, SHIN_LINE + 40, 670, 895])
  },
  // Hakama noir, ceinture et jambières blanches.
  'bottom-hakama': (context) => {
    fill(context, '#24242a', ZONES.pants)
    fill(context, '#ececec', ZONES.legwraps, ZONES.belts)
    context.strokeStyle = '#24242a'
    context.lineWidth = 4
    for (let x = 610; x < 1024; x += 26) {
      context.beginPath()
      context.moveTo(x, 900)
      context.lineTo(x + 18, 1020)
      context.stroke()
    }
  },
  // Short en jean retroussé : sous le genou, la jambe nue.
  'bottom-denim': (context) => {
    fill(context, '#3d5f9c', ZONES.pants)
    clip(context, [ZONES.pants], () => {
      context.strokeStyle = 'rgba(255,255,255,0.12)'
      context.lineWidth = 2
      for (let x = -400; x < 700; x += 7) {
        context.beginPath()
        context.moveTo(x, 475)
        context.lineTo(x + 420, 895)
        context.stroke()
      }
    })
    fill(context, '#7d9bd0', [0, SHIN_LINE - 34, 670, SHIN_LINE])
    fill(context, SKIN, [0, SHIN_LINE, 670, 895], ZONES.legwraps)
    fill(context, '#5a3a22', ZONES.belts)
  },
  // Pantalon blanc, sangles de cuir du harnais.
  'bottom-survey': (context) => {
    fill(context, '#eeebe2', ZONES.pants)
    fill(context, '#5a3a22', ZONES.legwraps, ZONES.belts, [0, 600, 670, 616], [0, 690, 670, 706])
  },
}

interface OutfitState {
  original: THREE.Texture
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  materials: THREE.Material[]
  key: string
  parts: THREE.Object3D[]
  geometries: Set<THREE.BufferGeometry>
  materialsOwned: Set<THREE.Material>
  /** Pixels d'origine (copie) et albédo (dessin) : réutilisés d'un essayage à l'autre. */
  base: ImageData | null
  paint: HTMLCanvasElement
}

type MaterialWithMap = THREE.Material & { map?: THREE.Texture | null; shadeMultiplyTexture?: THREE.Texture | null }

function stateOf(vrm: VRM): OutfitState | null {
  const existing = vrm.scene.userData[STATE_KEY] as OutfitState | undefined
  if (existing) return existing
  // La texture des vêtements : celle du matériau « huku » (tunique, pantalon).
  let original: THREE.Texture | null = null
  vrm.scene.traverse((node) => {
    if (original || !(node instanceof THREE.Mesh)) return
    for (const material of [node.material].flat() as MaterialWithMap[]) if (/huku/i.test(material.name) && material.map) original = material.map
  })
  if (!original) return null
  const source = original as THREE.Texture
  const image = source.image as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const paint = document.createElement('canvas')
  paint.width = canvas.width
  paint.height = canvas.height
  const texture = new THREE.CanvasTexture(canvas)
  texture.flipY = source.flipY
  texture.colorSpace = source.colorSpace
  texture.wrapS = source.wrapS
  texture.wrapT = source.wrapT
  texture.anisotropy = 4
  const materials: THREE.Material[] = []
  vrm.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of [node.material].flat() as MaterialWithMap[]) if (material.map === source || material.shadeMultiplyTexture === source) materials.push(material)
  })
  const state: OutfitState = { original: source, canvas, texture, materials, key: '', parts: [], geometries: new Set(), materialsOwned: new Set(), base: null, paint }
  vrm.scene.userData[STATE_KEY] = state
  return state
}

/** Repeint la texture des vêtements : l'albédo des pièces, multiplié par l'ombrage d'origine. */
function paintClothes(state: OutfitState, outfit: Outfit): void {
  const context = state.canvas.getContext('2d', { willReadFrequently: true })
  const paint = state.paint.getContext('2d', { willReadFrequently: true })
  if (!context || !paint) return
  const { width, height } = state.canvas
  if (!state.base) {
    context.drawImage(state.original.image as CanvasImageSource, 0, 0, width, height)
    state.base = context.getImageData(0, 0, width, height)
  }
  const garments = [outfit.top, outfit.bottom].flatMap((id) => (id && GARMENTS[id] ? [GARMENTS[id]] : []))
  const swap = (material: MaterialWithMap, from: THREE.Texture, to: THREE.Texture) => {
    if (material.map === from) material.map = to
    if (material.shadeMultiplyTexture === from) material.shadeMultiplyTexture = to
  }
  if (garments.length === 0) {
    for (const material of state.materials) swap(material, state.texture, state.original)
    return
  }
  const scale = width / 1024
  paint.setTransform(1, 0, 0, 1, 0, 0)
  paint.clearRect(0, 0, width, height)
  paint.setTransform(scale, 0, 0, scale, 0, 0)
  for (const draw of garments) draw(paint)
  const albedo = paint.getImageData(0, 0, width, height).data
  const base = state.base.data
  const out = new ImageData(new Uint8ClampedArray(base), width, height)
  const pixels = out.data
  for (let index = 0; index < pixels.length; index += 4) {
    if (albedo[index + 3]! < 8) continue
    const r = base[index]! / 255
    const g = base[index + 1]! / 255
    const b = base[index + 2]! / 255
    const max = Math.max(r, g, b)
    // Liserés colorés : intacts. Le tissu blanc (et ses ombres grises) prend la couleur.
    if (max - Math.min(r, g, b) > 0.22) continue
    const shade = Math.min(1.06, Math.pow((0.299 * r + 0.587 * g + 0.114 * b) / 0.9, 1.15))
    pixels[index] = albedo[index]! * shade
    pixels[index + 1] = albedo[index + 1]! * shade
    pixels[index + 2] = albedo[index + 2]! * shade
  }
  context.putImageData(out, 0, 0)
  state.texture.needsUpdate = true
  for (const material of state.materials) swap(material, state.original, state.texture)
}

/**
 * L'écusson hexagonal cousu sur la poitrine de la tunique (un petit maillage à part, logé
 * dans des découpes du tissu) : il prend la teinte du haut porté, comme une broderie.
 */
const LOGO_TINTS: Partial<Record<WardrobeItemId, string>> = {
  'top-tanjiro': '#1f8f66',
  'top-goku': '#2443a8',
  'top-naruto': '#d6261f',
  'top-survey': '#2f5fa8',
  'top-luffy': '#f2c53d',
}

type Tintable = THREE.Material & { color?: THREE.Color; shadeColorFactor?: THREE.Color }

function tintLogo(vrm: VRM, color: string | null): void {
  vrm.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of [node.material].flat() as Tintable[]) {
      if (!/logo/i.test(material.name) || !material.color) continue
      const original = (material.userData.original ??= { lit: material.color.getHex(), shade: material.shadeColorFactor?.getHex() }) as { lit: number; shade?: number }
      if (color) {
        material.color.set(color)
        material.shadeColorFactor?.set(color).multiplyScalar(0.6)
      } else {
        material.color.setHex(original.lit)
        if (original.shade !== undefined) material.shadeColorFactor?.setHex(original.shade)
      }
    }
  })
}

/* ---- Pièces modelées -------------------------------------------------------------------- */

type Piece = { bone: RestBone; object: THREE.Object3D }

/** Tête : centre et rayon (m), au repos. */
const HEAD = { x: 0, y: 1.445, z: 0.004, radius: 0.128, crown: 1.505 }

function hatBase(object: THREE.Object3D, tilt = -0.1): Piece {
  object.position.set(HEAD.x, HEAD.crown, HEAD.z - 0.008)
  object.rotation.x = tilt
  return { bone: 'head', object }
}

function strawTexture(): THREE.CanvasTexture {
  return canvasMap(
    256,
    64,
    (context) => {
      context.fillStyle = '#e9c46a'
      context.fillRect(0, 0, 256, 64)
      for (let line = 0; line < 64; line += 4) {
        context.fillStyle = line % 8 ? 'rgba(160,110,40,0.25)' : 'rgba(255,240,190,0.35)'
        context.fillRect(0, line, 256, 2)
      }
      for (let x = 0; x < 256; x += 6) {
        context.fillStyle = 'rgba(140,95,30,0.18)'
        context.fillRect(x, 0, 1, 64)
      }
    },
    [6, 3],
  )
}

/** Visage de badge (Ace) : rond, deux yeux, une bouche. */
function badgeTexture(color: string, happy: boolean): THREE.CanvasTexture {
  return canvasMap(64, 64, (context) => {
    context.fillStyle = color
    context.beginPath()
    context.arc(32, 32, 31, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#1a1a1a'
    context.fillRect(20, 20, 6, 12)
    context.fillRect(38, 20, 6, 12)
    context.strokeStyle = '#1a1a1a'
    context.lineWidth = 5
    context.beginPath()
    if (happy) context.arc(32, 36, 13, 0.15 * Math.PI, 0.85 * Math.PI)
    else context.arc(32, 52, 13, 1.15 * Math.PI, 1.85 * Math.PI)
    context.stroke()
  })
}

function spotsTexture(base: string, spot: string, count: number): THREE.CanvasTexture {
  return canvasMap(256, 128, (context) => {
    context.fillStyle = base
    context.fillRect(0, 0, 256, 128)
    context.fillStyle = spot
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let index = 0; index < count; index += 1) {
      context.beginPath()
      context.ellipse(random() * 256, random() * 128, 6 + random() * 9, 5 + random() * 7, random() * 3, 0, Math.PI * 2)
      context.fill()
    }
  })
}

const stripesTexture = (a: string, b: string, count: number) =>
  canvasMap(256, 16, (context) => {
    for (let stripe = 0; stripe < count; stripe += 1) {
      context.fillStyle = stripe % 2 ? b : a
      context.fillRect((stripe * 256) / count, 0, 256 / count + 1, 16)
    }
  })

/** Poignée tressée (losanges) des sabres. */
const wrapTexture = (cord: string, under: string) =>
  canvasMap(
    32,
    64,
    (context) => {
      context.fillStyle = under
      context.fillRect(0, 0, 32, 64)
      context.fillStyle = cord
      for (let y = -16; y < 64; y += 16) {
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(16, y + 8)
        context.lineTo(32, y)
        context.lineTo(32, y + 6)
        context.lineTo(16, y + 14)
        context.lineTo(0, y + 6)
        context.fill()
      }
    },
    [1, 4],
  )

const HATS: Partial<Record<WardrobeItemId, () => Piece[]>> = {
  // Chapeau de paille : calotte, large bord légèrement tombant, ruban rouge.
  'hat-straw': () => {
    const group = new THREE.Group()
    const straw = toon('#ffffff', { map: strawTexture() })
    group.add(mesh(lathe([[0.137, 0], [0.135, 0.05], [0.125, 0.085], [0.095, 0.108], [0.04, 0.116], [0, 0.117]]), straw, 0.004))
    group.add(mesh(brim([[0.13, 0.002], [0.2, -0.004], [0.27, -0.016], [0.285, -0.024], [0.28, -0.03], [0.2, -0.012], [0.13, -0.006]], 40), straw, 0.004))
    group.add(mesh(new THREE.CylinderGeometry(0.139, 0.14, 0.032, 32, 1, true), toon('#c62828'), 0))
    group.children[2]!.position.y = 0.02
    return [hatBase(group, -0.16)]
  },
  // Chapeau de cow-boy orange, cordon, deux badges (un triste, un joyeux).
  'hat-ace': () => {
    const group = new THREE.Group()
    const felt = toon('#f08a24')
    group.add(mesh(lathe([[0.135, 0], [0.128, 0.07], [0.118, 0.11], [0.08, 0.128], [0.03, 0.115], [0, 0.112]]), felt, 0.004))
    group.add(mesh(brim([[0.13, 0.006], [0.18, 0.007], [0.232, 0.022], [0.254, 0.05], [0.264, 0.044], [0.246, 0.012], [0.2, -0.002], [0.13, -0.004]], 40), felt, 0.004))
    const cord = mesh(new THREE.CylinderGeometry(0.133, 0.135, 0.018, 32, 1, true), toon('#3a2a1f'), 0)
    cord.position.y = 0.016
    group.add(cord)
    for (const [index, happy] of [false, true].entries()) {
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), toon('#ffffff', { map: badgeTexture(happy ? '#e2483a' : '#3f7fe0', happy) }))
      const angle = (index ? 0.32 : -0.32) + Math.PI / 2
      badge.position.set(Math.cos(angle) * 0.137, 0.042, Math.sin(angle) * 0.137)
      badge.lookAt(Math.cos(angle) * 2, 0.042, Math.sin(angle) * 2)
      group.add(badge)
    }
    return [hatBase(group, -0.12)]
  },
  // Toque de fourrure blanche à taches, bord tacheté.
  'hat-law': () => {
    const group = new THREE.Group()
    group.add(mesh(lathe([[0.14, 0], [0.142, 0.06], [0.138, 0.11], [0.11, 0.142], [0.05, 0.152], [0, 0.153]]), toon('#ffffff', { map: spotsTexture('#f4f2ec', '#6b4a32', 26) }), 0.004))
    const band = mesh(new THREE.TorusGeometry(0.143, 0.022, 10, 36), toon('#ffffff', { map: spotsTexture('#efe6d6', '#3a2a1f', 40) }), 0.003)
    band.rotation.x = Math.PI / 2
    band.position.y = 0.012
    group.add(band)
    return [hatBase(group, -0.08)]
  },
  // Bob rayé vert et blanc, bord qui retombe.
  'hat-urahara': () => {
    const group = new THREE.Group()
    const stripes = toon('#ffffff', { map: stripesTexture('#2f7d4a', '#f2f2ea', 24) })
    group.add(mesh(lathe([[0.136, 0], [0.13, 0.07], [0.118, 0.105], [0.06, 0.118], [0, 0.119]]), stripes, 0.004))
    group.add(mesh(brim([[0.134, 0.004], [0.18, -0.025], [0.225, -0.058], [0.222, -0.064], [0.176, -0.034], [0.132, -0.004]], 40), stripes, 0.004))
    return [hatBase(group, -0.06)]
  },
  // Casquette noire, visière, insigne doré et chaîne.
  'hat-jotaro': () => {
    const group = new THREE.Group()
    const cloth = toon('#1b1b22')
    group.add(mesh(lathe([[0.138, 0], [0.136, 0.05], [0.12, 0.09], [0.07, 0.106], [0, 0.108]]), cloth, 0.004))
    const visor = mesh(new THREE.CircleGeometry(0.13, 24, Math.PI, Math.PI), cloth, 0.003)
    visor.rotation.x = -Math.PI / 2 + 0.22
    visor.scale.set(1, 0.85, 1)
    visor.position.set(0, 0.012, 0.075)
    group.add(visor)
    const gold = metal('#e6b43c')
    const badge = mesh(new THREE.BoxGeometry(0.045, 0.03, 0.008), gold, 0.002)
    badge.position.set(0, 0.05, 0.135)
    badge.rotation.x = -0.25
    group.add(badge)
    for (let link = 0; link < 9; link += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0022, 6, 12), gold)
      const t = link / 8
      ring.position.set(-0.137 - Math.sin(t * Math.PI) * 0.012, 0.03 - Math.sin(t * Math.PI) * 0.035, 0.08 - t * 0.17)
      ring.rotation.set(link % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0)
      group.add(ring)
    }
    return [hatBase(group, -0.1)]
  },
}

/** Plaque frontale gravée de la feuille. */
function leafPlateTexture(): THREE.CanvasTexture {
  return canvasMap(128, 56, (context) => {
    const gradient = context.createLinearGradient(0, 0, 0, 56)
    gradient.addColorStop(0, '#f1f4f8')
    gradient.addColorStop(0.5, '#b9c2cf')
    gradient.addColorStop(1, '#e3e8ef')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 56)
    context.strokeStyle = '#4b5463'
    context.lineWidth = 3
    context.strokeRect(5, 5, 118, 46)
    context.lineWidth = 3.5
    context.beginPath()
    for (let step = 0; step <= 40; step += 1) {
      const angle = step * 0.34
      const radius = 1 + step * 0.36
      const x = 62 + Math.cos(angle) * radius
      const y = 30 + Math.sin(angle) * radius
      if (step === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.lineTo(84, 12)
    context.lineTo(77, 33)
    context.stroke()
    for (const x of [14, 114]) {
      context.fillStyle = '#4b5463'
      context.beginPath()
      context.arc(x, 28, 3, 0, Math.PI * 2)
      context.fill()
    }
  })
}

const ZODIAC_GEMS = ['#3fa9ff', '#ff6fb5', '#ff4d5e', '#5ef2b0', '#c58bff', '#ffd35c']

function katana(scabbard: string, handle: string, cord: string): THREE.Group {
  const sword = new THREE.Group()
  // Le long de +y : poignée en haut, fourreau dessous ; la garde à l'origine.
  const sheath = mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.6, 12), toon(scabbard), 0.002)
  sheath.position.y = -0.3
  sheath.scale.set(1, 1, 1.35)
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 16), metal('#c9a227', 0.2))
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.22, 10), toon('#ffffff', { map: wrapTexture(cord, handle) }))
  grip.position.y = 0.114
  sword.add(sheath, guard, grip)
  return sword
}

const ACCESSORIES: Partial<Record<WardrobeItemId, () => Piece[]>> = {
  // Bandeau frontal : ruban bleu nuit, plaque d'acier gravée, deux pans dans le dos.
  'acc-leaf': () => {
    const group = new THREE.Group()
    const cloth = toon('#1f2a4d')
    const band = mesh(new THREE.CylinderGeometry(0.133, 0.133, 0.034, 36, 1, true), cloth, 0)
    band.scale.set(1, 1, 1.07)
    group.add(band)
    const plate = mesh(new THREE.BoxGeometry(0.118, 0.044, 0.008), toon('#b9c2cf'), 0.002)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.116, 0.042), metal('#ffffff', 0.12))
    ;(face.material as THREE.MeshToonMaterial).map = leafPlateTexture()
    face.position.z = 0.0045
    plate.add(face)
    plate.position.set(0, 0, 0.142)
    plate.rotation.x = -0.08
    group.add(plate)
    for (const side of [-1, 1]) {
      const tail = mesh(new THREE.BoxGeometry(0.028, 0.16, 0.006), cloth, 0.002)
      tail.position.set(side * 0.025, -0.07, -0.148)
      tail.rotation.set(0.25, 0, side * 0.18)
      group.add(tail)
    }
    group.position.set(HEAD.x, 1.474, HEAD.z)
    group.rotation.x = -0.1
    return [{ bone: 'head', object: group }]
  },
  // Clés du zodiaque : anneau doré à la hanche droite, six clés aux pierres de couleur.
  'acc-zodiac': () => {
    const group = new THREE.Group()
    const gold = metal('#f5c542', 0.35)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 24), gold)
    group.add(ring)
    ZODIAC_GEMS.forEach((gem, index) => {
      const key = new THREE.Group()
      const angle = -0.9 + (index / (ZODIAC_GEMS.length - 1)) * 1.8
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.06, 6), gold)
      shaft.position.y = -0.055
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.003, 6, 14), gold)
      bow.position.y = -0.018
      const stone = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), toon(gem, { emissive: gem, glow: 0.6 }))
      stone.position.y = -0.018
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.004), gold)
      bit.position.set(0.007, -0.08, 0)
      key.add(shaft, bow, stone, bit)
      key.position.set(Math.sin(angle) * 0.03, -Math.cos(angle) * 0.03, 0)
      key.rotation.z = angle
      group.add(key)
    })
    group.position.set(-0.145, 0.78, 0.045)
    group.rotation.set(0, -0.9, 0)
    return [{ bone: 'hips', object: group }]
  },
  // Trois sabres à la hanche gauche : blanc, rouge, noir.
  'acc-swords': () => {
    const group = new THREE.Group()
    const swords = [katana('#f2f2f2', '#f2f2f2', '#1a1a1a'), katana('#a3171d', '#5a0d10', '#1a1a1a'), katana('#141414', '#7a1f1f', '#141414')]
    swords.forEach((sword, index) => {
      sword.position.set(index * 0.012, index * 0.02, -index * 0.03)
      // Poignée vers l'avant et le haut, fourreau vers l'arrière.
      sword.rotation.set(1.18 + index * 0.07, 0, -0.12 - index * 0.06)
      group.add(sword)
    })
    group.position.set(0.165, 0.8, 0.05)
    group.rotation.set(0, 0.22, 0)
    return [{ bone: 'hips', object: group }]
  },
  // Zangetsu : lame-couperet géante en travers du dos, poignée bandée de blanc.
  'acc-zangetsu': () => {
    const group = new THREE.Group()
    const shape = new THREE.Shape()
    shape.moveTo(-0.07, 0)
    shape.lineTo(0.07, 0)
    shape.lineTo(0.07, 0.9)
    shape.lineTo(0.0, 1.0)
    shape.lineTo(-0.07, 0.96)
    shape.closePath()
    const blade = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 }), metal('#d6dbe2', 0.22), 0.004)
    blade.position.z = -0.006
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.88, 0.02), toon('#2a2d33'))
    edge.position.set(-0.066, 0.46, 0)
    const grip = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.24, 10), toon('#ffffff', { map: wrapTexture('#d8d2c4', '#f6f2ea') }), 0.002)
    grip.position.y = -0.12
    const gold = metal('#9aa3ad', 0.15)
    for (let link = 0; link < 5; link += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.0028, 6, 12), gold)
      ring.position.set(0.006 * link, -0.25 - link * 0.016, 0)
      ring.rotation.y = link % 2 ? Math.PI / 2 : 0
      group.add(ring)
    }
    group.add(blade, edge, grip)
    // Lame vers le bas à gauche, poignée par-dessus l'épaule droite.
    group.position.set(-0.13, 1.28, -0.125)
    group.rotation.set(0, Math.PI, Math.PI - 0.62)
    return [{ bone: 'chest', object: group }]
  },
  // Écharpe rouge : un tour du cou, un pan sur la poitrine.
  'acc-scarf': () => {
    const group = new THREE.Group()
    const wool = toon('#b81f2c')
    const loop = mesh(new THREE.TorusGeometry(0.068, 0.028, 12, 28), wool, 0.003)
    loop.rotation.x = Math.PI / 2 - 0.1
    loop.scale.set(1, 1.12, 0.9)
    group.add(loop)
    const tail = mesh(new THREE.BoxGeometry(0.075, 0.2, 0.022), wool, 0.003)
    tail.position.set(0.03, -0.1, 0.085)
    tail.rotation.set(0.14, 0, 0.12)
    group.add(tail)
    group.position.set(0, 1.272, -0.006)
    return [{ bone: 'chest', object: group }]
  },
}

/* ---- Chaussures ------------------------------------------------------------------------ */

/** Pied au repos : cheville, longueur de la semelle (du talon au bout), largeur. */
const FOOT = { ankleY: 0.076, heel: -0.07, toe: 0.2, width: 0.098, x: 0.09 }

/**
 * Empeigne : une boîte arrondie déformée (bout effilé et plus bas, talon arrondi), posée sur
 * la semelle. `height` : hauteur au cou-de-pied.
 */
function upperGeometry(height: number, width = FOOT.width, toeLift = 0.45): THREE.BufferGeometry {
  const length = FOOT.toe - FOOT.heel
  const geometry = new THREE.BoxGeometry(width, height, length, 6, 4, 12)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index) + height / 2
    const t = (position.getZ(index) + length / 2) / length
    // Plus bas et plus étroit vers le bout, arrondi au talon.
    const lower = t > 0.5 ? 1 - ((t - 0.5) / 0.5) ** 1.6 * (1 - toeLift) : 1
    const narrow = t > 0.75 ? 1 - ((t - 0.75) / 0.25) ** 2 * 0.45 : t < 0.12 ? 1 - ((0.12 - t) / 0.12) ** 2 * 0.3 : 1
    const round = 1 - (y / height) ** 2 * 0.25
    position.setXYZ(index, x * narrow * round, y * lower, FOOT.heel + t * length)
  }
  geometry.computeVertexNormals()
  return geometry
}

function soleGeometry(thickness: number, width = FOOT.width + 0.012): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const half = width / 2
  shape.moveTo(-half * 0.8, FOOT.heel)
  shape.quadraticCurveTo(0, FOOT.heel - 0.02, half * 0.8, FOOT.heel)
  shape.quadraticCurveTo(half, FOOT.heel + 0.06, half, FOOT.toe - 0.07)
  shape.quadraticCurveTo(half * 0.8, FOOT.toe + 0.005, 0, FOOT.toe + 0.006)
  shape.quadraticCurveTo(-half * 0.8, FOOT.toe + 0.005, -half, FOOT.toe - 0.07)
  shape.quadraticCurveTo(-half, FOOT.heel + 0.06, -half * 0.8, FOOT.heel)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 6 })
  // Dessin dans le plan (x, z) : on couche la forme (profondeur vers le haut).
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, -1, -1)
  return geometry
}

/** Une tige de botte (tibia) : de la cheville à `top` (hauteur au repos). */
function shaft(top: number, color: string, bottom = 0.05): THREE.Mesh {
  const shin = mesh(new THREE.CylinderGeometry(0.052, 0.047, top - bottom, 18), toon(color), 0.003)
  shin.position.y = (top + bottom) / 2
  shin.position.z = -0.008
  return shin
}

/** Une paire : pour chaque pied, le pied (os du pied) et la tige (os du tibia), en miroir. */
function pair(build: (side: number) => { foot: THREE.Object3D[]; shin?: THREE.Object3D[] }): Piece[] {
  const pieces: Piece[] = []
  for (const side of [1, -1]) {
    const { foot, shin } = build(side)
    const footGroup = new THREE.Group()
    footGroup.add(...foot)
    footGroup.position.x = side * FOOT.x
    pieces.push({ bone: side > 0 ? 'leftFoot' : 'rightFoot', object: footGroup })
    if (shin?.length) {
      const shinGroup = new THREE.Group()
      shinGroup.add(...shin)
      shinGroup.position.x = side * FOOT.x
      pieces.push({ bone: side > 0 ? 'leftLowerLeg' : 'rightLowerLeg', object: shinGroup })
    }
  }
  return pieces
}

const SHOES: Partial<Record<WardrobeItemId, () => Piece[]>> = {
  // Bottes bleues, revers doré, liseré rouge.
  'shoes-goku': () =>
    pair(() => {
      const sole = mesh(soleGeometry(0.02), toon('#e7d3a1'), 0.002)
      const upper = mesh(upperGeometry(0.09), toon('#2d4fb4'), 0.003)
      upper.position.y = 0.018
      const cuff = mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.03, 18), toon('#e6b43c'), 0.002)
      cuff.position.set(0, 0.32, -0.008)
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.006), toon('#d92b2b'))
      stripe.position.set(0, 0.2, 0.046)
      return { foot: [sole, upper], shin: [shaft(0.31, '#2d4fb4'), cuff, stripe] }
    }),
  // Grandes bottes de cuir brun, sangles et boucles.
  'shoes-survey': () =>
    pair(() => {
      const sole = mesh(soleGeometry(0.022), toon('#2a1a10'), 0.002)
      const upper = mesh(upperGeometry(0.088), toon('#5a3a22'), 0.003)
      upper.position.y = 0.02
      const parts: THREE.Object3D[] = [shaft(0.42, '#5a3a22')]
      for (const y of [0.18, 0.3]) {
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.016, 18, 1, true), toon('#2f1d10'))
        strap.position.set(0, y, -0.008)
        const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.006), metal('#c9a227', 0.2))
        buckle.position.set(0.05, y, 0.012)
        parts.push(strap, buckle)
      }
      return { foot: [sole, upper], shin: parts }
    }),
  // Sandales ninja bleues : bout ouvert, sangles, talon couvert.
  'shoes-ninja': () =>
    pair(() => {
      const blue = toon('#2b3a7e')
      const sole = mesh(soleGeometry(0.018), blue, 0.002)
      const heel = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.075, 18, 1, true, Math.PI * 0.55, Math.PI * 0.9), blue, 0.002)
      heel.position.set(0, 0.056, -0.025)
      heel.rotation.y = Math.PI
      const parts: THREE.Object3D[] = [sole, heel]
      for (const z of [0.045, 0.11]) {
        const strap = mesh(new THREE.BoxGeometry(FOOT.width + 0.006, 0.026, 0.026), blue, 0.002)
        strap.position.set(0, 0.04 - (z - 0.045) * 0.25, z)
        parts.push(strap)
      }
      const ankle = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.007, 6, 20), blue)
      ankle.rotation.x = Math.PI / 2
      ankle.position.set(0, 0.095, -0.01)
      parts.push(ankle)
      return { foot: parts }
    }),
  // Waraji : chaussettes tabi blanches sur sandales de paille tressée.
  'shoes-waraji': () =>
    pair(() => {
      const sole = mesh(soleGeometry(0.018), toon('#ffffff', { map: strawTexture() }), 0.002)
      const sock = mesh(upperGeometry(0.062, FOOT.width - 0.012, 0.6), toon('#f4f1ea'), 0.002)
      sock.position.y = 0.016
      const cuff = mesh(new THREE.CylinderGeometry(0.046, 0.044, 0.07, 16), toon('#f4f1ea'), 0.002)
      cuff.position.set(0, 0.1, -0.012)
      const parts: THREE.Object3D[] = [sole, sock, cuff]
      for (const z of [0.0, 0.08]) {
        const rope = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.005, 6, 18, Math.PI), toon('#8b6a3a'))
        rope.position.set(0, 0.02, z)
        parts.push(rope)
      }
      return { foot: parts }
    }),
  // Sandales de bois à lanière en V.
  'shoes-luffy': () =>
    pair(() => {
      const sole = mesh(soleGeometry(0.024), toon('#b5874c'), 0.002)
      const strapMaterial = toon('#6b3f1f')
      const parts: THREE.Object3D[] = [sole]
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.105, 8), strapMaterial)
        strap.position.set(side * 0.026, 0.04, 0.085)
        strap.rotation.set(Math.PI / 2 - 0.35, 0, side * 0.9)
        parts.push(strap)
      }
      return { foot: parts }
    }),
}

/* ---- Habiller ------------------------------------------------------------------------- */

function disposeParts(state: OutfitState): void {
  for (const part of state.parts) part.removeFromParent()
  state.parts = []
  for (const geometry of state.geometries) geometry.dispose()
  for (const material of state.materialsOwned) {
    const textured = material as MaterialWithMap
    textured.map?.dispose()
    material.dispose()
  }
  state.geometries.clear()
  state.materialsOwned.clear()
}

const MATRIX = new THREE.Matrix4()

/**
 * Habille un VRM (vitrine ou course) de la tenue donnée. Idempotent : rien ne change si la
 * tenue est la même ; sinon, la texture est repeinte et les pièces modelées remplacées.
 */
export function applyOutfit(vrm: VRM, outfit: Outfit): void {
  const rest = vrm.scene.userData[REST_KEY] as Rest | undefined
  const state = stateOf(vrm)
  if (!rest || !state) return
  const key = JSON.stringify(outfit)
  if (state.key === key) return
  state.key = key
  paintClothes(state, outfit)
  tintLogo(vrm, outfit.top ? (LOGO_TINTS[outfit.top] ?? null) : null)
  disposeParts(state)
  const builders = [outfit.hat && HATS[outfit.hat], outfit.accessory && ACCESSORIES[outfit.accessory], outfit.shoes && SHOES[outfit.shoes]]
  for (const build of builders) {
    if (!build) continue
    for (const { bone, object } of build()) {
      const node = vrm.humanoid.getRawBoneNode(bone)
      const boneRest = rest.bones[bone]
      if (!node || !boneRest) continue
      // Placée dans le repère du modèle au repos, la pièce est ramenée dans celui de l'os.
      object.updateMatrix()
      MATRIX.copy(boneRest).invert().multiply(object.matrix)
      MATRIX.decompose(object.position, object.quaternion, object.scale)
      object.traverse((child) => {
        child.frustumCulled = false
        if (child instanceof THREE.Mesh) {
          state.geometries.add(child.geometry)
          for (const material of [child.material].flat()) state.materialsOwned.add(material)
        }
      })
      node.add(object)
      state.parts.push(object)
    }
  }
}

/* ---- Vignettes ----------------------------------------------------------------------- */

/** Les volumes d'une pièce (chapeau, chaussures, accessoire), dans le repère du modèle au repos. */
export function buildPieces(id: WardrobeItemId): THREE.Object3D[] {
  const build = HATS[id] ?? ACCESSORIES[id] ?? SHOES[id]
  return build ? build().map((piece) => piece.object) : []
}

/** Peint un haut ou un bas (couleurs à plat) dans le repère de la texture des vêtements (1024 px). */
export function drawGarment(id: WardrobeItemId, context: CanvasRenderingContext2D): boolean {
  const draw = GARMENTS[id]
  if (!draw) return false
  draw(context)
  return true
}

/** Zones de la texture : le devant de la tunique, le pantalon (pour cadrer une vignette). */
export const GARMENT_FRAMES = { top: ZONES.front, bottom: ZONES.pants } as const
