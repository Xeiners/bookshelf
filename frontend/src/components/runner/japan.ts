import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LANE_WIDTH } from '../../lib/runner/constants'
import type { RunState } from '../../lib/runner/engine'
import { Batch } from './batch'
import type { ScenePart } from './parts'
import { canvasTexture, toonMaterial } from './toon'

/*
 * Le décor du Manga Runner : un Japon de printemps au soleil couchant. Ciel pêche et
 * lavande, mont Fuji enneigé ; voie ferrée sur ballast et traverses de bois, au milieu
 * d'une allée de pierre semée de pétales ; cerisiers en fleurs, maisons de bois aux toits
 * d'ardoise, pagodes au loin, lanternes de papier et lanternes de pierre ; une pluie de
 * pétales de sakura. Tout défile en boucle, en instances (un appel de dessin par type).
 */

/** Couleur de l'horizon : le brouillard et le fond s'y fondent. */
export const HORIZON = '#f4b8c6'

const hash = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Points) {
      node.geometry.dispose()
      for (const material of [node.material].flat()) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    }
  })
}

/* ---- Ciel ---------------------------------------------------------------------------- */

export class SkyPart implements ScenePart {
  readonly object: THREE.Mesh

  constructor() {
    const texture = canvasTexture(1024, 512, (context) => {
      const sky = context.createLinearGradient(0, 0, 0, 512)
      sky.addColorStop(0, '#6d4fb6')
      sky.addColorStop(0.35, '#c784cf')
      sky.addColorStop(0.62, '#ffb3c7')
      sky.addColorStop(0.85, '#ffd2ad')
      sky.addColorStop(1, HORIZON)
      context.fillStyle = sky
      context.fillRect(0, 0, 1024, 512)
      // Soleil pâle et son halo.
      const glow = context.createRadialGradient(560, 360, 20, 560, 360, 220)
      glow.addColorStop(0, 'rgba(255,248,220,0.95)')
      glow.addColorStop(0.35, 'rgba(255,226,190,0.45)')
      glow.addColorStop(1, 'rgba(255,200,200,0)')
      context.fillStyle = glow
      context.fillRect(300, 120, 520, 400)
      context.fillStyle = '#fff6dc'
      context.beginPath()
      context.arc(560, 360, 62, 0, Math.PI * 2)
      context.fill()
      // Nuages étirés.
      context.fillStyle = 'rgba(255,255,255,0.35)'
      for (const [x, y, w] of [
        [120, 150, 260],
        [700, 110, 300],
        [420, 230, 220],
        [860, 260, 180],
      ] as const) {
        context.beginPath()
        context.ellipse(x, y, w / 2, 9, 0, 0, Math.PI * 2)
        context.fill()
      }
      // Montagnes lointaines, puis le Fuji enneigé.
      context.fillStyle = '#c79ac9'
      context.beginPath()
      context.moveTo(0, 470)
      for (let x = 0; x <= 1024; x += 64) context.lineTo(x, 430 + Math.sin(x * 0.013) * 22 + Math.cos(x * 0.031) * 12)
      context.lineTo(1024, 512)
      context.lineTo(0, 512)
      context.fill()
      context.fillStyle = '#a77fc2'
      context.beginPath()
      context.moveTo(180, 512)
      context.lineTo(380, 300)
      context.quadraticCurveTo(410, 286, 440, 300)
      context.lineTo(650, 512)
      context.fill()
      context.fillStyle = '#fbf3ff'
      context.beginPath()
      context.moveTo(380, 300)
      context.quadraticCurveTo(410, 286, 440, 300)
      context.lineTo(468, 330)
      context.lineTo(446, 322)
      context.lineTo(430, 338)
      context.lineTo(414, 324)
      context.lineTo(396, 340)
      context.lineTo(380, 324)
      context.lineTo(352, 330)
      context.fill()
    })
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(680, 220), new THREE.MeshBasicMaterial({ map: texture, fog: false, depthWrite: false }))
    this.object.position.set(0, 52, -225)
  }

  update(): void {}

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Sol ----------------------------------------------------------------------------- */

export const TRACK_WIDTH = LANE_WIDTH * 3 + 0.8
const LENGTH = 280
/** Longueur de piste couverte par un motif de texture (m). */
const TILE = 8

/** Voie ferrée (ballast, traverses, rails), allée de pierre semée de pétales, puis herbe. */
export class GroundPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly textures: THREE.CanvasTexture[] = []

  constructor() {
    const laneU = (x: number) => (0.5 + x / TRACK_WIDTH) * 512
    const track = canvasTexture(512, 512, (context) => {
      context.fillStyle = '#8f8091'
      context.fillRect(0, 0, 512, 512)
      // Ballast : petits cailloux.
      for (let index = 0; index < 1400; index += 1) {
        context.fillStyle = ['#7d6e80', '#a596a6', '#8a7b8c', '#9c8b98'][index % 4]!
        context.beginPath()
        context.arc(hash(index) * 512, hash(index + 9) * 512, 2 + hash(index + 3) * 3, 0, Math.PI * 2)
        context.fill()
      }
      // Traverses de bois sous chaque voie.
      for (let row = 0; row < 4; row += 1) {
        for (const lane of [-1, 0, 1]) {
          const left = laneU(lane * LANE_WIDTH - 0.95)
          const width = laneU(1.9) - laneU(0)
          context.fillStyle = '#6e4a36'
          context.fillRect(left, row * 128 + 40, width, 34)
          context.fillStyle = '#86593f'
          context.fillRect(left, row * 128 + 40, width, 8)
        }
      }
      // Rails d'acier, avec leur ombre.
      for (const lane of [-1, 0, 1]) {
        for (const side of [-0.55, 0.55]) {
          const u = laneU(lane * LANE_WIDTH + side)
          context.fillStyle = 'rgba(40,20,40,0.35)'
          context.fillRect(u - 3, 0, 9, 512)
          context.fillStyle = '#e9e4f2'
          context.fillRect(u - 4, 0, 8, 512)
          context.fillStyle = '#b3abc4'
          context.fillRect(u + 1, 0, 3, 512)
        }
      }
      // Bordures de pierre claire entre les voies et sur les côtés.
      context.fillStyle = '#e6d6cf'
      for (const x of [-TRACK_WIDTH / 2 + 0.12, TRACK_WIDTH / 2 - 0.12]) context.fillRect(laneU(x) - 10, 0, 20, 512)
    })
    const stone = canvasTexture(256, 256, (context) => {
      context.fillStyle = '#d9c3bd'
      context.fillRect(0, 0, 256, 256)
      // Dalles de pierre, joints, mousse et pétales tombés.
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          const shift = row % 2 ? 32 : 0
          context.fillStyle = ['#d4bdb6', '#ccb3ad', '#dcc8c1', '#c9b1b0'][(row + column) % 4]!
          context.fillRect(((column * 64 + shift) % 256) + 3, row * 64 + 3, 58, 58)
        }
      }
      for (let index = 0; index < 90; index += 1) {
        context.fillStyle = index % 5 === 0 ? 'rgba(120,160,100,0.45)' : '#ffb7d0'
        context.beginPath()
        context.ellipse(hash(index + 40) * 256, hash(index + 80) * 256, 3, 2, hash(index) * 3, 0, Math.PI * 2)
        context.fill()
      }
    })
    const grass = canvasTexture(256, 256, (context) => {
      context.fillStyle = '#8fbf72'
      context.fillRect(0, 0, 256, 256)
      for (let index = 0; index < 900; index += 1) {
        context.fillStyle = ['#7fb065', '#a3cf83', '#86b86a', '#ffc4da'][index % 9 === 0 ? 3 : index % 3]!
        context.fillRect(hash(index + 200) * 256, hash(index + 500) * 256, 2, 4)
      }
    })
    this.textures.push(track, stone, grass)
    for (const texture of this.textures) texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    track.repeat.set(1, LENGTH / TILE)
    stone.repeat.set(4, LENGTH / TILE)
    grass.repeat.set(30, LENGTH / TILE)
    const plane = (width: number, texture: THREE.Texture, y: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, LENGTH), new THREE.MeshBasicMaterial({ map: texture }))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(0, y, 20 - LENGTH / 2)
      this.object.add(mesh)
    }
    plane(TRACK_WIDTH, track, 0)
    plane(TRACK_WIDTH + 2 * 4.6, stone, -0.01)
    plane(260, grass, -0.02)
  }

  update(run: RunState): void {
    const offset = (run.distance / TILE) % 1
    for (const texture of this.textures) texture.offset.y = offset
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Décor --------------------------------------------------------------------------- */

const LOOP = 180
const BLOSSOM_COLORS = ['#ffc6dc', '#ffb3d0', '#ff9fc4', '#ffd9ea', '#ffbcd6'] as const

interface Tree {
  base: number
  x: number
  scale: number
  lean: number
  blossoms: { dx: number; dy: number; dz: number; size: number; color: string }[]
}

/** Pignon d'un toit : un prisme triangulaire (longueur 1 selon z). */
function gableGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-0.5, 0)
  shape.lineTo(0, 0.5)
  shape.lineTo(0.5, 0)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
  geometry.translate(0, 0, -0.5)
  return geometry
}

/** Toit d'un étage de pagode : une pyramide à quatre pans, évasée. */
function pagodaRoofGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.18, 0.75, 0.4, 4, 1)
  geometry.rotateY(Math.PI / 4)
  return geometry
}

/** Cerisiers en fleurs, maisons de bois, pagodes, lanternes de papier et de pierre : en boucle. */
export class SceneryPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly trees: Tree[]
  private readonly houses: { base: number; x: number; side: number; height: number; width: number; floors: number; wall: string }[]
  private readonly pagodas: { base: number; x: number; scale: number }[]
  private readonly trunk = new Batch(new THREE.CylinderGeometry(0.16, 0.28, 1, 8), toonMaterial('#6b4433'), 60, 0.025)
  private readonly branch = new Batch(new THREE.CylinderGeometry(0.06, 0.11, 1, 6), toonMaterial('#6b4433'), 120)
  private readonly blossom = new Batch(new THREE.IcosahedronGeometry(1, 1), toonMaterial('#ffffff', '#ffd0e2', 0.18), 400, 0.025)
  private readonly wall = new Batch(new RoundedBoxGeometry(1, 1, 1, 2, 0.04), toonMaterial(), 60, 0.02)
  private readonly timber = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#4a2f25'), 300)
  private readonly shoji = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#fff5e2', '#ffe6b8', 0.35), 120)
  private readonly roof = new Batch(gableGeometry(), toonMaterial('#3e4366'), 60, 0.03)
  private readonly pagodaBody = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#c8463f'), 40)
  private readonly pagodaRoof = new Batch(pagodaRoofGeometry(), toonMaterial('#33385a'), 40)
  private readonly pole = new Batch(new THREE.CylinderGeometry(0.07, 0.09, 1, 8), toonMaterial('#5a3a2c'), 40)
  private readonly paper = new Batch(new THREE.SphereGeometry(0.5, 14, 12), toonMaterial('#ff5a4f', '#ff7a4a', 0.65), 64, 0.02)
  private readonly cap = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), toonMaterial('#24162e'), 80)
  private readonly toro = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), toonMaterial('#b8aeb6'), 64, 0.02)
  private readonly toroLight = new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }), 16)
  private readonly batches: Batch[]

  constructor() {
    this.trees = []
    // Deux rangées de cerisiers : près de l'allée, puis plus loin.
    for (let index = 0; index < 50; index += 1) {
      const near = index < 30
      const side = index % 2 ? 1 : -1
      const count = near ? 15 : 10
      const slot = Math.floor((near ? index : index - 30) / 2)
      const scale = near ? 0.9 + hash(index) * 0.35 : 1.2 + hash(index) * 0.5
      const blossoms = Array.from({ length: 6 }, (_, b) => {
        const angle = (b / 6) * Math.PI * 2 + hash(index + b) * 0.8
        const radius = b === 0 ? 0 : 0.9 + hash(index * 7 + b) * 0.5
        return {
          dx: Math.cos(angle) * radius,
          dy: 3.1 + (b === 0 ? 0.55 : hash(index + b * 3) * 0.6),
          dz: Math.sin(angle) * radius * 0.8,
          size: b === 0 ? 1.45 : 0.95 + hash(index * 3 + b) * 0.4,
          color: BLOSSOM_COLORS[(index + b) % BLOSSOM_COLORS.length]!,
        }
      })
      this.trees.push({
        base: (slot / count) * LOOP + hash(index + 11) * 4 + (near ? 0 : 6),
        x: side * (near ? 6 + hash(index + 5) * 1.6 : 17 + hash(index + 5) * 6),
        scale,
        lean: (hash(index + 19) - 0.5) * 0.18,
        blossoms,
      })
    }
    this.houses = Array.from({ length: 22 }, (_, index) => {
      const side = index % 2 ? 1 : -1
      return {
        base: (Math.floor(index / 2) / 11) * LOOP + 7 + hash(index + 40) * 5,
        x: side * (11 + hash(index + 41) * 2.5),
        side,
        height: 2.6 + hash(index + 42) * 0.8,
        width: 4.2 + hash(index + 43) * 1.2,
        floors: hash(index + 44) > 0.55 ? 2 : 1,
        wall: ['#f3e5d2', '#ead7c2', '#f6ece0', '#e3cdb8'][index % 4]!,
      }
    })
    this.pagodas = Array.from({ length: 4 }, (_, index) => ({
      base: (index / 4) * LOOP + 20,
      x: (index % 2 ? 1 : -1) * (32 + hash(index + 60) * 10),
      scale: 1.3 + hash(index + 61) * 0.5,
    }))
    this.batches = [this.trunk, this.branch, this.blossom, this.wall, this.timber, this.shoji, this.roof, this.pagodaBody, this.pagodaRoof, this.pole, this.paper, this.cap, this.toro, this.toroLight]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState, time: number): void {
    const distance = run.distance
    // Place dans la boucle : de +14 m (derrière la caméra) à −166 m (dans la brume).
    const zOf = (base: number) => 14 - ((((base - distance) % LOOP) + LOOP) % LOOP)
    for (const batch of this.batches) batch.begin()

    for (const tree of this.trees) {
      const z = zOf(tree.base)
      const s = tree.scale
      const sway = Math.sin(time * 0.9 + tree.base) * 0.03
      this.trunk.push(tree.x, 1.6 * s, z, s, 3.2 * s, s, undefined, 0, 0, tree.lean)
      this.branch.push(tree.x + 0.45 * s, 2.6 * s, z, s, 1.4 * s, s, undefined, 0, 0, -0.75 + tree.lean)
      this.branch.push(tree.x - 0.4 * s, 2.7 * s, z + 0.2, s, 1.2 * s, s, undefined, 0.3, 0, 0.7 + tree.lean)
      for (const bloom of tree.blossoms) {
        this.blossom.push(tree.x + (bloom.dx + sway * bloom.dy) * s, bloom.dy * s, z + bloom.dz * s, bloom.size * s, bloom.size * 0.82 * s, bloom.size * s, bloom.color)
      }
    }

    for (const house of this.houses) {
      const z = zOf(house.base)
      const depth = 5
      const face = house.x - (house.side * house.width) / 2
      this.wall.push(house.x, house.height / 2, z, house.width, house.height, depth, house.wall)
      // Colombages et panneaux de papier (shoji) sur la façade tournée vers l'allée.
      for (let post = 0; post < 4; post += 1) this.timber.push(face - house.side * 0.03, house.height / 2, z - depth / 2 + 0.3 + post * ((depth - 0.6) / 3), 0.08, house.height, 0.16)
      this.timber.push(face - house.side * 0.03, house.height - 0.1, z, 0.1, 0.16, depth)
      for (let panel = 0; panel < 3; panel += 1) this.shoji.push(face - house.side * 0.02, house.height * 0.45, z - depth / 2 + 0.95 + panel * 1.55, 0.04, house.height * 0.5, 1.2)
      this.roof.push(house.x, house.height, z, house.width + 1, 1.6, depth + 0.8)
      if (house.floors === 2) {
        const upper = house.height + 0.5
        this.wall.push(house.x, upper + 0.9, z, house.width * 0.75, 1.8, depth * 0.7, house.wall)
        this.roof.push(house.x, upper + 1.8, z, house.width * 0.75 + 0.9, 1.3, depth * 0.7 + 0.7)
      }
      // Lanterne rouge à l'entrée.
      this.paper.push(face - house.side * 0.35, 1.9, z + 1.2, 0.45, 0.6, 0.45)
    }

    for (const pagoda of this.pagodas) {
      const z = zOf(pagoda.base) - 30
      const s = pagoda.scale
      for (let tier = 0; tier < 5; tier += 1) {
        const width = (3.4 - tier * 0.5) * s
        const y = (1.2 + tier * 2.3) * s
        this.pagodaBody.push(pagoda.x, y, z, width * 0.7, 1.6 * s, width * 0.7)
        this.pagodaRoof.push(pagoda.x, y + 1.05 * s, z, width * 1.15, 1.6 * s, width * 1.15)
      }
      this.pole.push(pagoda.x, 13.8 * s, z, 0.6 * s, 2.6 * s, 0.6 * s)
    }

    // Lanternes de papier le long de l'allée, une de chaque côté tous les 18 m.
    for (let index = 0; index < 20; index += 1) {
      const side = index % 2 ? 1 : -1
      const z = zOf((Math.floor(index / 2) / 10) * LOOP + 3)
      const x = side * (TRACK_WIDTH / 2 + 1.1)
      const swing = Math.sin(time * 2 + index) * 0.06
      this.pole.push(x, 1.5, z, 1, 3, 1)
      this.cap.push(x - side * 0.3, 2.95, z, 0.75, 0.07, 0.1)
      this.paper.push(x - side * 0.55 + swing, 2.45, z, 0.5, 0.68, 0.5)
      this.cap.push(x - side * 0.55 + swing, 2.83, z, 0.24, 0.07, 0.24)
      this.cap.push(x - side * 0.55 + swing, 2.08, z, 0.24, 0.07, 0.24)
    }

    // Lanternes de pierre (tōrō), plus rares.
    for (let index = 0; index < 8; index += 1) {
      const side = index % 2 ? 1 : -1
      const z = zOf((Math.floor(index / 2) / 4) * LOOP + 25)
      const x = side * (TRACK_WIDTH / 2 + 2.6)
      this.toro.push(x, 0.15, z, 0.9, 0.3, 0.9)
      this.toro.push(x, 0.7, z, 0.35, 0.9, 0.35)
      this.toro.push(x, 1.3, z, 0.8, 0.25, 0.8)
      this.toroLight.push(x, 1.62, z, 0.42, 0.38, 0.42)
      this.toro.push(x, 2.0, z, 1.05, 0.35, 1.05)
      this.toro.push(x, 2.3, z, 0.25, 0.25, 0.25)
    }

    for (const batch of this.batches) batch.end()
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}

/* ---- Pétales ------------------------------------------------------------------------- */

/** Pluie de pétales de sakura qui tourbillonnent et volent vers la caméra. */
export class PetalsPart implements ScenePart {
  readonly object: THREE.Points
  private readonly positions: Float32Array
  private readonly count: number

  constructor(count = 260) {
    this.count = count
    this.positions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      this.positions[index * 3] = (hash(index) - 0.5) * 34
      this.positions[index * 3 + 1] = hash(index + 50) * 14
      this.positions[index * 3 + 2] = -hash(index + 99) * 110
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    const texture = canvasTexture(64, 64, (context) => {
      const petal = context.createRadialGradient(28, 30, 2, 32, 32, 26)
      petal.addColorStop(0, '#fff3f8')
      petal.addColorStop(1, '#ff9fc4')
      context.fillStyle = petal
      context.beginPath()
      context.moveTo(32, 6)
      context.bezierCurveTo(56, 20, 52, 50, 32, 58)
      context.bezierCurveTo(12, 50, 8, 20, 26, 8)
      context.lineTo(32, 14)
      context.closePath()
      context.fill()
    })
    this.object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.42, map: texture, transparent: true, alphaTest: 0.2, depthWrite: false }))
    this.object.frustumCulled = false
  }

  update(run: RunState, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const speed = run.over ? 0 : run.speed
    const positions = this.positions
    for (let index = 0; index < this.count; index += 1) {
      const at = index * 3
      positions[at] = positions[at]! + Math.sin(time * 1.3 + index) * dt * 0.9
      positions[at + 1] = positions[at + 1]! - dt * (0.5 + (index % 5) * 0.14)
      positions[at + 2] = positions[at + 2]! + dt * (speed * 0.9 + Math.cos(time + index) * 0.4)
      if (positions[at + 2]! > 8 || positions[at + 1]! < 0) {
        positions[at] = (Math.random() - 0.5) * 34
        positions[at + 1] = 5 + Math.random() * 10
        positions[at + 2] = -70 - Math.random() * 40
      }
    }
    this.object.geometry.attributes.position!.needsUpdate = true
  }

  dispose(): void {
    disposeTree(this.object)
  }
}
