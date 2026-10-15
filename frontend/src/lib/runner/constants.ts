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

/**
 * Toit du Manga Express (m) : certains trains ont une rampe devant eux, on y monte et l'on
 * court sur les toits, à la Subway Surfers. On en tombe en changeant de voie ou au bout.
 */
export const TRAIN_ROOF = 3.35
export const RAMP_LENGTH = 9

/**
 * Les royaumes : un tremplin lance le coureur dans le ciel, jusqu'aux îles célestes de
 * Skypia ; un tunnel l'emmène dans le monde souterrain. On y court `REALM_TIME` secondes,
 * puis l'on revient sur terre. Le premier passage arrive vers `PORTAL_FIRST` m, puis tous
 * les `PORTAL_EVERY` m environ (tremplin et tunnel en alternance).
 */
export const REALM_TIME = 30
export const LAUNCH_VELOCITY = 26
/** Bascule vers le royaume (s après le tremplin ou l'entrée du tunnel), sous l'éclair de transition. */
export const LAUNCH_SWITCH = 0.55
export const TUNNEL_SWITCH = 0.3
/** Route libre (m) à l'arrivée dans un royaume et au retour sur terre. */
export const REALM_LANDING = 26
export const REALM_GAP = 30
export const PORTAL_FIRST = 450
export const PORTAL_EVERY = 650

/** Tir sur les monstres (on les touche du doigt) : recharge (s), portée (m), ✦ gagnées. */
export const SHOT_COOLDOWN = 5
export const SHOT_RANGE = 70
export const SHOT_REWARD = 2

/** Quiz : la route se vide devant soi le temps de répondre, plus cette marge (m). */
export const QUIZ_CLEAR_MARGIN = 25

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
/** Quiz : la voie où l'on court à l'échéance donne la réponse. */
export const QUIZ_TIME = 5

/**
 * Frôler un obstacle par le côté (changement de voie contre un train, coin d'un mur) : on
 * trébuche, on rebondit dans sa voie, sonné un instant et ralenti. Un second frôlement
 * pendant qu'on est sonné est fatal ; seul un choc de face l'est d'emblée.
 */
export const STUN_TIME = 2.6
export const STUMBLE_SLOWDOWN = 0.3
export const STUMBLE_RECOVERY = 1.1

/**
 * Monstres qui feintent : à `SHIFT_LEAD` secondes de l'impact, un monstre bondit dans la
 * voie voisine (libre) en `SHIFT_TIME` secondes. Il a fini 1,6 s avant d'arriver : le
 * coureur a toujours le temps de changer de voie.
 */
export const SHIFT_LEAD = 2.1
export const SHIFT_TIME = 0.45

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
