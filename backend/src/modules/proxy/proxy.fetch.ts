import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Téléchargement d'une image amont pour le relais `/api/proxy`. Les URL
 * viennent de sources externes : on ne leur fait pas confiance. Seuls des
 * hôtes publics en http(s) sont joints (redirections comprises), avec une
 * liste fermée d'en-têtes, une taille bornée et un type image obligatoire.
 */

const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3
/** Une page de scan dépasse rarement 3 Mo ; au-delà, c'est anormal. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Résolution DNS, remplaçable dans les tests (hôtes fictifs, pas de réseau). */
export const network = {
  lookup: async (hostname: string): Promise<string[]> =>
    (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address),
}

export class BlockedUrlError extends Error {}

function isPrivateV4(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** Adresses internes, locales, réservées ou multicast : jamais jointes par le relais. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(ip) === 4) return isPrivateV4(ip)
  if (isIP(ip) !== 6) return true
  if (ip === '::' || ip === '::1') return true
  // IPv4 encapsulée : `::ffff:127.0.0.1`, ou sa forme normalisée `::ffff:7f00:1`.
  const mapped = /^::ffff:(.+)$/.exec(ip)?.[1]
  if (mapped) {
    if (isIP(mapped) === 4) return isPrivateV4(mapped)
    const [high = '0', low = '0'] = mapped.split(':')
    const value = (Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16)
    return isPrivateV4([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'))
  }
  const first = Number.parseInt(ip.split(':')[0] || '0', 16)
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00
}

/** Refuse tout ce qui n'est pas une URL http(s) vers un hôte public. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedUrlError('URL invalide')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedUrlError(`protocole ${url.protocol} refusé`)
  if (url.username || url.password) throw new BlockedUrlError('identifiants dans l’URL refusés')

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError(`adresse interne ${host} refusée`)
    return url
  }
  // Nom sans point (`bookshelf-api`, `postgres`) : un conteneur voisin sur le réseau Docker.
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) {
    throw new BlockedUrlError(`hôte interne ${host} refusé`)
  }
  let addresses: string[]
  try {
    addresses = await network.lookup(host)
  } catch {
    throw new BlockedUrlError(`hôte ${host} introuvable`)
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new BlockedUrlError(`${host} pointe vers une adresse interne`)
  return url
}

/** En-têtes de provenance transmis au serveur d'images ; tout le reste est ignoré. */
const FORWARDED = new Map([
  ['referer', 'Referer'],
  ['origin', 'Origin'],
  ['user-agent', 'User-Agent'],
])

export function upstreamHeaders(provided: Record<string, string> | undefined, userAgent: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': userAgent, Accept: 'image/avif,image/webp,image/*;q=0.8' }
  for (const [name, value] of Object.entries(provided ?? {})) {
    const canonical = FORWARDED.get(name.toLowerCase())
    if (canonical && value && !/[\r\n]/.test(value)) headers[canonical] = value
  }
  return headers
}

export interface RelayedImage {
  body: Buffer
  contentType: string
}

type Attempt = { image: RelayedImage } | { retry: boolean; reason: string }

async function attempt(url: string, headers: Record<string, string>): Promise<Attempt> {
  let target: URL
  try {
    target = await assertPublicUrl(url)
  } catch (error) {
    return { retry: false, reason: error instanceof Error ? error.message : 'URL refusée' }
  }

  try {
    // Redirections suivies à la main : chaque saut repasse par `assertPublicUrl`.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        target = await assertPublicUrl(new URL(location, target).href)
        continue
      }
      if (!response.ok) return { retry: response.status >= 500 || response.status === 429, reason: `statut ${response.status}` }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) return { retry: false, reason: `type ${contentType || 'absent'}` }
      if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return { retry: false, reason: 'image trop lourde' }
      const body = Buffer.from(await response.arrayBuffer())
      if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) return { retry: false, reason: 'taille invalide' }
      return { image: { body, contentType } }
    }
    return { retry: false, reason: 'trop de redirections' }
  } catch (error) {
    if (error instanceof BlockedUrlError) return { retry: false, reason: error.message }
    // Réseau, délai dépassé : un raté passager mérite une seconde chance.
    return { retry: true, reason: error instanceof Error ? error.message : 'erreur réseau' }
  }
}

/**
 * Une image amont, ou `null` (l'appelant passe à la source suivante). Une
 * nouvelle tentative couvre les ratés passagers (réseau, 5xx, 429) ; une URL
 * refusée ou un 404 sont définitifs.
 */
export async function relayImage(
  page: { url: string; headers?: Record<string, string> },
  userAgent: string,
): Promise<{ image: RelayedImage | null; reason?: string }> {
  const headers = upstreamHeaders(page.headers, userAgent)
  const first = await attempt(page.url, headers)
  if ('image' in first) return { image: first.image }
  if (!first.retry) return { image: null, reason: first.reason }
  const second = await attempt(page.url, headers)
  return 'image' in second ? { image: second.image } : { image: null, reason: second.reason }
}
