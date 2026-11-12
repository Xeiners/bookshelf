/**
 * Sur téléphone, Gravity Ninja se joue mieux en paysage : plein écran et orientation verrouillée
 * quand le navigateur le permet (Android), sans effet ailleurs. À appeler dans le geste qui lance la
 * partie (niveau ou leçon du tutoriel).
 */
export function enterLandscape(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return
  const root = document.documentElement
  const lock = () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
    void orientation.lock?.('landscape').catch(() => undefined)
  }
  if (!document.fullscreenElement && root.requestFullscreen) void root.requestFullscreen().then(lock).catch(() => undefined)
  else lock()
}

export function leaveLandscape(): void {
  try {
    screen.orientation.unlock?.()
  } catch {
    // Rien à déverrouiller.
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
}
