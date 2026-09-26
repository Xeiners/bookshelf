/**
 * Préchargement des pages du lecteur, hors du fil principal.
 *
 * Chaque page est téléchargée en entier : elle arrive dans le cache HTTP du
 * navigateur, et dans celui du Service Worker (qui contrôle aussi ce worker),
 * d'où le chapitre en cours reste lisible hors-ligne. Quand le lecteur
 * l'affiche, l'`<img>` la trouve déjà là : zéro attente au changement de page.
 *
 * Messages reçus : `{ type: 'update', urls }` (ordre = priorité), `{ type: 'dispose' }`.
 * Messages émis : `{ type: 'loaded' | 'failed', url }`.
 */
import { PrefetchQueue } from '../lib/reader/prefetch'

export type PrefetchCommand = { type: 'update'; urls: string[] } | { type: 'dispose' }
export type PrefetchReport = { type: 'loaded' | 'failed'; url: string }

/**
 * Portée du worker, typée à la main : la lib `webworker` de TypeScript entre en
 * conflit avec la lib DOM du reste du projet (un seul programme).
 */
const scope = self as unknown as {
  postMessage: (message: PrefetchReport) => void
  onmessage: ((event: MessageEvent<PrefetchCommand>) => void) | null
}

const queue = new PrefetchQueue(
  async (url, signal) => {
    const response = await fetch(url, { signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error(String(response.status))
    // Lire le corps : sans ça, le téléchargement peut s'arrêter aux en-têtes.
    await response.blob()
  },
  {
    concurrency: 2,
    onLoaded: (url) => scope.postMessage({ type: 'loaded', url } satisfies PrefetchReport),
    onFailed: (url) => scope.postMessage({ type: 'failed', url } satisfies PrefetchReport),
  },
)

scope.onmessage = (event: MessageEvent<PrefetchCommand>) => {
  if (event.data.type === 'update') queue.update(event.data.urls)
  else queue.dispose()
}
