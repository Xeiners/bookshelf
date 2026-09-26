import { unzip } from 'fflate'
import type { ReaderPage } from '../../types/reader'
import { imageTypeOf, isPageEntry } from './formats'
import { naturalCompare } from './navigation'

export interface ArchivePages {
  pages: ReaderPage[]
  /** Libère les URL `blob:` (à appeler en quittant le lecteur). */
  release: () => void
}

/**
 * Pages d'une archive CBZ : images seulement, dans l'ordre naturel des noms.
 * `fflate.unzip` décompresse dans des workers : l'interface reste fluide même
 * sur un volume de 100 Mo.
 */
export async function openArchive(blob: Blob): Promise<ArchivePages> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, { filter: (file) => isPageEntry(file.name) }, (error, result) => (error ? reject(error) : resolve(result)))
  })

  const names = Object.keys(files).sort(naturalCompare)
  const urls = names.map((name) => {
    const data = files[name] ?? new Uint8Array()
    return URL.createObjectURL(new Blob([data as BlobPart], { type: imageTypeOf(name) ?? 'application/octet-stream' }))
  })

  return {
    pages: urls.map((url, index) => ({ index, url, fallbackUrl: null })),
    release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  }
}
