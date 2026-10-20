/**
 * Type d'image d'après les OCTETS (jamais l'en-tête d'un serveur tiers) :
 * seuls les formats raster courants passent. Un SVG ou un HTML renvoyé par une
 * source hostile ne doit pas être servi depuis notre origine.
 */
export function sniffImageType(body: Uint8Array): string | null {
  const has = (offset: number, text: string) => text.split('').every((char, i) => body[offset + i] === char.charCodeAt(0))
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body[0] === 0x89 && has(1, 'PNG')) return 'image/png'
  if (has(0, 'GIF8')) return 'image/gif'
  if (has(0, 'RIFF') && has(8, 'WEBP')) return 'image/webp'
  if (has(4, 'ftyp') && (has(8, 'avif') || has(8, 'avis'))) return 'image/avif'
  return null
}
