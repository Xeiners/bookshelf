import { z } from 'zod'

/*
 * Gravity Ninja : la forme d'un niveau (JSON) et du plan qu'une IA écrit, vérifiés champ par champ.
 * Mêmes bornes que le jeu (`frontend/src/lib/gravity/constants.ts` et `validate.ts`) : le serveur
 * n'enregistre jamais un niveau que le jeu refuserait.
 */

/** Thèmes connus du jeu (`THEME_IDS` côté front). */
export const GRAVITY_THEMES = ['konoha', 'night', 'hunter', 'halloween', 'christmas', 'sand', 'mist'] as const
/** Sections du générateur (`SECTION_KINDS` côté front). */
export const GRAVITY_SECTIONS = ['runway', 'switch', 'spikes', 'wall', 'zigzag', 'islands', 'crumble', 'mover', 'pad', 'shuriken', 'moon', 'mini', 'kawarimi', 'hiraishin', 'flames', 'ghost', 'orbit', 'spring', 'cloud', 'kekkai', 'kunai'] as const

const range = (min: number, max: number) => z.number().finite().min(min).max(max)
const X = range(-20, 3100)
const Y = range(-10, 24)
const SIZE = range(0.2, 3100)
const Gravity = z.union([z.literal(1), z.literal(-1)])

const Box = { x: X, y: Y, w: SIZE, h: SIZE }

const ELEMENTS = [
  z.object({ type: z.literal('block'), ...Box }),
  z.object({ type: z.literal('crumble'), ...Box }),
  z.object({ type: z.literal('flip'), ...Box }),
  z.object({ type: z.literal('mover'), ...Box, dx: range(-60, 60), dy: range(-20, 20), period: range(0.5, 30), phase: range(0, 1).optional() }),
  z.object({ type: z.literal('spikes'), x: X, y: Y, w: SIZE, dir: z.enum(['up', 'down']) }),
  z.object({
    type: z.literal('shuriken'),
    x: X,
    y: Y,
    r: range(0.3, 3).optional(),
    dx: range(-60, 60).optional(),
    dy: range(-20, 20).optional(),
    period: range(0.5, 30).optional(),
    phase: range(0, 1).optional(),
    orbit: range(0, 8).optional(),
  }),
  z.object({ type: z.literal('moon'), x: X, y: Y }),
  z.object({ type: z.literal('scroll'), x: X, y: Y }),
  z.object({ type: z.literal('size'), ...Box, mini: z.boolean() }),
  z.object({ type: z.literal('log'), x: X, y: Y }),
  z.object({ type: z.literal('warp'), ...Box, tx: X, ty: Y }),
  z.object({ type: z.literal('flame'), x: X, y: Y, w: SIZE, reach: range(0.3, 14), dir: z.enum(['up', 'down']), period: range(0.5, 30), on: range(0.05, 0.95), phase: range(0, 1).optional() }),
  z.object({ type: z.literal('ghost'), ...Box, period: range(0.5, 30), on: range(0.05, 0.95), phase: range(0, 1).optional() }),
  z.object({ type: z.literal('spring'), x: X, y: Y, w: SIZE, dir: z.enum(['up', 'down']) }),
  z.object({ type: z.literal('cloud'), ...Box, dir: z.enum(['up', 'down']) }),
  z.object({ type: z.literal('key'), x: X, y: Y, channel: z.number().int().min(0).max(7) }),
  z.object({ type: z.literal('barrier'), ...Box, channel: z.number().int().min(0).max(7) }),
  z.object({ type: z.literal('kunai'), x: X, y: Y, speed: range(2, 60), range: range(1, 120), period: range(0.5, 30), phase: range(0, 1).optional() }),
] as const

export const ElementSchema = z.discriminatedUnion('type', [...ELEMENTS])
type GravityElement = z.infer<typeof ElementSchema>

/** Ancien format : les points de reprise n'existent plus (une chute renvoie au départ) ; lus, puis écartés. */
const LegacyCheckpoint = z.object({ type: z.literal('checkpoint'), x: X, y: Y, g: Gravity })

export const LevelSchema = z.object({
  format: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  name: z.string().trim().min(1).max(40),
  theme: z.enum(GRAVITY_THEMES),
  difficulty: z.number().int().min(1).max(10),
  speed: range(6, 16),
  length: range(60, 3000),
  start: z.object({ y: Y, g: Gravity }),
  elements: z
    .array(z.discriminatedUnion('type', [...ELEMENTS, LegacyCheckpoint]))
    .max(2000)
    .transform((elements) => elements.filter((element): element is GravityElement => element.type !== 'checkpoint')),
})

export type GravityLevelData = z.infer<typeof LevelSchema>

/**
 * Le plan d'un niveau, tel qu'une IA l'écrit : un nom, un thème, une difficulté et la suite des
 * sections. Le générateur du jeu le transforme en niveau, prouvé faisable section par section.
 */
export const PlanSchema = z.object({
  name: z.string().min(1).max(40).describe('Nom du niveau, court et évocateur (40 caractères au plus).'),
  theme: z.enum(GRAVITY_THEMES).describe('Thème visuel du niveau.'),
  difficulty: z.number().int().min(1).max(10).describe('Difficulté générale, de 1 (très facile) à 10 (redoutable).'),
  sections: z
    .array(
      z.object({
        kind: z.enum(GRAVITY_SECTIONS).describe('Type de section.'),
        intensity: z.number().int().min(1).max(10).describe('Intensité de cette section, de 1 à 10.'),
      }),
    )
    .min(4)
    .max(60)
    .describe('Les sections, dans l’ordre du parcours.'),
})

export type GravityPlan = z.infer<typeof PlanSchema>

export const RunSchema = z.object({
  percent: z.number().int().min(0).max(100),
  completed: z.boolean(),
  timeMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
  deaths: z.number().int().min(0).max(1_000_000),
  scrolls: z.number().int().min(0).max(3),
})

export type GravityRun = z.infer<typeof RunSchema>
