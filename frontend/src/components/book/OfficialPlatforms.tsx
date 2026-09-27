import { useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '../../i18n'
import { DUR, EASE, gsap, useGSAP } from '../../lib/gsap'
import type { OfficialPlatform } from '../../types/reader'

interface OfficialPlatformsProps {
  platforms: OfficialPlatform[]
  /** Dans le lecteur, le texte d'explication est déjà affiché au-dessus. */
  showHeading?: boolean
}

/** Texte noir ou blanc selon la clarté de la couleur de marque (luminance relative). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) > 0.45 ? '#0b0b0f' : '#ffffff'
}

/** Icône du service ; si elle ne charge pas (ou n'existe pas), l'initiale sur sa couleur de marque. */
function PlatformLogo({ platform }: { platform: OfficialPlatform }) {
  const [failed, setFailed] = useState(false)
  if (platform.logo && !failed) {
    return (
      <img
        src={platform.logo}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-5 shrink-0 rounded-md object-contain"
      />
    )
  }
  const background = platform.color ?? '#3a3a44'
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-semibold"
      style={{ background, color: readableOn(background) }}
    >
      {platform.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/**
 * « Lire sur la plateforme officielle » : un bouton par service (MANGA Plus,
 * WEBTOON, Tappytoon…), ouvert dans un nouvel onglet, avec sa langue de
 * lecture. Fiche livre, et écran « aucun chapitre » du lecteur.
 */
export function OfficialPlatforms({ platforms, showHeading = true }: OfficialPlatformsProps) {
  const t = useT()
  const listRef = useRef<HTMLUListElement>(null)
  const names = new Intl.DisplayNames([t.locale], { type: 'language' })
  const languageName = (code: string | null) => {
    if (!code) return null
    const name = names.of(code)
    return name ? name.charAt(0).toLocaleUpperCase(t.locale) + name.slice(1) : null
  }

  useGSAP(
    () => {
      const items = listRef.current?.children
      if (items?.length) gsap.from(items, { opacity: 0, y: 6, duration: DUR.fast, ease: EASE.swift, stagger: 0.04 })
    },
    { dependencies: [platforms], revertOnUpdate: true },
  )

  if (platforms.length === 0) return null

  return (
    <section className="w-full text-left">
      {showHeading && (
        <>
          <h3 className="text-xs font-medium text-cream/90">{t.book.official.title}</h3>
          <p className="mt-0.5 text-[11px] text-mist">{t.book.official.hint}</p>
        </>
      )}
      <ul ref={listRef} className={`grid grid-cols-2 gap-2 ${showHeading ? 'mt-3' : ''}`}>
        {platforms.map((platform) => (
          <li key={platform.url}>
            <a
              href={platform.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.book.official.open(platform.name)}
              className="group flex h-full items-center gap-2.5 rounded-xl border border-white/10 bg-cream/[0.04] px-3 py-2.5 transition-colors hover:border-white/20 hover:bg-cream/[0.08] focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold"
              // Liseré à la couleur du service : reconnaissable d'un coup d'œil.
              style={platform.color ? { boxShadow: `inset 3px 0 0 ${platform.color}` } : undefined}
            >
              <PlatformLogo platform={platform} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-cream">{platform.name}</span>
                {platform.language && <span className="block truncate text-[10px] text-mist">{languageName(platform.language)}</span>}
              </span>
              <ExternalLink size={12} aria-hidden className="shrink-0 text-mist transition-colors group-hover:text-cream" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
