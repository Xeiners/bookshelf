import * as THREE from 'three'
import type { RunState, TrackObject } from '../../lib/runner/engine'
import { objectX } from '../../lib/runner/engine'
import { paletteColor } from './toon'
import type { ScenePart } from './parts'

/*
 * L'Éveil pulvérise les obstacles : à l'impact, un éclair, une onde de choc, une gerbe
 * d'éclats (pages, carton, bois) projetés devant le coureur, et une onomatopée manga
 * (« ドン ! ») qui claque à l'écran. Les éclats suivent la voie : ils vivent en mètres de
 * piste, pas en coordonnées d'écran.
 */

const SHARDS = 160
const PER_SMASH = 26
const BURSTS = 4
const LIFE = 1.1

interface Shard {
  life: number
  x: number
  y: number
  s: number
  vx: number
  vy: number
  vs: number
  spin: THREE.Vector3
  size: number
}

interface Burst {
  life: number
  x: number
  /** Hauteur de l'éclat (un monstre sur un toit éclate là-haut). */
  y: number
  s: number
  flash: THREE.Sprite
  word: THREE.Sprite
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,230,140,0.85)')
  gradient.addColorStop(1, 'rgba(255,150,20,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** L'onomatopée, lettrage manga : blanc cerné de noir, sur un éclat jaune. */
function wordTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 160
  const context = canvas.getContext('2d')!
  context.translate(128, 80)
  context.rotate(-0.12)
  context.fillStyle = '#ffd23a'
  context.beginPath()
  for (let point = 0; point < 24; point += 1) {
    const angle = (point / 24) * Math.PI * 2
    const radius = point % 2 ? 52 : 78
    context.lineTo(Math.cos(angle) * radius * 1.45, Math.sin(angle) * radius * 0.9)
  }
  context.closePath()
  context.fill()
  context.font = '900 74px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 14
  context.strokeStyle = '#140a14'
  context.strokeText('ドン!', 0, 4) // i18n-ignore (onomatopée)
  context.fillStyle = '#ffffff'
  context.fillText('ドン!', 0, 4) // i18n-ignore (onomatopée)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class SmashPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly shards: Shard[] = []
  private readonly bursts: Burst[] = []
  private readonly seen = new Set<number>()
  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly position = new THREE.Vector3()
  private readonly scale = new THREE.Vector3()
  private readonly color = new THREE.Color()
  private cursor = 0
  private burstCursor = 0

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.12), new THREE.MeshLambertMaterial(), SHARDS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    for (let index = 0; index < SHARDS; index += 1) {
      this.shards.push({ life: 0, x: 0, y: 0, s: 0, vx: 0, vy: 0, vs: 0, spin: new THREE.Vector3(), size: 0 })
      this.mesh.setColorAt(index, this.color.set('#ffffff'))
    }
    this.object.add(this.mesh)

    const glow = glowTexture()
    const word = wordTexture()
    for (let index = 0; index < BURSTS; index += 1) {
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }))
      const text = new THREE.Sprite(new THREE.SpriteMaterial({ map: word, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }))
      text.renderOrder = 10
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40),
        new THREE.MeshBasicMaterial({ color: '#fff0b0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
      )
      flash.visible = text.visible = ring.visible = false
      this.bursts.push({ life: 0, x: 0, y: 0, s: 0, flash, word: text, ring })
      this.object.add(flash, text, ring)
    }
  }

  private explode(object: TrackObject): void {
    const x = objectX(object)
    const s = object.s
    const base = new THREE.Color(paletteColor(object.variant))
    const tall = object.kind === 'wall'
    // Un monstre sur le toit d'un train éclate là-haut.
    const lift = object.base ?? 0
    for (let count = 0; count < PER_SMASH; count += 1) {
      const index = this.cursor
      const shard = this.shards[index]!
      this.cursor = (this.cursor + 1) % SHARDS
      const angle = Math.random() * Math.PI * 2
      shard.life = LIFE * (0.7 + Math.random() * 0.3)
      shard.x = x + (Math.random() - 0.5) * 1.2
      shard.y = lift + 0.2 + Math.random() * (tall ? 2.2 : 0.8)
      shard.s = s + Math.random() * object.length
      shard.vx = Math.cos(angle) * (3 + Math.random() * 5)
      shard.vy = 3 + Math.random() * 6
      shard.vs = 6 + Math.random() * 10
      shard.spin.set(Math.random() * 14, Math.random() * 14, Math.random() * 14)
      shard.size = 0.12 + Math.random() * 0.26
      // Couverture colorée, pages crème, quelques éclats dorés.
      const pick = count % 4
      this.color.copy(pick === 0 ? base : pick === 3 ? new THREE.Color('#ffd23a') : new THREE.Color('#f4ead2'))
      this.mesh.setColorAt(index, this.color)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    const burst = this.bursts[this.burstCursor]!
    this.burstCursor = (this.burstCursor + 1) % BURSTS
    burst.life = 1
    burst.x = x
    burst.s = s
    burst.y = lift
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    for (const object of run.objects) {
      if (object.smashedAt === undefined || this.seen.has(object.id)) continue
      this.seen.add(object.id)
      if (run.t - object.smashedAt < 0.5) this.explode(object)
    }
    // Les identifiants passés ne reviennent pas : on oublie ceux qui sont loin derrière.
    if (this.seen.size > 64) {
      const alive = new Set(run.objects.map((object) => object.id))
      for (const id of this.seen) if (!alive.has(id)) this.seen.delete(id)
    }

    let used = 0
    for (let index = 0; index < SHARDS; index += 1) {
      const shard = this.shards[index]!
      if (shard.life <= 0) continue
      shard.life -= dt
      shard.vy -= 18 * dt
      shard.x += shard.vx * dt
      shard.y = Math.max(0.05, shard.y + shard.vy * dt)
      shard.s += shard.vs * dt
      const fade = Math.min(1, shard.life / 0.25)
      this.position.set(shard.x, shard.y, -(shard.s - run.distance))
      this.euler.set(shard.spin.x * shard.life, shard.spin.y * shard.life, shard.spin.z * shard.life)
      this.quaternion.setFromEuler(this.euler)
      this.scale.set(shard.size * fade, shard.size * 1.3 * fade, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(index, this.matrix)
      used = index + 1
    }
    // Les éclats morts restent en place, réduits à rien : un seul envoi, borné aux indices vivants.
    for (let index = 0; index < used; index += 1) {
      if (this.shards[index]!.life > 0) continue
      this.matrix.makeScale(0, 0, 0)
      this.mesh.setMatrixAt(index, this.matrix)
    }
    this.mesh.count = used
    this.mesh.instanceMatrix.needsUpdate = used > 0

    for (const burst of this.bursts) {
      const visible = burst.life > 0
      burst.flash.visible = burst.word.visible = burst.ring.visible = visible
      if (!visible) continue
      burst.life = Math.max(0, burst.life - dt / 0.7)
      const age = 1 - burst.life
      const z = -(burst.s - run.distance)
      burst.flash.position.set(burst.x, burst.y + 1.2, z)
      burst.flash.scale.setScalar(1.2 + age * 2.6)
      burst.flash.material.opacity = burst.life ** 2
      burst.ring.position.set(burst.x, burst.y + 1.1, z - 0.2)
      burst.ring.scale.setScalar(0.3 + (1 - (1 - age) ** 3) * 2.2)
      burst.ring.material.opacity = burst.life * 0.7
      // Le mot claque (léger rebond), monte un peu, puis s'efface.
      const pop = age < 0.15 ? (age / 0.15) * 1.25 : 1.25 - Math.min(0.25, (age - 0.15) * 1.2)
      // Posé un peu devant l'impact, au-dessus de la voie : lisible, sans masquer le coureur.
      burst.word.position.set(burst.x * 0.8, burst.y + 3.1 + age * 0.6, z - 5)
      burst.word.scale.set(1.9 * pop, 1.2 * pop, 1)
      burst.word.material.opacity = Math.min(1, burst.life * 2.2)
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      // La géométrie des sprites est commune à tous ceux de three : on ne libère que leurs matériaux.
      if (node instanceof THREE.Mesh || node instanceof THREE.Sprite) {
        if (node instanceof THREE.Mesh) node.geometry.dispose()
        const material = node.material as THREE.Material & { map?: THREE.Texture | null }
        material.map?.dispose()
        material.dispose()
      }
    })
  }
}
