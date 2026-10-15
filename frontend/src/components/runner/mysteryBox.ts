import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { outlineMaterial, toonRamp } from './toon'

/*
 * La boîte mystère, en 3D : un coffret laqué violet nuit, cerclé d'or, scellé d'un ruban,
 * posé sur un autel de lumière. Elle tombe du ciel, rebondit ; à chaque tape elle tremble et
 * se fend, des fissures de lumière s'ouvrent — leur couleur monte vers la rareté de la pièce
 * (bleu, puis violet, puis or). Au dernier coup : le couvercle s'envole, éclair, onde de choc,
 * gerbe d'étincelles et colonne de lumière, d'où surgit le coureur paré de sa nouvelle pièce.
 *
 * Tout est piloté par `update` (aucune allocation pendant l'animation).
 */

const SPARKS = 160
const MOTES = 70

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Rayon : un fuseau de lumière qui s'efface vers le bout. */
function rayTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const along = context.createLinearGradient(0, 256, 0, 0)
  along.addColorStop(0, 'rgba(255,255,255,0.9)')
  along.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = along
  context.beginPath()
  context.moveTo(32, 256)
  context.lineTo(0, 0)
  context.lineTo(64, 0)
  context.closePath()
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Fissures : des éclairs qui partent du centre de chaque face. */
function crackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')!
  context.strokeStyle = '#ffffff'
  context.lineCap = 'round'
  context.shadowColor = '#ffffff'
  context.shadowBlur = 10
  let seed = 11
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let branch = 0; branch < 7; branch += 1) {
    let x = 128
    let y = 128
    let angle = (branch / 7) * Math.PI * 2 + random() * 0.5
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(x, y)
    for (let step = 0; step < 7; step += 1) {
      angle += (random() - 0.5) * 1.1
      x += Math.cos(angle) * (14 + random() * 12)
      y += Math.sin(angle) * (14 + random() * 12)
      context.lineTo(x, y)
      context.lineWidth = Math.max(1.5, 5 - step * 0.6)
    }
    context.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Sceau de la face avant : « ? » doré dans un médaillon, caractère 漫 au-dessus. */
function sealTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffd35c'
  context.beginPath()
  context.arc(128, 128, 96, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#2a1150'
  context.beginPath()
  context.arc(128, 128, 84, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = '#ffd35c'
  context.lineWidth = 3
  context.beginPath()
  context.arc(128, 128, 74, 0, Math.PI * 2)
  context.stroke()
  context.fillStyle = '#ffe9a8'
  context.font = '900 120px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = '#ffb300'
  context.shadowBlur = 18
  context.fillText('?', 128, 136)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const toon = (color: THREE.ColorRepresentation, emissive: THREE.ColorRepresentation = '#000000', glow = 0) =>
  new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), emissive, emissiveIntensity: glow })

const additive = (map: THREE.Texture | null, color: THREE.ColorRepresentation = '#ffffff') =>
  new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, opacity: 0 })

export interface BoxFrame {
  /** Secondes depuis l'apparition de la boîte. */
  age: number
  /** Coups reçus (0 à 3). */
  stage: number
  /** Secondes depuis le dernier coup. */
  sinceTap: number
  /** Couleur des fissures (montée vers la rareté). */
  color: THREE.Color
  /** Secondes depuis l'explosion (`null` : pas encore). */
  burst: number | null
  /** Rareté finale (0 commune … 3 légendaire) : force de l'explosion. */
  rarity: number
}

/** Le temps de la boîte : chute, coups, explosion (partagé entre l'interface et la scène). */
export class BoxTimeline {
  readonly frame: BoxFrame = { age: 0, stage: 0, sinceTap: 99, color: new THREE.Color('#9fd8ff'), burst: null, rarity: 0 }

  /** Posée sur l'autel (prête à recevoir des coups) après `land` secondes. */
  landed(land: number): boolean {
    return this.frame.age >= land
  }

  idle(seconds: number): boolean {
    return this.frame.sinceTap > seconds
  }

  knock(stage: number, color: string, rarity: number): void {
    this.frame.stage = stage
    this.frame.sinceTap = 0
    this.frame.rarity = rarity
    this.frame.color.set(color)
  }

  explode(): void {
    this.frame.burst = 0
  }

  tick(delta: number): void {
    this.frame.age += delta
    this.frame.sinceTap += delta
    if (this.frame.burst !== null) this.frame.burst += delta
  }
}

export class MysteryBoxScene {
  readonly object = new THREE.Group()
  private readonly box = new THREE.Group()
  private readonly body: THREE.Group
  private readonly lid = new THREE.Group()
  private readonly cracks: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly seam: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  private readonly rays = new THREE.Group()
  private readonly rayMaterial: THREE.MeshBasicMaterial
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>
  private readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly flash: THREE.Sprite
  private readonly wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly sparkVelocity = new Float32Array(SPARKS * 3)
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly moteSeed = new Float32Array(MOTES * 3)
  private exploded = false
  private readonly lidSpin = new THREE.Vector3()

  constructor() {
    const glow = glowTexture()
    // Autel : un disque sombre et son anneau de lumière.
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.24, 48), toon('#1a0d33', '#3a1f73', 0.25))
    altar.position.y = -0.12
    altar.add(new THREE.Mesh(altar.geometry, outlineMaterial(0.02)))
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.03, 8, 64), additive(null))
    this.ring.rotation.x = Math.PI / 2
    this.ring.position.y = 0.005
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), additive(glow))
    this.halo.rotation.x = -Math.PI / 2
    this.halo.position.y = 0.01
    this.object.add(altar, this.ring, this.halo)

    // Rayons derrière la boîte.
    this.rayMaterial = additive(rayTexture())
    const rayGeometry = new THREE.PlaneGeometry(0.55, 5.5)
    rayGeometry.translate(0, 2.75, 0)
    for (let ray = 0; ray < 14; ray += 1) {
      const mesh = new THREE.Mesh(rayGeometry, this.rayMaterial)
      mesh.rotation.z = (ray / 14) * Math.PI * 2
      mesh.scale.set(0.6 + (ray % 3) * 0.35, 0.8 + (ray % 4) * 0.15, 1)
      this.rays.add(mesh)
    }
    this.rays.position.set(0, 0.8, -1.2)
    this.object.add(this.rays)

    // La boîte : corps laqué, liserés d'or, ruban, sceau ; couvercle à part.
    const lacquer = toon('#3a1670', '#5a24a8', 0.18)
    const gold = toon('#ffc93c', '#ffb000', 0.35)
    const bodyGeometry = new RoundedBoxGeometry(1, 0.86, 1, 4, 0.07)
    const bodyMesh = new THREE.Mesh(bodyGeometry, lacquer)
    bodyMesh.add(new THREE.Mesh(bodyGeometry, outlineMaterial(0.025)))
    bodyMesh.position.y = 0.43
    this.body = new THREE.Group()
    this.body.add(bodyMesh)
    for (const x of [-0.505, 0.505]) {
      for (const z of [-0.505, 0.505]) {
        const post = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.9, 0.08, 2, 0.03), gold)
        post.position.set(x * 0.98, 0.43, z * 0.98)
        this.body.add(post)
      }
    }
    for (const side of [0, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(side ? 1.03 : 0.16, 0.88, side ? 0.16 : 1.03), gold)
      band.position.y = 0.43
      this.body.add(band)
    }
    const sealMaterial = new THREE.MeshBasicMaterial({ map: sealTexture(), transparent: true, toneMapped: false })
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), sealMaterial)
      seal.position.set(Math.sin(angle) * 0.52, 0.43, Math.cos(angle) * 0.52)
      seal.rotation.y = angle
      this.body.add(seal)
    }
    const crackMap = crackTexture()
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.86), additive(crackMap))
      crack.position.set(Math.sin(angle) * 0.525, 0.43, Math.cos(angle) * 0.525)
      crack.rotation.y = angle
      this.cracks.push(crack)
      this.body.add(crack)
    }
    // Lumière qui filtre sous le couvercle.
    this.seam = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.04, 1.04), additive(null))
    this.seam.position.y = 0.875
    this.body.add(this.seam)
    this.box.add(this.body)

    const lidGeometry = new RoundedBoxGeometry(1.1, 0.2, 1.1, 4, 0.06)
    const lidMesh = new THREE.Mesh(lidGeometry, lacquer)
    lidMesh.add(new THREE.Mesh(lidGeometry, outlineMaterial(0.025)))
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.07, 1.12), gold)
    lidBand.position.y = -0.04
    // Nœud du ruban : deux boucles et un cœur.
    const bow = new THREE.Group()
    for (const side of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 10, 24), gold)
      loop.position.set(side * 0.14, 0.15, 0)
      loop.rotation.set(0, 0, side * 0.4)
      loop.scale.set(1, 0.7, 0.6)
      bow.add(loop)
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), gold)
    knot.position.y = 0.13
    bow.add(knot)
    this.lid.add(lidMesh, lidBand, bow)
    this.lid.position.y = 0.96
    this.box.add(this.lid)
    this.object.add(this.box)

    // Éclair, onde de choc, colonne de lumière.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }))
    this.flash.position.y = 0.6
    this.flash.renderOrder = 20
    this.wave = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), additive(null))
    this.wave.rotation.x = -Math.PI / 2
    this.wave.position.y = 0.05
    const beamGeometry = new THREE.CylinderGeometry(0.75, 0.95, 9, 32, 1, true)
    beamGeometry.translate(0, 4.5, 0)
    const fade = new Float32Array(beamGeometry.attributes.position!.count * 3)
    for (let index = 0; index < beamGeometry.attributes.position!.count; index += 1) {
      const level = 1 - beamGeometry.attributes.position!.getY(index) / 9
      fade.set([level, level, level], index * 3)
    }
    beamGeometry.setAttribute('color', new THREE.BufferAttribute(fade, 3))
    this.beam = new THREE.Mesh(beamGeometry, additive(null))
    this.beam.material.vertexColors = true
    this.object.add(this.flash, this.wave, this.beam)

    // Étincelles de l'explosion, et poussière lumineuse qui monte autour de l'autel.
    const sparkGeometry = new THREE.BufferGeometry()
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
    this.sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ map: glow, size: 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }))
    this.sparks.frustumCulled = false
    const moteGeometry = new THREE.BufferGeometry()
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3))
    for (let index = 0; index < MOTES; index += 1) this.moteSeed.set([Math.random() * Math.PI * 2, Math.random(), 0.6 + Math.random() * 1.2], index * 3)
    this.motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({ map: glow, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.8 }))
    this.motes.frustumCulled = false
    this.object.add(this.sparks, this.motes)
  }

  private explode(rarity: number): void {
    this.exploded = true
    const positions = this.sparks.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < SPARKS; index += 1) {
      positions.setXYZ(index, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6)
      const angle = Math.random() * Math.PI * 2
      const speed = (2 + Math.random() * 4) * (1 + rarity * 0.25)
      this.sparkVelocity.set([Math.cos(angle) * speed, 2 + Math.random() * 6, Math.sin(angle) * speed * 0.6 + 1.2], index * 3)
    }
    this.lidSpin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 9)
  }

  update(frame: BoxFrame, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const color = frame.color
    // Chute du ciel et rebonds (0,7 s), puis respiration.
    const fall = Math.min(1, frame.age / 0.7)
    const bounce = fall < 1 ? (1 - fall) ** 2 * 6 - Math.abs(Math.sin(fall * Math.PI * 2.5)) * (1 - fall) * 0.5 : 0
    const breathe = 1 + Math.sin(time * 3) * 0.015
    // Tremblement à chaque coup, de plus en plus fort ; vibration continue au dernier stade.
    const kick = Math.max(0, 1 - frame.sinceTap / 0.35)
    const tremor = kick * (0.05 + frame.stage * 0.03) + (frame.stage >= 2 ? 0.008 * frame.stage : 0)
    if (frame.burst === null) {
      this.box.visible = true
      this.box.position.set((Math.random() - 0.5) * tremor, Math.max(0, bounce), (Math.random() - 0.5) * tremor)
      this.box.rotation.set((Math.random() - 0.5) * tremor * 2, Math.sin(time * 0.6) * 0.35 + (Math.random() - 0.5) * tremor * 3, (Math.random() - 0.5) * tremor * 2)
      this.box.scale.set(breathe + kick * 0.06, breathe - kick * 0.08, breathe + kick * 0.06)
      this.body.scale.setScalar(1)
      this.lid.position.set(0, 0.96 + kick * 0.05 * frame.stage, 0)
      this.lid.rotation.set(0, 0, 0)
    } else {
      if (!this.exploded) this.explode(frame.rarity)
      // Le couvercle s'envole en tournoyant, le coffret se volatilise.
      const t = frame.burst
      this.lid.position.set(t * 0.8, 0.96 + t * 6 - t * t * 2, t * 1.4)
      this.lid.rotation.set(this.lidSpin.x * t, this.lidSpin.y * t, this.lidSpin.z * t)
      const vanish = Math.max(0, 1 - t / 0.25)
      this.body.scale.set(1 + (1 - vanish) * 0.4, vanish, 1 + (1 - vanish) * 0.4)
      this.box.visible = t < 1.4
    }

    // Fissures et lueur du joint : montent avec les coups, couleur de la rareté pressentie.
    const charge = frame.burst === null ? Math.min(1, frame.stage / 3) : 0
    for (const crack of this.cracks) {
      crack.material.color.copy(color)
      crack.material.opacity = frame.stage === 0 ? 0 : (0.35 + charge * 0.65) * (0.8 + Math.sin(time * 18) * 0.2)
      crack.scale.setScalar(0.35 + charge * 0.75)
    }
    this.seam.material.color.copy(color)
    this.seam.material.opacity = frame.burst === null ? 0.15 + charge * 0.85 : 0

    // Rayons, anneau, halo.
    // Après l'explosion, la lumière retombe : le coureur doit se voir.
    const settle = frame.burst === null ? 1 : Math.max(0.3, 1 - frame.burst * 0.6)
    const power = frame.burst === null ? 0.25 + charge * 0.75 : settle
    this.rays.rotation.z = time * (0.25 + charge * 0.9)
    this.rayMaterial.color.copy(color)
    this.rayMaterial.opacity = Math.min(0.5, power * 0.45 * fall) * (frame.burst === null ? 1 : 0.55)
    this.rays.scale.setScalar(0.8 + power * 0.4)
    this.ring.material.color.copy(color)
    this.ring.material.opacity = 0.5 + power * 0.5
    this.halo.material.color.copy(color)
    this.halo.material.opacity = (0.3 + power * 0.4) * settle

    // Explosion : éclair, onde, colonne, étincelles.
    const t = frame.burst ?? -1
    this.flash.material.color.copy(color).lerp(new THREE.Color('#ffffff'), 0.5)
    this.flash.material.opacity = t >= 0 ? Math.max(0, 1 - t / 0.5) : 0
    this.flash.scale.setScalar(t >= 0 ? 2 + t * 14 : 0.001)
    this.wave.material.color.copy(color)
    this.wave.material.opacity = t >= 0 ? Math.max(0, 1 - t / 0.8) : 0
    this.wave.scale.setScalar(t >= 0 ? 0.5 + (1 - Math.max(0, 1 - t / 0.8) ** 3) * 6 : 0.001)
    this.beam.material.color.copy(color)
    // Colonne : jaillit, puis s'efface en voile léger derrière le coureur.
    const beam = t < 0 ? 0 : t < 0.5 ? Math.min(0.5, t * 2) : Math.max(0.08, 0.5 - (t - 0.5) * 0.45)
    this.beam.material.opacity = beam * (0.85 + Math.sin(time * 10) * 0.15)
    this.beam.scale.set(t >= 0 ? 1 + Math.max(0, 0.6 - t) : 1, t >= 0 ? Math.min(1, t * 3) : 0.001, t >= 0 ? 1 + Math.max(0, 0.6 - t) : 1)
    if (t >= 0) {
      const positions = this.sparks.geometry.attributes.position as THREE.BufferAttribute
      for (let index = 0; index < SPARKS; index += 1) {
        const velocity = index * 3
        this.sparkVelocity[velocity + 1] = this.sparkVelocity[velocity + 1]! - 9 * dt
        positions.setXYZ(
          index,
          positions.getX(index) + this.sparkVelocity[velocity]! * dt,
          Math.max(0.02, positions.getY(index) + this.sparkVelocity[velocity + 1]! * dt),
          positions.getZ(index) + this.sparkVelocity[velocity + 2]! * dt,
        )
      }
      positions.needsUpdate = true
      this.sparks.material.color.copy(color).lerp(new THREE.Color('#ffffff'), 0.3)
      this.sparks.material.opacity = Math.max(0, 1 - t / 1.6)
    }

    // Poussière lumineuse qui spirale vers le haut (plus dense et plus vive en fin de charge).
    const motes = this.motes.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < MOTES; index += 1) {
      const seed = index * 3
      const life = (this.moteSeed[seed + 1]! + time * (0.15 + charge * 0.35)) % 1
      const angle = this.moteSeed[seed]! + time * (0.6 + charge)
      const radius = this.moteSeed[seed + 2]! * (1 - life * 0.4)
      motes.setXYZ(index, Math.cos(angle) * radius, life * 3, Math.sin(angle) * radius)
    }
    motes.needsUpdate = true
    this.motes.material.color.copy(color)
    this.motes.material.opacity = 0.35 + power * 0.6
  }

  dispose(): void {
    const seen = new Set<THREE.Material | THREE.BufferGeometry>()
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Points || node instanceof THREE.Sprite) {
        if (!(node instanceof THREE.Sprite) && !seen.has(node.geometry)) {
          seen.add(node.geometry)
          node.geometry.dispose()
        }
        for (const material of [node.material].flat() as (THREE.Material & { map?: THREE.Texture | null })[]) {
          if (seen.has(material)) continue
          seen.add(material)
          material.map?.dispose()
          material.dispose()
        }
      }
    })
  }
}
