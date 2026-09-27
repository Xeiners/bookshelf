/**
 * Plateformes de lecture officielles d'une œuvre — fonctions pures, testées
 * (`backend/test/official.test.ts`). Sources : les liens AniList de type
 * `STREAMING` (MANGA Plus, WEBTOON, Tappytoon, KakaoPage…), complétés par les
 * liens officiels de MangaDex (`raw` : éditeur d'origine, `engtl` : édition
 * anglaise) quand AniList ne les connaît pas.
 */
import type { Language } from '../../lib/language.js'

export interface OfficialPlatform {
  name: string
  url: string
  /** Icône du service (hébergée par AniList), à afficher si elle charge. */
  logo?: string
  /** Couleur de marque, `#rrggbb`. */
  color?: string
  /** Langue de lecture (code ISO 639-1), `null` si inconnue. */
  language: string | null
}

/** Lien externe tel qu'AniList le décrit (sous-ensemble utile). */
export interface ExternalLinkInput {
  url: string
  site: string
  type: string | null
  language: string | null
  icon: string | null
  color: string | null
  isDisabled: boolean | null
}

export interface PlatformSources {
  anilist: ExternalLinkInput[]
  /** `attributes.links` de MangaDex. */
  mangadexLinks: Record<string, string | undefined> | null
  /** Langue d'origine MangaDex (`ja`, `ko`, `zh-hk`…). */
  originalLanguage: string | null
}

/** Au-delà, la section devient une liste : on garde les plus utiles. */
export const MAX_PLATFORMS = 8

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en',
  french: 'fr',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  spanish: 'es',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  thai: 'th',
  indonesian: 'id',
  vietnamese: 'vi',
  russian: 'ru',
}

export const languageCode = (value: string | null | undefined): string | null =>
  value ? (LANGUAGE_CODES[value.trim().toLowerCase()] ?? null) : null

/** Noms lisibles des plateformes connues, pour les liens MangaDex (qui n'ont qu'une URL). */
const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)mangaplus\.shueisha\.co\.jp$/, 'MANGA Plus'],
  [/(^|\.)webtoons\.com$/, 'WEBTOON'],
  [/(^|\.)tappytoon\.com$/, 'Tappytoon'],
  [/(^|\.)page\.kakao\.com$/, 'KakaoPage'],
  [/(^|\.)webtoon\.kakao\.com$/, 'Kakao Webtoon'],
  [/(^|\.)comic\.naver\.com$/, 'Naver Webtoon'],
  [/(^|\.)series\.naver\.com$/, 'Naver Series'],
  [/(^|\.)izneo\.com$/, 'Izneo'],
  [/(^|\.)tapas\.io$/, 'Tapas'],
  [/(^|\.)lezhin\.com$/, 'Lezhin'],
  [/(^|\.)delitoon\.com$/, 'Delitoon'],
  [/(^|\.)piccoma\.com$/, 'Piccoma'],
  [/(^|\.)kmanga\.kodansha\.com$/, 'K MANGA'],
  [/(^|\.)pocket\.shonenmagazine\.com$/, 'Pocket Magazine'],
  [/(^|\.)comic-days\.com$/, 'Comic Days'],
  [/(^|\.)shonenjumpplus\.com$/, 'Shōnen Jump+'],
  [/(^|\.)viz\.com$/, 'VIZ'],
  [/(^|\.)comikey\.com$/, 'Comikey'],
  [/(^|\.)inkr\.com$/, 'INKR'],
  [/(^|\.)manta\.net$/, 'Manta'],
  [/(^|\.)yenpress\.com$/, 'Yen Press'],
]

/** URL https valide, sinon `null` : un lien d'API tiers ne doit jamais devenir `javascript:`. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function platformName(url: string): string {
  const host = new URL(url).hostname.toLowerCase()
  return KNOWN_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, '')
}

/** Même page, écrite différemment (`/` final, `www.`) : une seule fois. */
const identity = (url: string) => {
  const parsed = new URL(url)
  return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
}

/**
 * Plateformes à proposer, dans l'ordre utile au lecteur : sa langue, puis
 * l'autre langue de l'application (fr / en), puis la langue d'origine ;
 * les autres langues (thaï, allemand…) sont écartées, les langues inconnues
 * gardées en dernier. Bornées à `MAX_PLATFORMS`.
 */
export function buildOfficialPlatforms(sources: PlatformSources, language: Language): OfficialPlatform[] {
  const original = sources.originalLanguage?.slice(0, 2).toLowerCase() || null
  const candidates: OfficialPlatform[] = []

  for (const link of sources.anilist) {
    const url = safeUrl(link.url)
    if (!url || link.type !== 'STREAMING' || link.isDisabled) continue
    const logo = safeUrl(link.icon) ?? undefined
    const color = link.color && /^#[0-9a-f]{6}$/i.test(link.color) ? link.color : undefined
    candidates.push({ name: link.site.trim() || platformName(url), url, language: languageCode(link.language), ...(logo && { logo }), ...(color && { color }) })
  }

  // MangaDex : l'éditeur d'origine et l'édition anglaise officielle, s'ils manquent encore.
  const fromMangadex: [string | undefined, string | null][] = [
    [sources.mangadexLinks?.raw, original],
    [sources.mangadexLinks?.engtl, 'en'],
  ]
  for (const [raw, linkLanguage] of fromMangadex) {
    const url = safeUrl(raw)
    if (url) candidates.push({ name: platformName(url), url, language: linkLanguage })
  }

  const other = language === 'fr' ? 'en' : 'fr'
  const rank = (code: string | null) =>
    code === language ? 0 : code === other ? 1 : code !== null && code === original ? 2 : code === null ? 3 : -1

  const seen = new Set<string>()
  return candidates
    .filter((platform) => {
      const key = identity(platform.url)
      if (seen.has(key) || rank(platform.language) === -1) return false
      seen.add(key)
      return true
    })
    .map((platform, index) => ({ platform, index }))
    .sort((a, b) => rank(a.platform.language) - rank(b.platform.language) || a.index - b.index)
    .slice(0, MAX_PLATFORMS)
    .map(({ platform }) => platform)
}
