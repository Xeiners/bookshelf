import * as THREE from 'three'
import { outlineMaterial } from './toon'

const dummy = new THREE.Object3D()

/** Marque à envoyer les `length` premières valeurs d'un tampon d'instances (rien s'il est vide). */
export function uploadUsed(attribute: THREE.BufferAttribute, length: number): void {
  attribute.clearUpdateRanges()
  if (length <= 0) return
  attribute.addUpdateRange(0, length)
  attribute.needsUpdate = true
}

/**
 * Un lot d'instances : un seul appel de dessin pour tous les objets d'un même type (et un
 * de plus pour leur contour). Chaque image, on le remplit (`begin`, `push`…, `end`) : rien
 * n'est alloué, les objets hors champ ne sont tout simplement pas poussés.
 */
export class Batch {
  readonly mesh: THREE.InstancedMesh
  readonly outline: THREE.InstancedMesh | null
  readonly group = new THREE.Group()
  private count = 0
  private readonly color = new THREE.Color()
  readonly max: number

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], max: number, outline = 0) {
    this.max = max
    this.mesh = new THREE.InstancedMesh(geometry, material, max)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Couleur par instance : l'attribut existe dès la première compilation du matériau.
    for (let index = 0; index < max; index += 1) this.mesh.setColorAt(index, this.color.set('#ffffff'))
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.group.add(this.mesh)
    if (outline > 0) {
      this.outline = new THREE.InstancedMesh(geometry, outlineMaterial(outline), max)
      // Même tampon de matrices : le contour suit son objet sans recopie.
      this.outline.instanceMatrix = this.mesh.instanceMatrix
      this.outline.frustumCulled = false
      this.outline.count = 0
      this.group.add(this.outline)
    } else {
      this.outline = null
    }
  }

  begin(): void {
    this.count = 0
  }

  /** Nombre d'instances posées depuis `begin` (l'indice de la prochaine). */
  get size(): number {
    return this.count
  }

  push(x: number, y: number, z: number, sx: number, sy: number, sz: number, color?: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0): void {
    if (this.count >= this.max) return
    dummy.position.set(x, y, z)
    dummy.rotation.set(rx, ry, rz)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    this.mesh.setMatrixAt(this.count, dummy.matrix)
    if (color !== undefined) this.mesh.setColorAt(this.count, this.color.set(color))
    this.count += 1
  }

  end(): void {
    this.mesh.count = this.count
    // Seules les instances posées partent vers la carte graphique (pas tout le tampon).
    uploadUsed(this.mesh.instanceMatrix, this.count * 16)
    if (this.mesh.instanceColor) uploadUsed(this.mesh.instanceColor, this.count * 3)
    if (this.outline) this.outline.count = this.count
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    for (const material of [this.mesh.material, this.outline?.material].flat()) material?.dispose()
    this.mesh.dispose()
    this.outline?.dispose()
  }
}
