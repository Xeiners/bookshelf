/**
 * Reconnaissance des fichiers importés — pure, testée (`frontend/test/formats.test.ts`).
 * On lit la signature du fichier plutôt que de croire son extension : beaucoup
 * de « .cbr » sont en réalité des ZIP renommés, parfaitement lisibles.
 */
import type { LocalFormat } from '../../types/reader'

export type SniffResult = { format: LocalFormat } | { unsupported: 'cbr' | 'unknown' }

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

const PDF = [0x25, 0x50, 0x44, 0x46] // %PDF
const ZIP = [0x50, 0x4b, 0x03, 0x04] // PK\3\4
const RAR = [0x52, 0x61, 0x72, 0x21] // Rar!
/** Un EPUB commence par l'entrée `mimetype` non compressée : `application/epub+zip`. */
const EPUB_MIMETYPE = 'application/epub+zip'

/** Nombre d'octets à lire en tête de fichier pour reconnaître son format. */
export const SNIFF_BYTES = 64

export function sniffFormat(name: string, head: Uint8Array): SniffResult {
  if (startsWith(head, PDF)) return { format: 'pdf' }
  if (startsWith(head, RAR)) return { unsupported: 'cbr' }
  if (startsWith(head, ZIP)) {
    const text = new TextDecoder('latin1').decode(head.subarray(30, 30 + 8 + EPUB_MIMETYPE.length))
    if (text.includes(EPUB_MIMETYPE) || /\.epub$/i.test(name)) return { format: 'epub' }
    return { format: 'cbz' }
  }
  return { unsupported: 'unknown' }
}

/** Titre lisible depuis un nom de fichier : « One_Piece_v01.cbz » → « One Piece v01 ». */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base || name
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

/** Type MIME d'une image d'archive d'après son extension, `null` si ce n'est pas une image. */
export function imageTypeOf(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_TYPES[extension] ?? null
}

/** Entrée d'archive à afficher : image, hors dossiers système (`__MACOSX`, fichiers cachés). */
export function isPageEntry(path: string): boolean {
  const parts = path.split('/')
  if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) return false
  return imageTypeOf(path) !== null
}
