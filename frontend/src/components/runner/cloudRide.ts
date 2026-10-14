import * as THREE from 'three'
import { uploadUsed } from './batch'

/*
 * Le nuage magique : un nuage doré à la Kinto-un, fait de volutes qui respirent, blanc
 * dessus et doré dessous, posé sur un halo. Il se forme dans une bouffée quand on le
 * ramasse, laisse une traînée de petits nuages et d'étincelles, s'incline dans les virages,
 * et se dissipe à la fin. Des lignes de vent filent autour du coureur pendant le vol.
 *
 * Trois appels de dessin (volutes et traînée en instances, lignes de vent), aucun objet
 * créé pendant la course.
 */

const PUFFS = 22
const TRAIL = 40
const STREAKS = 26
const SPARKS = 36

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  span: number
  size: number
}

/** Sphère lisse, blanche sur le dessus, dorée en dessous (couleurs par sommet). */
function puffGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 3)
  const normal = geometry.attributes.normal!
  const colors = new Float32Array(normal.count * 3)
  const top = new THREE.Color('#fffaf0')
  const bottom = new THREE.Color('#ffc55a')
  const color = new THREE.Color()
  for (let index = 0; index < normal.count; index += 1) {
    color.copy(bottom).lerp(top, THREE.MathUtils.smoothstep(normal.getY(index), -0.6, 0.55))
    colors.set([color.r, color.g, color.b], index * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

const dummy = new THREE.Object3D()
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2

export class CloudRide {
  /** Dans le monde (pas dans le corps du coureur) : la traînée reste derrière lui. */
  readonly object = new THREE.Group()
  private readonly cloud = new THREE.Group()
  private readonly puffs: THREE.InstancedMesh
  private readonly layout: { x: number; y: number; z: number; size: number; phase: number }[] = []
  private readonly trail: THREE.InstancedMesh
  private readonly particles: Particle[] = []
  private readonly streaks: THREE.InstancedMesh
  private readonly streakState: { x: number; y: number; z: number; length: number }[] = []
  private readonly sparks: THREE.Points
  private readonly sparkPositions = new Float32Array(SPARKS * 3)
  private readonly glow: THREE.Mesh
  private readonly streakMaterial: THREE.MeshBasicMaterial
  private presence = 0
  private flying = false
  private spawn = 0

  constructor() {
    const geometry = puffGeometry()
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffd27a', emissiveIntensity: 0.32 })
    this.puffs = new THREE.InstancedMesh(geometry, material, PUFFS)
    this.puffs.frustumCulled = false
    // Volutes : un ovale allongé dans le sens de la course, plus épais au centre, une queue derrière.
    // Une seule masse : des volutes serrées qui se chevauchent, un dôme au centre, une queue.
    for (let index = 0; index < PUFFS; index += 1) {
      const angle = (index / PUFFS) * Math.PI * 2 * 2.618
      const ring = Math.sqrt((index + 0.5) / PUFFS)
      const tail = index >= PUFFS - 4 ? (index - (PUFFS - 4) + 1) * 0.28 : 0
      this.layout.push({
        x: Math.cos(angle) * 0.62 * ring * (tail ? 0.4 : 1),
        y: 0.16 * (1 - ring) + Math.sin(index * 2.1) * 0.03 - tail * 0.12,
        z: Math.sin(angle) * 0.42 * ring + tail,
        size: (0.42 - ring * 0.12 - tail * 0.18) * (1 + Math.sin(index * 1.7) * 0.08),
        phase: index * 1.3,
      })
    }
    this.cloud.add(this.puffs)
    const glowTexture = new THREE.CanvasTexture(
      (() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        const context = canvas.getContext('2d')!
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
        gradient.addColorStop(0, 'rgba(255,214,120,0.9)')
        gradient.addColorStop(1, 'rgba(255,214,120,0)')
        context.fillStyle = gradient
        context.fillRect(0, 0, 64, 64)
        return canvas
      })(),
    )
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    this.glow.rotation.x = -Math.PI / 2
    this.glow.position.y = -0.35
    this.cloud.add(this.glow)
    this.object.add(this.cloud)

    this.trail = new THREE.InstancedMesh(geometry, material, TRAIL)
    this.trail.frustumCulled = false
    this.trail.count = 0
    this.object.add(this.trail)

    this.streakMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.025, 1), this.streakMaterial, STREAKS)
    this.streaks.frustumCulled = false
    for (let index = 0; index < STREAKS; index += 1) this.streakState.push(this.newStreak(-Math.random() * 60))
    this.object.add(this.streaks)

    const sparkGeometry = new THREE.BufferGeometry()
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3).setUsage(THREE.DynamicDrawUsage))
    this.sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({ color: '#ffe08a', size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    this.sparks.frustumCulled = false
    this.object.add(this.sparks)
    this.object.visible = false
  }

  private newStreak(z: number): { x: number; y: number; z: number; length: number } {
    const angle = Math.random() * Math.PI * 2
    const radius = 2.4 + Math.random() * 4
    return { x: Math.cos(angle) * radius, y: 3 + Math.sin(angle) * radius * 0.7, z, length: 1.5 + Math.random() * 3 }
  }

  /** Une bouffée de petits nuages, en couronne, à l'apparition et à la disparition. */
  private burst(x: number, y: number): void {
    for (let index = 0; index < 14; index += 1) {
      const angle = (index / 14) * Math.PI * 2
      this.emit({ x, y, z: 0, vx: Math.cos(angle) * 2.6, vy: 0.5 + Math.random() * 0.7, vz: Math.sin(angle) * 1.6 - 6, life: 0, span: 0.5, size: 0.24 })
    }
  }

  private emit(particle: Particle): void {
    if (this.particles.length >= TRAIL) this.particles.shift()
    this.particles.push(particle)
  }

  /**
   * `x`, `y` : pieds du coureur ; `roll` : son inclinaison (virages) ; `speed` : vitesse de
   * la course (la traînée et le vent filent vers la caméra).
   */
  update(flying: boolean, x: number, y: number, roll: number, speed: number, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    if (flying !== this.flying) {
      this.burst(x, y - 0.1)
      this.flying = flying
    }
    this.presence = THREE.MathUtils.clamp(this.presence + (flying ? dt * 3.2 : -dt * 4), 0, 1)
    this.object.visible = this.presence > 0.001 || this.particles.length > 0

    // Le nuage : il gonfle en apparaissant, flotte, s'incline dans les virages.
    const grow = this.presence > 0 ? easeOutBack(this.presence) : 0
    this.cloud.visible = grow > 0.01
    this.cloud.position.set(x, y - 0.12 + Math.sin(time * 2.4) * 0.06, 0.1)
    this.cloud.rotation.set(Math.sin(time * 1.7) * 0.05, 0, roll * 1.3)
    this.cloud.scale.setScalar(Math.max(0.001, grow))
    this.layout.forEach((puff, index) => {
      const breathe = 1 + Math.sin(time * 3 + puff.phase) * 0.08
      dummy.position.set(puff.x, puff.y + Math.sin(time * 2 + puff.phase) * 0.03, puff.z)
      dummy.scale.set(puff.size * breathe * 1.15, puff.size * breathe * 0.8, puff.size * breathe)
      dummy.updateMatrix()
      this.puffs.setMatrixAt(index, dummy.matrix)
    })
    uploadUsed(this.puffs.instanceMatrix, PUFFS * 16)
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 4) * 0.12

    // Traînée : de petits nuages lâchés à l'arrière, qui restent dans le monde et fondent.
    if (flying && this.presence > 0.5) {
      this.spawn -= dt
      while (this.spawn <= 0) {
        this.spawn += 0.045
        // Lâchées à l'arrière, elles freinent un peu moins que le paysage : la traînée reste près du nuage.
        this.emit({
          x: x + (Math.random() - 0.5) * 0.9,
          y: y - 0.2 + (Math.random() - 0.5) * 0.25,
          z: 0.7,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.3) * 0.3,
          vz: -speed * 0.75,
          life: 0,
          span: 0.45 + Math.random() * 0.25,
          size: 0.12 + Math.random() * 0.1,
        })
      }
    }
    let count = 0
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]!
      particle.life += dt
      if (particle.life >= particle.span) {
        this.particles.splice(index, 1)
        continue
      }
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.z += (particle.vz + speed) * dt
      // Jamais jusqu'à la caméra (elle grossirait tout l'écran).
      if (particle.z > 3.2) {
        this.particles.splice(index, 1)
        continue
      }
      const fade = 1 - particle.life / particle.span
      dummy.position.set(particle.x, particle.y, particle.z)
      dummy.scale.setScalar(particle.size * Math.sin(Math.min(1, fade * 1.6) * Math.PI * 0.5))
      dummy.updateMatrix()
      this.trail.setMatrixAt(count, dummy.matrix)
      count += 1
    }
    this.trail.count = count
    uploadUsed(this.trail.instanceMatrix, count * 16)

    // Lignes de vent : elles filent vers la caméra, plus vite que le paysage.
    this.streakMaterial.opacity = 0.35 * this.presence
    this.streaks.visible = this.presence > 0.01
    if (this.streaks.visible) {
      this.streakState.forEach((streak, index) => {
        streak.z += speed * 1.6 * dt
        if (streak.z > 10) Object.assign(streak, this.newStreak(-50 - Math.random() * 20))
        dummy.position.set(streak.x + x * 0.5, streak.y + y * 0.4, streak.z)
        dummy.scale.set(1, 1, streak.length)
        dummy.updateMatrix()
        this.streaks.setMatrixAt(index, dummy.matrix)
      })
      uploadUsed(this.streaks.instanceMatrix, STREAKS * 16)
    }

    // Étincelles dorées qui tournent autour du nuage.
    this.sparks.visible = this.presence > 0.01
    if (this.sparks.visible) {
      for (let index = 0; index < SPARKS; index += 1) {
        const angle = time * (1.2 + (index % 4) * 0.35) + index * 2.4
        const radius = (0.9 + (index % 5) * 0.18) * grow
        this.sparkPositions[index * 3] = x + Math.cos(angle) * radius
        this.sparkPositions[index * 3 + 1] = y - 0.1 + Math.sin(time * 3 + index) * 0.3
        this.sparkPositions[index * 3 + 2] = Math.sin(angle) * radius * 0.8 + ((index * 0.37 + time * 1.5) % 1.5)
      }
      this.sparks.geometry.attributes.position!.needsUpdate = true
      ;(this.sparks.material as THREE.PointsMaterial).opacity = this.presence * (0.6 + Math.sin(time * 9) * 0.3)
    }
  }

  dispose(): void {
    const materials = new Set<THREE.Material>()
    const geometries = new Set<THREE.BufferGeometry>()
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Points) {
        geometries.add(node.geometry)
        for (const material of [node.material].flat()) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      ;(material as THREE.MeshBasicMaterial).map?.dispose()
      material.dispose()
    }
  }
}
