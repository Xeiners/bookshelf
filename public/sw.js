/**
 * Service worker de Bookshelf — écrit à la main, sans Workbox.
 *
 * Pourquoi pas de précache généré au build ? Les noms de fichiers sont hachés
 * par Vite, donc inconnus à l'écriture. On mise plutôt sur du cache runtime :
 * après la première visite, la coquille et les assets sont en cache et l'app
 * démarre hors-ligne. Zéro dépendance, zéro étape de build supplémentaire.
 *
 * Stratégies :
 *  - navigation      → réseau d'abord, repli sur la coquille en cache
 *  - /assets/* (hachés) → cache d'abord (immuables par construction)
 *  - couvertures     → stale-while-revalidate, cache plafonné
 *  - API Open Library → réseau uniquement (jamais de résultats périmés)
 */

const VERSION = 'v1'
const SHELL_CACHE = `bookshelf-shell-${VERSION}`
const ASSET_CACHE = `bookshelf-assets-${VERSION}`
const IMAGE_CACHE = `bookshelf-covers-${VERSION}`

const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './favicon.svg']
const MAX_IMAGES = 80

const COVERS_HOST = 'covers.openlibrary.org'
const API_HOST = 'openlibrary.org'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // `reload` court-circuite le cache HTTP : on veut la version fraîche.
      cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  )
  // Pas de skipWaiting : la nouvelle version prend la main au prochain
  // démarrage, jamais en plein milieu d'une session.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const current = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE])
      await Promise.all(keys.filter((key) => !current.has(key)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

/** Supprime les entrées les plus anciennes au-delà de `max`. */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)))
}

async function networkFirstShell(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(SHELL_CACHE)
    cache.put('./index.html', response.clone())
    return response
  } catch {
    const cached = (await caches.match('./index.html')) ?? (await caches.match('./'))
    if (cached) return cached
    return new Response('Hors-ligne', { status: 503, statusText: 'Hors-ligne' })
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
        trimCache(cacheName, MAX_IMAGES)
      }
      return response
    })
    .catch(() => cached)

  return cached ?? network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Documents : réseau d'abord pour toujours servir la dernière version.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }

  if (url.hostname === COVERS_HOST) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // Recherches et fiches : jamais servies depuis le cache.
  if (url.hostname === API_HOST) return

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})
