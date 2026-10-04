/**
 * Service worker de Bookshelf — écrit à la main, sans Workbox.
 *
 * Pourquoi pas de précache généré au build ? Les noms de fichiers sont hachés
 * par Vite, donc inconnus à l'écriture. On mise plutôt sur du cache runtime :
 * après la première visite, la coquille et les assets sont en cache et l'app
 * démarre hors-ligne. Zéro dépendance, zéro étape de build supplémentaire.
 *
 * Stratégies :
 *  - installation    → précache de TOUT le code du build (liste injectée au build)
 *  - navigation      → réseau d'abord (4 s max), repli sur la coquille en cache
 *  - /assets/* (hachés) → cache d'abord (immuables par construction)
 *  - couvertures (/api/covers, Open Library) → stale-while-revalidate, cache plafonné
 *  - pages de chapitre (/api/chapters/…/image/…, et /api/proxy/page/… pour les autres sources)
 *    → cache d'abord : le chapitre en cours, préchargé en entier, reste lisible hors-ligne
 *  - listes de chapitres et de pages → réseau d'abord (4 s max), repli sur la dernière copie
 *  - couvertures des romans du compte (/api/books/<id>/cover) → stale-while-revalidate,
 *    dans un cache « privé » que la déconnexion efface (cf. useNovelStore.clear)
 *  - reste de /api   → réseau uniquement (session, bibliothèque : jamais périmés).
 *    Les fichiers EPUB du compte n'y passent pas : IndexedDB les garde (cloudBooks.ts).
 */

const VERSION = 'v6'
/**
 * Remplacé au build (cf. `precacheManifest` dans vite.config.ts) : l'empreinte du build
 * et TOUS ses fichiers (`assets/…`), lecteur compris. Ce fichier change donc à chaque
 * déploiement : le navigateur installe la nouvelle version, qui précache tout.
 */
const PRECACHE = self.__BOOKSHELF_PRECACHE__ ?? { build: 'dev', assets: [] }
/** Réseau trop lent (connexion faible) : on sert la copie locale au-delà de ce délai. */
const NETWORK_TIMEOUT_MS = 4000
const SHELL_CACHE = `bookshelf-shell-${VERSION}`
const ASSET_CACHE = `bookshelf-assets-${VERSION}`
const IMAGE_CACHE = `bookshelf-covers-${VERSION}`
const PAGES_CACHE = `bookshelf-pages-${VERSION}`
const READER_DATA_CACHE = `bookshelf-reader-data-${VERSION}`
/** Données d'un compte : le préfixe `bookshelf-private-` est effacé à la déconnexion. */
const PRIVATE_CACHE = `bookshelf-private-${VERSION}`

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './favicon.ico',
  './apple-touch-icon.png',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
]
const MAX_IMAGES = 200
/** Quelques chapitres complets (une page pèse 100 à 500 Ko). */
const MAX_PAGES = 400
const MAX_READER_DATA = 80

/** Couvertures des anciennes entrées de bibliothèque. */
const LEGACY_COVERS_HOST = 'covers.openlibrary.org'
const API_PREFIX = '/api/'
const COVERS_PREFIX = '/api/covers/'
/**
 * `/api/chapters/<id>/image/<qualité>/<fichier>` (MangaDex) et
 * `/api/proxy/page/<source~id>/<index>` (autres sources, relais générique).
 */
const CHAPTER_IMAGE = /^\/api\/(chapters\/[\w-]+\/image|proxy\/page)\//
/** `/api/chapters/<id>/pages` (UUID MangaDex ou `source~id`) et `/api/manga/<id>/chapters` */
const READER_DATA = /^\/api\/(chapters\/[\w~-]+\/pages|manga\/[\w-]+\/chapters)$/
/** Couverture extraite d'un EPUB du compte : `/api/books/<id>/cover?v=<empreinte>`. */
const NOVEL_COVER = /^\/api\/books\/[\w-]+\/cover$/

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) =>
        // `reload` court-circuite le cache HTTP : on veut la version fraîche.
        cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))),
      ),
      precacheAssets(),
    ]),
  )
  // Pas de skipWaiting : la nouvelle version prend la main au prochain
  // démarrage, jamais en plein milieu d'une session.
})

/**
 * Tout le code de l'app, y compris ce qui n'est chargé qu'à la demande (le lecteur, ses
 * moteurs EPUB et PDF, le worker de pdf.js…). Sans ça, le lecteur n'était en cache que
 * si on l'avait ouvert EN LIGNE depuis le dernier déploiement : hors-ligne, il ne
 * s'ouvrait qu'une fois sur quatre.
 *
 * Les fichiers sont hachés (immuables) : ceux déjà en cache ne sont pas retéléchargés.
 * Un fichier manquant fait échouer l'installation : l'ancienne version reste en place
 * et le navigateur réessaie au prochain passage, plutôt qu'un hors-ligne à trous.
 */
async function precacheAssets() {
  const cache = await caches.open(ASSET_CACHE)
  const urls = PRECACHE.assets.length > 0 ? PRECACHE.assets.map((file) => `./${file}`) : await entryAssets()
  const missing = []
  for (const url of urls) if (!(await cache.match(url, { ignoreVary: true }))) missing.push(url)
  // Quelques téléchargements à la fois : une connexion mobile ne sature pas.
  const queue = [...missing]
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await cacheOne(cache, url)
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}

/** Un fichier, avec une seconde chance (réseau mobile capricieux). */
async function cacheOne(cache, url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'reload' })
      if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`)
      await cache.put(url, response)
      return
    } catch (error) {
      if (attempt >= 1) throw error
    }
  }
}

/** Sans liste (source non construite) : les JS et CSS d'entrée, lus dans `index.html`. */
async function entryAssets() {
  const response = await fetch('./index.html', { cache: 'reload' })
  const html = await response.text()
  return [...new Set(html.match(/\/assets\/[^"'\s>]+/g) ?? [])]
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const current = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE, PAGES_CACHE, READER_DATA_CACHE, PRIVATE_CACHE])
      await Promise.all(keys.filter((key) => !current.has(key)).map((key) => caches.delete(key)))
      await pruneOldAssets()
      await self.clients.claim()
    })(),
  )
})

/** Le code des builds précédents (autres noms hachés) : inutile, on libère la place. */
async function pruneOldAssets() {
  if (PRECACHE.assets.length === 0) return
  const keep = new Set(PRECACHE.assets.map((file) => new URL(`./${file}`, self.location.href).pathname))
  const cache = await caches.open(ASSET_CACHE)
  const keys = await cache.keys()
  await Promise.all(keys.filter((request) => !keep.has(new URL(request.url).pathname)).map((request) => cache.delete(request)))
}

/**
 * Le réseau, ou `fallback()` s'il échoue OU tarde (connexion faible : la requête ne
 * répond ni n'échoue). La réponse tardive sert quand même : `onResponse` la range.
 */
function networkOr(request, fallback, onResponse) {
  const network = fetch(request).then((response) => {
    onResponse(response.clone())
    return response
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const useFallback = async (error) => {
      if (settled) return
      const cached = await fallback()
      if (settled) return
      if (cached) {
        settled = true
        resolve(cached)
      } else if (error) {
        settled = true
        reject(error)
      }
    }
    const timer = setTimeout(() => useFallback(null), NETWORK_TIMEOUT_MS)
    network.then(
      (response) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve(response)
        }
      },
      (error) => {
        clearTimeout(timer)
        useFallback(error)
      },
    )
  })
}

/** Supprime les entrées les plus anciennes au-delà de `max`. */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)))
}

async function networkFirstShell(request) {
  const shell = async () => (await caches.match('./index.html')) ?? (await caches.match('./'))
  try {
    return await networkOr(request, shell, (response) => {
      if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', response)).catch(() => {})
    })
  } catch {
    return (await shell()) ?? new Response('Hors-ligne', { status: 503, statusText: 'Hors-ligne' })
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
 * donc servie depuis le cache dès qu'elle y est. Un repli n'est pas gardé :
 * « Data Saver » servi à la place de l'originale (en-tête `X-Reader-Quality`),
 * ou page d'une autre source (en-tête `X-Reader-Fallback`).
 */
async function chapterImage(request) {
  const cache = await caches.open(PAGES_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  const isImage = response.headers.get('content-type')?.startsWith('image/')
  const degraded = response.headers.has('x-reader-quality') || response.headers.has('x-reader-fallback')
  if (response.ok && isImage && !degraded) {
    cache
      .put(request, response.clone())
      .then(() => trimCache(PAGES_CACHE, MAX_PAGES))
      .catch(() => {})
  }
  return response
}

/** Listes du lecteur : toujours fraîches en ligne, dernière copie connue hors-ligne (ou réseau trop lent). */
async function networkFirstData(request) {
  const cache = await caches.open(READER_DATA_CACHE)
  return networkOr(
    request,
    () => cache.match(request),
    (response) => {
      if (!response.ok) return
      cache
        .put(request, response)
        .then(() => trimCache(READER_DATA_CACHE, MAX_READER_DATA))
        .catch(() => {})
    },
  )
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
  if (url.pathname.startsWith(COVERS_PREFIX) || url.hostname === LEGACY_COVERS_HOST) {
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
  // Couvertures des romans du compte : affichées hors-ligne dans « Mes romans ».
  if (url.origin === self.location.origin && NOVEL_COVER.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, PRIVATE_CACHE))
    return
  }

  // Session, bibliothèque, catalogue : jamais servis depuis le cache.
  // Cette règle DOIT précéder le cache-first de même origine ci-dessous.
  if (url.pathname.startsWith(API_PREFIX)) return

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})
