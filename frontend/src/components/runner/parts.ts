import * as THREE from 'three'
import { LANE_WIDTH, MAX_SPEED, START_SPEED } from '../../lib/runner/constants'
import { isFlying, isShielded, isSliding, type RunState } from '../../lib/runner/engine'
import { Batch } from './batch'
import { PALETTE, canvasTexture, outlineMaterial, paletteColor, toonMaterial } from './toon'

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

/** Tomes couchés, piles de tomes debout, torii à bannière, Manga Express. */
export class ObstaclesPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly cover = new Batch(box(), toonMaterial(), 48, 0.04)
  private readonly pages = new Batch(box(), toonMaterial('#fff4dc'), 48)
  private readonly tome = new Batch(box(), toonMaterial(), 96, 0.03)
  private readonly spine = new Batch(box(), toonMaterial('#fff4dc', '#fff4dc', 0.25), 96)
  private readonly pillar = new Batch(box(), toonMaterial('#ff4d5e'), 48, 0.03)
  private readonly beam = new Batch(box(), toonMaterial(), 48, 0.03)
  private readonly banner = new Batch(box(), toonMaterial(), 24)
  private readonly wagon = new Batch(box(), toonMaterial(), 16)
  private readonly wagonEdge = new Batch(box(), new THREE.MeshBasicMaterial({ color: '#170b2e' }), 16)
  private readonly windows = new Batch(box(), new THREE.MeshBasicMaterial({ color: '#bfe9ff', toneMapped: false }), 16)
  private readonly roof = new Batch(box(), toonMaterial('#f4ecff'), 16)
  private readonly nose = new Batch(box(), toonMaterial('#24164a'), 16)
  private readonly light = new Batch(box(), new THREE.MeshBasicMaterial({ color: '#fff3b0', toneMapped: false }), 32)
  private readonly panel = new Batch(box(), toonMaterial('#ffffff', '#ffffff', 0.15), 200)
  private readonly batches = [
    this.cover,
    this.pages,
    this.tome,
    this.spine,
    this.pillar,
    this.beam,
    this.banner,
    this.wagon,
    this.wagonEdge,
    this.windows,
    this.roof,
    this.nose,
    this.light,
    this.panel,
  ]

  constructor() {
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
        // Un tome géant couché en travers : couverture colorée, tranche de pages crème.
        this.cover.push(x, 0.42, z, 2, 0.84, 1.05, color)
        this.pages.push(x, 0.42, z, 1.82, 0.62, 1.09)
      } else if (object.kind === 'wall') {
        // Trois tomes debout, de hauteurs et couleurs différentes, étiquette au dos.
        for (let book = 0; book < 3; book += 1) {
          const height = 2.7 + ((object.variant >> (book * 2)) & 3) * 0.18
          const bx = x + (book - 1) * 0.66
          this.tome.push(bx, height / 2, z, 0.62, height, 1.5, paletteColor(object.variant + book * 3))
          this.spine.push(bx, height * 0.72, z + 0.76, 0.42, 0.32, 0.02)
        }
      } else if (object.kind === 'gate') {
        // Torii : piliers rouges, linteaux, bannière qui ondule.
        this.pillar.push(x - 1.02, 1.95, z, 0.26, 3.9, 0.26)
        this.pillar.push(x + 1.02, 1.95, z, 0.26, 3.9, 0.26)
        this.beam.push(x, 3.85, z, 2.8, 0.3, 0.44, '#2a1030')
        this.beam.push(x, 3.25, z, 2.3, 0.2, 0.26, '#ff4d5e')
        this.banner.push(x, 2.25, z, 1.8, 1.6, 0.06, color, Math.sin(run.t * 3 + object.id) * 0.12)
      } else {
        // Manga Express : wagon pastel, vitres lumineuses, couvertures de manga sur les flancs.
        this.wagon.push(x, 1.7, z, 2.1, 3.2, object.length, color)
        this.wagonEdge.push(x, 0.12, z, 2.16, 0.24, object.length + 0.04)
        this.windows.push(x, 2.35, z, 2.16, 0.55, object.length * 0.86)
        this.roof.push(x, 3.38, z, 1.9, 0.16, object.length * 0.98)
        this.nose.push(x, 1.6, near + 0.04, 1.86, 2.9, 0.08)
        this.light.push(x - 0.6, 0.75, near + 0.1, 0.38, 0.22, 0.04)
        this.light.push(x + 0.6, 0.75, near + 0.1, 0.38, 0.22, 0.04)
        const panels = Math.floor((object.length - 1) / 3.2)
        for (let index = 0; index < panels; index += 1) {
          const pz = near - 1.8 - index * 3.2
          const tint = PALETTE[(object.variant + index + 1) % PALETTE.length]
          this.panel.push(x - 1.07, 1.35, pz, 0.03, 1.25, 2.4, tint)
          this.panel.push(x + 1.07, 1.35, pz, 0.03, 1.25, 2.4, tint)
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

/* ---- Le coureur ---------------------------------------------------------------------- */

/** Un héros d'anime en volumes simples : cheveux en pointes, bandeau, sac-livre ; nuage, bouclier, ombre. */
export class RunnerPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly root = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly legL: THREE.Group
  private readonly legR: THREE.Group
  private readonly armL: THREE.Group
  private readonly armR: THREE.Group
  private readonly cloud = new THREE.Group()
  private readonly shield: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private phase = 0

  constructor() {
    const ink = outlineMaterial(0.03)
    const part = (geometry: THREE.BufferGeometry, color: string, outline = true) => {
      const mesh = new THREE.Mesh(geometry, toonMaterial(color))
      if (outline) mesh.add(new THREE.Mesh(geometry, ink))
      return mesh
    }
    this.root.add(this.body)
    const torso = part(new THREE.BoxGeometry(0.62, 0.66, 0.38), '#ff8a3c')
    torso.position.y = 1.08
    const belt = part(new THREE.BoxGeometry(0.64, 0.1, 0.4), '#2b2d6e', false)
    belt.position.y = 0.78
    const head = part(new THREE.SphereGeometry(0.3, 18, 14), '#ffd9b8')
    head.position.y = 1.62
    const hair = new THREE.Group()
    hair.position.y = 1.72
    const hairMaterial = toonMaterial('#2b2d6e')
    const spikes: [number, number, number, number, number][] = [
      [0, 0.16, 0.05, 0, 0],
      [-0.18, 0.1, 0.02, 0, 0.6],
      [0.18, 0.1, 0.02, 0, -0.6],
      [0, 0.06, 0.2, -1.2, 0],
      [-0.14, 0.02, 0.18, -1, 0.5],
      [0.14, 0.02, 0.18, -1, -0.5],
      [0, 0.08, -0.16, 0.7, 0],
    ]
    for (const [x, y, z, rx, rz] of spikes) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 6), hairMaterial)
      spike.add(new THREE.Mesh(spike.geometry, ink))
      spike.position.set(x, y, z)
      spike.rotation.set(rx, 0, rz)
      hair.add(spike)
    }
    const band = part(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 18), '#ff4d5e', false)
    band.position.y = 1.7
    const tail = part(new THREE.BoxGeometry(0.08, 0.06, 0.42), '#ff4d5e', false)
    tail.position.set(0.08, 1.68, 0.4)
    // Sac à dos en forme de livre (Bookshelf oblige).
    const pack = part(new THREE.BoxGeometry(0.5, 0.56, 0.18), '#7c5cff')
    pack.position.set(0, 1.1, 0.3)
    const pages = part(new THREE.BoxGeometry(0.44, 0.5, 0.06), '#fff4dc', false)
    pages.position.set(0, 1.1, 0.4)
    this.body.add(torso, belt, head, hair, band, tail, pack, pages)

    const limb = (color: string, x: number, y: number, length: number, width: number) => {
      const pivot = new THREE.Group()
      pivot.position.set(x, y, 0)
      const mesh = part(new THREE.BoxGeometry(width, length, width), color)
      mesh.position.y = -length / 2
      pivot.add(mesh)
      return pivot
    }
    this.legL = limb('#2b2d6e', -0.15, 0.74, 0.72, 0.22)
    this.legR = limb('#2b2d6e', 0.15, 0.74, 0.72, 0.22)
    this.armL = limb('#ff8a3c', -0.4, 1.36, 0.56, 0.16)
    this.armR = limb('#ff8a3c', 0.4, 1.36, 0.56, 0.16)
    for (const leg of [this.legL, this.legR]) {
      const shoe = part(new THREE.BoxGeometry(0.26, 0.14, 0.34), '#ffffff')
      shoe.position.set(0, -0.72, -0.05)
      leg.add(shoe)
    }
    this.body.add(this.legL, this.legR, this.armL, this.armR)

    for (let bump = 0; bump < 5; bump += 1) {
      const puff = part(new THREE.SphereGeometry(0.42, 12, 10), '#ffffff')
      puff.position.set((bump - 2) * 0.32, (bump % 2) * 0.1 - 0.1, (bump % 3) * 0.12 - 0.1)
      this.cloud.add(puff)
    }
    this.cloud.scale.setScalar(0.75)
    this.cloud.position.y = 0.05
    this.cloud.visible = false
    this.root.add(this.cloud)
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 24, 18),
      new THREE.MeshBasicMaterial({ color: '#3fd0ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.shield.position.y = 0.95
    this.shield.visible = false
    this.root.add(this.shield)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: '#0b0420', transparent: true, opacity: 0.45, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.object.add(this.root, this.shadow)
  }

  update(run: RunState, _time: number, delta: number): void {
    const { root, body, legL, legR, armL, armR, cloud, shield, shadow } = this
    const flying = isFlying(run)
    const sliding = isSliding(run)
    root.position.set(run.x, run.y, 0)
    shadow.position.set(run.x, 0.02, 0)
    const shrink = Math.max(0.3, 1 - run.y * 0.15)
    shadow.scale.set(shrink, shrink, 1)
    // Penché dans le changement de voie.
    root.rotation.z = (run.x - run.lane * LANE_WIDTH) * 0.12
    if (!run.over) this.phase += delta * (6 + run.speed * 0.42)
    const swing = Math.sin(this.phase)
    if (sliding) {
      body.rotation.x = -1.15
      body.position.y = 0.32
      legL.rotation.x = legR.rotation.x = -1.2
      armL.rotation.x = armR.rotation.x = -2.4
    } else if (!run.grounded || flying) {
      body.rotation.x = flying ? 0 : -0.15
      body.position.y = 0
      legL.rotation.x = flying ? 0.2 : 0.9
      legR.rotation.x = flying ? -0.2 : -0.5
      armL.rotation.x = armR.rotation.x = flying ? -0.4 : -2.6
    } else {
      body.rotation.x = 0.12
      body.position.y = Math.abs(swing) * 0.08
      legL.rotation.x = swing * 0.95
      legR.rotation.x = -swing * 0.95
      armL.rotation.x = -swing * 0.85
      armR.rotation.x = swing * 0.85
    }
    cloud.visible = flying
    // Clignote pendant l'invincibilité qui suit un choc.
    body.visible = run.over || !(run.invulnerableUntil > run.t && !isShielded(run)) || Math.floor(run.t * 14) % 2 === 0
    shield.visible = isShielded(run)
    if (shield.visible) {
      shield.scale.setScalar(1 + Math.sin(run.t * 8) * 0.04)
      ;(shield.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(run.t * 6) * 0.06
    }
  }

  dispose(): void {
    disposeTree(this.object)
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
