import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LANE_WIDTH, MAX_SPEED, RAMP_LENGTH, START_SPEED, TRAIN_ROOF } from '../../lib/runner/constants'
import type { RunState, TrackObject } from '../../lib/runner/engine'
import { Batch } from './batch'
import { monsterOf } from './biomes'
import { canvasTexture, paletteColor, toonMaterial } from './toon'
import { CoverBatch } from './covers'
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
export const rounded = (width: number, height: number, depth: number, radius: number, segments = 3) => new RoundedBoxGeometry(width, height, depth, segments, radius)

/** Longueurs des wagons tirées par la piste (12, 16 ou 20 m) : une caisse arrondie par longueur. */
const TRAIN_LENGTHS = [12, 16, 20] as const

/** Couleurs de ligne des trains (bandeaux), à la japonaise : vert, orange, bleu ciel, jaune, rose, violet. */
const LINE_COLORS = ['#7fc342', '#f26b21', '#18b4e6', '#ffd400', '#ff6fb5', '#8a6cff'] as const

/** Girouette du train : texte en diodes orangées sur fond noir. */
function signTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 56, (context) => {
    context.fillStyle = '#0b0b10'
    context.fillRect(0, 0, 256, 56)
    context.fillStyle = '#ff9b1f'
    context.shadowColor = '#ff7a00'
    context.shadowBlur = 8
    context.font = 'bold 30px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('漫画特急', 82, 29) // i18n-ignore (girouette)
    context.font = 'bold 17px system-ui, sans-serif'
    context.fillText('MANGA', 196, 19) // i18n-ignore (girouette)
    context.fillText('EXPRESS', 196, 39) // i18n-ignore (girouette)
  })
}

/** Pantographe : socle, losange articulé, archet. */
function pantographGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const bar = (width: number, height: number, depth: number, x: number, y: number, z: number, rz = 0) => {
    const geometry = new THREE.BoxGeometry(width, height, depth)
    geometry.rotateZ(rz)
    geometry.translate(x, y, z)
    parts.push(geometry)
  }
  bar(0.9, 0.08, 0.9, 0, 0, 0)
  bar(0.05, 0.62, 0.05, -0.2, 0.28, 0, -0.62)
  bar(0.05, 0.62, 0.05, 0.2, 0.28, 0, 0.62)
  bar(0.05, 0.62, 0.05, -0.2, 0.78, 0, 0.62)
  bar(0.05, 0.62, 0.05, 0.2, 0.78, 0, -0.62)
  bar(1.5, 0.05, 0.12, 0, 1.04, 0)
  return mergeGeometries(parts)!
}

/** Flèche d'indication : deux chevrons blancs cernés d'encre, pointe vers le bas (teintée par instance). */
export function arrowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (context) => {
    context.lineJoin = 'round'
    context.lineCap = 'round'
    for (const [top, alpha] of [
      [22, 0.55],
      [58, 1],
    ] as const) {
      context.globalAlpha = alpha
      context.beginPath()
      context.moveTo(22, top)
      context.lineTo(64, top + 40)
      context.lineTo(106, top)
      context.strokeStyle = '#170b2e'
      context.lineWidth = 30
      context.stroke()
      context.strokeStyle = '#ffffff'
      context.lineWidth = 17
      context.stroke()
    }
  })
}

/**
 * Rampe d'un train : un plan incliné d'acier (prisme triangulaire), du sol jusqu'au toit.
 * Origine : le pied de la rampe ; elle monte vers -z jusqu'au nez du train.
 */
function rampGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(RAMP_LENGTH, 0)
  shape.lineTo(RAMP_LENGTH, TRAIN_ROOF)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.9, bevelEnabled: false })
  // (u, v, profondeur) → (x, y, z) = (profondeur, v, -u).
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-0.95, 0, 0)
  geometry.computeVertexNormals()
  return geometry
}

/** Une voie libre à côté d'un tome géant (pour la flèche qui l'indique), ou `null`. */
export function dodgeOf(objects: readonly TrackObject[], wall: TrackObject): -1 | 1 | null {
  const free = (lane: number) =>
    lane >= -1 &&
    lane <= 1 &&
    !objects.some(
      (other) =>
        other !== wall &&
        !other.cleared &&
        other.smashedAt === undefined &&
        (other.kind === 'wall' || other.kind === 'train' || other.kind === 'low' || other.kind === 'gate') &&
        (other.shiftTo ?? other.lane) === lane &&
        other.s < wall.s + wall.length + 3 &&
        other.s + other.length > wall.s - 3,
    )
  const first = wall.lane === 0 ? (wall.variant % 2 ? 1 : -1) : -wall.lane
  if (free(wall.lane + first)) return first as -1 | 1
  if (free(wall.lane - first)) return -first as -1 | 1
  return null
}

/**
 * Les obstacles : tomes géants debout (la vraie couverture face au coureur), tomes couchés
 * (couverture vers le ciel), torii, et le Manga Express, rame de banlieue japonaise :
 * caisse inox, bandeau de ligne, vitres teintées, portes, publicités de mangas sur les
 * flancs, girouette lumineuse, pantographe ; certains avec une rampe pour monter sur le toit.
 * Des flèches lumineuses disent quoi faire : glisser sous un torii, monter la rampe, contourner
 * un tome géant. Volumes arrondis, ombrage « cel », contour d'encre.
 */
export class ObstaclesPart implements ScenePart {
  readonly object = new THREE.Group()
  // Tome couché : couverture, tranche de pages, illustration sur le dessus.
  private readonly cover = new Batch(rounded(2, 0.84, 1.05, 0.08), toonMaterial(), 40, 0.035)
  private readonly pages = new Batch(rounded(1.88, 0.6, 1.1, 0.04), toonMaterial('#fff4dc'), 40)
  private readonly lyingArt = new CoverBatch(0.96, 1.5, 40)
  // Tome géant debout : bloc de pages, plats de couverture, dos, illustration.
  private readonly bookPages = new Batch(rounded(1.9, 2.92, 0.42, 0.04), toonMaterial('#fff4dc'), 32)
  private readonly bookBoards = new Batch(rounded(2.0, 3.0, 0.06, 0.025, 2), toonMaterial(), 64, 0.025)
  private readonly bookSpine = new Batch(rounded(0.12, 3.0, 0.54, 0.05), toonMaterial(), 32, 0.025)
  private readonly bookArt = new CoverBatch(1.94, 2.94, 32)
  // Torii (cf. `torii.ts`) : la structure, la corde sacrée qui se balance, la plaque.
  private readonly torii = new Batch(toriiGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 24)
  private readonly rope = new Batch(shimenawaGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 24)
  private readonly plaque = new Batch(new THREE.PlaneGeometry(0.42, 0.63), new THREE.MeshLambertMaterial({ map: plaqueTexture(), emissive: '#ffffff', emissiveIntensity: 0.12 }), 24)
  // Manga Express. Les pièces longues sont étirées (échelle en z) ; la caisse garde ses arrondis.
  private readonly bodies = TRAIN_LENGTHS.map((length) => new Batch(rounded(2.1, 2.75, length, 0.34, 4), toonMaterial('#eef1f6'), 8, 0.03))
  private readonly skirt = new Batch(rounded(1.92, 0.5, 1, 0.06), toonMaterial('#373c48'), 8)
  private readonly windowBand = new Batch(rounded(2.13, 0.8, 1, 0.1), new THREE.MeshLambertMaterial({ color: '#1c2a42', emissive: '#29486e', emissiveIntensity: 0.35 }), 8)
  private readonly lineBand = new Batch(rounded(2.15, 0.2, 1, 0.05), toonMaterial(), 16)
  private readonly doors = new Batch(rounded(0.05, 1.95, 1.25, 0.03, 2), toonMaterial('#d9dee6'), 96)
  private readonly doorGlass = new Batch(box(), new THREE.MeshLambertMaterial({ color: '#1c2a42', emissive: '#29486e', emissiveIntensity: 0.35 }), 96)
  private readonly ads = new CoverBatch(0.7, 1.05, 96)
  private readonly windshield = new Batch(rounded(1.84, 1.05, 0.12, 0.14), new THREE.MeshLambertMaterial({ color: '#111a2e', emissive: '#1d3358', emissiveIntensity: 0.4 }), 16)
  private readonly sign = new Batch(new THREE.PlaneGeometry(1.25, 0.27), new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }), 16)
  private readonly frontBand = new Batch(rounded(2.02, 0.26, 0.08, 0.04), toonMaterial(), 16)
  private readonly light = new Batch(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), new THREE.MeshBasicMaterial({ color: '#fff6c8', toneMapped: false }), 64)
  private readonly wheel = new Batch(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 16), toonMaterial('#22242c'), 96)
  private readonly roofUnit = new Batch(rounded(1.25, 0.3, 2.2, 0.08), toonMaterial('#c9ced8'), 24)
  private readonly pantograph = new Batch(pantographGeometry(), toonMaterial('#4a4f5c'), 8)
  // Rampes : le prisme d'acier, ses deux rives jaunes.
  private readonly ramp = new Batch(rampGeometry(), toonMaterial('#5d6475'), 8, 0.03)
  private readonly rampEdge = new Batch(rounded(0.14, 0.1, Math.hypot(RAMP_LENGTH, TRAIN_ROOF), 0.04), toonMaterial('#ffd400', '#ffb000', 0.25), 16)
  // Flèches d'indication (toujours lisibles : pas de brouillard, par-dessus le décor proche).
  private readonly arrow = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    40,
  )
  private readonly batches: Batch[]

  constructor() {
    this.batches = [
      this.cover,
      this.pages,
      this.lyingArt,
      this.bookPages,
      this.bookBoards,
      this.bookSpine,
      this.bookArt,
      this.torii,
      this.rope,
      this.plaque,
      ...this.bodies,
      this.skirt,
      this.windowBand,
      this.lineBand,
      this.doors,
      this.doorGlass,
      this.ads,
      this.windshield,
      this.sign,
      this.frontBand,
      this.light,
      this.wheel,
      this.roofUnit,
      this.pantograph,
      this.ramp,
      this.rampEdge,
      this.arrow,
    ]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState): void {
    for (const batch of this.batches) batch.begin()
    // Les flèches battent doucement, toutes ensemble.
    const bob = Math.sin(run.t * 5) * 0.12
    for (const object of run.objects) {
      if (object.kind !== 'low' && object.kind !== 'wall' && object.kind !== 'gate' && object.kind !== 'train') continue
      // Effacé (quiz, royaume) : la route est vide. Les royaumes dessinent leurs obstacles (`realms.ts`).
      if (object.cleared || object.realm || run.realm !== 'earth') continue
      // Un monstre tient lieu de cet obstacle (cf. `monsters.ts`) ; pulvérisé, il vole en éclats (`smash.ts`).
      if (monsterOf(object) || object.smashedAt !== undefined) continue
      const x = object.lane * LANE_WIDTH
      // `near` : la face tournée vers le coureur ; `z` : le centre de l'objet.
      const near = -(object.s - run.distance)
      const z = near - object.length / 2
      if (near < -170 || z > 14 + (object.ramp ? RAMP_LENGTH : 0)) continue
      const color = paletteColor(object.variant)
      const ahead = object.s - run.distance
      if (object.kind === 'low') {
        this.cover.push(x, 0.42, z, 1, 1, 1, color)
        this.pages.push(x, 0.42, z, 1, 1, 1)
        // Couverture vers le ciel, en long dans le sens de la voie barrée.
        this.lyingArt.cover(object.variant, x, 0.846, z, -Math.PI / 2, 0, Math.PI / 2)
      } else if (object.kind === 'wall') {
        // Un tome géant, debout, couverture face au coureur.
        const bz = near - 0.3
        this.bookPages.push(x + 0.02, 1.5, bz, 1, 1, 1)
        this.bookBoards.push(x, 1.5, bz + 0.24, 1, 1, 1, color)
        this.bookBoards.push(x, 1.5, bz - 0.24, 1, 1, 1, color)
        this.bookSpine.push(x - 0.97, 1.5, bz, 1, 1, 1, color)
        this.bookArt.cover(object.variant * 5 + 3, x, 1.5, bz + 0.275)
        // Au-dessus : une flèche vers la voie libre d'à côté.
        if (ahead > 4 && ahead < 70) {
          const dodge = dodgeOf(run.objects, object)
          if (dodge) this.arrow.push(x + dodge * (0.35 + bob), 3.75, near + 0.2, 1.1, 1.1, 1, '#ff8fcb', 0, 0, dodge * (Math.PI / 2))
        }
      } else if (object.kind === 'gate') {
        // Deux torii voisins sur une même rangée : décalés en profondeur, leurs linteaux ne se mêlent pas.
        const tz = z + object.lane * 0.45
        this.torii.push(x, 0, tz, 1, 1, 1)
        this.plaque.push(x, 3.36, tz + 0.1, 1, 1, 1, undefined, -0.08)
        // La corde se balance au vent, chaque torii à son rythme.
        const swing = Math.sin(run.t * 1.9 + object.id) * 0.09 + Math.sin(run.t * 3.3 + object.id * 2) * 0.03
        this.rope.push(x, 1.58, tz, 1, 1, 1, undefined, swing)
        // Sous le linteau : une flèche vers le bas (on glisse dessous).
        if (ahead > 2 && ahead < 70) this.arrow.push(x, 2.45 - bob, tz + 0.25, 1.15, 1.15, 1, '#7ff0ff')
      } else {
        this.train(x, near, z, object.length, object.variant, object.ramp === true || object.linked === true)
        if (object.ramp) {
          // La rampe, du sol jusqu'au nez du train ; une flèche vers le haut à son pied.
          const slope = Math.atan2(TRAIN_ROOF, RAMP_LENGTH)
          this.ramp.push(x, 0, near + RAMP_LENGTH, 1, 1, 1)
          for (const side of [-1, 1]) this.rampEdge.push(x + side * 0.9, TRAIN_ROOF / 2 + 0.04, near + RAMP_LENGTH / 2, 1, 1, 1, undefined, slope)
          if (ahead > RAMP_LENGTH + 2 && ahead < 80) this.arrow.push(x, 1.7 + bob, near + RAMP_LENGTH + 0.6, 1.2, 1.2, 1, '#ffd35c', 0, 0, Math.PI)
        }
      }
    }
    for (const batch of this.batches) batch.end()
  }

  /** `rideable` : on court sur son toit (rampe ou wagon accroché) ; pas de climatiseurs ni de pantographe. */
  private train(x: number, near: number, z: number, length: number, variant: number, rideable: boolean): void {
    const size = TRAIN_LENGTHS.indexOf(length as (typeof TRAIN_LENGTHS)[number])
    const line = LINE_COLORS[Math.abs(variant) % LINE_COLORS.length]!
    this.bodies[size < 0 ? 0 : size]!.push(x, 1.98, z, 1, 1, 1)
    this.skirt.push(x, 0.42, z, 1, 1, length - 1.2)
    this.windowBand.push(x, 2.36, z, 1, 1, length - 1.4)
    this.lineBand.push(x, 1.84, z, 1, 1, length - 0.5, line)
    this.lineBand.push(x, 3.02, z, 0.97, 0.45, length - 0.7, line)
    // Face avant : pare-brise, girouette, bandeau, phares.
    this.windshield.push(x, 2.36, near + 0.02, 1, 1, 1)
    this.sign.push(x, 3.02, near + 0.09, 1, 1, 1)
    this.frontBand.push(x, 1.6, near + 0.02, 1, 1, 1, line)
    for (const side of [-1, 1]) {
      this.light.push(x + side * 0.6, 1.12, near + 0.03, 1, 1, 1, undefined, Math.PI / 2)
      this.light.push(x + side * 0.82, 1.12, near + 0.03, 0.8, 1, 0.8, undefined, Math.PI / 2)
    }
    // Bogies : deux essieux à chaque bout.
    for (const end of [near - 1.7, near - length + 1.7]) {
      for (const offset of [-0.55, 0.55]) {
        this.wheel.push(x - 0.98, 0.32, end + offset, 1, 1, 1, undefined, 0, 0, Math.PI / 2)
        this.wheel.push(x + 0.98, 0.32, end + offset, 1, 1, 1, undefined, 0, 0, Math.PI / 2)
      }
    }
    // Toit : climatiseurs et pantographe (sauf là où l'on court).
    if (!rideable) {
      this.roofUnit.push(x, 3.42, near - length * 0.25, 1, 1, 1)
      this.roofUnit.push(x, 3.42, near - length * 0.75, 1, 1, 1)
      this.pantograph.push(x, 3.36, z, 1, 1, 1)
    }
    // Flancs : portes (vitrées) tous les 4 m, une publicité manga entre deux portes.
    for (let slot = 0; 2.4 + slot * 4 < length - 1.2; slot += 1) {
      const doorZ = near - 2.4 - slot * 4
      for (const side of [-1, 1]) {
        this.doors.push(x + side * 1.06, 1.55, doorZ, 1, 1, 1)
        this.doorGlass.push(x + side * 1.075, 2.15, doorZ, 0.04, 0.62, 0.9)
      }
      const adZ = doorZ - 2
      if (adZ < near - length + 1.4) continue
      const cell = variant * 3 + slot
      this.ads.cover(cell, x + 1.07, 1.15, adZ, 0, Math.PI / 2, 0)
      this.ads.cover(cell + 7, x - 1.07, 1.15, adZ, 0, -Math.PI / 2, 0)
    }
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
      if (object.done || (object.realm ?? 'earth') !== run.realm) continue
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
  private fov = 62

  update(camera: THREE.Camera, run: RunState, delta: number): void {
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 7)
    // Secousse : forte au choc, légère au trébuchement.
    // Un obstacle pulvérisé par l'Éveil secoue aussi l'image, brièvement.
    let smash = -Infinity
    for (const object of run.objects) if (object.smashedAt !== undefined && object.smashedAt > smash) smash = object.smashedAt
    const shake = run.invulnerableUntil - run.t > 1.25 ? 0.18 : run.t - run.stumbleAt < 0.22 ? 0.09 : run.t - smash < 0.18 ? 0.14 : 0
    camera.position.x += (run.x * 0.55 - camera.position.x) * ease + (Math.random() - 0.5) * shake
    camera.position.y += (3.4 + run.y * 0.85 - camera.position.y) * ease + (Math.random() - 0.5) * shake
    camera.position.z = 6.8
    this.look.x += (run.x * 0.7 - this.look.x) * ease
    this.look.y += (1.3 + run.y * 0.8 - this.look.y) * ease
    camera.lookAt(this.look)
    if (camera instanceof THREE.PerspectiveCamera) {
      // L'Éveil élargit le champ (sensation de vitesse) le temps qu'il dure.
      const awake = run.shieldUntil > run.t ? 7 : 0
      const target = 62 + ((run.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 12 + awake
      this.fov += (target - this.fov) * (1 - Math.exp(-Math.min(delta, 0.05) * 4))
      const fov = this.fov
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    }
  }
}
