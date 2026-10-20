import { parentPort, workerData } from 'node:worker_threads'

/**
 * Fil d'exécution jetable : lit l'EPUB reçu et renvoie ses métadonnées (ou l'erreur).
 * Lancé depuis le code source (développement, tests), le fil n'hérite pas du
 * chargeur TypeScript du processus principal : on le réinstalle ici.
 */
if (import.meta.url.endsWith('.ts')) (await import('tsx/esm/api')).register()
const { InvalidEpubError, parseEpub } = await import('./epub.parser.js')

try {
  parentPort?.postMessage({ ok: true, metadata: parseEpub(workerData as Uint8Array) })
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    invalid: error instanceof InvalidEpubError,
    message: error instanceof Error ? error.message : 'EPUB illisible.',
  })
}
