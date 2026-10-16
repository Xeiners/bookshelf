import type { CanvasEngine } from './engine'

/*
 * Le moteur de la toile en cours. Créé par `CanvasView` quand ses calques existent ; les boutons
 * de l'interface l'appellent dans leurs gestionnaires (jamais pendant un rendu React : le moteur
 * change à chaque image, pas l'interface).
 */

let current: CanvasEngine | null = null

export const getEngine = (): CanvasEngine | null => current

export function setEngine(engine: CanvasEngine | null): void {
  current = engine
}
