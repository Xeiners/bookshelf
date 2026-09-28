import type { Dictionary } from '../i18n/fr'
import type { Book } from '../types/book'

/** Vitesse de lecture moyenne retenue : ~1,15 min par page. */
const MINUTES_PER_PAGE = 1.15

export function readingMinutes(pages: number | null): number | null {
  if (!pages || pages <= 0) return null
  return Math.round(pages * MINUTES_PER_PAGE)
}

/** 312 pages → « 6 h » / « 45 min ». */
export function formatReadingTime(pages: number | null, t: Dictionary): string | null {
  const minutes = readingMinutes(pages)
  if (minutes === null) return null
  if (minutes < 60) return t.book.minutes(minutes)
  return t.book.hours(Math.round(minutes / 60))
}

export function formatAuthors(authors: string[], t: Dictionary): string {
  if (authors.length === 0) return t.book.unknownAuthor
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
export function primaryCategory(book: Book, t: Dictionary): string {
  const raw = book.categories[0]
  if (!raw) return t.book.fallbackCategory
  const short = raw.split(/[/&,]/)[0]?.trim() ?? raw
  // Troncature typographique : « … » n'appartient à aucune langue.
  return short.length > 22 ? `${short.slice(0, 21)}…` : short // i18n-ignore
}

/** Taille lisible dans la langue de l'interface : « 12,3 Mo », « 1.2 GB »… */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['kilobyte', 'megabyte', 'gigabyte'] as const
  let value = Math.max(0, bytes) / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}
