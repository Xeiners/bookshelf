import type { ThemeId } from './types'

/*
 * Les thèmes : de la donnée pure (couleurs, silhouettes, particules, matière des plateformes) que
 * le rendu interprète. Ajouter un thème (Noël, Halloween, un univers d'anime…) = ajouter une
 * entrée ici, son nom dans les dictionnaires, et l'identifiant dans `THEME_IDS`.
 */

export type Silhouette = 'pagoda' | 'bamboo' | 'towers' | 'pumpkins' | 'pines'
export type Particles = 'sakura' | 'fireflies' | 'leaves' | 'embers' | 'snow'
export type Material = 'tiles' | 'stone' | 'moss' | 'wood' | 'snow'

export interface GravityTheme {
  id: ThemeId
  /** Ciel : haut, milieu, horizon. */
  sky: [string, string, string]
  /** Astre : soleil ou lune, sa couleur et son halo ; position en fraction de l'écran. */
  orb: { kind: 'sun' | 'moon'; color: string; glow: string; x: number; y: number; size: number }
  /** Montagnes lointaines, collines, silhouettes du premier plan. */
  far: string
  mid: string
  near: string
  silhouette: Silhouette
  particles: { kind: Particles; color: string }
  /** Plateformes : dessus, corps, liseré lumineux, matière. */
  platform: { top: string; body: string; edge: string; material: Material }
  /** Pics, shurikens. */
  hazard: string
  /** Couleur d'accent (sceaux, interface du thème). */
  accent: string
  /** Brume au pied du décor. */
  fog: string
}

export const THEMES: Record<ThemeId, GravityTheme> = {
  konoha: {
    id: 'konoha',
    sky: ['#2b1b4d', '#d9577a', '#ffb36b'],
    orb: { kind: 'sun', color: '#fff1c4', glow: 'rgba(255,190,110,0.55)', x: 0.7, y: 0.42, size: 0.15 },
    far: '#7a3f73',
    mid: '#4f2552',
    near: '#2a1236',
    silhouette: 'pagoda',
    particles: { kind: 'sakura', color: '#ffc4dc' },
    platform: { top: '#c9473a', body: '#3b2433', edge: '#ffb38a', material: 'tiles' },
    hazard: '#ecebf5',
    accent: '#ff8a6b',
    fog: 'rgba(255,150,140,0.18)',
  },
  night: {
    id: 'night',
    sky: ['#050816', '#121a3d', '#2a3570'],
    orb: { kind: 'moon', color: '#f4f1ff', glow: 'rgba(170,180,255,0.42)', x: 0.74, y: 0.3, size: 0.12 },
    far: '#1d2550',
    mid: '#121836',
    near: '#070a1a',
    silhouette: 'bamboo',
    particles: { kind: 'fireflies', color: '#d4ff8a' },
    platform: { top: '#6b7a9c', body: '#1d2236', edge: '#9fb4ff', material: 'stone' },
    hazard: '#cfd6ff',
    accent: '#8aa2ff',
    fog: 'rgba(120,140,255,0.12)',
  },
  hunter: {
    id: 'hunter',
    sky: ['#0f3b3a', '#2e8a6e', '#d4f2a8'],
    orb: { kind: 'sun', color: '#fffbe0', glow: 'rgba(255,250,200,0.5)', x: 0.3, y: 0.32, size: 0.11 },
    far: '#3b7d66',
    mid: '#225443',
    near: '#0f2a24',
    silhouette: 'towers',
    particles: { kind: 'leaves', color: '#a6e870' },
    platform: { top: '#6fae4a', body: '#3a2a1c', edge: '#c6f08a', material: 'moss' },
    hazard: '#eef7e2',
    accent: '#7be0a0',
    fog: 'rgba(200,255,200,0.14)',
  },
  halloween: {
    id: 'halloween',
    sky: ['#12051f', '#3d0f45', '#b4472a'],
    orb: { kind: 'moon', color: '#ffd27a', glow: 'rgba(255,150,60,0.5)', x: 0.66, y: 0.36, size: 0.17 },
    far: '#36124a',
    mid: '#220b30',
    near: '#0c0412',
    silhouette: 'pumpkins',
    particles: { kind: 'embers', color: '#ff9a3c' },
    platform: { top: '#5d3d72', body: '#1c1024', edge: '#ff9a3c', material: 'wood' },
    hazard: '#ffd27a',
    accent: '#ff7a1a',
    fog: 'rgba(255,120,40,0.12)',
  },
  christmas: {
    id: 'christmas',
    sky: ['#081833', '#16407a', '#86b8ea'],
    orb: { kind: 'moon', color: '#ffffff', glow: 'rgba(200,230,255,0.5)', x: 0.28, y: 0.28, size: 0.1 },
    far: '#30588f',
    mid: '#1c3a68',
    near: '#0d1f3d',
    silhouette: 'pines',
    particles: { kind: 'snow', color: '#ffffff' },
    platform: { top: '#f4fbff', body: '#2c3e66', edge: '#ff4d6d', material: 'snow' },
    hazard: '#e8304f',
    accent: '#ff4d6d',
    fog: 'rgba(230,245,255,0.16)',
  },
  sand: {
    id: 'sand',
    sky: ['#3a1d2e', '#c4603a', '#f2b56b'],
    orb: { kind: 'sun', color: '#fff0c2', glow: 'rgba(255,200,120,0.5)', x: 0.3, y: 0.4, size: 0.17 },
    far: '#a5583a',
    mid: '#7a3b2a',
    near: '#3d1d1a',
    silhouette: 'towers',
    particles: { kind: 'leaves', color: '#f0c48a' },
    platform: { top: '#e9b873', body: '#7c4a2c', edge: '#ffd27a', material: 'stone' },
    hazard: '#eef1f7',
    accent: '#ff7a3d',
    fog: 'rgba(255,190,120,0.14)',
  },
  mist: {
    id: 'mist',
    sky: ['#1b2630', '#4f6b73', '#a9c1bf'],
    orb: { kind: 'sun', color: '#f4f7f2', glow: 'rgba(230,240,235,0.45)', x: 0.66, y: 0.36, size: 0.12 },
    far: '#5d7a7f',
    mid: '#3c565c',
    near: '#1d2c31',
    silhouette: 'pagoda',
    particles: { kind: 'snow', color: '#dfe9e6' },
    platform: { top: '#cfd8d2', body: '#34474c', edge: '#7fe3d0', material: 'wood' },
    hazard: '#e85a4f',
    accent: '#7fe3d0',
    fog: 'rgba(220,235,230,0.22)',
  },
}

export const themeOf = (id: string): GravityTheme => THEMES[id as ThemeId] ?? THEMES.konoha
