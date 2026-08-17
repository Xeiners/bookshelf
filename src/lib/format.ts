import type { Book } from '../types/book'

/** Vitesse de lecture moyenne retenue : ~1,15 min par page. */
const MINUTES_PER_PAGE = 1.15

export function readingMinutes(pages: number | null): number | null {
  if (!pages || pages <= 0) return null
  return Math.round(pages * MINUTES_PER_PAGE)
}

/** 312 pages → « 6 h » / « 45 min ». */
export function formatReadingTime(pages: number | null): string | null {
  const minutes = readingMinutes(pages)
  if (minutes === null) return null
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return `${hours} h`
}

export function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return 'Auteur inconnu'
  if (authors.length <= 2) return authors.join(' & ')
  return `${authors[0]} +${authors.length - 1}`
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** Les descriptions Google Books contiennent du HTML : on nettoie. */
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#39|apos|rsquo);/g, '’')
    .replace(/&(quot|ldquo|rdquo);/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Hash déterministe → teinte stable par livre (couvertures procédurales). */
export function hueFromString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}

/** Dégradé de secours quand l'API ne fournit pas de visuel exploitable. */
export function proceduralGradient(seed: string): string {
  const hue = hueFromString(seed)
  return `linear-gradient(150deg,
    hsl(${hue} 62% 22%) 0%,
    hsl(${(hue + 38) % 360} 48% 12%) 55%,
    hsl(${(hue + 74) % 360} 40% 8%) 100%)`
}

/** Genre principal, raccourci pour l'affichage en pilule. */
export function primaryCategory(book: Book): string {
  const raw = book.categories[0]
  if (!raw) return 'Découverte'
  const short = raw.split(/[/&,]/)[0]?.trim() ?? raw
  return short.length > 22 ? `${short.slice(0, 21)}…` : short
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`)
}
