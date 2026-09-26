import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PrefetchQueue, prefetchOrder } from '../src/lib/reader/prefetch'

describe('ordre de préchargement', () => {
  it('les pages suivantes d’abord, puis la précédente', () => {
    assert.deepEqual(prefetchOrder(5, 20, { ahead: 3, behind: 1 }), [6, 7, 8, 4])
  })

  it('borné au chapitre (ni négatif, ni au-delà de la dernière page)', () => {
    assert.deepEqual(prefetchOrder(0, 3, { ahead: 5, behind: 2 }), [1, 2])
    assert.deepEqual(prefetchOrder(2, 3, { ahead: 5, behind: 1 }), [1])
    assert.deepEqual(prefetchOrder(0, 0), [])
  })

  it('chapitre entier : la fenêtre prioritaire, puis le reste en avançant, puis en arrière', () => {
    assert.deepEqual(prefetchOrder(3, 8, { ahead: 2, behind: 1, whole: true }), [4, 5, 2, 6, 7, 1, 0])
  })

  it('jamais la page courante, jamais deux fois la même', () => {
    const order = prefetchOrder(4, 10, { ahead: 5, behind: 5, whole: true })
    assert.equal(new Set(order).size, order.length)
    assert.ok(!order.includes(4))
    assert.equal(order.length, 9)
  })

  it('page courante hors limites : ramenée dans le chapitre', () => {
    assert.deepEqual(prefetchOrder(50, 4, { ahead: 2, behind: 1 }), [2])
  })
})

/** Chargeur contrôlable : chaque URL attend qu'on la résolve ou la rejette. */
function controllableLoader() {
  const calls: string[] = []
  const aborted: string[] = []
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  const load = (url: string, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      calls.push(url)
      pending.set(url, { resolve, reject })
      signal.addEventListener('abort', () => {
        aborted.push(url)
        reject(new Error('aborted'))
      })
    })
  const settle = async (url: string, ok = true) => {
    const entry = pending.get(url)
    assert.ok(entry, `${url} n'est pas en cours`)
    pending.delete(url)
    if (ok) entry.resolve()
    else entry.reject(new Error('failed'))
    // Laisse les `then` de la file s'exécuter.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { load, calls, aborted, settle }
}

describe('file de préchargement', () => {
  it('respecte la priorité et la concurrence', async () => {
    const loader = controllableLoader()
    const queue = new PrefetchQueue(loader.load, { concurrency: 2 })
    queue.update(['p1', 'p2', 'p3', 'p4'])
    assert.deepEqual(loader.calls, ['p1', 'p2'])
    await loader.settle('p1')
    assert.deepEqual(loader.calls, ['p1', 'p2', 'p3'])
    assert.deepEqual(queue.size, { pending: 1, inflight: 2, loaded: 1 })
  })

  it('une page chargée ne l’est jamais deux fois', async () => {
    const loader = controllableLoader()
    const loaded: string[] = []
    const queue = new PrefetchQueue(loader.load, { concurrency: 1, onLoaded: (url) => loaded.push(url) })
    queue.update(['a'])
    await loader.settle('a')
    queue.update(['a', 'b'])
    assert.deepEqual(loader.calls, ['a', 'b'])
    assert.deepEqual(loaded, ['a'])
    assert.ok(queue.isLoaded('a'))
  })

  it('saut de page : les téléchargements devenus inutiles sont annulés', async () => {
    const loader = controllableLoader()
    const queue = new PrefetchQueue(loader.load, { concurrency: 2 })
    queue.update(['p1', 'p2', 'p3'])
    queue.update(['p20', 'p21', 'p2'])
    assert.deepEqual(loader.aborted, ['p1'])
    assert.deepEqual(loader.calls, ['p1', 'p2', 'p20'])
    assert.deepEqual(queue.size, { pending: 1, inflight: 2, loaded: 0 })
  })

  it('un échec est signalé, et retenté seulement s’il est redemandé', async () => {
    const loader = controllableLoader()
    const failed: string[] = []
    const queue = new PrefetchQueue(loader.load, { concurrency: 1, onFailed: (url) => failed.push(url) })
    queue.update(['x', 'y'])
    await loader.settle('x', false)
    assert.deepEqual(failed, ['x'])
    assert.deepEqual(loader.calls, ['x', 'y'])
    await loader.settle('y')
    queue.update(['x'])
    assert.deepEqual(loader.calls, ['x', 'y', 'x'])
  })

  it('une annulation n’est pas rapportée comme un échec', async () => {
    const loader = controllableLoader()
    const failed: string[] = []
    const queue = new PrefetchQueue(loader.load, { concurrency: 1, onFailed: (url) => failed.push(url) })
    queue.update(['old'])
    queue.update(['new'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(failed, [])
    assert.deepEqual(loader.calls, ['old', 'new'])
  })

  it('page affichée par le lecteur : retirée de l’attente', () => {
    const loader = controllableLoader()
    const queue = new PrefetchQueue(loader.load, { concurrency: 1 })
    queue.update(['a', 'b', 'c'])
    queue.markLoaded('b')
    assert.equal(queue.size.pending, 1)
  })

  it('dispose : tout s’arrête, plus rien ne démarre', () => {
    const loader = controllableLoader()
    const queue = new PrefetchQueue(loader.load, { concurrency: 2 })
    queue.update(['a', 'b', 'c'])
    queue.dispose()
    queue.update(['d'])
    assert.deepEqual(loader.aborted.sort(), ['a', 'b'])
    assert.deepEqual(loader.calls, ['a', 'b'])
  })
})
