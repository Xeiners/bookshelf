/**
 * Manga Runner 3D — constantes partagées avec le serveur (`backend/src/modules/runner/runner.logic.ts`
 * vérifie qu'une course reste plausible avec ces mêmes vitesses).
 */

/** Vitesse au départ, accélération et plafond (m/s, m/s²). */
export const START_SPEED = 13
export const ACCEL = 0.18
export const MAX_SPEED = 30

/** Écart entre deux voies (m) ; voie -1 : gauche, 0 : centre, 1 : droite. */
export const LANE_WIDTH = 2.4
/**
 * Durée d'un changement de voie (s) : courbe douce qui part de la vitesse latérale du
 * moment (deux gestes enchaînés ne cassent pas le mouvement) et se pose sans à-coup.
 */
export const LANE_TIME = 0.21

export const GRAVITY = 42
export const JUMP_VELOCITY = 13.5
/** Plongeon en l'air (bas pendant un saut) : on redescend vite, puis on glisse. */
export const DIVE_VELOCITY = -26
export const SLIDE_TIME = 0.62
/** Hauteur de vol sur le nuage magique. */
export const FLY_HEIGHT = 4.4

/** Taille du coureur : debout, puis en glissade (m). */
export const PLAYER_HEIGHT = 1.75
export const SLIDE_HEIGHT = 0.85
export const PLAYER_HALF_WIDTH = 0.4
export const PLAYER_HALF_DEPTH = 0.4

/** Durées (s) : invincibilité après un choc, bouclier d'un quiz réussi, aimant, nuage, temps de réponse au quiz. */
export const HIT_INVULNERABILITY = 1.6
export const SHIELD_TIME = 6
export const MAGNET_TIME = 8
export const CLOUD_TIME = 5
export const QUIZ_TIME = 5

/**
 * Frôler un obstacle par le côté (changement de voie contre un train, coin d'un mur) : on
 * trébuche, on rebondit dans sa voie, sonné un instant et ralenti. Un second frôlement
 * pendant qu'on est sonné est fatal ; seul un choc de face l'est d'emblée.
 */
export const STUN_TIME = 2.6
export const STUMBLE_SLOWDOWN = 0.3
export const STUMBLE_RECOVERY = 1.1

/** Une seule vie : un choc termine la course, sauf résurrection payée en Poussières. */
export const LIVES = 1
/** Après une résurrection : invincible un instant, et la piste proche est dégagée (m). */
export const REVIVE_INVULNERABILITY = 2.5
export const REVIVE_CLEARANCE = 35
/** Revivre : 50 ✦, puis le double à chaque fois ; trois fois au plus (comme le serveur). */
export const REVIVE_BASE_COST = 50
export const MAX_REVIVES = 3
export const reviveCost = (revivesSoFar: number): number | null => (revivesSoFar >= MAX_REVIVES ? null : REVIVE_BASE_COST * 2 ** revivesSoFar)

/** Piste générée jusqu'à cette distance devant le coureur ; effacée derrière lui. */
export const VIEW_AHEAD = 150
export const KEEP_BEHIND = 14

/** Multiplicateur de score : +0,1 par tranche de 20 ✦ ; points par quiz réussi. */
export const multiplierFor = (stardust: number): number => 1 + Math.floor(Math.max(0, stardust) / 20) / 10
export const QUIZ_POINTS = 250
export const scoreFor = (distance: number, stardust: number, quiz: number): number =>
  Math.floor(Math.max(0, distance) * multiplierFor(stardust)) + Math.max(0, quiz) * QUIZ_POINTS

/** Vitesse au temps `t` de la course. */
export const speedAt = (t: number): number => Math.min(MAX_SPEED, START_SPEED + ACCEL * t)
