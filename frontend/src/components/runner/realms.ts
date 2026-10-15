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
 * des îles célestes de One Piece). Les Enfers (le royaume « sous terre ») : une chaussée
 * d'obsidienne fendue de magma, posée sur une mer de lave qui bouillonne, des aiguilles de
 * roche noire, des braseros, des portes démoniaques à cornes, des geysers de lave, des
 * braises qui montent sous un ciel rouge sang. Chacun a ses obstacles (colonnes, blocs de
 * nuage, arches ; pics d'obsidienne, auges de lave, barres runiques). Et sur terre, ce qui y
 * mène : le tremplin (colonne de lumière, anneaux qui montent) et l'entrée du tunnel (une
 * gueule de roche cornue, rougeoyante).
 *
 * Tout se pose chaque image à partir de `s` (rien n'est alloué) ; un monde caché ne coûte
 * rien. Les décors sont préparés au chargement avec le reste (ils sont compilés cachés).
 */

const BEHIND = 14
const AHEAD = 190
/** Demi-largeur de la chaussée (trois voies et leurs marges). */
const ROAD_HALF = (LANE_WIDTH * 3 + 1.4) / 2
/** Niveau de la mer de lave, sous la chaussée des Enfers. */
const LAVA_LEVEL = -2.4
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
  sky: { horizon: '#bfe6ff', fogNear: 90, fogFar: 360, hemiSky: '#ffffff', hemiGround: '#bcd7ff', hemi: 1.35, sun: '#fff1cf', sunPower: 1.5, sunDirection: [0.4, 0.8, -0.45] },
  under: { horizon: '#6a1606', fogNear: 40, fogFar: 240, hemiSky: '#ff9a6a', hemiGround: '#ff3a0a', hemi: 1.15, sun: '#ffb27a', sunPower: 1.05, sunDirection: [0.25, 0.75, -0.6] },
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

/** Mer de lave : magma orange et jaune, plaques de croûte noire entre les coulées (raccord sans couture). */
function lavaTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    const base = context.createLinearGradient(0, 0, 256, 256)
    base.addColorStop(0, '#ff4a00')
    base.addColorStop(0.5, '#ff7a10')
    base.addColorStop(1, '#ff4a00')
    context.fillStyle = base
    context.fillRect(0, 0, 256, 256)
    const tiled = (draw: (x: number, y: number) => void, x: number, y: number) => {
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) draw(x + dx, y + dy)
    }
    for (let index = 0; index < 26; index += 1) {
      tiled(
        (x, y) => {
          const hot = context.createRadialGradient(x, y, 0, x, y, 26)
          hot.addColorStop(0, 'rgba(255,230,120,0.9)')
          hot.addColorStop(1, 'rgba(255,200,60,0)')
          context.fillStyle = hot
          context.fillRect(x - 26, y - 26, 52, 52)
        },
        hash(index, 5) * 256,
        hash(index, 7) * 256,
      )
    }
    for (let index = 0; index < 34; index += 1) {
      const radius = 12 + hash(index, 17) * 20
      const stretch = 0.55 + hash(index, 19) * 0.4
      const angle = hash(index, 23) * Math.PI
      tiled(
        (x, y) => {
          context.fillStyle = '#5a1206'
          context.beginPath()
          context.ellipse(x, y, radius + 3, (radius + 3) * stretch, angle, 0, Math.PI * 2)
          context.fill()
          context.fillStyle = hash(index, 29) > 0.5 ? '#2a0805' : '#1c0604'
          context.beginPath()
          context.ellipse(x, y, radius, radius * stretch, angle, 0, Math.PI * 2)
          context.fill()
        },
        hash(index, 11) * 256,
        hash(index, 13) * 256,
      )
    }
  })
}

/** Chaussée des Enfers : dalles d'obsidienne en quinconce, joints et fissures de magma, voies marquées. */
function obsidianRoadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    context.fillStyle = '#ff5a14'
    context.fillRect(0, 0, 256, 256)
    const shades = ['#241619', '#2c1a1c', '#1f1416', '#30201f'] as const
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 ? 42 : 0
      for (let column = -1; column < 4; column += 1) {
        const x = column * 85 + offset
        context.fillStyle = shades[(row * 5 + column + 8) % shades.length]!
        context.fillRect(x + 2, row * 64 + 2, 81, 60)
      }
    }
    // Fissures : des éclairs de magma dans quelques dalles.
    context.strokeStyle = '#ff7a1a'
    context.lineWidth = 2
    context.shadowColor = '#ff5a00'
    context.shadowBlur = 6
    for (let index = 0; index < 9; index += 1) {
      let x = 10 + hash(index, 31) * 236
      let y = 8 + hash(index, 37) * 240
      context.beginPath()
      context.moveTo(x, y)
      for (let step = 0; step < 4; step += 1) {
        x += (hash(index, step + 41) - 0.5) * 30
        y += 6 + hash(index, step + 47) * 12
        context.lineTo(x, y)
      }
      context.stroke()
    }
    // Les trois voies : deux lignes de braise.
    context.fillStyle = '#ff9a3a'
    context.shadowBlur = 10
    for (const x of [85, 170]) context.fillRect(x - 1.5, 0, 3, 256)
  })
}

export function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (context) => {
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 64, 64)
  })
}

/** Plaque « 地獄 » (les Enfers) : au-dessus du tunnel et sur les portes démoniaques. */
function plaqueTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 96, (context) => {
    context.fillStyle = '#1a0605'
    context.fillRect(0, 0, 256, 96)
    context.strokeStyle = '#ff4a14'
    context.lineWidth = 6
    context.strokeRect(5, 5, 246, 86)
    context.fillStyle = '#ffd7a8'
    context.shadowColor = '#ff3a00'
    context.shadowBlur = 16
    context.font = 'bold 58px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('地獄', 128, 50) // i18n-ignore (enseigne)
  })
}

/**
 * Dôme du ciel (couleurs par sommet). Skypia : azur au zénith, blanc à l'horizon. Les
 * Enfers : une lueur de braise à l'horizon, rouge sang, puis presque noir au zénith.
 */
function skyDome(realm: Elsewhere): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(420, 32, 16)
  const colors: number[] = []
  const zenith = new THREE.Color(realm === 'sky' ? '#1f78f0' : '#120306')
  const middle = new THREE.Color(realm === 'sky' ? '#1f78f0' : '#5a0c08')
  const horizon = new THREE.Color(realm === 'sky' ? '#bfe6ff' : '#b8300c')
  const color = new THREE.Color()
  const position = geometry.attributes.position!
  for (let index = 0; index < position.count; index += 1) {
    const height = Math.max(0, position.getY(index) / 420)
    if (realm === 'sky') color.copy(horizon).lerp(zenith, Math.pow(height, 0.4))
    else if (height < 0.14) color.copy(horizon).lerp(middle, height / 0.14)
    else color.copy(middle).lerp(zenith, Math.pow((height - 0.14) / 0.86, 0.6))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }))
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
  // Les Enfers.
  private readonly lavaTexture = repeating(lavaTexture(), 9, 9)
  private readonly hellRoadTexture = repeating(obsidianRoadTexture(), 1, ROAD_LENGTH / 6)
  private readonly spires = new Batch(new THREE.ConeGeometry(1, 1, 6), toonMaterial('#2a171a', '#ff2a00', 0.07), 150)
  private readonly curbs = new Batch(rounded(0.42, 0.4, 2.5, 0.08), toonMaterial('#2a1a1c', '#ff2a00', 0.05), 150, 0.02)
  private readonly posts = new Batch(new THREE.CylinderGeometry(0.11, 0.17, 1.7, 8), toonMaterial('#24161a'), 40, 0.02)
  private readonly bowls = new Batch(new THREE.CylinderGeometry(0.5, 0.26, 0.42, 10), toonMaterial('#3a2420', '#ff3a00', 0.2), 40, 0.02)
  private readonly flames = new Batch(new THREE.ConeGeometry(0.36, 1.2, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 80)
  private readonly glows: Batch
  private readonly gatePillars = new Batch(rounded(1.1, 12.6, 1.1, 0.12), toonMaterial('#1e1215', '#ff2200', 0.06), 12, 0.03)
  private readonly gateBeams = new Batch(rounded(ROAD_HALF * 2 + 4.2, 0.9, 1.3, 0.12), toonMaterial('#24151a', '#ff2200', 0.06), 12, 0.03)
  private readonly gateRunes = new Batch(rounded(ROAD_HALF * 2 + 2.6, 0.16, 0.08, 0.03), new THREE.MeshBasicMaterial({ color: '#ff5a14', toneMapped: false }), 12)
  private readonly horns = new Batch(new THREE.ConeGeometry(0.42, 2.6, 8), toonMaterial('#e6d6b8', '#ff6a2a', 0.08), 24, 0.03)
  private readonly plaques = new Batch(new THREE.PlaneGeometry(2.6, 0.98), new THREE.MeshBasicMaterial({ map: plaqueTexture(), toneMapped: false }), 6)
  private readonly geysers = new Batch(new THREE.CylinderGeometry(0.45, 1.1, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ff6a14', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), 16)
  private readonly blobs = new Batch(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false }), 48)
  // Poussière d'étoile (Skypia) ou braises qui montent (les Enfers).
  private readonly motes: THREE.Points
  private readonly motePositions = new Float32Array(MOTES * 3)

  constructor() {
    // Skypia : ciel, soleil, mer de nuages, chaussée posée sur un socle de nuage-pierre.
    this.sky.add(skyDome('sky'))
    const glow = glowTexture()
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fff4c2', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }))
    sun.position.set(110, 120, -340)
    sun.scale.setScalar(80)
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

    // Les Enfers : ciel rouge, mer de lave, chaussée d'obsidienne posée sur un socle, rigoles de magma.
    this.under.add(skyDome('under'))
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ map: this.lavaTexture, toneMapped: false }))
    lava.rotation.x = -Math.PI / 2
    lava.position.set(0, LAVA_LEVEL, -300)
    this.under.add(lava)
    const causeway = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LENGTH), new THREE.MeshBasicMaterial({ map: this.hellRoadTexture }))
    causeway.rotation.x = -Math.PI / 2
    causeway.position.set(0, -0.01, -(ROAD_LENGTH / 2 - BEHIND))
    this.under.add(causeway)
    const base = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 1.6, 3, ROAD_LENGTH), toonMaterial('#1c1013', '#ff2a00', 0.05))
    base.position.set(0, -1.52, -(ROAD_LENGTH / 2 - BEHIND))
    this.under.add(base)
    const channel = new THREE.BoxGeometry(0.3, 0.05, ROAD_LENGTH)
    const magma = new THREE.MeshBasicMaterial({ color: '#ff6a14', toneMapped: false })
    for (const side of [-1, 1]) {
      const rill = new THREE.Mesh(channel, magma)
      rill.position.set(side * (ROAD_HALF + 0.2), 0, -(ROAD_LENGTH / 2 - BEHIND))
      this.under.add(rill)
    }
    this.glows = new Batch(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 120)
    this.under.add(
      this.spires.group,
      this.curbs.group,
      this.posts.group,
      this.bowls.group,
      this.flames.group,
      this.glows.group,
      this.gatePillars.group,
      this.gateBeams.group,
      this.gateRunes.group,
      this.horns.group,
      this.plaques.group,
      this.geysers.group,
      this.blobs.group,
    )

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
    material.color.set(realm === 'sky' ? '#fff3c4' : '#ff9a3a')
    material.size = realm === 'sky' ? 0.16 : 0.22
    const dt = Math.min(delta, 0.05)
    const speed = run.over ? 0 : run.speed
    // Aux Enfers, les braises montent de la lave puis s'éteignent en haut.
    const rise = realm === 'under' ? 1.4 : 0
    for (let index = 0; index < MOTES; index += 1) {
      const at = index * 3
      this.motePositions[at + 1] = this.motePositions[at + 1]! + Math.sin(time * 1.4 + index) * dt * 0.4 + rise * (0.6 + hash(index, 3)) * dt
      if (this.motePositions[at + 1]! > 12) this.motePositions[at + 1] = -1
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
    // La lave coule lentement de travers pendant que la chaussée défile.
    this.lavaTexture.offset.set(time * 0.012, (distance / 100 + time * 0.004) % 1)
    this.hellRoadTexture.offset.y = (distance / 6) % 1
    // Aiguilles de roche noire qui sortent de la lave : petites au bord, immenses au loin.
    this.spires.begin()
    this.glows.begin()
    for (let cell = Math.floor((distance - BEHIND) / 9); cell <= Math.floor((distance + AHEAD) / 9); cell += 1) {
      const z = -(cell * 9 - distance)
      for (const side of [-1, 1]) {
        const nearX = side * (ROAD_HALF + 4 + hash(cell, side * 3) * 8)
        const nearHeight = 2.5 + hash(cell, side * 5) * 5
        this.spires.push(nearX, LAVA_LEVEL + nearHeight / 2, z, 1 + hash(cell, side) * 0.8, nearHeight, 1 + hash(cell, side * 7) * 0.8, undefined, 0, hash(cell, 9) * 3)
        const farX = side * (26 + hash(cell, side * 11) * 50)
        const farHeight = 12 + hash(cell, side * 13) * 34
        const width = 3 + hash(cell, side * 17) * 5
        this.spires.push(farX, LAVA_LEVEL + farHeight / 2, z - 4, width, farHeight, width, undefined, 0, hash(cell, 19) * 3)
        // La lave rougeoie au pied des grandes aiguilles.
        if (cell % 2 === 0) this.glows.push(farX, LAVA_LEVEL + 2, z - 3, width * 3.2, 5, 1, '#ff4a00')
      }
    }
    this.spires.end()
    // Bordures de la chaussée ; un brasero toutes les quatre (12 m).
    this.curbs.begin()
    this.posts.begin()
    this.bowls.begin()
    this.flames.begin()
    for (let cell = Math.floor((distance - BEHIND) / 3); cell <= Math.floor((distance + AHEAD) / 3); cell += 1) {
      const z = -(cell * 3 - distance)
      for (const side of [-1, 1]) {
        const x = side * (ROAD_HALF + 0.62)
        if (cell % 4 !== 0) {
          this.curbs.push(x, 0.18, z, 1, 1, 1)
          continue
        }
        this.posts.push(x, 0.85, z, 1, 1, 1)
        this.bowls.push(x, 1.85, z, 1, 1, 1)
        const flicker = 1 + Math.sin(time * 13 + cell * 3 + side) * 0.12 + Math.sin(time * 7.3 + cell) * 0.08
        this.flames.push(x, 2.55, z, flicker, flicker * 1.15, flicker, '#ff7a1a')
        this.flames.push(x, 2.4, z, 0.6 * flicker, 0.8 * flicker, 0.6 * flicker, '#ffd35c')
        this.glows.push(x, 2.5, z + 0.2, 3.4 * flicker, 3.4 * flicker, 1, '#ff6a1a')
      }
    }
    this.curbs.end()
    this.posts.end()
    this.bowls.end()
    // Portes démoniaques (tous les 70 m) : deux piliers, un linteau à cornes, la plaque « 地獄 ».
    this.gatePillars.begin()
    this.gateBeams.begin()
    this.gateRunes.begin()
    this.horns.begin()
    this.plaques.begin()
    for (let cell = Math.floor((distance - BEHIND - 35) / 70); cell <= Math.floor((distance + AHEAD - 35) / 70); cell += 1) {
      const z = -(cell * 70 + 35 - distance)
      const pillarX = ROAD_HALF + 1.6
      for (const side of [-1, 1]) {
        this.gatePillars.push(side * pillarX, 3.9, z, 1, 1, 1)
        this.horns.push(side * (pillarX + 1.1), 11.7, z, 1, 1, 1, undefined, 0, 0, -side * 0.55)
        this.flames.push(side * pillarX, 11.3, z, 1.3, 1.4, 1.3, '#ff7a1a')
        this.glows.push(side * pillarX, 11.2, z + 0.3, 5, 5, 1, '#ff5a14')
      }
      this.gateBeams.push(0, 10.1, z, 1, 1, 1)
      this.gateBeams.push(0, 8.7, z, 0.86, 0.55, 0.8)
      this.gateRunes.push(0, 8.7, z + 0.55, 1, 1, 1)
      this.plaques.push(0, 10.1, z + 0.67, 1, 1, 1)
    }
    this.gatePillars.end()
    this.gateBeams.end()
    this.gateRunes.end()
    this.horns.end()
    this.plaques.end()
    this.flames.end()
    // Geysers de lave qui jaillissent par intermittence, loin de la chaussée.
    this.geysers.begin()
    this.blobs.begin()
    for (let cell = Math.floor((distance - BEHIND) / 26); cell <= Math.floor((distance + AHEAD) / 26); cell += 1) {
      const phase = (time * 0.35 + hash(cell, 51)) % 1
      if (phase > 0.45) continue
      const burst = Math.sin((phase / 0.45) * Math.PI)
      const side = hash(cell, 53) > 0.5 ? 1 : -1
      const x = side * (ROAD_HALF + 9 + hash(cell, 57) * 18)
      const z = -(cell * 26 + 13 - distance)
      const height = 3 + burst * (8 + hash(cell, 59) * 8)
      this.geysers.push(x, LAVA_LEVEL + height / 2, z, 1, height, 1)
      this.blobs.push(x, LAVA_LEVEL + height, z, 1.1 * burst + 0.3, 0.9 * burst + 0.3, 1.1 * burst + 0.3)
      for (let drop = 0; drop < 3; drop += 1) {
        const fall = (phase * 2.2 + drop / 3) % 1
        this.blobs.push(x + (drop - 1) * 1.4 * fall, LAVA_LEVEL + height * (1 - fall * fall) + 0.5, z + (drop % 2 ? 0.8 : -0.8) * fall, 0.28, 0.28, 0.28)
      }
      this.glows.push(x, LAVA_LEVEL + 1.5, z + 0.5, 8, 4, 1, '#ff6a14')
    }
    this.geysers.end()
    this.blobs.end()
    this.glows.end()
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
 * colonnettes (à passer en glissant) ; aux Enfers, des pics d'obsidienne autour d'un cœur
 * de magma, une auge de lave en flammes, une barre runique entre deux poteaux à épines. Une flèche dit quoi faire, comme sur terre.
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
  // Les Enfers.
  private readonly spike = new Batch(new THREE.ConeGeometry(0.6, 3.4, 5), toonMaterial('#ffffff', '#ff2a00', 0.12), 72, 0.03)
  private readonly core = new Batch(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: '#ff7a1a', toneMapped: false }), 24)
  private readonly trough = new Batch(rounded(1.9, 0.62, 1.05, 0.08), toonMaterial('#3a2622', '#ff2a00', 0.06), 24, 0.03)
  private readonly magma = new Batch(rounded(1.62, 0.08, 0.8, 0.03), new THREE.MeshBasicMaterial({ color: '#ff6a14', toneMapped: false }), 24)
  private readonly fire = new Batch(new THREE.ConeGeometry(0.22, 0.8, 7), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 96)
  private readonly bar = new Batch(rounded(2.3, 0.95, 0.42, 0.05), toonMaterial('#1e1418', '#ff2200', 0.05), 24, 0.03)
  private readonly rune = new Batch(rounded(2.0, 0.14, 0.46, 0.03), new THREE.MeshBasicMaterial({ color: '#ff4a14', toneMapped: false }), 24)
  private readonly prop = new Batch(new THREE.BoxGeometry(0.3, 3.8, 0.3), toonMaterial('#1e1418'), 48, 0.02)
  private readonly thorn = new Batch(new THREE.ConeGeometry(0.16, 0.55, 6), toonMaterial('#e6d6b8'), 48, 0.02)
  private readonly arrow = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    30,
  )
  private readonly batches: Batch[]

  constructor() {
    this.batches = [this.pillar, this.pillarCap, this.gold, this.block, this.band, this.puff, this.slab, this.slabTrim, this.post, this.spike, this.core, this.trough, this.magma, this.fire, this.bar, this.rune, this.prop, this.thorn, this.arrow]
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
        else this.under(object, x, z, near, run.t)
        // Flèches : vers la voie libre (mur), vers le bas (à passer en glissant).
        if (ahead > 2 && ahead < 70) {
          if (object.kind === 'gate') this.arrow.push(x, 0.75 - bob * 0.5, near + 0.4, 0.9, 0.9, 1, realm === 'sky' ? '#4fb8ff' : '#ffd35c')
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

  private under(object: TrackObject, x: number, z: number, near: number, time: number): void {
    if (object.kind === 'wall') {
      // Pics d'obsidienne autour d'un cœur de magma qui bat.
      const hue = object.variant % 3 === 0 ? '#2a1a1e' : object.variant % 3 === 1 ? '#3a1614' : '#24161e'
      this.spike.push(x, 1.7, z, 1, 1, 1, hue)
      this.spike.push(x - 0.6, 1.1, z + 0.2, 0.7, 0.68, 0.7, hue, 0, 0, 0.35)
      this.spike.push(x + 0.62, 1.0, z - 0.1, 0.65, 0.62, 0.65, hue, 0, 0, -0.4)
      const beat = 1 + Math.sin(time * 6 + object.id) * 0.12
      this.core.push(x, 0.45, z + 0.35, beat, beat, beat)
    } else if (object.kind === 'low') {
      // Auge de pierre pleine de lave, des flammes qui en sortent : à sauter.
      this.trough.push(x, 0.31, z, 1, 1, 1)
      this.magma.push(x, 0.63, z, 1, 1, 1)
      for (let index = 0; index < 3; index += 1) {
        const flicker = 0.8 + Math.abs(Math.sin(time * 12 + index * 2.1 + object.id)) * 0.5
        this.fire.push(x + (index - 1) * 0.55, 0.65 + 0.4 * flicker, z, flicker * 0.9, flicker, flicker * 0.9, index === 1 ? '#ffd35c' : '#ff6a1a')
      }
    } else {
      // Barre d'obsidienne gravée d'une rune de feu, entre deux poteaux à épines : on glisse dessous.
      this.bar.push(x, 1.65, near - 0.25, 1, 1, 1)
      this.rune.push(x, 1.65, near - 0.25, 1, 1, 1)
      for (const side of [-1, 1]) {
        this.prop.push(x + side * 1.05, 1.9, near - 0.25, 1, 1, 1)
        this.thorn.push(x + side * 1.05, 4.05, near - 0.25, 1, 1, 1)
      }
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
 * cornes, arche de braise, enseigne « 地獄 », chevrons au sol qui y mènent).
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
  private readonly rock = new Batch(rounded(2.9, 5.6, 4.2, 0.4), toonMaterial('#3b2522', '#ff2a00', 0.08), 4, 0.04)
  private readonly mouth = new Batch(new THREE.PlaneGeometry(1.95, 2.9), new THREE.MeshBasicMaterial({ color: '#1a0200' }), 4)
  private readonly arch = new Batch(new THREE.TorusGeometry(1.08, 0.13, 8, 24, Math.PI), new THREE.MeshBasicMaterial({ color: '#ff4a14', toneMapped: false }), 4)
  private readonly haze = new Batch(new THREE.PlaneGeometry(1.9, 2.8), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff3a00', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 4)
  private readonly horn = new Batch(new THREE.ConeGeometry(0.3, 1.7, 8), toonMaterial('#e6d6b8', '#ff6a2a', 0.08), 8, 0.03)
  private readonly sign = new Batch(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: plaqueTexture(), toneMapped: false }), 4)
  private readonly arrow = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    16,
  )
  private readonly batches: Batch[]

  constructor() {
    this.batches = [this.disc, this.ring, this.beam, this.rock, this.mouth, this.arch, this.haze, this.horn, this.sign, this.arrow]
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
          for (const side of [-1, 1]) this.horn.push(x + side * 1.15, 6.2, z + 1, 1, 1, 1, undefined, 0, 0, -side * 0.45)
          // Des chevrons au sol mènent dans le tunnel.
          if (ahead > 3 && ahead < 90) {
            for (let index = 0; index < 3; index += 1) {
              const glow = 0.6 + 0.4 * Math.sin(time * 6 - index)
              this.arrow.push(x, 0.04, near + 2 + index * 1.6, 1.4 * glow, 1.4 * glow, 1, '#ff5a1a', -Math.PI / 2, 0, Math.PI)
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
