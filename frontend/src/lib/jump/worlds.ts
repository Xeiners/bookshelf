import type { SiteTheme } from '../../services/themeApi'

/*
 * Page Jump : les univers traversés en montant, et l'habillage du jeu selon le thème saisonnier
 * de l'app (cf. `useThemeStore`). Un univers tous les `WORLD_SPAN` unités, à l'infini : la liste
 * recommence quand on l'a parcourue. Pour une nouvelle saison : ajouter un `Skin` à `SKINS`.
 */

/** Hauteur d'un univers (unités du jeu), et longueur du fondu vers le suivant. */
export const WORLD_SPAN = 2600
export const WORLD_BLEND = 600

/** Ce qui se dresse à l'horizon d'un univers. */
export type Landmark = 'rooftops' | 'sakura' | 'fuji' | 'city' | 'pagoda' | 'waves' | 'planets' | 'pumpkins' | 'graves' | 'castle'
/** Ce qui flotte dans le ciel, en parallaxe. */
export type Ambient = 'clouds' | 'petals' | 'stars' | 'lanterns' | 'bats'

export interface World {
  /** Clé du nom (`t.jump.worlds[id]`). */
  id: string
  sky: [top: string, bottom: string]
  /** Couleur de la silhouette de l'horizon, et des fenêtres ou détails éclairés. */
  land: string
  light: string
  landmark: Landmark
  ambient: Ambient
  /** L'astre du ciel (dessiné dans la couleur `light`), ou aucun. */
  orb: 'sun' | 'moon' | null
}

export interface Skin {
  worlds: World[]
  /** Couvertures des plateformes ordinaires. */
  platforms: string[]
  moving: string
  fragile: string
  enemy: 'oni' | 'ghost'
}

const MANGA: World[] = [
  { id: 'village', orb: 'sun', sky: ['#ff7aa8', '#ffd29a'], land: '#5a2a4a', light: '#ffd35c', landmark: 'rooftops', ambient: 'clouds' },
  { id: 'sakura', orb: 'sun', sky: ['#ff9ec7', '#ffe3ef'], land: '#7a3a5c', light: '#ffc1dc', landmark: 'sakura', ambient: 'petals' },
  { id: 'fuji', orb: 'sun', sky: ['#4f8dff', '#cfe6ff'], land: '#2c3f7a', light: '#ffffff', landmark: 'fuji', ambient: 'clouds' },
  { id: 'neon', orb: 'moon', sky: ['#2a0f4a', '#7a2a8f'], land: '#120626', light: '#3fe0ff', landmark: 'city', ambient: 'stars' },
  { id: 'shrine', orb: 'sun', sky: ['#1f6f7a', '#9fe0d6'], land: '#123c44', light: '#ff6b4a', landmark: 'pagoda', ambient: 'lanterns' },
  { id: 'wave', orb: 'sun', sky: ['#0f3a7a', '#7fc4ff'], land: '#0b2550', light: '#ffffff', landmark: 'waves', ambient: 'clouds' },
  { id: 'cosmos', orb: 'moon', sky: ['#05040f', '#2a1650'], land: '#0c0820', light: '#ffd35c', landmark: 'planets', ambient: 'stars' },
]

const HALLOWEEN: World[] = [
  { id: 'haunted', orb: 'moon', sky: ['#2a1245', '#ff8a3d'], land: '#160a24', light: '#ffb347', landmark: 'rooftops', ambient: 'bats' },
  { id: 'pumpkins', orb: 'moon', sky: ['#3a1408', '#ff7a1a'], land: '#1c0a06', light: '#ffb347', landmark: 'pumpkins', ambient: 'bats' },
  { id: 'graveyard', orb: 'moon', sky: ['#0f1a24', '#4a6a6a'], land: '#0a1014', light: '#b8ffb0', landmark: 'graves', ambient: 'stars' },
  { id: 'castle', orb: 'moon', sky: ['#1a0a30', '#6a2a8a'], land: '#0c0418', light: '#ffd35c', landmark: 'castle', ambient: 'bats' },
  { id: 'spirits', orb: null, sky: ['#04161a', '#1f6a6a'], land: '#020a0c', light: '#7fffd4', landmark: 'pagoda', ambient: 'lanterns' },
  { id: 'bloodmoon', orb: 'moon', sky: ['#1a0206', '#7a1020'], land: '#0c0104', light: '#ff4d4d', landmark: 'planets', ambient: 'stars' },
]

export const SKINS: Record<SiteTheme, Skin> = {
  none: { worlds: MANGA, platforms: ['#7bd34a', '#ff6fb5', '#ffc23a', '#9b8cff'], moving: '#4cc9f0', fragile: '#d9b48a', enemy: 'oni' },
  halloween: { worlds: HALLOWEEN, platforms: ['#ff8a1f', '#a06bff', '#7bd34a'], moving: '#4cc9f0', fragile: '#cfae8a', enemy: 'ghost' },
}

/** Numéro de l'univers (0, 1, 2… sans fin) à une hauteur donnée. */
export const worldIndexAt = (height: number): number => Math.max(0, Math.floor(height / WORLD_SPAN))

/** L'univers numéro `index` d'un habillage (la liste recommence). */
export const worldOf = (skin: Skin, index: number): World => skin.worlds[((index % skin.worlds.length) + skin.worlds.length) % skin.worlds.length]!

/** Fondu vers l'univers suivant, de 0 à 1, sur les `WORLD_BLEND` dernières unités. */
export const blendAt = (height: number): number => {
  const within = Math.max(0, height) - worldIndexAt(height) * WORLD_SPAN
  return Math.min(1, Math.max(0, (within - (WORLD_SPAN - WORLD_BLEND)) / WORLD_BLEND))
}
