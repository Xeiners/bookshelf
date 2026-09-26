import { useEffect, useRef } from 'react'
import { PrefetchQueue, prefetchOrder } from '../../lib/reader/prefetch'
import { isConstrainedNetwork } from '../../lib/reader/quality'
import type { ReaderPage } from '../../types/reader'
import type { PrefetchCommand } from '../../workers/prefetch.worker'

/** Pages suivantes chargées en priorité, avant tout le reste. */
const AHEAD = 5

interface Prefetcher {
  update: (urls: string[]) => void
  dispose: () => void
}

/** Worker dédié ; à défaut (très vieux navigateur), la même file sur le fil principal. */
function createPrefetcher(): Prefetcher {
  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('../../workers/prefetch.worker.ts', import.meta.url), { type: 'module' })
      const post = (command: PrefetchCommand) => worker.postMessage(command)
      return {
        update: (urls) => post({ type: 'update', urls }),
        dispose: () => {
          post({ type: 'dispose' })
          worker.terminate()
        },
      }
    } catch {
      // Worker refusé (CSP, mode privé exotique) : repli ci-dessous.
    }
  }
  const queue = new PrefetchQueue(
    (url, signal) =>
      new Promise<void>((resolve, reject) => {
        const image = new Image()
        signal.addEventListener('abort', () => {
          image.src = ''
          reject(new Error('aborted'))
        })
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('failed'))
        image.src = url
      }),
    { concurrency: 2 },
  )
  return { update: (urls) => queue.update(urls), dispose: () => queue.dispose() }
}

/**
 * Précharge les pages autour de la page courante, en arrière-plan :
 * - les 5 suivantes d'abord, puis la précédente ;
 * - puis tout le reste du chapitre (lecture hors-ligne), sauf si l'appareil
 *   signale une connexion lente ou l'économie de données ;
 * - les deux prochaines pages sont aussi décodées sur le fil principal, pour
 *   qu'un changement de page n'attende même pas le décodage.
 *
 * Les URL `blob:` (archives importées) sont déjà en mémoire : rien à faire.
 * `extra` : URL à charger ensuite (début du chapitre suivant).
 */
export function usePrefetch(pages: readonly ReaderPage[], current: number, extra: readonly string[] = []): void {
  const prefetcher = useRef<Prefetcher | null>(null)

  useEffect(() => {
    const instance = createPrefetcher()
    prefetcher.current = instance
    return () => {
      instance.dispose()
      prefetcher.current = null
    }
  }, [])

  const local = pages.length > 0 && pages.every((page) => page.url.startsWith('blob:'))
  const extraKey = extra.join('|')

  useEffect(() => {
    if (local || pages.length === 0) return
    const whole = !isConstrainedNetwork()
    const urls = prefetchOrder(current, pages.length, { ahead: AHEAD, behind: 1, whole })
      .map((index) => pages[index]?.url)
      .filter((url): url is string => Boolean(url))
    // `extraKey` et non `extra` : un nouveau tableau au contenu identique ne relance rien.
    const following = extraKey ? extraKey.split('|') : []
    prefetcher.current?.update([...urls.slice(0, AHEAD + 1), ...following, ...urls.slice(AHEAD + 1)])

    // Décodage anticipé des deux prochaines pages : l'image est prête à peindre.
    for (const index of [current + 1, current + 2]) {
      const url = pages[index]?.url
      if (!url) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      image.decode().catch(() => {})
    }
  }, [pages, current, local, extraKey])
}
