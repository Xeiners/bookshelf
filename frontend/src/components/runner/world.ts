import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LANE_WIDTH } from '../../lib/runner/constants'
import type { RunState } from '../../lib/runner/engine'
import { PropBatch, type RunnerAssets } from './assets'
import { uploadUsed } from './batch'
import { BIOME_LENGTH, BIOME_STYLE, biomeAt, biomeBlend, mixColor, type Biome, type BiomeStyle } from './biomes'
import type { ScenePart } from './parts'
import { canvasTexture } from './toon'

/*
 * Le monde du Manga Runner : une petite ligne de chemin de fer qui traverse la
 * campagne japonaise, comme dans les films d'animation. Une vraie voie (ballast, traverses
 * de bois, rails d'acier, poteaux et câbles), des prés qui ondulent puis montent en
 * collines, une végétation dessinée par un artiste (Stylized Nature MegaKit de Quaternius,
 * CC0) qui ondule au vent, un ciel peint en direct (dégradé, soleil, nuages, étoiles) et
 * trois rangées de montagnes dans la brume, mont Fuji compris.
 *
 * Tout est déterministe : le paysage d'un endroit (`s`, en mètres depuis le départ) se
 * tire de `s` lui-même ; chaque image, on ne fait que poser les instances visibles. Le sol
 * et la végétation partagent la même fonction de relief (`groundHeight`).
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Pseudo-hasard reproductible, de 0 à 1. */
const hash = (a: number, b = 0) => {
  const value = Math.sin(a * 127.1 + b * 311.7 + 74.7) * 43758.5453
  return value - Math.floor(value)
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Points || node instanceof THREE.InstancedMesh) {
      node.geometry.dispose()
      for (const material of [node.material].flat()) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    }
  })
}

/**
 * Champ de vision horizontal, tenu à jour par la caméra : demi-ouverture (tangente) et
 * position. En portrait, il est étroit ; on ne pose pas ce qui en sort.
 */
export const view = { spread: 0.6, x: 0, z: 6.8 }
const visible = (x: number, z: number, radius: number) => {
  const ahead = view.z - z
  return ahead > -radius && Math.abs(x - view.x) < Math.max(0, ahead) * view.spread + radius
}

/** Largeur du ballast (m), un peu plus que les trois voies. */
export const TRACK_WIDTH = LANE_WIDTH * 3 + 1.2
/** Le monde s'étend de 16 m derrière la caméra à 190 m devant. */
const BEHIND = 16
const AHEAD = 190

/**
 * Hauteur du sol (m) à l'écart `x` de la voie et à la distance `s` : talus plat le long du
 * ballast, prés qui ondulent, puis collines au loin. Somme de sinus : la même formule pose
 * le sol et la végétation, sans table.
 */
export function groundHeight(x: number, s: number): number {
  const side = Math.abs(x)
  const wave = Math.sin(s * 0.021 + x * 0.043) + 1.4 * Math.sin(s * 0.0083 - x * 0.017 + 1.7) + 0.35 * Math.sin(s * 0.047 + x * 0.11 + 0.6)
  return -0.42 + smoothstep(6.5, 24, side) * (0.9 + wave * 0.75) + smoothstep(32, 95, side) * (7 + wave * 5.5)
}

/* ---- Vent ---------------------------------------------------------------------------- */

/** Horloge du vent, partagée par tous les feuillages. */
const wind = { value: 0 }

/**
 * Matériau léger (Lambert) d'un modèle du paysage. Feuillages, herbes et fleurs ondulent au
 * vent (décalage selon la hauteur, phase selon la position dans le monde) et rayonnent
 * un peu de leur couleur, comme la lumière qui les traverse.
 */
function natureMaterial(source: THREE.Material, cache: Map<THREE.Material, THREE.Material>): THREE.Material {
  const known = cache.get(source)
  if (known) return known
  const standard = source as THREE.MeshStandardMaterial
  const leafy = /Leaves|Leaf|Grass|Flowers/.test(source.name)
  const material = new THREE.MeshLambertMaterial({
    name: source.name,
    map: standard.map ?? null,
    color: standard.color ?? new THREE.Color('#ffffff'),
    alphaTest: standard.alphaTest > 0 ? standard.alphaTest : leafy ? 0.5 : 0,
    side: leafy ? THREE.DoubleSide : standard.side,
    emissive: leafy ? new THREE.Color('#ffffff') : new THREE.Color('#000000'),
    emissiveMap: leafy ? (standard.map ?? null) : null,
    emissiveIntensity: leafy ? 0.16 : 0,
  })
  if (leafy) {
    const strength = /Grass|Flowers/.test(source.name) ? 0.09 : 0.012
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind
      // i18n-ignore (code GLSL)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace(
        '#include <begin_vertex>',
        // i18n-ignore (code GLSL)
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec4 windAt = instanceMatrix * vec4(position, 1.0);
        #else
          vec4 windAt = vec4(position, 1.0);
        #endif
        float gust = sin(uWind * 1.7 + windAt.x * 0.31 + windAt.z * 0.23) + 0.45 * sin(uWind * 3.1 + windAt.z * 0.57);
        float bend = max(position.y, 0.0) * ${strength.toFixed(3)};
        transformed.x += gust * bend;
        transformed.z += gust * bend * 0.5;`,
      )
    }
    material.customProgramCacheKey = () => `nature-wind-${strength}`
  }
  cache.set(source, material)
  return material
}

/* ---- Ciel ---------------------------------------------------------------------------- */

// i18n-ignore (code GLSL)
const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`
// i18n-ignore (code GLSL)
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDirection;
  uniform float uGlow;
  uniform vec3 uCloud;
  uniform vec3 uCloudShade;
  uniform float uCover;
  uniform float uStars;
  uniform float uTime;
  varying vec3 vDirection;

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float up = direction.y;
    vec3 color = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.5, up), 0.5));
    float toward = max(dot(direction, uSunDirection), 0.0);
    // Halo et disque du soleil (ou de la lune).
    color += uSun * (pow(toward, 5.0) * 0.22 + pow(toward, 48.0) * 0.55) * uGlow;
    color = mix(color, uSun * 1.25 + 0.2, smoothstep(0.99955, 0.9998, toward));
    // Nuages : bruit fractal projeté sur une voûte, éclairés du côté du soleil.
    if (up > 0.0) {
      vec2 at = direction.xz / (up + 0.18) * 1.15 + vec2(uTime * 0.006, uTime * 0.002);
      float shape = fbm(at * 1.3);
      float cover = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, shape) * smoothstep(0.0, 0.12, up);
      float light = fbm(at * 1.3 - uSunDirection.xz * 0.06);
      float lit = clamp(0.55 + (shape - light) * 4.0 + pow(toward, 3.0) * 0.6, 0.0, 1.0);
      vec3 cloud = mix(uCloudShade, uCloud, lit);
      cloud += uSun * pow(toward, 8.0) * 0.35 * uGlow;
      color = mix(color, cloud, cover * 0.95);
    }
    // Étoiles, la nuit : une par case du ciel, de temps en temps, qui scintillent.
    if (uStars > 0.0 && up > 0.0) {
      vec3 cell = floor(direction * 210.0);
      float seed = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float star = step(0.992, seed) * smoothstep(0.42, 0.0, length(fract(direction * 210.0) - 0.5));
      color += vec3(star) * uStars * smoothstep(0.04, 0.35, up) * (0.55 + 0.45 * sin(uTime * 2.3 + seed * 40.0));
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// i18n-ignore (code GLSL)
const MOUNTAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHorizon;
  uniform vec3 uSnow;
  uniform vec3 uSun;
  uniform float uHaze;
  uniform float uSnowLine;
  varying float vHeight;
  varying float vSlope;
  varying float vX;
  void main() {
    float snowLine = uSnowLine + sin(vX * 0.09) * 5.0 + sin(vX * 0.23 + 1.3) * 3.0;
    // Plus clair au pied (brume), neige au-dessus d'une ligne, flanc éclairé par le soleil.
    vec3 color = mix(uColor, uHorizon, uHaze + (1.0 - smoothstep(0.0, 70.0, vHeight)) * 0.45);
    color = mix(color, mix(uSnow, uHorizon, uHaze * 0.6), smoothstep(snowLine, snowLine + 3.0, vHeight));
    color += uSun * vSlope * 0.05;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
// i18n-ignore (code GLSL)
const MOUNTAIN_VERTEX = /* glsl */ `
  attribute float slope;
  varying float vHeight;
  varying float vSlope;
  varying float vX;
  void main() {
    vHeight = position.y;
    vX = position.x;
    vSlope = slope;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Une rangée de montagnes : un rideau dont le bord haut suit une ligne de crêtes. */
function ridgeGeometry(layer: number): THREE.BufferGeometry {
  const segments = 220
  const width = 1500 + layer * 300
  const positions: number[] = []
  const slopes: number[] = []
  const indices: number[] = []
  const height = (x: number) => {
    const ridge =
      Math.abs(Math.sin(x * 0.0061 + layer * 1.9)) * 46 +
      Math.abs(Math.sin(x * 0.0147 + layer * 4.1)) * 22 +
      Math.sin(x * 0.041 + layer) * 6 +
      Math.sin(x * 0.11 + layer * 2.3) * 2.5
    let y = 18 + ridge * (0.65 + layer * 0.25)
    // Le Fuji, seul, au fond : un cône aux flancs concaves, sommet tronqué.
    if (layer === 2) {
      const from = Math.abs(x - 60) / 230
      y = Math.max(y, 118 * Math.pow(Math.max(0, 1 - from), 1.6) * (from < 0.06 ? 0.985 + from * 0.25 : 1))
    }
    return y
  }
  for (let index = 0; index <= segments; index += 1) {
    const x = -width / 2 + (index / segments) * width
    const top = height(x)
    const slope = (height(x + 4) - height(x - 4)) / 8
    positions.push(x, top, 0, x, -30, 0)
    slopes.push(-slope, 0)
    if (index < segments) {
      const at = index * 2
      indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('slope', new THREE.Float32BufferAttribute(slopes, 1))
  geometry.setIndex(indices)
  return geometry
}

/** Ciel (dôme peint en direct) et trois rangées de montagnes, de plus en plus pâles. */
export class SkyPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly sky: THREE.ShaderMaterial
  private readonly mountains: THREE.ShaderMaterial[] = []
  private readonly sunDirection = new THREE.Vector3()

  constructor() {
    const color = () => ({ value: new THREE.Color() })
    this.sky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uZenith: color(),
        uHorizon: color(),
        uSun: color(),
        uSunDirection: { value: this.sunDirection },
        uGlow: { value: 1 },
        uCloud: color(),
        uCloudShade: color(),
        uCover: { value: 0.4 },
        uStars: { value: 0 },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), this.sky)
    dome.renderOrder = -10
    dome.frustumCulled = false
    this.object.add(dome)
    for (let layer = 0; layer < 3; layer += 1) {
      const material = new THREE.ShaderMaterial({
        vertexShader: MOUNTAIN_VERTEX,
        fragmentShader: MOUNTAIN_FRAGMENT,
        uniforms: {
          uColor: color(),
          uHorizon: color(),
          uSnow: color(),
          uSun: color(),
          uHaze: { value: 0.18 + layer * 0.2 },
          uSnowLine: { value: layer === 2 ? 84 : 74 + layer * 10 },
        },
        fog: false,
      })
      const mesh = new THREE.Mesh(ridgeGeometry(layer), material)
      mesh.position.set(layer * 40 - 40, -6, -360 - layer * 110)
      mesh.renderOrder = -9 + layer
      mesh.frustumCulled = false
      this.mountains.push(material)
      this.object.add(mesh)
    }
  }

  update(run: RunState, time: number): void {
    const { from, to, weight } = biomeBlend(run.distance)
    const a = BIOME_STYLE[from]
    const b = BIOME_STYLE[to]
    const lerp = (x: number, y: number) => x + (y - x) * weight
    const uniforms = this.sky.uniforms
    mixColor(uniforms.uZenith!.value, a.zenith, b.zenith, weight)
    mixColor(uniforms.uHorizon!.value, a.horizon, b.horizon, weight)
    mixColor(uniforms.uSun!.value, a.sun, b.sun, weight)
    mixColor(uniforms.uCloud!.value, a.cloud, b.cloud, weight)
    mixColor(uniforms.uCloudShade!.value, a.cloudShade, b.cloudShade, weight)
    uniforms.uGlow!.value = lerp(a.sunGlow, b.sunGlow)
    uniforms.uCover!.value = lerp(a.cloudCover, b.cloudCover)
    uniforms.uStars!.value = lerp(a.stars, b.stars)
    uniforms.uTime!.value = time
    sunDirectionOf(this.sunDirection, a, b, weight)
    this.mountains.forEach((material, layer) => {
      const values = material.uniforms
      mixColor(values.uColor!.value, a.mountains[layer]!, b.mountains[layer]!, weight)
      mixColor(values.uHorizon!.value, a.horizon, b.horizon, weight)
      mixColor(values.uSnow!.value, a.snow, b.snow, weight)
      mixColor(values.uSun!.value, a.sun, b.sun, weight)
    })
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/** Direction du soleil (vers lui), mélangée entre deux biomes. */
function sunDirectionOf(target: THREE.Vector3, a: BiomeStyle, b: BiomeStyle, weight: number): THREE.Vector3 {
  const elevation = a.sunElevation + (b.sunElevation - a.sunElevation) * weight
  const azimuth = a.sunAzimuth + (b.sunAzimuth - a.sunAzimuth) * weight
  return target.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).normalize()
}

/* ---- Sol ----------------------------------------------------------------------------- */

/** Colonnes du sol (m) : serrées près de la voie, larges au loin. */
const COLUMNS = (() => {
  const half = [5.2, 5.9, 6.7, 7.6, 8.7, 10, 11.6, 13.5, 15.8, 18.5, 21.7, 25.5, 30, 36, 43, 52, 63, 76, 92, 112, 140]
  return [...half.map((x) => -x).reverse(), ...half]
})()
const ROW = 2
const ROWS = Math.ceil((AHEAD + BEHIND) / ROW) + 2

// i18n-ignore (code GLSL)
const TERRAIN_COMMON = /* glsl */ `
  uniform float uDistance;
  uniform float uBoundary;
  uniform float uUvOffset;
  uniform vec3 uGrassA;
  uniform vec3 uDryA;
  uniform vec3 uDirtA;
  uniform vec3 uGrassB;
  uniform vec3 uDryB;
  uniform vec3 uDirtB;
  varying vec3 vTerrain;
  // Même relief que groundHeight() (végétation) : à garder identiques.
  float groundH(float x, float s) {
    float side = abs(x);
    float wave = sin(s * 0.021 + x * 0.043) + 1.4 * sin(s * 0.0083 - x * 0.017 + 1.7) + 0.35 * sin(s * 0.047 + x * 0.11 + 0.6);
    return -0.42 + smoothstep(6.5, 24.0, side) * (0.9 + wave * 0.75) + smoothstep(32.0, 95.0, side) * (7.0 + wave * 5.5);
  }
`
// i18n-ignore (code GLSL)
const TERRAIN_NORMAL = /* glsl */ `
  #include <beginnormal_vertex>
  float terrainS = uDistance - position.z;
  float slopeX = groundH(position.x + 0.5, terrainS) - groundH(position.x - 0.5, terrainS);
  float slopeS = groundH(position.x, terrainS + 0.5) - groundH(position.x, terrainS - 0.5);
  objectNormal = normalize(vec3(-slopeX, 1.0, slopeS));
`
// i18n-ignore (code GLSL)
const TERRAIN_POSITION = /* glsl */ `
  vec3 transformed = vec3(position.x, groundH(position.x, terrainS), position.z);
  // Herbe grasse dans les creux, sèche sur les bosses ; terre le long du talus ; fondu de biome.
  float into = smoothstep(uBoundary - 90.0, uBoundary, terrainS);
  vec3 grass = mix(uGrassA, uGrassB, into);
  vec3 dry = mix(uDryA, uDryB, into);
  vec3 dirt = mix(uDirtA, uDirtB, into);
  float patchy = 0.5 + 0.5 * sin(terrainS * 0.09 + position.x * 0.21) * sin(terrainS * 0.033 - position.x * 0.07);
  vec3 ground = mix(grass, dry, clamp(patchy * 0.7 + (transformed.y + 0.4) * 0.05, 0.0, 1.0));
  vTerrain = mix(ground, dirt, 1.0 - smoothstep(5.4, 6.6, abs(position.x)));
`

/**
 * Prés et collines de part et d'autre de la voie. La grille ne bouge pas : la carte
 * graphique y lit le relief et les couleurs à la distance courante (rien n'est recalculé
 * par le processeur, quelle que soit la vitesse).
 */
export class TerrainPart implements ScenePart {
  readonly object: THREE.Mesh
  private readonly texture: THREE.CanvasTexture
  private readonly uniforms = {
    uDistance: { value: 0 },
    uBoundary: { value: BIOME_LENGTH },
    uUvOffset: { value: 0 },
    uGrassA: { value: new THREE.Color() },
    uDryA: { value: new THREE.Color() },
    uDirtA: { value: new THREE.Color() },
    uGrassB: { value: new THREE.Color() },
    uDryB: { value: new THREE.Color() },
    uDirtB: { value: new THREE.Color() },
  }
  private biome = -1

  constructor() {
    const geometry = new THREE.BufferGeometry()
    const positions: number[] = []
    for (let row = 0; row < ROWS; row += 1) for (const x of COLUMNS) positions.push(x, 0, BEHIND - row * ROW)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
    const indices: number[] = []
    const half = COLUMNS.length / 2
    for (let row = 0; row < ROWS - 1; row += 1) {
      for (let column = 0; column < COLUMNS.length - 1; column += 1) {
        // Pas de sol sous le ballast (entre les deux colonnes centrales).
        if (column === half - 1) continue
        const a = row * COLUMNS.length + column
        const b = a + COLUMNS.length
        indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
    geometry.setIndex(indices)
    this.texture = canvasTexture(256, 256, (context) => {
      // Herbe en gris clair (teintée par le sol) : touffes, brins, petites taches.
      context.fillStyle = '#d8d8d8'
      context.fillRect(0, 0, 256, 256)
      for (let index = 0; index < 2600; index += 1) {
        const shade = 150 + Math.floor(hash(index, 1) * 105)
        context.fillStyle = `rgb(${shade},${shade},${shade})`
        context.fillRect(hash(index, 2) * 256, hash(index, 3) * 256, 1.5, 3 + hash(index, 4) * 5)
      }
      for (let index = 0; index < 60; index += 1) {
        context.fillStyle = `rgba(255,255,255,${0.15 + hash(index, 6) * 0.2})`
        context.beginPath()
        context.ellipse(hash(index, 7) * 256, hash(index, 8) * 256, 6 + hash(index, 9) * 14, 4 + hash(index, 10) * 9, 0, 0, Math.PI * 2)
        context.fill()
      }
    })
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping
    const material = new THREE.MeshLambertMaterial({ map: this.texture })
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_COMMON}`)
        .replace('#include <beginnormal_vertex>', TERRAIN_NORMAL)
        .replace('#include <begin_vertex>', TERRAIN_POSITION)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2(position.x * 0.22, -position.z * 0.22 + uUvOffset);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrain;') // i18n-ignore (code GLSL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTerrain;')
    }
    material.customProgramCacheKey = () => 'runner-terrain'
    this.object = new THREE.Mesh(geometry, material)
    this.object.frustumCulled = false
  }

  update(run: RunState): void {
    const distance = run.distance
    const uniforms = this.uniforms
    uniforms.uDistance.value = distance
    uniforms.uUvOffset.value = (distance * 0.22) % 1
    // Couleurs du biome courant et du suivant, fondues avant la frontière.
    const index = Math.floor(Math.max(0, distance) / BIOME_LENGTH)
    if (index !== this.biome) {
      this.biome = index
      const from = BIOME_STYLE[biomeAt(index * BIOME_LENGTH)]
      const to = BIOME_STYLE[biomeAt((index + 1) * BIOME_LENGTH)]
      uniforms.uBoundary.value = (index + 1) * BIOME_LENGTH
      uniforms.uGrassA.value.set(from.grass)
      uniforms.uDryA.value.set(from.grassDry)
      uniforms.uDirtA.value.set(from.dirt)
      uniforms.uGrassB.value.set(to.grass)
      uniforms.uDryB.value.set(to.grassDry)
      uniforms.uDirtB.value.set(to.dirt)
    }
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Voie ferrée --------------------------------------------------------------------- */

const SLEEPER_GAP = 0.62
const POLE_GAP = 32
/** Profil d'un rail (m) : patin, âme, champignon. */
function railShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-0.07, 0)
  shape.lineTo(0.07, 0)
  shape.lineTo(0.07, 0.018)
  shape.lineTo(0.014, 0.03)
  shape.lineTo(0.014, 0.1)
  shape.lineTo(0.034, 0.108)
  shape.lineTo(0.034, 0.145)
  shape.lineTo(-0.034, 0.145)
  shape.lineTo(-0.034, 0.108)
  shape.lineTo(-0.014, 0.1)
  shape.lineTo(-0.014, 0.03)
  shape.lineTo(-0.07, 0.018)
  shape.closePath()
  return shape
}

/** Un poteau électrique en bois, sa traverse et ses isolateurs, et les câbles qui pendent jusqu'au suivant. */
function poleSpanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 9, 8)
  pole.translate(0, 4.5, 0)
  parts.push(pole)
  const arm = new THREE.BoxGeometry(1.6, 0.12, 0.12)
  arm.translate(0, 8.4, 0)
  parts.push(arm)
  for (const x of [-0.65, 0, 0.65]) {
    const insulator = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6)
    insulator.translate(x, 8.55, 0)
    parts.push(insulator)
    // Le câble, en chaînette, jusqu'au poteau suivant (vers l'avant, −z).
    const points: THREE.Vector3[] = []
    for (let step = 0; step <= 16; step += 1) {
      const t = step / 16
      points.push(new THREE.Vector3(x, 8.6 - Math.sin(t * Math.PI) * 0.75, -t * POLE_GAP))
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.018, 4, false))
  }
  return mergeGeometries(parts.map((part) => part.toNonIndexed()))!
}

/** Ballast de gravier, traverses de béton, rails d'acier, poteaux électriques en bois le long du talus. */
export class TrackPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly gravel: THREE.CanvasTexture
  private readonly ballast: THREE.MeshLambertMaterial
  private readonly sleepers: THREE.Group
  private readonly poles: THREE.Group

  constructor() {
    this.gravel = canvasTexture(512, 512, (context) => {
      context.fillStyle = '#b2aca6'
      context.fillRect(0, 0, 512, 512)
      for (let index = 0; index < 5200; index += 1) {
        const shade = 140 + Math.floor(hash(index, 11) * 80)
        const warm = Math.floor(hash(index, 12) * 14)
        context.fillStyle = `rgb(${shade + warm},${shade + warm * 0.6},${shade})`
        context.beginPath()
        context.ellipse(hash(index, 13) * 512, hash(index, 14) * 512, 2 + hash(index, 15) * 4.5, 1.5 + hash(index, 16) * 3.5, hash(index, 17) * 3, 0, Math.PI * 2)
        context.fill()
      }
      // Ombre et rouille sous chaque voie (le gravier y est plus sombre).
      for (const lane of [-1, 0, 1]) {
        const center = (0.5 + (lane * LANE_WIDTH) / TRACK_WIDTH) * 512
        const gradient = context.createLinearGradient(center - 60, 0, center + 60, 0)
        gradient.addColorStop(0, 'rgba(70,45,30,0)')
        gradient.addColorStop(0.5, 'rgba(70,45,30,0.28)')
        gradient.addColorStop(1, 'rgba(70,45,30,0)')
        context.fillStyle = gradient
        context.fillRect(center - 60, 0, 120, 512)
      }
    })
    this.gravel.wrapS = this.gravel.wrapT = THREE.RepeatWrapping

    // Ballast : plateau et talus, en une bande de long.
    const half = TRACK_WIDTH / 2
    const profile: [number, number][] = [
      [-half - 1.3, -0.48],
      [-half, -0.12],
      [half, -0.12],
      [half + 1.3, -0.48],
    ]
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (const [index, [x, y]] of profile.entries()) {
      for (const z of [BEHIND, -AHEAD - 10]) {
        positions.push(x, y, z)
        uvs.push((x + half) / TRACK_WIDTH, -z / 8)
      }
      if (index < profile.length - 1) {
        const a = index * 2
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    const bed = new THREE.BufferGeometry()
    bed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    bed.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    bed.setIndex(indices)
    bed.computeVertexNormals()
    this.ballast = new THREE.MeshLambertMaterial({ map: this.gravel })
    this.object.add(new THREE.Mesh(bed, this.ballast))

    // Traverses, en instances fixes : le groupe glisse d'un intervalle, en boucle.
    // Traverses de béton (comme sur les lignes JR) : grain, taches, attaches des rails.
    const concrete = canvasTexture(256, 64, (context) => {
      context.fillStyle = '#d6d2cb'
      context.fillRect(0, 0, 256, 64)
      for (let dot = 0; dot < 900; dot += 1) {
        const shade = 150 + Math.floor(hash(dot, 21) * 90)
        context.fillStyle = `rgba(${shade},${shade - 4},${shade - 10},0.5)`
        context.fillRect(hash(dot, 22) * 256, hash(dot, 23) * 64, 1.5, 1.5)
      }
      for (const u of [0.2, 0.8]) {
        context.fillStyle = 'rgba(60,55,50,0.85)'
        context.fillRect(u * 256 - 12, 14, 24, 36)
      }
    })
    const sleeperGeometry = new THREE.BoxGeometry(1.95, 0.13, 0.24)
    const perLane = Math.ceil((AHEAD + BEHIND + 10) / SLEEPER_GAP)
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, new THREE.MeshLambertMaterial({ map: concrete }), perLane * 3)
    const matrix = new THREE.Matrix4()
    const tint = new THREE.Color()
    let at = 0
    for (const lane of [-1, 0, 1]) {
      for (let index = 0; index < perLane; index += 1) {
        matrix.makeTranslation(lane * LANE_WIDTH, -0.07, BEHIND - index * SLEEPER_GAP)
        sleepers.setMatrixAt(at, matrix)
        sleepers.setColorAt(at, tint.setHSL(0.09, 0.06, 0.62 + hash(index, lane) * 0.12))
        at += 1
      }
    }
    sleepers.frustumCulled = false
    this.sleepers = new THREE.Group()
    this.sleepers.add(sleepers)
    this.object.add(this.sleepers)

    // Rails : six longs profilés d'acier, mats sur les flancs, brillants sur le dessus.
    const rail = new THREE.ExtrudeGeometry(railShape(), { depth: AHEAD + BEHIND + 10, bevelEnabled: false, steps: 1 })
    rail.translate(0, -0.005, -AHEAD - 10)
    const steel = new THREE.MeshPhongMaterial({ color: '#8f8a86', specular: '#ffffff', shininess: 90 })
    for (const lane of [-1, 0, 1]) {
      for (const side of [-0.57, 0.57]) {
        const mesh = new THREE.Mesh(rail, steel)
        mesh.position.set(lane * LANE_WIDTH + side, 0, 0)
        this.object.add(mesh)
      }
    }

    // Poteaux électriques en bois le long du talus gauche, câbles en chaînette.
    const poleCount = Math.ceil((AHEAD + BEHIND) / POLE_GAP) + 1
    const poles = new THREE.InstancedMesh(poleSpanGeometry(), new THREE.MeshLambertMaterial({ color: '#5b4636' }), poleCount)
    for (let index = 0; index < poleCount; index += 1) poles.setMatrixAt(index, matrix.makeTranslation(-(TRACK_WIDTH / 2 + 3.4), -0.5, BEHIND - index * POLE_GAP))
    poles.frustumCulled = false
    this.poles = new THREE.Group()
    this.poles.add(poles)
    this.object.add(this.poles)
  }

  update(run: RunState): void {
    const d = run.distance
    this.gravel.offset.y = (d / 8) % 1
    this.sleepers.position.z = d % SLEEPER_GAP
    this.poles.position.z = d % POLE_GAP
    const { from, to, weight } = biomeBlend(d)
    mixColor(this.ballast.color, BIOME_STYLE[from].ballast, BIOME_STYLE[to].ballast, weight)
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Végétation ---------------------------------------------------------------------- */

const CELL = 4

/** Ce qui pousse dans chaque biome : arbres près de la voie et au loin, sous-bois, fleurs, herbes. */
const FLORA: Record<Biome, { near: string[]; far: string[]; bushes: string[]; flowers: string[]; grass: string[]; tints: string[] }> = {
  sakura: {
    near: ['CherryBlossom_1', 'CherryBlossom_4', 'CherryBlossom_1', 'CommonTree_1', 'CherryBlossom_4', 'CommonTree_3'],
    far: ['CherryBlossom_4', 'CommonTree_1', 'CommonTree_5', 'CherryBlossom_1', 'Pine_4'],
    bushes: ['Bush_Common_Flowers', 'Bush_Large_Flowers', 'Bush_Common', 'Fern_2', 'Plant_2'],
    flowers: ['Flower_3_Group', 'Flower_4_Group', 'Flower_1_Group', 'Clover_1', 'Flower_7_Group'],
    grass: ['Grass_Common_Short', 'Grass_Wispy_Short', 'Grass_Common_Tall', 'Grass_Wide_Tall'],
    tints: ['#ffffff'],
  },
  autumn: {
    near: ['Birch_2', 'Birch_4', 'Birch_2', 'Pine_1', 'Birch_4', 'CommonTree_5'],
    far: ['Birch_2', 'Birch_4', 'Pine_4', 'Birch_2', 'Pine_1'],
    bushes: ['Bush_Large', 'Bush_Common', 'Fern_1', 'Plant_1_Big', 'Bush_Long_1'],
    flowers: ['Flower_7_Group', 'Flower_2_Group', 'Grass_Wheat', 'Mushroom_Common'],
    grass: ['Grass_Wheat', 'Grass_Wispy_Tall', 'Grass_Common_Short', 'Grass_Wispy_Short'],
    tints: ['#ffffff', '#ffe2b0', '#ffd09a', '#fff0c8'],
  },
  haunted: {
    near: ['Pine_1', 'DeadTree_1', 'Pine_4', 'GiantPine_1', 'DeadTree_3', 'Pine_1'],
    far: ['GiantPine_1', 'Pine_4', 'Pine_1', 'DeadTree_1', 'GiantPine_1'],
    bushes: ['Fern_1', 'Fern_2', 'Bush_Large', 'Plant_5', 'Bush_Common'],
    flowers: ['Mushroom_RedCap', 'Mushroom_Common', 'Clover_1', 'Plant_5'],
    grass: ['Grass_Wispy_Short', 'Grass_Common_Short', 'Grass_Wide_Tall', 'Grass_Wispy_Tall'],
    tints: ['#a9bce6', '#93a8d8', '#b8c6ee'],
  },
}
const ROCKS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Rock_Medium_4']
const BIG_ROCKS = ['Rock_Big_1', 'Rock_Big_2']
const PEBBLES = ['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3']
/** Échelle de chaque famille (les modèles sont à leur taille d'origine). */
const SCALE: Record<string, [number, number]> = {
  CherryBlossom: [0.62, 0.86],
  CommonTree: [0.95, 1.35],
  Birch: [0.72, 0.98],
  Pine: [1.0, 1.4],
  GiantPine: [0.72, 0.95],
  DeadTree: [0.6, 0.85],
  Bush: [0.55, 0.95],
  Fern: [0.18, 0.28],
  Plant: [0.45, 0.75],
  Clover: [0.6, 0.9],
  Flower: [0.45, 0.7],
  Grass: [0.32, 0.55],
  Mushroom: [0.35, 0.6],
  Rock: [0.35, 0.8],
  Pebble: [0.8, 1.4],
}
const family = (name: string) => name.split('_')[0]!

/**
 * La végétation : chaque case de 4 m, de chaque côté, tire (de sa position) ses herbes,
 * ses fleurs, son sous-bois et ses arbres, dans le biome de l'endroit. Une ombre douce au
 * pied des arbres et des buissons les pose sur le sol.
 */
export class NaturePart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly batches = new Map<string, PropBatch>()
  private readonly shadows: THREE.InstancedMesh
  private shadowCount = 0
  private readonly density: number
  private readonly tint = new THREE.Color()
  private readonly matrix = new THREE.Matrix4()

  constructor(assets: RunnerAssets, lite: boolean) {
    this.density = lite ? 0.55 : 1
    const cache = new Map<THREE.Material, THREE.Material>()
    const names = new Set<string>([...ROCKS, ...BIG_ROCKS, ...PEBBLES])
    for (const flora of Object.values(FLORA)) for (const list of [flora.near, flora.far, flora.bushes, flora.flowers, flora.grass]) list.forEach((name) => names.add(name))
    for (const name of names) {
      const kind = family(name)
      const max = kind === 'Grass' ? 420 : ['CherryBlossom', 'CommonTree', 'Birch', 'Pine', 'GiantPine', 'DeadTree'].includes(kind) ? 70 : 90
      const batch = new PropBatch(assets.nature.get(name), max, {
        material: (source) => natureMaterial(source, cache),
        tinted: (source) => /Leaves|Leaf/.test(source.name),
      })
      this.batches.set(name, batch)
      this.object.add(batch.group)
    }
    const blob = canvasTexture(64, 64, (context) => {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
      gradient.addColorStop(0, 'rgba(20,24,30,0.55)')
      gradient.addColorStop(0.6, 'rgba(20,24,30,0.22)')
      gradient.addColorStop(1, 'rgba(20,24,30,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 64, 64)
    })
    const plane = new THREE.PlaneGeometry(1, 1)
    plane.rotateX(-Math.PI / 2)
    this.shadows = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }),
      400,
    )
    this.shadows.frustumCulled = false
    this.shadows.renderOrder = 1
    this.object.add(this.shadows)
  }

  private shadow(x: number, y: number, z: number, radius: number): void {
    if (this.shadowCount >= 400) return
    this.matrix.makeScale(radius * 2, 1, radius * 2).setPosition(x, y + 0.04, z)
    this.shadows.setMatrixAt(this.shadowCount, this.matrix)
    this.shadowCount += 1
  }

  /** Pose un modèle au sol, à sa place dans le monde. */
  private plant(name: string, x: number, s: number, distance: number, seed: number, scale = 1, tints?: string[]): number {
    const batch = this.batches.get(name)
    if (!batch) return 0
    const [low, high] = SCALE[family(name)] ?? [1, 1]
    const size = (low + (high - low) * hash(seed, 31)) * scale
    // Hors du champ (rayon large : un arbre déborde de son pied) : rien à poser.
    if (!visible(x, distance - s, 2 + size * 6)) return 0
    const tint = tints && tints.length > 1 ? this.tint.set(tints[Math.floor(hash(seed, 37) * tints.length)]!) : tints ? this.tint.set(tints[0]!) : undefined
    batch.push(x, groundHeight(x, s) - 0.05, distance - s, size, hash(seed, 33) * Math.PI * 2, tint)
    return size
  }

  update(run: RunState, time: number): void {
    wind.value = time
    const distance = run.distance
    for (const batch of this.batches.values()) batch.begin()
    this.shadowCount = 0
    const density = this.density
    const first = Math.floor((distance - BEHIND) / CELL)
    const last = Math.ceil((distance + AHEAD) / CELL)
    for (let cell = first; cell <= last; cell += 1) {
      for (const side of [-1, 1]) {
        const seed = cell * 2 + (side > 0 ? 1 : 0)
        const base = cell * CELL
        const at = (k: number) => base + hash(seed, k) * CELL
        const biome = biomeAt(base)
        const flora = FLORA[biome]
        const pick = (list: string[], k: number) => list[Math.floor(hash(seed, k) * list.length)]!
        const near = Math.min(1, (base - distance + 30) / 40)
        // Herbes et fleurs sur le talus et le pré tout proche (les plus nombreuses, de près seulement).
        if (base - distance < 110) {
          for (let tuft = 0; tuft < 5; tuft += 1) {
            if (hash(seed, 40 + tuft) > density) continue
            this.plant(pick(flora.grass, 50 + tuft), side * (5.9 + hash(seed, 60 + tuft) * 6), at(70 + tuft), distance, seed * 7 + tuft)
          }
          if (hash(seed, 80) < 0.55 * density) this.plant(pick(flora.flowers, 81), side * (6.6 + hash(seed, 82) * 7), at(83), distance, seed * 11)
          if (hash(seed, 84) < 0.25 * density) this.plant(pick(PEBBLES, 85), side * (5.6 + hash(seed, 86) * 1.2), at(87), distance, seed * 13)
        }
        // Sous-bois : buissons, fougères, rochers.
        if (hash(seed, 90) < 0.6 * density) {
          const x = side * (8.5 + hash(seed, 91) * 9)
          const s = at(92)
          const size = this.plant(pick(flora.bushes, 93), x, s, distance, seed * 17, 1, biome === 'sakura' ? undefined : flora.tints)
          if (size > 0) this.shadow(x, groundHeight(x, s), distance - s, 1.3 * size + 0.4)
        }
        if (hash(seed, 94) < 0.14 * density) {
          const x = side * (9 + hash(seed, 95) * 14)
          this.plant(pick(ROCKS, 96), x, at(97), distance, seed * 19)
        }
        if (hash(seed, 98) < 0.04) this.plant(pick(BIG_ROCKS, 99), side * (22 + hash(seed, 100) * 20), at(101), distance, seed * 23)
        // Arbres : une rangée qui encadre la voie, puis des bosquets dans les prés et sur les collines.
        if (hash(seed, 110) < 0.42 * Math.max(0.6, density)) {
          const x = side * (11.5 + hash(seed, 111) * 7)
          const s = at(112)
          const size = this.plant(pick(flora.near, 113), x, s, distance, seed * 29, 1, flora.tints)
          if (size > 0) this.shadow(x, groundHeight(x, s), distance - s, 3.4 * size)
        }
        if (hash(seed, 120) < 0.45 * density * near + 0.12) {
          const x = side * (20 + hash(seed, 121) * 26)
          this.plant(pick(flora.far, 122), x, at(123), distance, seed * 31, 1.1, flora.tints)
        }
        if (hash(seed, 130) < 0.4 * density) {
          const x = side * (48 + hash(seed, 131) * 55)
          this.plant(pick(flora.far, 132), x, at(133), distance, seed * 37, 1.3, flora.tints)
        }
      }
    }
    for (const batch of this.batches.values()) batch.end()
    this.shadows.count = this.shadowCount
    uploadUsed(this.shadows.instanceMatrix, this.shadowCount * 16)
  }

  dispose(): void {
    const materials = new Set<THREE.Material>()
    this.object.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) {
        for (const material of [node.material].flat()) materials.add(material)
        node.dispose()
      }
    })
    for (const material of materials) material.dispose()
    this.shadows.geometry.dispose()
  }
}

/* ---- Pétales, feuilles, lucioles ------------------------------------------------------ */

/** Pétales de sakura, feuilles d'automne ou lucioles : ils tourbillonnent et filent vers la caméra. */
export class PetalsPart implements ScenePart {
  readonly object: THREE.Points
  private readonly positions: Float32Array
  private readonly count: number

  constructor(count = 260) {
    this.count = count
    this.positions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      this.positions[index * 3] = (hash(index) - 0.5) * 34
      this.positions[index * 3 + 1] = hash(index, 50) * 14
      this.positions[index * 3 + 2] = -hash(index, 99) * 110
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    const texture = canvasTexture(64, 64, (context) => {
      const petal = context.createRadialGradient(28, 30, 2, 32, 32, 26)
      petal.addColorStop(0, '#ffffff')
      petal.addColorStop(1, '#e8e8e8')
      context.fillStyle = petal
      context.beginPath()
      context.moveTo(32, 6)
      context.bezierCurveTo(56, 20, 52, 50, 32, 58)
      context.bezierCurveTo(12, 50, 8, 20, 26, 8)
      context.lineTo(32, 14)
      context.closePath()
      context.fill()
    })
    this.object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.34, map: texture, transparent: true, alphaTest: 0.2, depthWrite: false }))
    this.object.frustumCulled = false
  }

  update(run: RunState, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const speed = run.over ? 0 : run.speed
    const positions = this.positions
    const { from, to, weight } = biomeBlend(run.distance)
    const material = this.object.material as THREE.PointsMaterial
    mixColor(material.color, BIOME_STYLE[from].particles, BIOME_STYLE[to].particles, weight)
    const night = (from === 'haunted' ? 1 - weight : 0) + (to === 'haunted' ? weight : 0)
    material.blending = night > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending
    material.size = 0.34 - night * 0.16
    for (let index = 0; index < this.count; index += 1) {
      const at = index * 3
      // La nuit, les lucioles flottent et clignotent au lieu de tomber.
      const fall = night > 0.5 ? Math.sin(time * 1.7 + index) * 0.3 : 0.5 + (index % 5) * 0.14
      positions[at] = positions[at]! + Math.sin(time * 1.3 + index) * dt * 0.9
      positions[at + 1] = positions[at + 1]! - dt * fall
      positions[at + 2] = positions[at + 2]! + dt * (speed * 0.9 + Math.cos(time + index) * 0.4)
      if (positions[at + 2]! > 8 || positions[at + 1]! < 0.2) {
        positions[at] = (Math.random() - 0.5) * 34
        positions[at + 1] = night > 0.5 ? 0.6 + Math.random() * 4 : 5 + Math.random() * 10
        positions[at + 2] = -70 - Math.random() * 40
      }
    }
    this.object.geometry.attributes.position!.needsUpdate = true
  }

  dispose(): void {
    disposeTree(this.object)
  }
}

/* ---- Lumière et brume ---------------------------------------------------------------- */

/** Lumière du ciel et du sol, soleil (ou lune) orienté selon le biome, brume couleur d'horizon. */
export class EnvironmentPart {
  readonly object = new THREE.Group()
  private readonly hemisphere = new THREE.HemisphereLight('#ffffff', '#ffffff', 1)
  private readonly sun = new THREE.DirectionalLight('#ffffff', 1)
  private readonly color = new THREE.Color()
  private readonly direction = new THREE.Vector3()

  constructor() {
    this.object.add(this.hemisphere, this.sun, this.sun.target)
  }

  update(run: RunState, scene: THREE.Scene): void {
    const { from, to, weight } = biomeBlend(run.distance)
    const a = BIOME_STYLE[from]
    const b = BIOME_STYLE[to]
    mixColor(this.hemisphere.color, a.hemiSky, b.hemiSky, weight)
    mixColor(this.hemisphere.groundColor, a.hemiGround, b.hemiGround, weight)
    this.hemisphere.intensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * weight
    mixColor(this.sun.color, a.sun, b.sun, weight)
    this.sun.intensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * weight
    sunDirectionOf(this.direction, a, b, weight)
    this.sun.position.copy(this.direction).multiplyScalar(60)
    mixColor(this.color, a.horizon, b.horizon, weight)
    if (scene.background instanceof THREE.Color) scene.background.copy(this.color)
    else scene.background = this.color.clone()
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(this.color)
      scene.fog.near = a.fogNear + (b.fogNear - a.fogNear) * weight
      scene.fog.far = a.fogFar + (b.fogFar - a.fogFar) * weight
    }
  }

  dispose(): void {
    this.hemisphere.dispose()
    this.sun.dispose()
  }
}
