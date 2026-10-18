/*
 * La tour d'une partie de Page Stack, à enregistrer à la fin : le jeu (solo ou salon) dépose ici de
 * quoi la dessiner, l'écran de fin la demande. Rien n'est dessiné tant qu'on ne clique pas.
 */

export interface TowerLabels {
  title: string
  subtitle: (pages: number, score: number) => string
  footer: string
}

/** Dessine l'image de la tour ; `null` hors partie. */
export const towerSource: { current: ((labels: TowerLabels) => HTMLCanvasElement) | null } = { current: null }

/** Taille de l'image : un format d'écran de téléphone, net une fois enregistré. */
export const TOWER_SIZE = { width: 1080, height: 1920 } as const

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed'

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

/**
 * Enregistre l'image : sur téléphone, la feuille de partage (« Enregistrer l'image », messageries) ;
 * ailleurs, un téléchargement.
 */
export async function saveCanvas(canvas: HTMLCanvasElement, filename: string): Promise<SaveOutcome> {
  const blob = await toBlob(canvas)
  if (!blob) return 'failed'
  const file = new File([blob], filename, { type: 'image/png' })
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Partage refusé autrement : on retombe sur le téléchargement.
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
