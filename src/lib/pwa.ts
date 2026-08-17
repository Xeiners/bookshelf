/**
 * Production uniquement : en dev, un service worker qui met en cache la
 * coquille entre en conflit avec le HMR de Vite et sert du code périmé.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      console.warn('[pwa] service worker non enregistré :', error)
    })
  })
}
