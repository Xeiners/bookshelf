import { Worker } from 'node:worker_threads'
import { InvalidEpubError, type EpubMetadata } from './epub.parser.js'

/**
 * Lecture d'un EPUB envoyé par un utilisateur, dans un fil jetable avec délai
 * et mémoire plafonnés. Un fichier piégé (bombe ZIP dont la taille annoncée
 * ment, XML pathologique) ne peut plus figer la boucle d'événements de l'API :
 * au pire le fil est tué et l'envoi refusé.
 */
const TIMEOUT_MS = 8_000

export function parseEpubSandboxed(zip: Uint8Array): Promise<EpubMetadata> {
  return new Promise((resolve, reject) => {
    // Le fichier compilé est `.js`, le code source lancé par `tsx` est `.ts`.
    const source = import.meta.url.endsWith('.ts')
    const worker = new Worker(new URL(`./epub.worker.${source ? 'ts' : 'js'}`, import.meta.url), {
      workerData: zip,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    })
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      action()
    }
    const timer = setTimeout(() => finish(() => reject(new InvalidEpubError('EPUB trop long à analyser : fichier refusé.'))), TIMEOUT_MS)
    worker.once('message', (result: { ok: true; metadata: EpubMetadata } | { ok: false; invalid: boolean; message: string }) =>
      finish(() => (result.ok ? resolve(result.metadata) : reject(result.invalid ? new InvalidEpubError(result.message) : new Error(result.message)))),
    )
    worker.once('error', (error) => finish(() => { if (process.env.DEBUG_EPUB) console.error(error); reject(new InvalidEpubError('EPUB illisible ou trop lourd à analyser.')) }))
    worker.once('exit', (code) => finish(() => reject(new InvalidEpubError(`Analyse interrompue (${code}).`))))
  })
}
