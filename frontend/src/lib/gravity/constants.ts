/*
 * Gravity Ninja : constantes de la simulation (unités du monde, secondes). Le monde est un couloir
 * horizontal de `WORLD_HEIGHT` unités de haut, y vers le bas ; le ninja court seul vers la droite et
 * le joueur n'a qu'un geste : inverser la gravité. Le générateur, le solveur et le serveur (bornes des
 * niveaux) s'appuient sur ces valeurs.
 */

/** Version du format des niveaux (JSON). */
export const LEVEL_FORMAT = 1

/** Hauteur du couloir : toujours entièrement visible. */
export const WORLD_HEIGHT = 14
/** Sortir du couloir de plus de tant d'unités (par le haut ou le bas) : chute. */
export const OUT_MARGIN = 2.5

/** Pas fixe de la simulation (s) : le jeu, le solveur et le générateur avancent au même pas. */
export const TICK = 1 / 60

/** La boîte du ninja. */
export const PLAYER_W = 0.8
export const PLAYER_H = 1.3

/** Pesanteur (unités/s²), vitesse de chute maximale, et l'élan qui décolle d'une surface à l'inversion. */
export const GRAVITY = 72
export const MAX_FALL = 24
export const FLIP_KICK = 3

/** Bonus de la lune : tant qu'on maintient le doigt, la pesanteur ne vaut plus que `MOON_GRAVITY`. */
export const MOON_SECONDS = 6
export const MOON_GRAVITY = 0.25
export const MOON_MAX_FALL = 9

/** Toucher un peu avant d'atterrir compte (mis en attente), et un peu après avoir quitté un bord. */
export const FLIP_BUFFER = 0.12
export const COYOTE = 0.06

/** Une plateforme fragile tombe tant de secondes après qu'on s'y est posé. */
export const CRUMBLE_DELAY = 0.3

/**
 * La caméra avance à la vitesse du niveau et garde le ninja à `ANCHOR` unités de son bord gauche.
 * Bloqué contre un mur, il prend du retard ; libre, il rattrape (×`CATCH_UP`). Sorti par la gauche : perdu.
 */
export const ANCHOR = 6
export const CATCH_UP = 1.15

/** Départ du ninja. */
export const START_X = 4

/** Hauteur des pics, rayon des shurikens et des bonus. */
export const SPIKE_H = 0.6
export const SHURIKEN_R = 0.6
export const PICKUP_R = 0.6

/** Rouleaux à collectionner par niveau. */
export const SCROLLS_PER_LEVEL = 3

/** Bornes acceptées d'un niveau (le serveur applique les mêmes). */
export const LIMITS = {
  speed: [6, 16],
  length: [60, 3000],
  difficulty: [1, 10],
  elements: 2000,
  name: 40,
} as const

/** Vitesse de course d'un niveau selon sa difficulté (1 → 10). */
export const speedFor = (difficulty: number) => 7.5 + (Math.min(10, Math.max(1, difficulty)) - 1) * 0.5
