import { useEffect } from 'react'
import { useUiStore } from '../store/useUiStore'

/**
 * Déclare un écran opaque en plein écran (une partie, la Toile…) tant qu'il est monté et que
 * `active` est vrai : le décor de fond de l'app (neige, guirlande, traîneau…), entièrement caché
 * dessous, est retiré. Sans cela, ses animations continuent d'occuper la carte graphique à chaque
 * image, en plus du jeu — de quoi faire chauffer un téléphone et ralentir la partie.
 */
export function useCoverScreen(active = true): void {
  useEffect(() => {
    if (!active) return
    return useUiStore.getState().coverScreen()
  }, [active])
}
