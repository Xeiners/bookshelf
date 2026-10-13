import * as THREE from 'three'

/*
 * Matériaux du Manga Runner : un ombrage « cel » à trois tons (MeshToonMaterial et une
 * petite rampe), et un contour d'encre par coque inversée — la géométrie repoussée le
 * long de ses normales, faces arrière seulement. Le contour partage la matrice
 * d'instances de son maillage : un seul appel de dessin de plus par type d'objet.
 */

let ramp: THREE.DataTexture | null = null

/** Rampe à trois tons, en filtrage « nearest » : des aplats nets, comme en anime. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp
  const data = new Uint8Array([90, 170, 255])
  ramp = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

export function toonMaterial(color: THREE.ColorRepresentation = '#ffffff', emissive: THREE.ColorRepresentation = '#000000', emissiveIntensity = 0): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), emissive, emissiveIntensity })
}

/**
 * Contour d'encre : épaisseur dans le repère de l'objet. La coque est poussée depuis le
 * centre de l'objet (et non le long des normales des faces) : aux arêtes d'une boîte,
 * le contour reste continu, sans fente.
 */
export function outlineMaterial(thickness = 0.035, color: THREE.ColorRepresentation = '#170b2e'): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position) + normalize(position + vec3(1e-5)) * ${thickness.toFixed(4)};`)
  }
  material.customProgramCacheKey = () => `outline-${thickness}`
  return material
}

/** Texture dessinée sur un canevas (piste, ciel, étiquettes) ; `draw` reçoit le contexte 2D. */
export function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Palette néon-pastel : couvertures, bannières, wagons. */
export const PALETTE = ['#ff6fb5', '#7c5cff', '#3fd0ff', '#ffc46b', '#5ef2b0', '#ff8a5c', '#c58bff', '#ff5e7a'] as const
export const paletteColor = (variant: number) => PALETTE[Math.abs(variant) % PALETTE.length]!
