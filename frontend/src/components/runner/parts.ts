import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LANE_WIDTH, MAX_SPEED, START_SPEED } from '../../lib/runner/constants'
import type { RunState } from '../../lib/runner/engine'
import { Batch } from './batch'
import { PALETTE, canvasTexture, paletteColor, toonMaterial } from './toon'

/*
 * Les parties de la scène du Manga Runner, en Three.js pur : chacune construit ses objets
 * une fois, puis `update` relit l'état de la course à chaque image (rien n'est alloué).
 * Le composant React (`RunnerScene`) ne fait que les monter et les appeler.
 */

export interface ScenePart {
  readonly object: THREE.Object3D
  update(run: RunState, time: number, delta: number): void
  dispose(): void
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

/** Ciel de soleil couchant façon anime : dégradé, soleil rayé, mont Fuji au loin. */
export class SkyPart implements ScenePart {
  readonly object: THREE.Mesh

  constructor() {
    const texture = canvasTexture(512, 256, (context) => {
      const sky = context.createLinearGradient(0, 0, 0, 256)
      sky.addColorStop(0, '#1d0f40')
      sky.addColorStop(0.45, '#6b2fa8')
      sky.addColorStop(0.75, '#ff6fb5')
      sky.addColorStop(1, '#ffc46b')
      context.fillStyle = sky
      context.fillRect(0, 0, 512, 256)
      const sun = context.createLinearGradient(0, 120, 0, 230)
      sun.addColorStop(0, '#fff3b0')
      sun.addColorStop(1, '#ff7a9c')
      context.fillStyle = sun
      context.beginPath()
      context.arc(256, 205, 70, Math.PI, 0)
      context.fill()
      context.fillStyle = '#ff6fb5'
      for (let line = 0; line < 6; line += 1) context.fillRect(186, 175 + line * 6, 140, 1 + line * 0.6)
      // Fuji : silhouette violette et neige.
      context.fillStyle = '#3b1c6d'
      context.beginPath()
      context.moveTo(60, 256)
      context.lineTo(160, 160)
      context.lineTo(190, 156)
      context.lineTo(300, 256)
      context.fill()
      context.fillStyle = '#f2e6ff'
      context.beginPath()
      context.moveTo(160, 160)
      context.lineTo(190, 156)
      context.lineTo(205, 172)
      context.lineTo(188, 168)
      context.lineTo(176, 176)
      context.lineTo(166, 168)
      context.lineTo(146, 174)
      context.fill()
      context.fillStyle = '#2a1555'
      context.fillRect(0, 238, 512, 18)
    })
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(620, 150), new THREE.MeshBasicMaterial({ map: texture, fog: false, depthWrite: false }))
    this.object.position.set(0, 32, -215)
  }

  update(): void {}

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Sol ----------------------------------------------------------------------------- */

export const TRACK_WIDTH = LANE_WIDTH * 3 + 0.8
const TRACK_LENGTH = 260
/** Longueur de piste couverte par un motif de texture (m). */
const TILE = 8

/** La piste (trois voies, rails, séparations néon) et le sol en grille ; les textures défilent. */
export class GroundPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly track: THREE.CanvasTexture
  private readonly grid: THREE.CanvasTexture

  constructor() {
    const laneU = (x: number) => (0.5 + x / TRACK_WIDTH) * 256
    this.track = canvasTexture(256, 256, (context) => {
      for (let row = 0; row < 8; row += 1) {
        context.fillStyle = row % 2 ? '#311d5c' : '#2b1a52'
        context.fillRect(0, row * 32, 256, 32)
      }
      // Traverses, rails argentés, séparations néon en tirets, bordures cyan.
      context.fillStyle = 'rgba(20,10,40,0.6)'
      for (let row = 0; row < 4; row += 1) for (const lane of [-1, 0, 1]) context.fillRect(laneU(lane * LANE_WIDTH - 0.8), row * 64 + 20, laneU(1.6) - laneU(0), 10)
      context.fillStyle = '#b9b3ff'
      for (const lane of [-1, 0, 1]) for (const side of [-0.55, 0.55]) context.fillRect(laneU(lane * LANE_WIDTH + side) - 2, 0, 4, 256)
      context.fillStyle = '#ff6fb5'
      for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) for (let dash = 0; dash < 4; dash += 1) context.fillRect(laneU(x) - 3, dash * 64, 6, 36)
      context.fillStyle = '#3fd0ff'
      context.fillRect(0, 0, 6, 256)
      context.fillRect(250, 0, 6, 256)
    })
    this.track.wrapS = this.track.wrapT = THREE.RepeatWrapping
    this.track.repeat.set(1, TRACK_LENGTH / TILE)
    this.grid = canvasTexture(128, 128, (context) => {
      context.fillStyle = '#160b31'
      context.fillRect(0, 0, 128, 128)
      context.strokeStyle = '#7c5cff'
      context.lineWidth = 3
      context.strokeRect(0, 0, 128, 128)
    })
    this.grid.wrapS = this.grid.wrapT = THREE.RepeatWrapping
    this.grid.repeat.set(40, TRACK_LENGTH / TILE)

    const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, TRACK_LENGTH), new THREE.MeshBasicMaterial({ map: this.track }))
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 40, TRACK_LENGTH), new THREE.MeshBasicMaterial({ map: this.grid }))
    for (const [mesh, y] of [
      [track, 0],
      [floor, -0.02],
    ] as const) {
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(0, y, 20 - TRACK_LENGTH / 2)
      this.object.add(mesh)
    }
  }

  update(run: RunState): void {
    const offset = (run.distance / TILE) % 1
    this.track.offset.y = offset
    this.grid.offset.y = offset
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Décor --------------------------------------------------------------------------- */

const SCENERY_LOOP = 176
const BUILDINGS = 44
const LANTERNS = 32
const SHELVES = 10

/** Pseudo-hasard fixe (le décor est le même à chaque course). */
const hash = (seed: number) => {
  const value = Math.sin(seed * 127.1) * 43758.5453
  return value - Math.floor(value)
}

/** Décor qui défile en boucle : immeubles pastel aux néons, lanternes, bibliothèques flottantes. */
export class SceneryPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly buildings = Array.from({ length: BUILDINGS }, (_, index) => {
    const side = index % 2 ? 1 : -1
    return {
      base: (index / BUILDINGS) * SCENERY_LOOP + hash(index) * 3,
      x: side * (7.5 + hash(index + 7) * 5),
      width: 3 + hash(index + 3) * 3,
      depth: 3 + hash(index + 5) * 3,
      height: 5 + hash(index + 11) * 12,
      color: ['#4a2f8a', '#5b3aa3', '#3d2b7a', '#6a3f9e', '#2f2466'][index % 5]!,
      neon: PALETTE[index % PALETTE.length]!,
      side,
    }
  })
  private readonly shelves = Array.from({ length: SHELVES }, (_, index) => ({
    base: (index / SHELVES) * SCENERY_LOOP + 9,
    x: (index % 2 ? 1 : -1) * (5.6 + hash(index + 31) * 1.5),
    y: 6 + hash(index + 17) * 3,
    tilt: (hash(index + 23) - 0.5) * 0.4,
  }))
  private readonly building = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial(), BUILDINGS, 0.03)
  private readonly neon = new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), BUILDINGS * 2)
  private readonly pole = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#2a1555'), LANTERNS)
  private readonly lantern = new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffb35c', toneMapped: false }), LANTERNS)
  private readonly shelf = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#7a4a2a'), SHELVES * 2, 0.04)
  private readonly book = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial(), SHELVES * 6)
  private readonly batches = [this.building, this.neon, this.pole, this.lantern, this.shelf, this.book]

  constructor() {
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState, time: number): void {
    const distance = run.distance
    // Place dans la boucle : de +12 m (derrière) à −164 m (devant, dans le brouillard).
    const zOf = (base: number) => 12 - ((((base - distance) % SCENERY_LOOP) + SCENERY_LOOP) % SCENERY_LOOP)
    for (const batch of this.batches) batch.begin()
    for (const item of this.buildings) {
      const z = zOf(item.base)
      this.building.push(item.x, item.height / 2, z, item.width, item.height, item.depth, item.color)
      // Bandes néon sur la façade tournée vers la piste.
      const face = item.x - (item.side * item.width) / 2 - item.side * 0.06
      this.neon.push(face, item.height * 0.55, z, 0.08, item.height * 0.6, 0.3, item.neon)
      this.neon.push(face, item.height * 0.82, z, 0.08, 0.5, item.depth * 0.7, item.neon)
    }
    for (let index = 0; index < LANTERNS; index += 1) {
      const side = index % 2 ? 1 : -1
      const z = zOf((Math.floor(index / 2) / (LANTERNS / 2)) * SCENERY_LOOP)
      const x = side * (TRACK_WIDTH / 2 + 0.7)
      this.pole.push(x, 1.4, z, 0.14, 2.8, 0.14)
      this.lantern.push(x, 2.95, z, 0.42, 0.55, 0.42)
    }
    this.shelves.forEach((item, index) => {
      const z = zOf(item.base)
      const y = item.y + Math.sin(time * 1.2 + index) * 0.35
      this.shelf.push(item.x, y, z, 3.2, 0.18, 0.9, undefined, 0, 0, item.tilt)
      this.shelf.push(item.x, y + 1.25, z, 3.2, 0.14, 0.9, undefined, 0, 0, item.tilt)
      for (let slot = 0; slot < 6; slot += 1) {
        const offset = (slot - 2.5) * 0.48
        this.book.push(item.x + offset * Math.cos(item.tilt), y + 0.6 + offset * Math.sin(item.tilt), z, 0.38, 1 - (slot % 3) * 0.12, 0.7, PALETTE[(slot + index) % PALETTE.length], 0, 0, item.tilt)
      }
    })
    for (const batch of this.batches) batch.end()
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}

/* ---- Obstacles ----------------------------------------------------------------------- */

const box = () => new THREE.BoxGeometry(1, 1, 1)
const rounded = (width: number, height: number, depth: number, radius: number, segments = 3) => new RoundedBoxGeometry(width, height, depth, segments, radius)

/** Linteau de torii (kasagi) : une poutre dont les extrémités se relèvent. */
function kasagiGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(3.1, 0.24, 0.5, 24, 1, 1)
  const position = geometry.attributes.position!
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / 1.55
    position.setY(index, position.getY(index) + 0.22 * x ** 4 + (position.getY(index) > 0 ? 0.03 * x * x : 0))
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Longueurs des wagons tirées par la piste (12, 16 ou 20 m) : une géométrie arrondie par longueur. */
const TRAIN_LENGTHS = [12, 16, 20] as const

/**
 * Tomes couchés, piles de tomes debout, torii, Manga Express. Géométries arrondies
 * construites à leur vraie taille (l'arrondi ne se déforme pas), lisérés dorés, rivets,
 * roues : des volumes propres sous un ombrage « cel » et un contour d'encre.
 */
export class ObstaclesPart implements ScenePart {
  readonly object = new THREE.Group()
  // Tome couché : couverture, tranche de pages, titre doré.
  private readonly cover = new Batch(rounded(2, 0.84, 1.05, 0.08), toonMaterial(), 40, 0.035)
  private readonly pages = new Batch(rounded(1.88, 0.6, 1.1, 0.04), toonMaterial('#fff4dc'), 40)
  private readonly title = new Batch(rounded(0.9, 0.04, 0.5, 0.02, 2), toonMaterial('#ffd35c', '#ffb000', 0.35), 40)
  // Pile de tomes debout : dos arrondis, bandes dorées, étiquette.
  private readonly tome = new Batch(rounded(0.62, 3, 1.5, 0.07), toonMaterial(), 96, 0.03)
  private readonly bands = new Batch(rounded(0.64, 0.07, 0.06, 0.02, 2), toonMaterial('#ffd35c', '#ffb000', 0.3), 200)
  private readonly label = new Batch(rounded(0.42, 0.34, 0.04, 0.03, 2), toonMaterial('#fff4dc', '#fff4dc', 0.2), 96)
  // Torii : piliers ronds sur socles noirs, linteau relevé, bannière.
  private readonly pillar = new Batch(new THREE.CylinderGeometry(0.15, 0.18, 3.9, 16), toonMaterial('#ff4d5e'), 48, 0.025)
  private readonly socle = new Batch(new THREE.CylinderGeometry(0.22, 0.24, 0.32, 16), toonMaterial('#24164a'), 48)
  private readonly kasagi = new Batch(kasagiGeometry(), toonMaterial('#2a1030'), 24, 0.03)
  private readonly nuki = new Batch(rounded(2.6, 0.2, 0.26, 0.06), toonMaterial('#ff4d5e'), 48, 0.025)
  private readonly banner = new Batch(rounded(1.7, 1.5, 0.06, 0.03, 2), toonMaterial(), 24)
  private readonly emblem = new Batch(new THREE.CircleGeometry(0.34, 24), toonMaterial('#fff4dc', '#fff4dc', 0.25), 24)
  // Manga Express : wagon arrondi, bandeau, vitres, pare-brise, phares, roues, couvertures sur les flancs.
  private readonly wagons = TRAIN_LENGTHS.map((length) => new Batch(rounded(2.1, 3.1, length, 0.32, 4), toonMaterial(), 8, 0.03))
  private readonly stripes = TRAIN_LENGTHS.map((length) => new Batch(rounded(2.14, 0.22, length - 0.4, 0.08), toonMaterial('#fbf7ff'), 8))
  private readonly windows = TRAIN_LENGTHS.map((length) => new Batch(rounded(2.15, 0.62, length - 1.6, 0.2), new THREE.MeshBasicMaterial({ color: '#bfe9ff', toneMapped: false }), 8))
  private readonly windshield = new Batch(rounded(1.7, 0.9, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#2a3a7a' }), 16)
  private readonly light = new Batch(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18), new THREE.MeshBasicMaterial({ color: '#fff3b0', toneMapped: false }), 32)
  private readonly wheel = new Batch(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 18), toonMaterial('#1b1233'), 160)
  private readonly panel = new Batch(rounded(0.04, 1.25, 2.4, 0.02, 2), toonMaterial('#ffffff', '#ffffff', 0.15), 200)
  private readonly batches: Batch[]

  constructor() {
    this.batches = [
      this.cover,
      this.pages,
      this.title,
      this.tome,
      this.bands,
      this.label,
      this.pillar,
      this.socle,
      this.kasagi,
      this.nuki,
      this.banner,
      this.emblem,
      ...this.wagons,
      ...this.stripes,
      ...this.windows,
      this.windshield,
      this.light,
      this.wheel,
      this.panel,
    ]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState): void {
    for (const batch of this.batches) batch.begin()
    for (const object of run.objects) {
      if (object.kind !== 'low' && object.kind !== 'wall' && object.kind !== 'gate' && object.kind !== 'train') continue
      const x = object.lane * LANE_WIDTH
      // `near` : la face tournée vers le coureur ; `z` : le centre de l'objet.
      const near = -(object.s - run.distance)
      const z = near - object.length / 2
      if (near < -170 || z > 14) continue
      const color = paletteColor(object.variant)
      if (object.kind === 'low') {
        this.cover.push(x, 0.42, z, 1, 1, 1, color)
        this.pages.push(x, 0.42, z, 1, 1, 1)
        this.title.push(x - 0.35, 0.85, z, 1, 1, 1)
      } else if (object.kind === 'wall') {
        for (let book = 0; book < 3; book += 1) {
          const height = 2.7 + ((object.variant >> (book * 2)) & 3) * 0.18
          const bx = x + (book - 1) * 0.66
          const front = z + 0.75
          this.tome.push(bx, height / 2, z, 1, height / 3, 1, paletteColor(object.variant + book * 3))
          this.bands.push(bx, height * 0.12, front, 1, 1, 1)
          this.bands.push(bx, height * 0.9, front, 1, 1, 1)
          this.label.push(bx, height * 0.62, front + 0.01, 1, 1, 1)
        }
      } else if (object.kind === 'gate') {
        for (const side of [-1, 1]) {
          this.pillar.push(x + side * 1.02, 1.95, z, 1, 1, 1)
          this.socle.push(x + side * 1.02, 0.16, z, 1, 1, 1)
        }
        this.kasagi.push(x, 3.95, z, 1, 1, 1)
        this.nuki.push(x, 3.3, z, 1, 1, 1)
        const wave = Math.sin(run.t * 2.6 + object.id) * 0.1
        this.banner.push(x, 2.3, z + 0.02, 1, 1, 1, color, wave)
        this.emblem.push(x, 2.35, z + 0.06, 1, 1, 1, undefined, wave)
      } else {
        const size = TRAIN_LENGTHS.indexOf(object.length as (typeof TRAIN_LENGTHS)[number])
        const index = size < 0 ? 0 : size
        this.wagons[index]!.push(x, 1.75, z, 1, 1, 1, color)
        this.stripes[index]!.push(x, 1.2, z, 1, 1, 1)
        this.windows[index]!.push(x, 2.35, z, 1, 1, 1)
        this.windshield.push(x, 2.35, near + 0.02, 1, 1, 1)
        this.light.push(x - 0.62, 0.85, near + 0.02, 1, 1, 1, undefined, Math.PI / 2)
        this.light.push(x + 0.62, 0.85, near + 0.02, 1, 1, 1, undefined, Math.PI / 2)
        for (let wheel = 0; wheel * 2.6 + 1.4 < object.length; wheel += 1) {
          const wz = near - 1.4 - wheel * 2.6
          this.wheel.push(x - 1.0, 0.3, wz, 1, 1, 1, undefined, 0, 0, Math.PI / 2)
          this.wheel.push(x + 1.0, 0.3, wz, 1, 1, 1, undefined, 0, 0, Math.PI / 2)
        }
        const panels = Math.floor((object.length - 1) / 3.2)
        for (let panel = 0; panel < panels; panel += 1) {
          const pz = near - 1.8 - panel * 3.2
          const tint = PALETTE[(object.variant + panel + 1) % PALETTE.length]
          this.panel.push(x - 1.07, 1.75, pz, 1, 1, 1, tint)
          this.panel.push(x + 1.07, 1.75, pz, 1, 1, 1, tint)
        }
      }
    }
    for (const batch of this.batches) batch.end()
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}

/* ---- Objets à ramasser --------------------------------------------------------------- */

function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 ? 0.2 : 0.44
    const angle = (point / 10) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (point === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 1 })
  geometry.center()
  return geometry
}

/** ✦ dorées qui tournent (attirées par l'aimant), jetons de quiz, aimants, nuages. */
export class PickupsPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly star = new Batch(starGeometry(), toonMaterial('#ffd35c', '#ffb000', 0.55), 220, 0.03)
  private readonly coin: Batch
  private readonly arc = new Batch(new THREE.TorusGeometry(0.42, 0.14, 10, 20, Math.PI), toonMaterial('#ff4d5e'), 4, 0.03)
  private readonly tip = new Batch(box(), toonMaterial('#e8e6ff'), 8)
  private readonly puff = new Batch(new THREE.SphereGeometry(0.5, 14, 10), toonMaterial('#ffffff', '#cfe8ff', 0.3), 24, 0.03)
  private readonly glow = new Batch(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false }), 12)
  private readonly batches: Batch[]

  constructor() {
    const question = canvasTexture(128, 128, (context) => {
      context.fillStyle = '#ffd35c'
      context.beginPath()
      context.arc(64, 64, 64, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#7c2cff'
      context.font = 'bold 92px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('?', 64, 70)
    })
    const side = toonMaterial('#e8a521', '#ffb000', 0.2)
    const face = new THREE.MeshToonMaterial({ map: question, emissive: '#ffffff', emissiveMap: question, emissiveIntensity: 0.35 })
    this.coin = new Batch(new THREE.CylinderGeometry(0.6, 0.6, 0.16, 28), [side, face, face], 4, 0.035)
    this.batches = [this.glow, this.star, this.coin, this.arc, this.tip, this.puff]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState): void {
    for (const batch of this.batches) batch.begin()
    const magnet = run.magnetUntil > run.t
    const t = run.t
    for (const object of run.objects) {
      if (object.done) continue
      if (object.kind !== 'star' && object.kind !== 'quiz' && object.kind !== 'magnet' && object.kind !== 'cloud') continue
      const ahead = object.s - run.distance
      if (ahead > 160 || ahead < -6) continue
      let x = object.lane * LANE_WIDTH
      let y = object.y + Math.sin(t * 4 + object.id) * 0.08
      let z = -ahead
      if (object.kind === 'star') {
        // L'aimant attire les ✦ proches vers le coureur.
        if (magnet && ahead < 12) {
          const pull = 1 - Math.max(0, ahead) / 12
          x += (run.x - x) * pull
          y += (run.y + 1 - y) * pull
          z *= 1 - pull * 0.3
        }
        this.star.push(x, y, z, 1, 1, 1, undefined, 0, t * 3 + object.id)
        continue
      }
      y = 1.1 + Math.sin(t * 3 + object.id) * 0.15
      this.glow.push(x, 0.03, z, 1, 1, 1, object.kind === 'quiz' ? '#ffd35c' : object.kind === 'magnet' ? '#ff4d5e' : '#bfe9ff', -Math.PI / 2)
      if (object.kind === 'quiz') {
        this.coin.push(x, y, z, 1, 1, 1, undefined, Math.PI / 2, t * 2.4)
      } else if (object.kind === 'magnet') {
        const spin = t * 2
        this.arc.push(x, y + 0.1, z, 1, 1, 1, undefined, 0, spin, Math.PI)
        this.tip.push(x - 0.42 * Math.cos(spin), y - 0.05, z + 0.42 * Math.sin(spin), 0.3, 0.22, 0.3, undefined, 0, spin)
        this.tip.push(x + 0.42 * Math.cos(spin), y - 0.05, z - 0.42 * Math.sin(spin), 0.3, 0.22, 0.3, undefined, 0, spin)
      } else {
        for (let bump = 0; bump < 4; bump += 1) {
          const offset = (bump - 1.5) * 0.42
          this.puff.push(x + offset, y + (bump % 2) * 0.18, z, 0.9 - Math.abs(offset) * 0.25, 0.75, 0.8)
        }
      }
    }
    for (const batch of this.batches) batch.end()
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}

/* ---- Pétales ------------------------------------------------------------------------- */

const PETALS = 140

/** Pétales de cerisier qui volent vers la caméra (un seul tampon de points). */
export class PetalsPart implements ScenePart {
  readonly object: THREE.Points
  private readonly positions = new Float32Array(PETALS * 3)

  constructor() {
    for (let index = 0; index < PETALS; index += 1) {
      this.positions[index * 3] = (hash(index) - 0.5) * 30
      this.positions[index * 3 + 1] = hash(index + 50) * 12
      this.positions[index * 3 + 2] = -hash(index + 99) * 90
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    const texture = canvasTexture(32, 32, (context) => {
      context.fillStyle = '#ffd1ea'
      context.beginPath()
      context.ellipse(16, 16, 14, 8, 0.6, 0, Math.PI * 2)
      context.fill()
    })
    this.object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.32, map: texture, transparent: true, opacity: 0.85, depthWrite: false }))
    this.object.frustumCulled = false
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const speed = run.over ? 0 : run.speed
    const positions = this.positions
    for (let index = 0; index < PETALS; index += 1) {
      const at = index * 3
      positions[at] = positions[at]! + Math.sin(index + positions[at + 2]! * 0.1) * dt * 0.6
      positions[at + 1] = positions[at + 1]! - dt * (0.6 + (index % 5) * 0.12)
      positions[at + 2] = positions[at + 2]! + dt * speed * 0.9
      if (positions[at + 2]! > 8 || positions[at + 1]! < 0) {
        positions[at] = (Math.random() - 0.5) * 30
        positions[at + 1] = 4 + Math.random() * 9
        positions[at + 2] = -60 - Math.random() * 40
      }
    }
    this.object.geometry.attributes.position!.needsUpdate = true
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Caméra -------------------------------------------------------------------------- */

/** Caméra derrière le coureur : elle suit sa voie et sa hauteur, s'élargit avec la vitesse, tremble au choc. */
export class CameraFollow {
  private readonly look = new THREE.Vector3(0, 1.3, -8)

  update(camera: THREE.Camera, run: RunState, delta: number): void {
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 7)
    const shake = run.invulnerableUntil - run.t > 1.25 ? 0.18 : 0
    camera.position.x += (run.x * 0.55 - camera.position.x) * ease + (Math.random() - 0.5) * shake
    camera.position.y += (3.4 + run.y * 0.85 - camera.position.y) * ease + (Math.random() - 0.5) * shake
    camera.position.z = 6.8
    this.look.x += (run.x * 0.7 - this.look.x) * ease
    this.look.y += (1.3 + run.y * 0.8 - this.look.y) * ease
    camera.lookAt(this.look)
    if (camera instanceof THREE.PerspectiveCamera) {
      const fov = 62 + ((run.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 12
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    }
  }
}
