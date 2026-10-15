import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { ITEM_INFO, WARDROBE_ITEMS, type WardrobeItemId } from '../../lib/runner/wardrobe'
import { GARMENT_FRAMES, buildPieces, drawGarment } from './outfit'

/*
 * Les vignettes de la garde-robe : chapeaux, chaussures et accessoires sont de vrais rendus
 * 3D des pièces (un rendu hors écran, une fois, puis la carte graphique est rendue) ; hauts
 * et bas sont leur patron — les couleurs et motifs exacts peints sur le modèle — découpé
 * dans une silhouette de vêtement.
 */

const SIZE = 192
const icons = new Map<WardrobeItemId, string>()
let pending: Promise<void> | null = null

/** Silhouette d'une tunique (devant) ou d'un pantalon, dans un carré de `SIZE`. */
function silhouette(context: CanvasRenderingContext2D, kind: 'top' | 'bottom'): void {
  context.beginPath()
  if (kind === 'top') {
    context.moveTo(62, 22)
    context.lineTo(84, 30)
    context.lineTo(96, 48)
    context.lineTo(108, 30)
    context.lineTo(130, 22)
    context.lineTo(168, 50)
    context.lineTo(152, 80)
    context.lineTo(138, 70)
    context.lineTo(142, 172)
    context.lineTo(50, 172)
    context.lineTo(54, 70)
    context.lineTo(40, 80)
    context.lineTo(24, 50)
  } else {
    context.moveTo(52, 20)
    context.lineTo(140, 20)
    context.lineTo(150, 176)
    context.lineTo(106, 176)
    context.lineTo(96, 76)
    context.lineTo(86, 176)
    context.lineTo(42, 176)
  }
  context.closePath()
}

function garmentIcon(id: WardrobeItemId): string {
  const kind = ITEM_INFO[id].slot === 'top' ? 'top' : 'bottom'
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const context = canvas.getContext('2d')!
  const [x0, y0, x1, y1] = GARMENT_FRAMES[kind]
  context.save()
  silhouette(context, kind)
  context.clip()
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, SIZE, SIZE)
  // Le patron de la texture, cadré sur la silhouette.
  context.translate(20, 14)
  context.scale(152 / (x1 - x0), 164 / (y1 - y0))
  context.translate(-x0, -y0)
  drawGarment(id, context)
  context.restore()
  // Volume : ombre douce sur les côtés, reflet, contour d'encre.
  context.save()
  silhouette(context, kind)
  context.clip()
  const light = context.createLinearGradient(0, 0, SIZE, 0)
  light.addColorStop(0, 'rgba(0,0,0,0.28)')
  light.addColorStop(0.35, 'rgba(255,255,255,0.12)')
  light.addColorStop(0.7, 'rgba(0,0,0,0)')
  light.addColorStop(1, 'rgba(0,0,0,0.3)')
  context.fillStyle = light
  context.fillRect(0, 0, SIZE, SIZE)
  context.restore()
  silhouette(context, kind)
  context.lineWidth = 5
  context.lineJoin = 'round'
  context.strokeStyle = '#170b2e'
  context.stroke()
  return canvas.toDataURL('image/png')
}

function renderPieces(renderer: THREE.WebGLRenderer, id: WardrobeItemId): string {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#fff6f0', '#8a6aa8', 1.6))
  const sun = new THREE.DirectionalLight('#ffffff', 2)
  sun.position.set(2, 4, 5)
  scene.add(sun)
  const group = new THREE.Group()
  let pieces = buildPieces(id)
  // Chaussures : une seule (la gauche, avec sa tige), vue de trois quarts.
  if (ITEM_INFO[id].slot === 'shoes') pieces = pieces.filter((piece) => piece.position.x > 0)
  group.add(...pieces)
  scene.add(group)
  const slot = ITEM_INFO[id].slot
  // Le sabre géant se porte dans le dos : on le montre de dos.
  if (id === 'acc-zangetsu') group.rotation.y = Math.PI
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getSize(new THREE.Vector3()).length() / 2
  const direction =
    id === 'acc-swords'
      ? new THREE.Vector3(1, 0.35, 0.2)
      : slot === 'shoes'
        ? new THREE.Vector3(1, 0.45, 0.8)
        : slot === 'hat' || id === 'acc-scarf'
          ? new THREE.Vector3(0.35, 0.55, 1)
          : new THREE.Vector3(0.45, 0.25, 1)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50)
  camera.position.copy(center).addScaledVector(direction.normalize(), (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.02)
  camera.lookAt(center)
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      for (const material of [node.material].flat()) {
        ;(material as THREE.MeshToonMaterial).map?.dispose()
        material.dispose()
      }
    }
  })
  return url
}

/** Prépare toutes les vignettes (une fois). */
export function loadItemIcons(): Promise<void> {
  pending ??= new Promise<void>((resolve) => {
    // Hors du fil critique : le premier affichage d'abord.
    window.setTimeout(() => {
      let renderer: THREE.WebGLRenderer | null = null
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        renderer.setPixelRatio(1)
        renderer.setSize(SIZE, SIZE)
        renderer.setClearColor(0x000000, 0)
      } catch {
        renderer = null
      }
      for (const id of WARDROBE_ITEMS) {
        const slot = ITEM_INFO[id].slot
        try {
          if (slot === 'top' || slot === 'bottom') icons.set(id, garmentIcon(id))
          else if (renderer) icons.set(id, renderPieces(renderer, id))
        } catch {
          // Une vignette manquante : la carte garde son pictogramme.
        }
      }
      renderer?.dispose()
      renderer?.forceContextLoss()
      resolve()
    }, 60)
  })
  return pending
}

/** Les vignettes prêtes (vide au premier rendu, puis complet). */
export function useItemIcons(): ReadonlyMap<WardrobeItemId, string> {
  const [ready, setReady] = useState(() => icons.size > 0)
  useEffect(() => {
    if (ready) return
    let alive = true
    void loadItemIcons().then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [ready])
  return icons
}

/** La vignette d'une pièce, si elle est prête. */
export const itemIcon = (id: WardrobeItemId): string | undefined => icons.get(id)
