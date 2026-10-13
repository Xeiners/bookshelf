import * as THREE from 'three'
import type { TrackObject } from '../../lib/runner/engine'

/*
 * Les décors du Manga Runner se succèdent au fil de la course : l'allée des cerisiers,
 * la forêt d'automne, puis le sanctuaire hanté de nuit, et l'on recommence. Chaque
 * élément du décor prend le biome de l'endroit où il se trouve (pas celui du coureur) :
 * le paysage change devant lui, comme une vraie route. Le ciel, la brume et la lumière,
 * eux, glissent d'un biome à l'autre sur les derniers mètres.
 */

export const BIOMES = ['sakura', 'autumn', 'haunted'] as const
export type Biome = (typeof BIOMES)[number]

/** Longueur d'un biome (m), et de la transition de lumière à sa fin. */
export const BIOME_LENGTH = 650
const BLEND = 90

export const biomeAt = (s: number): Biome => BIOMES[Math.floor(Math.max(0, s) / BIOME_LENGTH) % BIOMES.length]!

export interface BiomeStyle {
  /** Couleur de l'horizon : brume et fond s'y fondent. */
  horizon: string
  fogNear: number
  fogFar: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  sun: string
  sunIntensity: number
  /** Teinte des sols (piste, allée, herbe). */
  track: string
  path: string
  grass: string
  /** Pétales, feuilles mortes ou feux follets. */
  particles: string
}

export const BIOME_STYLE: Record<Biome, BiomeStyle> = {
  sakura: {
    horizon: '#f4b8c6',
    fogNear: 50,
    fogFar: 175,
    hemiSky: '#fff1f6',
    hemiGround: '#b98bb4',
    hemiIntensity: 1.35,
    sun: '#ffe6cc',
    sunIntensity: 1.65,
    track: '#ffffff',
    path: '#ffffff',
    grass: '#ffffff',
    particles: '#ffffff',
  },
  autumn: {
    horizon: '#f2c08a',
    fogNear: 45,
    fogFar: 170,
    hemiSky: '#fff3dc',
    hemiGround: '#a8794a',
    hemiIntensity: 1.3,
    sun: '#ffd49a',
    sunIntensity: 1.8,
    track: '#f2e2d2',
    path: '#efd9c0',
    grass: '#e2b24f',
    particles: '#ff9c3d',
  },
  haunted: {
    horizon: '#2c2a5c',
    fogNear: 25,
    fogFar: 135,
    hemiSky: '#8e9cff',
    hemiGround: '#24183a',
    hemiIntensity: 0.95,
    sun: '#b8c4ff',
    sunIntensity: 0.9,
    track: '#8d8fc0',
    path: '#7d7ca8',
    grass: '#4c587a',
    particles: '#8ff3ff',
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
 * travers (un sur deux la nuit). Purement visuel : la simulation ne voit que des murs et
 * des obstacles bas.
 */
export function monsterOf(object: TrackObject): 'standing' | 'lying' | null {
  const haunted = biomeAt(object.s) === 'haunted'
  if (object.kind === 'wall') return object.variant % 3 === 0 || (haunted && object.variant % 3 === 1) ? 'standing' : null
  if (object.kind === 'low') return object.variant % (haunted ? 2 : 4) === 0 ? 'lying' : null
  return null
}
