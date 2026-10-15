import * as THREE from 'three'
import { LANE_WIDTH } from '../../lib/runner/constants'
import type { Realm, RunState, TrackObject } from '../../lib/runner/engine'
import { Batch } from './batch'
import { monsterOf } from './biomes'
import { arrowTexture, dodgeOf, rounded, type ScenePart } from './parts'
import { canvasTexture, toonMaterial } from './toon'

/*
 * Les royaumes du Manga Runner. Skypia : une chaussée de marbre blanc posée sur une mer de
 * nuages, des colonnes antiques, des îles qui flottent au loin, un ciel d'azur (à la façon
 * des îles célestes de One Piece). Le monde souterrain : une galerie de mine creusée dans la
 * roche violette, des cristaux qui luisent, des lanternes, des étais de bois. Chacun a ses
 * obstacles (colonnes, blocs de nuage, arches ; amas de cristaux, wagonnets, poutres). Et sur
 * terre, ce qui y mène : le tremplin (colonne de lumière, anneaux qui montent) et l'entrée du
 * tunnel (une arche dans la roche).
 *
 * Tout se pose chaque image à partir de `s` (rien n'est alloué) ; un monde caché ne coûte
 * rien. Les décors sont préparés au chargement avec le reste (ils sont compilés cachés).
 */

const BEHIND = 14
const AHEAD = 190
const ROAD_LENGTH = 420
/** Royaume affiché : le monde où court le joueur. */
type Elsewhere = Exclude<Realm, 'earth'>

/** Pseudo-hasard reproductible, de 0 à 1. */
const hash = (a: number, b = 0) => {
  const value = Math.sin(a * 127.1 + b * 311.7 + 74.7) * 43758.5453
  return value - Math.floor(value)
}

const repeating = (texture: THREE.Texture, x: number, y: number) => {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(x, y)
  texture.anisotropy = 4
  return texture
}

/** Lumière et brume de chaque royaume (cf. `EnvironmentPart`). */
export const REALM_ATMOSPHERE: Record<Elsewhere, { horizon: string; fogNear: number; fogFar: number; hemiSky: string; hemiGround: string; hemi: number; sun: string; sunPower: number; sunDirection: [number, number, number] }> = {
  sky: { horizon: '#cdeeff', fogNear: 70, fogFar: 330, hemiSky: '#ffffff', hemiGround: '#bcd7ff', hemi: 1.35, sun: '#fff1cf', sunPower: 1.5, sunDirection: [0.4, 0.8, -0.45] },
  under: { horizon: '#160c28', fogNear: 6, fogFar: 105, hemiSky: '#9b8cff', hemiGround: '#24123c', hemi: 1.05, sun: '#7fe8ff', sunPower: 0.55, sunDirection: [-0.3, 0.9, 0.3] },
}

/* ---- Textures ------------------------------------------------------------------------ */

function cloudSeaTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    context.fillStyle = '#e3f3ff'
    context.fillRect(0, 0, 256, 256)
    for (let index = 0; index < 46; index += 1) {
      const x = hash(index) * 256
      const y = hash(index, 3) * 256
      const radius = 16 + hash(index, 7) * 42
      for (const [dx, dy] of [
        [0, 0],
        [256, 0],
        [-256, 0],
        [0, 256],
        [0, -256],
      ] as const) {
        const blob = context.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius)
        blob.addColorStop(0, 'rgba(255,255,255,0.95)')
        blob.addColorStop(1, 'rgba(255,255,255,0)')
        context.fillStyle = blob
        context.beginPath()
        context.arc(x + dx, y + dy, radius, 0, Math.PI * 2)
        context.fill()
      }
    }
  })
}

/** Chaussée céleste : dalles de marbre, joints dorés entre les voies. */
function marbleRoadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    context.fillStyle = '#f8f3e9'
    context.fillRect(0, 0, 256, 256)
    context.strokeStyle = '#e4d8c2'
    context.lineWidth = 2
    for (let row = 0; row <= 4; row += 1) {
      context.beginPath()
      context.moveTo(0, row * 64)
      context.lineTo(256, row * 64)
      context.stroke()
    }
    for (let column = 0; column < 6; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        const x = column * 43 + (row % 2) * 21
        context.beginPath()
        context.moveTo(x, row * 64)
        context.lineTo(x, row * 64 + 64)
        context.stroke()
      }
    }
    // Joints dorés entre les trois voies, et les bords.
    context.fillStyle = '#e9b949'
    for (const x of [0, 85, 170, 252]) context.fillRect(x, 0, 4, 256)
  })
}

function rockTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    context.fillStyle = '#2b1d3d'
    context.fillRect(0, 0, 256, 256)
    for (let index = 0; index < 220; index += 1) {
      const x = hash(index, 11) * 256
      const y = hash(index, 13) * 256
      const radius = 4 + hash(index, 17) * 22
      const shade = hash(index, 19)
      context.fillStyle = shade > 0.6 ? 'rgba(98,70,128,0.45)' : shade > 0.3 ? 'rgba(20,10,30,0.5)' : 'rgba(64,42,70,0.5)'
      context.beginPath()
      context.ellipse(x, y, radius, radius * 0.6, hash(index, 23) * Math.PI, 0, Math.PI * 2)
      context.fill()
    }
  })
}

/** Sol de la mine : terre sombre, traverses de bois, trois paires de rails. */
function mineFloorTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 128, (context) => {
    context.fillStyle = '#1d1426'
    context.fillRect(0, 0, 256, 128)
    context.fillStyle = '#4a3122'
    for (const y of [10, 74]) for (const x of [12, 97, 182]) context.fillRect(x, y, 62, 14)
    context.fillStyle = '#8f8aa0'
    for (const x of [22, 62, 107, 147, 192, 232]) context.fillRect(x, 0, 4, 128)
  })
}

function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (context) => {
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 64, 64)
  })
}

/** Plaque gravée au-dessus du tunnel. */
function plaqueTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 96, (context) => {
    context.fillStyle = '#2a1640'
    context.fillRect(0, 0, 256, 96)
    context.strokeStyle = '#e04dff'
    context.lineWidth = 6
    context.strokeRect(5, 5, 246, 86)
    context.fillStyle = '#f6d7ff'
    context.shadowColor = '#e04dff'
    context.shadowBlur = 14
    context.font = 'bold 56px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('地底', 128, 50) // i18n-ignore (enseigne)
  })
}

/** Dôme du ciel de Skypia : azur au zénith, blanc à l'horizon (couleurs par sommet). */
function skyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(420, 32, 16)
  const colors: number[] = []
  const zenith = new THREE.Color('#3d97ff')
  const horizon = new THREE.Color('#e6f6ff')
  const color = new THREE.Color()
  const position = geometry.attributes.position!
  for (let index = 0; index < position.count; index += 1) {
    const height = Math.max(0, position.getY(index) / 420)
    color.copy(horizon).lerp(zenith, Math.pow(height, 0.55))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  dome.renderOrder = -10
  dome.frustumCulled = false
  return dome
}

/** Une île flottante : socle de roche en pointe, prairie, quelques arbres. */
function islandTemplate(): THREE.Group {
  const island = new THREE.Group()
  const rock = new THREE.ConeGeometry(5, 9, 7)
  rock.rotateX(Math.PI)
  rock.translate(0, -4.5, 0)
  island.add(new THREE.Mesh(rock, toonMaterial('#b9a68d')))
  const meadow = new THREE.CylinderGeometry(5.3, 5, 1.1, 14)
  meadow.translate(0, 0.5, 0)
  island.add(new THREE.Mesh(meadow, toonMaterial('#8fd36b')))
  const tree = new THREE.ConeGeometry(0.9, 2.8, 7)
  const leaves = toonMaterial('#4b9d58')
  for (const [x, z] of [
    [-2, 1],
    [1.5, -1.8],
    [2.4, 1.6],
  ] as const) {
    const mesh = new THREE.Mesh(tree, leaves)
    mesh.position.set(x, 2.4, z)
    island.add(mesh)
  }
  return island
}

/* ---- Décors des royaumes -------------------------------------------------------------- */

const ISLANDS = 9
const MOTES = 140

export class RealmScenery implements ScenePart {
  readonly object = new THREE.Group()
  private readonly sky = new THREE.Group()
  private readonly under = new THREE.Group()
  // Skypia.
  private readonly seaTexture = repeating(cloudSeaTexture(), 7, 7)
  private readonly roadTexture = repeating(marbleRoadTexture(), 1, ROAD_LENGTH / 6)
  private readonly puffs = new Batch(new THREE.SphereGeometry(1, 12, 8), toonMaterial('#ffffff', '#e8f4ff', 0.4), 380)
  private readonly columns = new Batch(new THREE.CylinderGeometry(0.34, 0.42, 6, 12), toonMaterial('#f7f2e6'), 40, 0.03)
  private readonly capitals = new Batch(rounded(1.2, 0.35, 1.2, 0.06), toonMaterial('#fffaf0'), 80, 0.03)
  private readonly islands: THREE.Group[] = []
  // Monde souterrain.
  private readonly rockTexture = repeating(rockTexture(), 5, ROAD_LENGTH / 14)
  private readonly floorTexture = repeating(mineFloorTexture(), 1, ROAD_LENGTH / 5)
  private readonly crystals = new Batch(new THREE.ConeGeometry(0.32, 1.8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), 220)
  private readonly lamps = new Batch(rounded(0.32, 0.46, 0.32, 0.05), new THREE.MeshBasicMaterial({ color: '#ffc46b', toneMapped: false }), 40)
  private readonly glows: Batch
  private readonly timbers = new Batch(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#5c3b24'), 60, 0.02)
  // Poussière d'étoile (Skypia) ou spores luisantes (sous terre).
  private readonly motes: THREE.Points
  private readonly motePositions = new Float32Array(MOTES * 3)

  constructor() {
    // Skypia : ciel, soleil, mer de nuages, chaussée posée sur un socle de nuage-pierre.
    this.sky.add(skyDome())
    const glow = glowTexture()
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fff4c2', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }))
    sun.position.set(90, 140, -330)
    sun.scale.setScalar(150)
    this.sky.add(sun)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ map: this.seaTexture, emissive: '#dff1ff', emissiveIntensity: 0.35 }))
    sea.rotation.x = -Math.PI / 2
    sea.position.set(0, -9, -300)
    this.sky.add(sea)
    const road = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH * 3 + 1.4, ROAD_LENGTH), new THREE.MeshLambertMaterial({ map: this.roadTexture }))
    road.rotation.x = -Math.PI / 2
    road.position.set(0, -0.01, -(ROAD_LENGTH / 2 - BEHIND))
    this.sky.add(road)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 1.8, 1.3, ROAD_LENGTH), toonMaterial('#efe7d6'))
    slab.position.set(0, -0.67, -(ROAD_LENGTH / 2 - BEHIND))
    this.sky.add(slab)
    const template = islandTemplate()
    for (let index = 0; index < ISLANDS; index += 1) {
      const island = index === 0 ? template : template.clone()
      island.scale.setScalar(0.7 + hash(index, 41) * 1.3)
      this.islands.push(island)
      this.sky.add(island)
    }
    this.sky.add(this.puffs.group, this.columns.group, this.capitals.group)

    // Sous terre : la galerie (tube de roche vu de l'intérieur), le sol de la mine.
    const tube = new THREE.CylinderGeometry(8.5, 8.5, ROAD_LENGTH, 30, 1, true)
    tube.rotateX(Math.PI / 2)
    const tunnel = new THREE.Mesh(tube, new THREE.MeshLambertMaterial({ map: this.rockTexture, side: THREE.BackSide }))
    tunnel.position.set(0, 4.2, -(ROAD_LENGTH / 2 - BEHIND))
    this.under.add(tunnel)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, ROAD_LENGTH), new THREE.MeshLambertMaterial({ map: this.floorTexture }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.01, -(ROAD_LENGTH / 2 - BEHIND))
    this.under.add(floor)
    this.glows = new Batch(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 80)
    this.under.add(this.crystals.group, this.lamps.group, this.glows.group, this.timbers.group)

    for (let index = 0; index < MOTES; index += 1) {
      this.motePositions[index * 3] = (hash(index, 61) - 0.5) * 18
      this.motePositions[index * 3 + 1] = hash(index, 67) * 9
      this.motePositions[index * 3 + 2] = -hash(index, 71) * 110
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3).setUsage(THREE.DynamicDrawUsage))
    this.motes = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.16, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.motes.frustumCulled = false

    this.sky.visible = false
    this.under.visible = false
    this.object.add(this.sky, this.under, this.motes)
  }

  update(run: RunState, time: number, delta: number): void {
    const realm = run.realm
    this.sky.visible = realm === 'sky'
    this.under.visible = realm === 'under'
    this.motes.visible = realm !== 'earth'
    if (realm === 'earth') return
    const distance = run.distance
    if (realm === 'sky') this.updateSky(distance, time)
    else this.updateUnder(distance, time)
    // Particules : elles filent vers la caméra et reviennent au loin.
    const material = this.motes.material as THREE.PointsMaterial
    material.color.set(realm === 'sky' ? '#fff3c4' : '#7ef9ff')
    const dt = Math.min(delta, 0.05)
    const speed = run.over ? 0 : run.speed
    for (let index = 0; index < MOTES; index += 1) {
      const at = index * 3
      this.motePositions[at + 1] = this.motePositions[at + 1]! + Math.sin(time * 1.4 + index) * dt * 0.4
      this.motePositions[at + 2] = this.motePositions[at + 2]! + dt * speed * 0.9
      if (this.motePositions[at + 2]! > 8) this.motePositions[at + 2] = -100 - hash(index, time) * 20
    }
    this.motes.geometry.attributes.position!.needsUpdate = true
  }

  private updateSky(distance: number, time: number): void {
    this.seaTexture.offset.set(Math.sin(time * 0.05) * 0.02, (distance / (900 / 7)) % 1)
    this.roadTexture.offset.y = (distance / 6) % 1
    // Nuages qui bordent la chaussée (petits, puis de grands bancs plus bas, plus loin).
    this.puffs.begin()
    const first = Math.floor((distance - BEHIND) / 3)
    const last = Math.floor((distance + AHEAD) / 3)
    for (let cell = first; cell <= last; cell += 1) {
      const z = -(cell * 3 - distance)
      for (const side of [-1, 1]) {
        for (let puff = 0; puff < 2; puff += 1) {
          const size = 0.8 + hash(cell, side * 3 + puff) * 1.1
          this.puffs.push(side * (5.1 + hash(cell, side + puff * 7) * 1.8), -0.9 + hash(cell, side * 5 + puff) * 0.7, z + puff * 1.4, size * 1.35, size, size)
        }
        if (cell % 4 === 0) {
          const size = 3 + hash(cell, side * 9) * 4
          this.puffs.push(side * (12 + hash(cell, side * 11) * 22), -7 + hash(cell, side * 13) * 4, z, size * 1.6, size * 0.7, size)
        }
      }
    }
    this.puffs.end()
    // Colonnes antiques de part et d'autre, tous les 24 m.
    this.columns.begin()
    this.capitals.begin()
    for (let cell = Math.floor((distance - BEHIND) / 24); cell <= Math.floor((distance + AHEAD) / 24); cell += 1) {
      const z = -(cell * 24 - distance)
      for (const side of [-1, 1]) {
        const x = side * 5.6
        this.columns.push(x, 2.4, z, 1, 1, 1)
        this.capitals.push(x, 5.5, z, 1, 1, 1)
        this.capitals.push(x, -0.55, z, 1.1, 1, 1.1)
      }
    }
    this.columns.end()
    this.capitals.end()
    // Îles qui dérivent au loin (parallaxe lente).
    this.islands.forEach((island, index) => {
      const side = index % 2 ? 1 : -1
      const along = (((hash(index, 31) * 600 - distance * 0.3) % 600) + 600) % 600
      island.position.set(side * (30 + hash(index, 37) * 75), 4 + hash(index, 43) * 30 + Math.sin(time * 0.4 + index) * 0.6, 40 - along)
      island.rotation.y = time * 0.03 + index
    })
  }

  private updateUnder(distance: number, time: number): void {
    this.rockTexture.offset.y = -(distance / 14) % 1
    this.floorTexture.offset.y = (distance / 5) % 1
    // Cristaux plantés dans les parois.
    this.crystals.begin()
    const colors = ['#38f2d0', '#e04dff', '#5aa8ff', '#9d7bff'] as const
    for (let cell = Math.floor((distance - BEHIND) / 3.5); cell <= Math.floor((distance + AHEAD) / 3.5); cell += 1) {
      const z = -(cell * 3.5 - distance)
      for (const side of [-1, 1]) {
        const count = 1 + Math.floor(hash(cell, side * 3) * 2)
        for (let index = 0; index < count; index += 1) {
          const height = hash(cell, side * 7 + index) * 6
          // Sur la paroi courbe : plus haut, plus près du centre.
          const x = side * (7.2 - Math.max(0, height - 3) * 0.55)
          const size = 0.6 + hash(cell, side * 11 + index) * 1.3
          const pulse = 1 + Math.sin(time * 2 + cell + index) * 0.04
          this.crystals.push(x, height + 0.3, z + index * 1.2, size * pulse, size * pulse, size * pulse, colors[(cell + index + (side > 0 ? 1 : 0)) % colors.length], 0, 0, side * (0.7 + height * 0.12))
        }
      }
    }
    this.crystals.end()
    // Lanternes (tous les 14 m) et étais de bois (tous les 18 m).
    this.lamps.begin()
    this.glows.begin()
    for (let cell = Math.floor((distance - BEHIND) / 14); cell <= Math.floor((distance + AHEAD) / 14); cell += 1) {
      const z = -(cell * 14 - distance)
      const flicker = 1 + Math.sin(time * 9 + cell * 3) * 0.06
      for (const side of [-1, 1]) {
        this.lamps.push(side * 5.9, 3.3, z, 1, 1, 1)
        this.glows.push(side * 5.85, 3.3, z + 0.3, 2.6 * flicker, 2.6 * flicker, 1, '#ffb347')
      }
    }
    this.lamps.end()
    this.glows.end()
    this.timbers.begin()
    for (let cell = Math.floor((distance - BEHIND) / 18); cell <= Math.floor((distance + AHEAD) / 18); cell += 1) {
      const z = -(cell * 18 + 7 - distance)
      for (const side of [-1, 1]) this.timbers.push(side * 6.3, 3.2, z, 0.4, 6.4, 0.4)
      this.timbers.push(0, 6.5, z, 13, 0.45, 0.45)
    }
    this.timbers.end()
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Points || node instanceof THREE.Sprite) {
        if (!(node instanceof THREE.Sprite)) node.geometry.dispose()
        for (const material of [node.material].flat()) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
          material.dispose()
        }
      }
    })
  }
}

/* ---- Obstacles des royaumes ----------------------------------------------------------- */

/**
 * Les obstacles de chaque royaume, aux mêmes hauteurs que sur terre : à Skypia, une colonne
 * de marbre (mur), un bloc de nuage-pierre (à sauter), une dalle suspendue entre deux
 * colonnettes (à passer en glissant) ; sous terre, un amas de cristaux, un wagonnet de
 * minerai, une poutre d'étai. Une flèche dit quoi faire, comme sur terre.
 */
export class RealmObstacles implements ScenePart {
  readonly object = new THREE.Group()
  // Skypia.
  private readonly pillar = new Batch(new THREE.CylinderGeometry(0.72, 0.85, 3.2, 16), toonMaterial('#f6f1e4'), 24, 0.03)
  private readonly pillarCap = new Batch(rounded(1.9, 0.32, 1.9, 0.06), toonMaterial('#fffaf0'), 48, 0.03)
  private readonly gold = new Batch(new THREE.CylinderGeometry(0.9, 0.9, 0.14, 16), toonMaterial('#f2c14e', '#ffb300', 0.25), 48)
  private readonly block = new Batch(rounded(2, 0.86, 1.05, 0.2), toonMaterial('#fbf7ef'), 24, 0.03)
  private readonly band = new Batch(rounded(2.04, 0.16, 1.09, 0.05), toonMaterial('#f2c14e', '#ffb300', 0.25), 24)
  private readonly puff = new Batch(new THREE.SphereGeometry(0.42, 10, 8), toonMaterial('#ffffff', '#e8f4ff', 0.4), 72)
  private readonly slab = new Batch(rounded(2.15, 2.3, 0.4, 0.08), toonMaterial('#f6f1e4'), 24, 0.03)
  private readonly slabTrim = new Batch(rounded(2.2, 0.14, 0.46, 0.04), toonMaterial('#f2c14e', '#ffb300', 0.25), 24)
  private readonly post = new Batch(new THREE.CylinderGeometry(0.16, 0.18, 3.9, 10), toonMaterial('#f6f1e4'), 48, 0.02)
  // Monde souterrain.
  private readonly crystal = new Batch(new THREE.ConeGeometry(0.55, 3.3, 6), new THREE.MeshToonMaterial({ color: '#ffffff', emissive: '#3a0d8e', emissiveIntensity: 0.6 }), 72, 0.03)
  private readonly cart = new Batch(rounded(1.8, 0.62, 1.1, 0.06), toonMaterial('#4a4458'), 24, 0.03)
  private readonly cartRim = new Batch(rounded(1.9, 0.12, 1.2, 0.04), toonMaterial('#8a6a3c'), 24)
  private readonly ore = new Batch(new THREE.IcosahedronGeometry(0.26, 0), toonMaterial('#ffd35c', '#ff9b1f', 0.4), 96)
  private readonly wheel = new Batch(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), toonMaterial('#22202a'), 96)
  private readonly beam = new Batch(rounded(2.3, 0.95, 0.42, 0.05), toonMaterial('#6b4429'), 24, 0.03)
  private readonly prop = new Batch(new THREE.BoxGeometry(0.26, 3.8, 0.26), toonMaterial('#5c3b24'), 48, 0.02)
  private readonly arrow = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    30,
  )
  private readonly batches: Batch[]

  constructor() {
    this.batches = [this.pillar, this.pillarCap, this.gold, this.block, this.band, this.puff, this.slab, this.slabTrim, this.post, this.crystal, this.cart, this.cartRim, this.ore, this.wheel, this.beam, this.prop, this.arrow]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState): void {
    for (const batch of this.batches) batch.begin()
    const realm = run.realm
    const bob = Math.sin(run.t * 5) * 0.12
    if (realm !== 'earth') {
      for (const object of run.objects) {
        if (object.realm !== realm || object.cleared || object.smashedAt !== undefined || monsterOf(object)) continue
        if (object.kind !== 'wall' && object.kind !== 'low' && object.kind !== 'gate') continue
        const near = -(object.s - run.distance)
        const z = near - object.length / 2
        if (near < -170 || z > 14) continue
        const ahead = object.s - run.distance
        const x = object.lane * LANE_WIDTH
        if (realm === 'sky') this.sky(object, x, z, near)
        else this.under(object, x, z, near)
        // Flèches : vers la voie libre (mur), vers le bas (à passer en glissant).
        if (ahead > 2 && ahead < 70) {
          if (object.kind === 'gate') this.arrow.push(x, 0.75 - bob * 0.5, near + 0.4, 0.9, 0.9, 1, realm === 'sky' ? '#4fb8ff' : '#7ff0ff')
          else if (object.kind === 'wall' && ahead > 4) {
            const dodge = dodgeOf(run.objects, object)
            if (dodge) this.arrow.push(x + dodge * (0.35 + bob), 3.8, near + 0.2, 1.1, 1.1, 1, '#ff8fcb', 0, 0, dodge * (Math.PI / 2))
          }
        }
      }
    }
    for (const batch of this.batches) batch.end()
  }

  private sky(object: TrackObject, x: number, z: number, near: number): void {
    if (object.kind === 'wall') {
      this.pillar.push(x, 1.6, z, 1, 1, 1)
      this.pillarCap.push(x, 3.3, z, 1, 1, 1)
      this.pillarCap.push(x, 0.12, z, 1.05, 1, 1.05)
      this.gold.push(x, 0.5, z, 1, 1, 1)
      this.gold.push(x, 2.9, z, 0.95, 1, 0.95)
    } else if (object.kind === 'low') {
      this.block.push(x, 0.43, z, 1, 1, 1)
      this.band.push(x, 0.62, z, 1, 1, 1)
      for (let index = 0; index < 3; index += 1) this.puff.push(x + (index - 1) * 0.6, 0.9, z + (index % 2) * 0.2, 1 + (index % 2) * 0.3, 0.8, 1)
    } else {
      // Une dalle de marbre suspendue entre deux colonnettes : on glisse dessous.
      this.slab.push(x, 2.45, near - 0.3, 1, 1, 1)
      this.slabTrim.push(x, 1.27, near - 0.3, 1, 1, 1)
      for (const side of [-1, 1]) this.post.push(x + side * 1.08, 1.95, near - 0.3, 1, 1, 1)
    }
  }

  private under(object: TrackObject, x: number, z: number, near: number): void {
    if (object.kind === 'wall') {
      const hue = object.variant % 3 === 0 ? '#c77dff' : object.variant % 3 === 1 ? '#38f2d0' : '#7a9bff'
      this.crystal.push(x, 1.65, z, 1, 1, 1, hue)
      this.crystal.push(x - 0.55, 1.1, z + 0.2, 0.7, 0.68, 0.7, hue, 0, 0, 0.35)
      this.crystal.push(x + 0.6, 1.0, z - 0.1, 0.65, 0.62, 0.65, hue, 0, 0, -0.4)
    } else if (object.kind === 'low') {
      this.cart.push(x, 0.55, z, 1, 1, 1)
      this.cartRim.push(x, 0.88, z, 1, 1, 1)
      for (let index = 0; index < 4; index += 1) this.ore.push(x + (index - 1.5) * 0.4, 0.95, z + (index % 2 ? 0.18 : -0.18), 1, 1, 1, undefined, index, index * 2)
      for (const side of [-1, 1]) for (const end of [-0.35, 0.35]) this.wheel.push(x + side * 0.92, 0.2, z + end, 1, 1, 1, undefined, 0, 0, Math.PI / 2)
    } else {
      this.beam.push(x, 1.65, near - 0.25, 1, 1, 1)
      for (const side of [-1, 1]) this.prop.push(x + side * 1.05, 1.9, near - 0.25, 1, 1, 1)
    }
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}

/* ---- Tremplins et tunnels (sur terre) --------------------------------------------------- */

/**
 * Ce qui mène aux royaumes, bien visible de loin : le tremplin (disque lumineux, colonne de
 * lumière, anneaux qui montent, flèche vers le haut) et l'entrée du tunnel (bloc de roche,
 * arche lumineuse, enseigne « 地底 », chevrons au sol qui y mènent).
 */
export class PortalsPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly disc = new Batch(new THREE.CylinderGeometry(1.05, 1.15, 0.2, 28), toonMaterial('#2bd9ff', '#20b8ff', 0.6), 4, 0.03)
  private readonly ring = new Batch(new THREE.TorusGeometry(0.95, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: '#bff6ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 16)
  private readonly beam = new Batch(
    new THREE.CylinderGeometry(0.9, 0.9, 16, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    4,
  )
  private readonly rock = new Batch(rounded(2.9, 5.6, 4.2, 0.4), toonMaterial('#6d5a50'), 4, 0.04)
  private readonly mouth = new Batch(new THREE.PlaneGeometry(1.95, 2.9), new THREE.MeshBasicMaterial({ color: '#05020a' }), 4)
  private readonly arch = new Batch(new THREE.TorusGeometry(1.08, 0.13, 8, 24, Math.PI), new THREE.MeshBasicMaterial({ color: '#e04dff', toneMapped: false }), 4)
  private readonly haze = new Batch(new THREE.PlaneGeometry(1.9, 2.8), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#b04dff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 4)
  private readonly sign = new Batch(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: plaqueTexture(), toneMapped: false }), 4)
  private readonly arrow = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    16,
  )
  private readonly batches: Batch[]

  constructor() {
    this.batches = [this.disc, this.ring, this.beam, this.rock, this.mouth, this.arch, this.haze, this.sign, this.arrow]
    for (const batch of this.batches) this.object.add(batch.group)
  }

  update(run: RunState, time: number): void {
    for (const batch of this.batches) batch.begin()
    if (run.realm === 'earth') {
      for (const object of run.objects) {
        if ((object.kind !== 'pad' && object.kind !== 'tunnel') || object.cleared) continue
        const near = -(object.s - run.distance)
        if (near < -175 || near > 14) continue
        const x = object.lane * LANE_WIDTH
        const ahead = object.s - run.distance
        if (object.kind === 'pad') {
          const z = near - object.length / 2
          const pulse = 1 + Math.sin(time * 6) * 0.05
          this.disc.push(x, 0.1, z, pulse, 1, pulse)
          // La colonne de lumière se voit de très loin ; les anneaux montent en boucle.
          if (!object.done) this.beam.push(x, 8, z, 1, 1, 1)
          for (let index = 0; index < 3; index += 1) {
            const rise = (time * 0.9 + index / 3) % 1
            this.ring.push(x, 0.3 + rise * 4.5, z, 1 - rise * 0.35, 1 - rise * 0.35, 1, undefined, Math.PI / 2)
          }
          if (ahead > 3 && ahead < 90) this.arrow.push(x, 2.6 + Math.sin(time * 5) * 0.2, z, 1.3, 1.3, 1, '#ffd35c', 0, 0, Math.PI)
        } else {
          const z = near - 2.1
          this.rock.push(x, 2.8, z, 1, 1, 1)
          this.mouth.push(x, 1.45, near + 0.02, 1, 1, 1)
          this.haze.push(x, 1.45, near + 0.04, 1 + Math.sin(time * 3) * 0.05, 1, 1)
          this.arch.push(x, 2.0, near + 0.06, 1, 1, 1)
          this.sign.push(x, 4.2, near + 0.06, 1, 1, 1)
          // Des chevrons au sol mènent dans le tunnel.
          if (ahead > 3 && ahead < 90) {
            for (let index = 0; index < 3; index += 1) {
              const glow = 0.6 + 0.4 * Math.sin(time * 6 - index)
              this.arrow.push(x, 0.04, near + 2 + index * 1.6, 1.4 * glow, 1.4 * glow, 1, '#e04dff', -Math.PI / 2, 0, Math.PI)
            }
          }
        }
      }
    }
    for (const batch of this.batches) batch.end()
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
  }
}
