/**
 * Production uniquement : en dev, un service worker qui met en cache la
 * coquille entre en conflit avec le HMR de Vite et sert du code périmé.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(watchForUpdates)
      .catch((error: unknown) => {
        console.warn('[pwa] service worker non enregistré :', error)
      })
    // Le code du lecteur (chargé à la demande) passe par le cache dès maintenant :
    // il s'ouvrira hors-ligne même si la connexion tombe juste après un déploiement.
    window.setTimeout(preloadReader, READER_PRELOAD_DELAY_MS)
  })
}

const READER_PRELOAD_DELAY_MS = 4000
/** Au plus une vérification de mise à jour par quart d'heure. */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

/**
 * Une app installée revient souvent de l'arrière-plan sans recharger la page : le
 * navigateur ne cherche alors jamais la nouvelle version (ni son précache hors-ligne).
 * On la cherche au retour au premier plan.
 */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let lastCheck = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return
    lastCheck = Date.now()
    registration.update().catch(() => {})
  })
}

function preloadReader(): void {
  if (!navigator.onLine) return
  const run = () =>
    void Promise.all([
      import('../components/reader/UniversalReader'),
      import('../components/reader/EpubReader'),
      import('../components/reader/PdfReader'),
      import('../components/reader/CloudReader'),
    ]).catch(() => {})
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 })
  else run()
}
