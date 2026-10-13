import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LANE_WIDTH, MAX_SPEED, START_SPEED } from '../../lib/runner/constants'
import type { RunState } from '../../lib/runner/engine'
import { Batch } from './batch'
import { monsterOf } from './biomes'
import { PALETTE, canvasTexture, paletteColor, toonMaterial } from './toon'
import { plaqueTexture, shimenawaGeometry, toriiGeometry } from './torii'

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


/* ---- Obstacles ----------------------------------------------------------------------- */

const box = () => new THREE.BoxGeometry(1, 1, 1)
const rounded = (width: number, height: number, depth: number, radius: number, segments = 3) => new RoundedBoxGeometry(width, height, depth, segments, radius)

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
  // Torii (cf. `torii.ts`) : la structure, la corde sacrée qui se balance, la plaque.
  private readonly torii = new Batch(toriiGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 24)
  private readonly rope = new Batch(shimenawaGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 24)
  private readonly plaque = new Batch(new THREE.PlaneGeometry(0.42, 0.63), new THREE.MeshLambertMaterial({ map: plaqueTexture(), emissive: '#ffffff', emissiveIntensity: 0.12 }), 24)
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
      this.torii,
      this.rope,
      this.plaque,
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
      // Un monstre tient lieu de cet obstacle (cf. `monsters.ts`).
      if (monsterOf(object)) continue
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
        // Deux torii voisins sur une même rangée : décalés en profondeur, leurs linteaux ne se mêlent pas.
        const tz = z + object.lane * 0.45
        this.torii.push(x, 0, tz, 1, 1, 1)
        this.plaque.push(x, 3.36, tz + 0.1, 1, 1, 1, undefined, -0.08)
        // La corde se balance au vent, chaque torii à son rythme.
        const swing = Math.sin(run.t * 1.9 + object.id) * 0.09 + Math.sin(run.t * 3.3 + object.id * 2) * 0.03
        this.rope.push(x, 1.58, tz, 1, 1, 1, undefined, swing)
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

/* ---- Caméra -------------------------------------------------------------------------- */

/** Caméra derrière le coureur : elle suit sa voie et sa hauteur, s'élargit avec la vitesse, tremble au choc. */
export class CameraFollow {
  private readonly look = new THREE.Vector3(0, 1.3, -8)

  update(camera: THREE.Camera, run: RunState, delta: number): void {
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 7)
    // Secousse : forte au choc, légère au trébuchement.
    const shake = run.invulnerableUntil - run.t > 1.25 ? 0.18 : run.t - run.stumbleAt < 0.22 ? 0.09 : 0
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
