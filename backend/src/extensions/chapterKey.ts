/**
 * Identifiants de chapitre publics, vus par le front, le Service Worker et la
 * progression enregistrée.
 *
 * - MangaDex garde son UUID nu : les positions déjà sauvegardées, les caches
 *   hors-ligne et les URL existantes restent valables.
 * - Toute autre source : `<source>~<id brut en base64url>`. Aucun caractère à
 *   échapper dans une URL, et l'identifiant brut (souvent un chemin, un slug
 *   avec des « / ») ne peut pas s'évader du segment de route.
 */

export const MANGADEX_SOURCE_ID = 'mangadex'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SOURCE_ID = /^[a-z0-9]{2,24}$/
const KEY = /^([a-z0-9]{2,24})~([A-Za-z0-9_-]{1,700})$/

export function encodeChapterKey(sourceId: string, rawId: string): string {
  if (sourceId === MANGADEX_SOURCE_ID) return rawId
  return `${sourceId}~${Buffer.from(rawId, 'utf8').toString('base64url')}`
}

export function decodeChapterKey(key: string): { sourceId: string; rawId: string } | null {
  if (UUID.test(key)) return { sourceId: MANGADEX_SOURCE_ID, rawId: key }
  const match = KEY.exec(key)
  if (!match || match[1] === MANGADEX_SOURCE_ID) return null
  const rawId = Buffer.from(match[2]!, 'base64url').toString('utf8')
  return rawId ? { sourceId: match[1]!, rawId } : null
}

export const isChapterKey = (value: string) => decodeChapterKey(value) !== null
