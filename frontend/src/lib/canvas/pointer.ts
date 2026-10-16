/*
 * Le doigt est moins précis que la souris : les zones à toucher (poignées, points d'une courbe,
 * objets à choisir) grandissent sur un écran tactile.
 */

let coarse: boolean | null = null

export function isTouchDevice(): boolean {
  if (coarse === null) coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  return coarse
}

/** Un rayon de toucher (px) : celui de la souris, agrandi au doigt. */
export const reach = (mouse: number): number => (isTouchDevice() ? Math.round(mouse * 1.7) : mouse)
