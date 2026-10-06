import { forgetAllDownloads } from './reader/cloudBooks'

/**
 * Caches du Service Worker (cf. `public/sw.js`) qui se reconstituent seuls :
 * couvertures, pages de chapitres, données du lecteur, couvertures des romans.
 * L'app elle-même (`shell`, `assets`) reste : elle doit démarrer hors-ligne. Les chapitres
 * téléchargés (`downloads`) aussi : ils se gèrent dans « Mes téléchargements ».
 */
const DISPOSABLE_CACHES = /^bookshelf-(covers|pages|reader-data|private)-/

/** Espace occupé par l'app sur cet appareil (IndexedDB, caches…), en octets ; `null` si inconnu. */
export async function deviceUsage(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return estimate?.usage ?? null
  } catch {
    return null
  }
}

/**
 * Vide le cache local : romans téléchargés (ils restent sur le compte),
 * positions EPUB précalculées, images et pages gardées pour le hors-ligne.
 * Jamais les fichiers importés sur l'appareil, ni la bibliothèque, ni une
 * position de lecture pas encore envoyée.
 */
export async function clearLocalCache(): Promise<void> {
  await forgetAllDownloads().catch(() => {})
  const keys = await globalThis.caches?.keys().catch(() => [] as string[])
  await Promise.all((keys ?? []).filter((key) => DISPOSABLE_CACHES.test(key)).map((key) => caches.delete(key)))
}
