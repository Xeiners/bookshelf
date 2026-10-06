/**
 * Les titres n'ont plus de texte en dégradé : une couleur pleine, la teinte du milieu du
 * dégradé de la page (un peu éclaircie pour rester lisible sur le fond sombre).
 */
export function inkOf(gradient: string): string {
  const stops = gradient.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  const middle = stops[Math.floor((stops.length - 1) / 2)]
  return middle ? `color-mix(in oklab, ${middle} 85%, white)` : 'currentColor' // i18n-ignore
}

/** Style d'un texte coloré d'après un dégradé. */
export const inkText = (gradient: string | undefined) => ({ color: gradient ? inkOf(gradient) : undefined })
