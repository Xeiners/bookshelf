/**
 * Page Jump : constantes partagées avec le serveur (`backend/src/modules/jump/jump.logic.ts`), qui
 * vérifie avec les mêmes barèmes qu'une partie est plausible. Unités du monde : la scène fait
 * `WORLD_WIDTH` de large, quelle que soit sa taille à l'écran ; la hauteur se compte vers le haut.
 */

export const WORLD_WIDTH = 360

/** Pesanteur (unités/s²) ; vitesse d'un rebond, d'un ressort, de l'envol (unités/s) ; durée de l'envol (s). */
export const GRAVITY = 1500
export const JUMP_SPEED = 800
export const SPRING_SPEED = 1300
export const ROCKET_SPEED = 1100
export const ROCKET_SECONDS = 2.2
/** Bonus à durée : Grand tome (plateformes élargies), Aimant (attire les éclats), Plume (pesanteur allégée). */
export const WIDE_SECONDS = 8
export const WIDE_FACTOR = 1.7
export const MAGNET_SECONDS = 8
export const MAGNET_RANGE = 170
export const MAGNET_SPEED = 950
export const FEATHER_SECONDS = 6
export const FEATHER_GRAVITY = 0.55
/** Rebond sur un oni écrasé. */
export const STOMP_SPEED = 900

/** Vitesse horizontale au plus (unités/s) et temps pour l'atteindre (lissage du contrôle). */
export const MOVE_SPEED = 400
export const MOVE_RESPONSE = 0.08

/** Le héros : largeur de sa zone d'appui, hauteur. */
export const PLAYER_WIDTH = 30
export const PLAYER_HEIGHT = 36

/** Un tome-plateforme : largeur, épaisseur. */
export const PLATFORM_WIDTH = 64
export const PLATFORM_HEIGHT = 14

/** Écart vertical entre deux tomes : au départ, au plus (toujours sous la hauteur d'un rebond). */
export const MIN_GAP = 52
export const MAX_GAP = 168
/** Hauteur à laquelle la difficulté plafonne. */
export const HARD_AT = 24_000

/** Points : un par `HEIGHT_PER_POINT` unités grimpées, un éclat ✦ ramassé, un oni écrasé. */
export const HEIGHT_PER_POINT = 10
export const STAR_POINTS = 10
export const STOMP_POINTS = 50

/** Plausibilité (serveur) : montée au plus rapide (envol), éclats et onis au plus par unité de hauteur. */
export const MAX_CLIMB_PER_SECOND = 1200
export const CLIMB_ALLOWANCE = 800
export const MIN_STAR_SPACING = 90
export const MIN_ENEMY_SPACING = 260

/** Score d'une partie, à partir de ce qu'elle a accompli. */
export const scoreOf = (height: number, stars: number, stomps: number): number =>
  Math.floor(Math.max(0, height) / HEIGHT_PER_POINT) + Math.max(0, stars) * STAR_POINTS + Math.max(0, stomps) * STOMP_POINTS
