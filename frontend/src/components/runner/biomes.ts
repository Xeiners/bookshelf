import * as THREE from 'three'
import type { TrackObject } from '../../lib/runner/engine'

/*
 * Les décors du Manga Runner se succèdent au fil de la course, comme le long d'une petite
 * ligne de campagne japonaise : la vallée des cerisiers au printemps, la forêt de
 * bouleaux d'automne, puis la forêt de pins au clair de lune, et l'on recommence. Chaque
 * élément du paysage prend le biome de l'endroit où il pousse (pas celui du coureur) :
 * le pays change devant lui. Le ciel, la brume et la lumière glissent d'un biome à
 * l'autre sur les derniers mètres.
 */

export const BIOMES = ['sakura', 'autumn', 'haunted'] as const
export type Biome = (typeof BIOMES)[number]

/** Longueur d'un biome (m), et de la transition de lumière à sa fin. */
export const BIOME_LENGTH = 650
const BLEND = 90

export const biomeAt = (s: number): Biome => BIOMES[Math.floor(Math.max(0, s) / BIOME_LENGTH) % BIOMES.length]!

export interface BiomeStyle {
  /** Ciel : zénith, horizon ; la brume et le fond prennent l'horizon. */
  zenith: string
  horizon: string
  fogNear: number
  fogFar: number
  /** Soleil (ou lune) : couleur, intensité, hauteur et cap (radians), éclat du disque. */
  sun: string
  sunIntensity: number
  sunElevation: number
  sunAzimuth: number
  sunGlow: number
  /** Nuages : couleur éclairée, ombre, couverture (0 à 1). */
  cloud: string
  cloudShade: string
  cloudCover: number
  /** Étoiles (nuit). */
  stars: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  /** Montagnes, de la plus proche à la plus lointaine ; neige des sommets. */
  mountains: readonly [string, string, string]
  snow: string
  /** Herbe : grasse, sèche (sommets, bords), et terre du talus. */
  grass: string
  grassDry: string
  dirt: string
  /** Ballast de la voie. */
  ballast: string
  /** Teinte des feuillages (multipliée) ; pétales, feuilles mortes ou lucioles. */
  foliage: string
  particles: string
}

export const BIOME_STYLE: Record<Biome, BiomeStyle> = {
  sakura: {
    zenith: '#2f74ea',
    horizon: '#e4e9f6',
    fogNear: 60,
    fogFar: 230,
    sun: '#fff0d8',
    sunIntensity: 2.4,
    sunElevation: 0.42,
    sunAzimuth: 0.55,
    sunGlow: 1,
    cloud: '#ffffff',
    cloudShade: '#b9b3d9',
    cloudCover: 0.32,
    stars: 0,
    hemiSky: '#d8e8ff',
    hemiGround: '#8a9a5a',
    hemiIntensity: 1.25,
    mountains: ['#7f93b8', '#9aaccb', '#b9c4dc'],
    snow: '#fbfbff',
    grass: '#6fae3f',
    grassDry: '#b8cc5c',
    dirt: '#9a7a58',
    ballast: '#a39c98',
    foliage: '#ffffff',
    particles: '#ffc1d6',
  },
  autumn: {
    zenith: '#3f6fb9',
    horizon: '#f7c98e',
    fogNear: 40,
    fogFar: 190,
    sun: '#ffc27a',
    sunIntensity: 2.6,
    sunElevation: 0.2,
    sunAzimuth: -0.6,
    sunGlow: 1.6,
    cloud: '#fff1df',
    cloudShade: '#c98d73',
    cloudCover: 0.4,
    stars: 0,
    hemiSky: '#ffe2bd',
    hemiGround: '#7a5a34',
    hemiIntensity: 1.15,
    mountains: ['#8a6f86', '#a8879a', '#cfa9a6'],
    snow: '#fff2e6',
    grass: '#a39437',
    grassDry: '#d9a548',
    dirt: '#8c6440',
    ballast: '#a6968a',
    foliage: '#ffb070',
    particles: '#ff9d3c',
  },
  haunted: {
    zenith: '#070c24',
    horizon: '#2d3d6e',
    fogNear: 25,
    fogFar: 150,
    sun: '#9fb4ff',
    sunIntensity: 1.1,
    sunElevation: 0.5,
    sunAzimuth: -0.35,
    sunGlow: 0.55,
    cloud: '#3c4c80',
    cloudShade: '#141a38',
    cloudCover: 0.3,
    stars: 1,
    hemiSky: '#8fa2ea',
    hemiGround: '#2a3352',
    hemiIntensity: 1.1,
    mountains: ['#1c2547', '#25305a', '#34416e'],
    snow: '#c9d4ff',
    grass: '#3d5f5c',
    grassDry: '#577570',
    dirt: '#3a3440',
    ballast: '#6c7088',
    foliage: '#9fb3d9',
    particles: '#c8ff7a',
  },
}

/** Où en est la lumière à `s` : le biome courant, le suivant, et la part du suivant (0 à 1). */
export function biomeBlend(s: number): { from: Biome; to: Biome; weight: number } {
  const from = biomeAt(s)
  const to = biomeAt(s + BIOME_LENGTH)
  const into = Math.max(0, s) % BIOME_LENGTH
  const weight = Math.min(1, Math.max(0, (into - (BIOME_LENGTH - BLEND)) / BLEND))
  return { from, to, weight: weight * weight * (3 - 2 * weight) }
}

const mixA = new THREE.Color()
const mixB = new THREE.Color()
/** Mélange deux couleurs du style, sans allocation. */
export function mixColor(target: THREE.Color, a: string, b: string, weight: number): THREE.Color {
  mixA.set(a)
  mixB.set(b)
  return target.copy(mixA).lerp(mixB, weight)
}

/**
 * Les monstres : une pile de tomes sur trois devient un squelette qui barre la voie (deux
 * sur trois au sanctuaire hanté), un tome couché sur quatre un squelette étendu en
 * travers (un sur deux la nuit), les monstres des toits de trains et les gardiens des
 * royaumes. La simulation ne voit que des obstacles ; seuls ces monstres-là s'offrent au tir
 * (cf. `shots.ts`).
 */
export function monsterOf(object: TrackObject): 'standing' | 'lying' | null {
  const haunted = biomeAt(object.s) === 'haunted'
  // Les feintes (un mur qui change de voie) sont toujours des monstres : un mur ne bondit pas.
  if (object.kind === 'wall' && object.shiftTo !== undefined) return 'standing'
  // Sur le toit d'un train : toujours un monstre (on ne pose pas un tome géant là-haut).
  if (object.kind === 'wall' && object.base) return 'standing'
  // Dans les royaumes : une colonne (ou un cristal) sur deux est un gardien du lieu.
  if (object.realm) return object.kind === 'wall' && object.variant % 2 === 0 ? 'standing' : null
  if (object.kind === 'wall') return object.variant % 3 === 0 || (haunted && object.variant % 3 === 1) ? 'standing' : null
  if (object.kind === 'low') return object.variant % (haunted ? 2 : 4) === 0 ? 'lying' : null
  return null
}
