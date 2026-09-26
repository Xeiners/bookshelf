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
 *  - couvertures (/api/covers, Open Library, AniList) → stale-while-revalidate, cache plafonné
 *  - pages de chapitre (/api/chapters/…/image/…) → cache d'abord (nom = empreinte du contenu) :
 *    le chapitre en cours, préchargé en entier, reste lisible hors-ligne
 *  - listes de chapitres et de pages → réseau d'abord, repli sur la dernière copie
 *  - reste de /api   → réseau uniquement (session, bibliothèque : jamais périmés)
 */

const VERSION = 'v4'
const SHELL_CACHE = `bookshelf-shell-${VERSION}`
const ASSET_CACHE = `bookshelf-assets-${VERSION}`
const IMAGE_CACHE = `bookshelf-covers-${VERSION}`
const PAGES_CACHE = `bookshelf-pages-${VERSION}`
const READER_DATA_CACHE = `bookshelf-reader-data-${VERSION}`

const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './favicon.svg']
const MAX_IMAGES = 200
/** Quelques chapitres complets (une page pèse 100 à 500 Ko). */
const MAX_PAGES = 400
const MAX_READER_DATA = 80

/** Couvertures des anciennes entrées de bibliothèque. */
const LEGACY_COVERS_HOST = 'covers.openlibrary.org'
/** Couvertures des œuvres connues d'AniList seulement (deck « Pour toi »). */
const ANILIST_COVERS_HOST = 's4.anilist.co'
const API_PREFIX = '/api/'
const COVERS_PREFIX = '/api/covers/'
/** `/api/chapters/<id>/image/<qualité>/<fichier>` */
const CHAPTER_IMAGE = /^\/api\/chapters\/[\w-]+\/image\//
/** `/api/chapters/<id>/pages` et `/api/manga/<id>/chapters` */
const READER_DATA = /^\/api\/(chapters\/[\w-]+\/pages|manga\/[\w-]+\/chapters)$/

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) =>
        // `reload` court-circuite le cache HTTP : on veut la version fraîche.
        cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))),
      ),
      // Échec sans gravité : ces fichiers seront mis en cache au prochain passage.
      precacheEntryAssets().catch(() => {}),
    ]),
  )
  // Pas de skipWaiting : la nouvelle version prend la main au prochain
  // démarrage, jamais en plein milieu d'une session.
})

/**
 * JS et CSS d'entrée (noms hachés), lus dans `index.html`. À la première visite,
 * la page les charge AVANT que le Service Worker n'en prenne le contrôle : sans
 * ce précache, ils ne passeraient jamais par lui et l'application ne pourrait
 * pas démarrer hors-ligne (le chapitre en cache serait alors inaccessible).
 */
async function precacheEntryAssets() {
  const response = await fetch('./index.html', { cache: 'reload' })
  const html = await response.text()
  const urls = [...new Set(html.match(/\/assets\/[^"'\s>]+/g) ?? [])]
  const cache = await caches.open(ASSET_CACHE)
  await cache.addAll(urls)
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const current = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE, PAGES_CACHE, READER_DATA_CACHE])
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
  // `ignoreVary` : un fichier haché est immuable. Sans ça, une copie précachée
  // (sans en-tête Origin) ne sert jamais une balise `crossorigin` (avec).
  const cached = await caches.match(request, { ignoreVary: true })
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

  const network = fetch(request).then((response) => {
    // Seules les vraies images sont gardées : jamais une erreur, ni une
    // réponse opaque (sans statut lisible, et très coûteuse en quota).
    const isImage = response.headers.get('content-type')?.startsWith('image/')
    if (response.ok && response.type !== 'opaque' && isImage) {
      cache
        .put(request, response.clone())
        .then(() => trimCache(cacheName, MAX_IMAGES))
        .catch(() => {})
    }
    return response
  })

  if (cached) {
    // Revalidation en arrière-plan : un échec ici ne concerne pas l'image affichée.
    network.catch(() => {})
    return cached
  }
  // Pas de copie locale : la réponse (ou l'erreur) du réseau telle quelle.
  // Avant, un échec réseau résolvait `respondWith` avec `undefined`.
  return network
}

/**
 * Page de chapitre : immuable (le nom de fichier est l'empreinte de l'image),
 * donc servie depuis le cache dès qu'elle y est. Un repli « Data Saver » servi
 * à la place de l'originale (en-tête `X-Reader-Quality`) n'est pas gardé.
 */
async function chapterImage(request) {
  const cache = await caches.open(PAGES_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  const isImage = response.headers.get('content-type')?.startsWith('image/')
  if (response.ok && isImage && !response.headers.has('x-reader-quality')) {
    cache
      .put(request, response.clone())
      .then(() => trimCache(PAGES_CACHE, MAX_PAGES))
      .catch(() => {})
  }
  return response
}

/** Listes du lecteur : toujours fraîches en ligne, dernière copie connue hors-ligne. */
async function networkFirstData(request) {
  const cache = await caches.open(READER_DATA_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache
        .put(request, response.clone())
        .then(() => trimCache(READER_DATA_CACHE, MAX_READER_DATA))
        .catch(() => {})
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
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

  // Couvertures : immuables par nom de fichier, idéales pour le hors-ligne.
  if (url.pathname.startsWith(COVERS_PREFIX) || url.hostname === LEGACY_COVERS_HOST || url.hostname === ANILIST_COVERS_HOST) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // Lecteur : pages de chapitre et listes, pour lire hors-ligne le chapitre en cours.
  if (url.origin === self.location.origin && CHAPTER_IMAGE.test(url.pathname)) {
    event.respondWith(chapterImage(request))
    return
  }
  if (url.origin === self.location.origin && READER_DATA.test(url.pathname)) {
    event.respondWith(networkFirstData(request))
    return
  }

  // Session, bibliothèque, catalogue : jamais servis depuis le cache.
  // Cette règle DOIT précéder le cache-first de même origine ci-dessous.
  if (url.pathname.startsWith(API_PREFIX)) return

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})
