/** Retour haptique court — silencieux si l'appareil ne le supporte pas. */
export function vibrate(pattern: number | number[] = 12): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Certains navigateurs exposent l'API mais la bloquent hors interaction.
  }
}
