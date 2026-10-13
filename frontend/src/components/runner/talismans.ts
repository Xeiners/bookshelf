import * as THREE from 'three'
import { canvasTexture } from './toon'

/*
 * La protection gagnée au quiz : des talismans de papier (ofuda) marqués « 護 » (protéger)
 * tournoient autour du coureur, au-dessus d'un cercle sacré doré qui tourne au sol, dans
 * un léger halo de lumière. Ils se déploient d'un coup, flottent, et clignotent quand la
 * protection touche à sa fin.
 */

const COUNT = 6
const RADIUS = 0.82

function ofudaTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 160, (context) => {
    context.fillStyle = '#fbf3df'
    context.fillRect(0, 0, 64, 160)
    // Double liseré vermillon, sceau en haut, caractère au centre, traits d'encre dessous.
    context.strokeStyle = '#c8261b'
    context.lineWidth = 4
    context.strokeRect(5, 5, 54, 150)
    context.lineWidth = 1.5
    context.strokeRect(11, 11, 42, 138)
    context.fillStyle = '#c8261b'
    context.beginPath()
    context.arc(32, 30, 9, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#1c1414'
    context.font = 'bold 36px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('護', 32, 78) // i18n-ignore (caractère du talisman)
    context.fillRect(30, 102, 4, 34)
    context.fillRect(22, 112, 20, 3)
    context.fillRect(24, 124, 16, 3)
  })
}

function sigilTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    const center = 128
    context.strokeStyle = '#ffd36b'
    context.fillStyle = '#ffd36b'
    context.lineWidth = 5
    context.beginPath()
    context.arc(center, center, 120, 0, Math.PI * 2)
    context.stroke()
    context.lineWidth = 2.5
    context.beginPath()
    context.arc(center, center, 104, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.arc(center, center, 56, 0, Math.PI * 2)
    context.stroke()
    // Étoile à cinq branches (seiman), tracée d'un seul trait.
    context.lineWidth = 3
    context.beginPath()
    for (let point = 0; point <= 5; point += 1) {
      const angle = -Math.PI / 2 + (point * 4 * Math.PI) / 5
      const x = center + Math.cos(angle) * 96
      const y = center + Math.sin(angle) * 96
      if (point === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.stroke()
    // Petites marques entre les deux cercles extérieurs.
    for (let mark = 0; mark < 24; mark += 1) {
      const angle = (mark / 24) * Math.PI * 2
      context.save()
      context.translate(center + Math.cos(angle) * 112, center + Math.sin(angle) * 112)
      context.rotate(angle)
      context.fillRect(-1.5, -5, 3, 10)
      context.restore()
    }
  })
}

export class TalismanAura {
  readonly object = new THREE.Group()
  private readonly ring = new THREE.Group()
  private readonly papers: THREE.Mesh[] = []
  private readonly sigil: THREE.Mesh
  private readonly halo: THREE.Mesh
  private readonly paperMaterial: THREE.MeshBasicMaterial
  private readonly glowMaterials: THREE.MeshBasicMaterial[]
  private grow = 0

  constructor() {
    this.paperMaterial = new THREE.MeshBasicMaterial({ map: ofudaTexture(), side: THREE.DoubleSide, transparent: true, fog: false })
    const paper = new THREE.PlaneGeometry(0.2, 0.5)
    for (let index = 0; index < COUNT; index += 1) {
      const mesh = new THREE.Mesh(paper, this.paperMaterial)
      this.papers.push(mesh)
      this.ring.add(mesh)
    }
    this.object.add(this.ring)
    const sigilMaterial = new THREE.MeshBasicMaterial({ map: sigilTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), sigilMaterial)
    this.sigil.rotation.x = -Math.PI / 2
    this.sigil.position.y = 0.04
    this.object.add(this.sigil)
    // Halo : un cylindre ouvert, lumineux au pied, qui s'efface vers le haut.
    const haloGeometry = new THREE.CylinderGeometry(0.75, 1.0, 1.8, 32, 1, true)
    const fade = new Float32Array(haloGeometry.attributes.position!.count * 3)
    for (let index = 0; index < haloGeometry.attributes.position!.count; index += 1) {
      const level = haloGeometry.attributes.position!.getY(index) < 0 ? 1 : 0
      fade.set([level, level * 0.85, level * 0.45], index * 3)
    }
    haloGeometry.setAttribute('color', new THREE.BufferAttribute(fade, 3))
    const haloMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    this.halo = new THREE.Mesh(haloGeometry, haloMaterial)
    this.halo.position.y = 0.9
    this.object.add(this.halo)
    this.glowMaterials = [sigilMaterial, haloMaterial]
    this.object.visible = false
  }

  /** `left` : secondes de protection restantes (0 : aucune). */
  update(left: number, time: number, delta: number): void {
    const active = left > 0
    this.grow = Math.max(0, Math.min(1, this.grow + (active ? delta * 4 : -delta * 5)))
    this.object.visible = this.grow > 0.001
    if (!this.object.visible) return
    // Déploiement en douceur (léger dépassement), clignotement à la fin.
    const pop = 1 - (1 - this.grow) ** 3 + Math.sin(this.grow * Math.PI) * 0.12
    const blink = active && left < 1.5 ? 0.45 + 0.55 * (Math.sin(time * 18) > 0 ? 1 : 0) : 1
    this.ring.rotation.y = time * 2.2
    this.papers.forEach((paper, index) => {
      const angle = (index / COUNT) * Math.PI * 2
      const radius = RADIUS * pop
      paper.position.set(Math.cos(angle) * radius, 1.0 + Math.sin(time * 3 + index * 1.7) * 0.14, Math.sin(angle) * radius)
      // Face tournée vers l'extérieur, le papier ondule un peu.
      paper.rotation.set(Math.sin(time * 5 + index) * 0.15, -angle + Math.PI / 2, Math.sin(time * 4 + index * 2) * 0.12)
    })
    this.paperMaterial.opacity = blink * Math.min(1, this.grow * 1.5)
    this.sigil.rotation.z = -time * 0.8
    this.sigil.scale.setScalar(pop * (1 + Math.sin(time * 4) * 0.03))
    this.glowMaterials[0]!.opacity = 0.85 * blink * this.grow
    this.glowMaterials[1]!.opacity = (0.12 + Math.sin(time * 5) * 0.03) * blink * this.grow
    this.halo.scale.set(pop, 1, pop)
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        const material = node.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
    })
  }
}
