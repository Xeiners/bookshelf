import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { config } from '../../core/config.js'
import { HttpError } from '../../core/http/errors.js'
import { GRAVITY_SECTIONS, GRAVITY_THEMES, PlanSchema, type GravityPlan } from './gravity.schema.js'

/*
 * Gravity Ninja : une IA (Claude) écrit le PLAN d'un niveau — son nom, son thème et la suite de
 * ses sections — à partir d'une demande libre (« un niveau de Noël difficile, plein de plateformes
 * qui s'effondrent »). Le générateur du jeu bâtit ensuite le niveau section par section et prouve
 * qu'il se finit : l'IA décide du rythme et de l'ambiance, la physique reste garantie.
 *
 * Sans `ANTHROPIC_API_KEY`, la génération par IA est indisponible (503) ; le même texte (`planPrompt`)
 * peut alors être copié vers n'importe quel assistant, et sa réponse importée dans l'atelier.
 */

const MODEL = 'claude-opus-5-5'

/** Nombre de sections conseillé selon la longueur voulue. */
const SECTIONS_FOR = { short: '10 à 14', medium: '16 à 22', long: '26 à 34' } as const
export type PlanLength = keyof typeof SECTIONS_FOR

const SYSTEM = `Tu conçois des niveaux pour « Gravity Ninja », un jeu de course à défilement horizontal inspiré de Gravity Guy, dans un univers de ninjas.

Le jeu : le ninja court tout seul vers la droite dans un couloir. Le joueur n'a qu'un geste : toucher l'écran inverse la gravité (il tombe alors vers le plafond, ou de nouveau vers le sol). On ne peut inverser que posé sur une surface. Tomber hors du couloir, toucher un piège ou se faire rattraper par le bord gauche de l'écran renvoie au dernier point de reprise (posés automatiquement).

Tu n'écris pas la géométrie : tu écris le PLAN, une suite de sections. Le générateur du jeu calcule chaque section à partir de la physique et vérifie qu'elle est faisable ; une section trop dure est adoucie.

Sections disponibles (« kind ») :
- runway : une ligne droite pour respirer, sans action.
- switch : la surface s'arrête au-dessus du vide ; il faut inverser vers la surface d'en face.
- spikes : la surface continue, hérissée de pics : inverser avant.
- wall : un mur se dresse sur la surface : inverser à temps pour passer de l'autre côté.
- pad : un sceau inverse la gravité tout seul ; la surface d'en face attend (une surprise douce).
- zigzag : deux à quatre inversions rapides, sol-plafond-sol.
- islands : sauter d'îlot en îlot, des dalles suspendues à mi-hauteur.
- crumble : se poser sur une dalle fragile qui s'effondre aussitôt, et en repartir tout de suite.
- mover : une plateforme qui se déplace ; viser le bon moment.
- shuriken : un shuriken géant dans la trajectoire : inverser tôt ou tard, pas au milieu.
- moon : un bonus de lune, puis un vide trop long : il faut maintenir le doigt pour planer (gravité lunaire).

« intensity » (1 à 10) règle la dureté de chaque section : la fenêtre pour inverser va d'environ 0,8 s (1) à 0,15 s (10), et les respirations raccourcissent.

Bonnes pratiques :
- Une courbe de difficulté : une mise en jambes, une montée progressive, un pic vers la fin, et une ou deux respirations (runway) après les passages intenses.
- Varie les sections ; évite plus de deux fois de suite la même.
- Introduis un mécanisme nouveau (moon, crumble, mover, shuriken) à une intensité un peu plus basse que le reste, la première fois.
- Pour un niveau facile, privilégie switch, spikes, wall, islands, pad et quelques runway ; garde zigzag, crumble, mover et shuriken pour les niveaux plus durs.
- Le nom est court, en français, évocateur de l'ambiance (40 caractères au plus).

Thèmes (« theme ») : ${GRAVITY_THEMES.join(', ')} — konoha (village caché au soleil couchant, pagodes, sakura), night (nuit bleue, bambous, lucioles), hunter (forêt verdoyante et tours géantes, univers de chasseurs), halloween (lune orange, citrouilles, braises), christmas (nuit de neige, sapins illuminés).

Réponds uniquement par le plan, au format demandé. Types de sections valides : ${GRAVITY_SECTIONS.join(', ')}.`

export interface PlanRequest {
  prompt: string
  difficulty?: number
  theme?: (typeof GRAVITY_THEMES)[number]
  length?: PlanLength
}

/** La demande, complétée des choix faits dans l'atelier. */
function userMessage(request: PlanRequest): string {
  const lines = [`Demande : ${request.prompt.trim() || 'un niveau équilibré et amusant.'}`]
  if (request.difficulty) lines.push(`Difficulté voulue : ${request.difficulty}/10.`)
  if (request.theme) lines.push(`Thème imposé : ${request.theme}.`)
  lines.push(`Longueur : ${SECTIONS_FOR[request.length ?? 'medium']} sections.`)
  return lines.join('\n')
}

/** Le texte complet à donner à un autre assistant (sa réponse s'importe dans l'atelier). */
export function planPrompt(request: PlanRequest): string {
  return `${SYSTEM}\n\n${userMessage(request)}\n\nRéponds par un objet JSON de la forme {"name": "...", "theme": "...", "difficulty": 1-10, "sections": [{"kind": "...", "intensity": 1-10}, ...]}, sans aucun texte autour.`
}

export const aiAvailable = () => Boolean(config.ai.anthropicApiKey)

let client: Anthropic | null = null

/** Demande le plan d'un niveau à Claude (sortie structurée, validée par `PlanSchema`). */
export async function generatePlan(request: PlanRequest): Promise<GravityPlan> {
  if (!aiAvailable()) throw new HttpError(503, 'gravity_ai_unavailable', 'Génération par IA indisponible : ANTHROPIC_API_KEY manquante.')
  client ??= new Anthropic({ apiKey: config.ai.anthropicApiKey, timeout: 120_000, maxRetries: 1 })
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: userMessage(request) }],
    })
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'gravity_ai_refused', 'L’IA a refusé cette demande.')
    if (!response.parsed_output) throw new HttpError(502, 'gravity_ai_invalid', 'L’IA n’a pas rendu de plan valable.')
    return response.parsed_output
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, 'gravity_ai_unavailable', 'Clé de l’API Claude refusée.')
    }
    if (error instanceof Anthropic.RateLimitError) throw new HttpError(429, 'gravity_ai_busy', 'L’IA est très demandée, réessaie dans un instant.')
    if (error instanceof Anthropic.APIError) throw new HttpError(502, 'gravity_ai_failed', 'L’IA n’a pas pu répondre.')
    throw error
  }
}
