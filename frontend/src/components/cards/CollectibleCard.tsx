import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useHoloTilt } from '../../hooks/useHoloTilt'
import { useT } from '../../i18n'
import { RARITY_STYLE, type Rarity } from '../../lib/boosters'
import { CARD_FRAMES } from './cardFrames'
import { LegendaryCard, MythicCard } from './PremiumCard'

/** Format d'une carte à collectionner (63 × 88 mm). */
export const CARD_RATIO = 88 / 63

export interface CardFace {
  title: string
  imageUrl: string
  rarity: Rarity
  number: number
  /** Carte de personnage (Série 3) : illustration de plus en plus pleine avec la rareté. */
  characterName?: string | null
  /** Œuvre du personnage, sous son nom. */
  mangaTitle?: string
}

/**
 * Cartes de personnages, de la Commune au cadre classique à l'Épique pleine image.
 * 1 : l'illustration remplit tout l'intérieur du cadre, le texte passe dessus.
 * 2 : pleine image bord à bord, foil gravé.
 * Légendaire et Mythique ont leur propre carte, toutes séries confondues (cf. `PremiumCard`).
 */
const FULL_ART_LEVEL: Record<Rarity, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 0, MYTHIC: 0 }

/** Foil gravé des pleines images : fines lignes qui s'allument à l'inclinaison. */
const ETCHED_LAYER: CSSProperties = {
  background: 'repeating-linear-gradient(62deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 5px), repeating-linear-gradient(-28deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 7px)',
  mixBlendMode: 'overlay',
}

/** Couleur du nom et du liseré, par niveau de pleine image. */
const FULL_ART_ACCENT: Record<number, { ring: string; name: string; glow: string }> = {
  1: { ring: 'transparent', name: '#f7f5f0', glow: '0 2px 10px rgba(0,0,0,0.85)' },
  2: { ring: 'rgba(214,147,255,0.9)', name: '#f7f5f0', glow: '0 2px 10px rgba(0,0,0,0.85), 0 0 16px rgba(180,108,255,0.55)' },
}

interface CollectibleCardProps {
  card: CardFace
  width: number
  /** `false` : ombre chinoise (carte pas encore obtenue). */
  owned?: boolean
  /** Inclinaison et reflet à la souris (et au gyroscope si `gyro`). */
  interactive?: boolean
  gyro?: boolean
  /** Effets en boucle (aura, étincelles, iridescence) ; coupés dans les très petites vignettes. */
  effects?: boolean
  /** Pastille en haut à gauche (« Nouvelle », ×3…). */
  badge?: ReactNode
  /** Image chargée en différé (album) ou tout de suite (révélation). */
  lazy?: boolean
  className?: string
}

/** Reflet arc-en-ciel : ses bandes glissent avec le pointeur (`--mx`, `--my`). */
const HOLO_LAYER: CSSProperties = {
  background:
    'repeating-linear-gradient(115deg, #ff5ec4 0%, #ffc46b 7%, #3fe0a0 14%, #4cc9f0 21%, #b46cff 28%, #ff5ec4 35%)',
  backgroundSize: '240% 240%',
  backgroundPosition: 'var(--mx, 50%) var(--my, 50%)',
  mixBlendMode: 'color-dodge',
}

const GLARE_LAYER: CSSProperties = {
  background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.55), transparent 48%)',
  mixBlendMode: 'overlay',
}

/** Biseau du métal : arête claire en haut, sombre en bas. */
const BEVEL = 'inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.25)'

/**
 * Une carte de la collection : une œuvre, sa couverture, sa rareté.
 * Cadre en métal biseauté selon la rareté (argent mat, cobalt brillant,
 * violet néon à l'aura pulsante, or ciselé étincelant, iridescence
 * tournante) ; reflet holographique réactif pour les Épiques et au-delà ;
 * ombre chinoise pour une carte pas encore obtenue. Seuls `transform` et
 * `opacity` (et des variables CSS) bougent.
 */
export function CollectibleCard({
  card,
  width,
  owned = true,
  interactive = false,
  gyro = false,
  effects = true,
  badge,
  lazy = true,
  className = '',
}: CollectibleCardProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const frame = CARD_FRAMES[card.rarity]
  const holo = owned && RARITY_STYLE[card.rarity].holo
  const fx = owned && effects
  useHoloTilt(ref, interactive && owned, { gyro })

  const height = Math.round(width * CARD_RATIO)
  const font = Math.max(9, Math.round(width * 0.07))
  const border = Math.max(3, Math.round(width * 0.04))
  const rarityLabel = t.cards.rarity[card.rarity]
  const radius = 'rounded-[9%/6.5%]'
  /** Petite carte (album sur téléphone) : pastille resserrée, numéro court, pour que « Légendaire » tienne. */
  const compact = width < 150
  /** Pleine image (cartes de personnages possédées) : 0 = cadre classique. */
  const level = owned && card.characterName ? FULL_ART_LEVEL[card.rarity] : 0
  /** Légendaire et Mythique possédées : leur propre carte (relique dorée, prisme céleste). */
  const premium = owned && (card.rarity === 'LEGENDARY' || card.rarity === 'MYTHIC')
  const subtitle = card.characterName ? card.mangaTitle : undefined
  const pill = (
    <span
      className={`inline-flex min-w-0 items-center gap-[0.3em] truncate rounded-full px-[0.55em] py-[0.12em] leading-[1.35] font-semibold uppercase ${compact ? 'tracking-[0.03em]' : 'tracking-[0.12em]'}`}
      style={{
        fontSize: Math.max(7, font * (compact ? 0.6 : 0.66)),
        background: owned ? frame.badge : 'rgba(255,255,255,0.05)',
        color: owned ? frame.badgeText : '#4a4858',
        boxShadow: owned ? 'inset 0 1px 0 rgba(255,255,255,0.5)' : undefined,
      }}
    >
      {!compact && <span aria-hidden className="inline-block size-[0.6em] shrink-0 rotate-45 rounded-[1px] bg-current opacity-80" />}
      <span className="truncate">{rarityLabel}</span>
    </span>
  )
  const numberLabel = compact ? `#${String(card.number).padStart(3, '0')}` : t.cards.number(card.number)

  return (
    <div
      ref={ref}
      role="img"
      aria-label={owned ? t.cards.cardAria(card.title, rarityLabel) : t.cards.missing(card.number)}
      className={`relative isolate shrink-0 select-none ${className}`}
      style={{
        width,
        height,
        // Transform 3D (calque GPU) seulement si la carte s'incline : 300 calques pour rien faisaient ramer l'album.
        // Pas de transition CSS : `useHoloTilt` lisse déjà le mouvement à chaque image (un second amortissement le rendait mou et en retard).
        ...(interactive && owned && {
          transform: 'perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
        }),
      }}
    >
      {/* Aura pulsante (Épique et au-delà), derrière la carte. */}
      {fx && frame.aura && (
        <div
          aria-hidden
          data-card-fx
          className="pointer-events-none absolute -inset-[14%] -z-10"
          style={{ background: frame.aura, animation: 'card-aura 2.8s ease-in-out infinite' }}
        />
      )}

      {premium ? (
        card.rarity === 'MYTHIC' ? (
          <MythicCard card={card} width={width} border={border} font={font} fx={fx} lazy={lazy} pill={pill} numberLabel={numberLabel} />
        ) : (
          <LegendaryCard card={card} width={width} border={border} font={font} fx={fx} lazy={lazy} pill={pill} numberLabel={numberLabel} />
        )
      ) : level > 0 ? (
        <FullArt card={card} level={level} radius={radius} border={border} font={font} frame={frame} lazy={lazy} pill={pill} numberLabel={numberLabel} />
      ) : (
        <>
        {/* Cadre en métal, biseauté. */}
        <div
          aria-hidden
          className={`absolute inset-0 overflow-hidden ${radius}`}
          style={{
            background: owned ? frame.metal : '#1c1b25',
            boxShadow: owned ? `${BEVEL}, 0 14px 30px -14px rgba(0,0,0,0.9)` : BEVEL,
          }}
        >
          {owned && frame.gloss && (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.6), transparent 38%)' }} />
          )}
        </div>

        {/* Panneau intérieur : illustration, puis cartouche gravé. */}
        <div
          className={`absolute flex flex-col overflow-hidden rounded-[7%/5%] bg-ink`}
          style={{
            inset: border,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.65), 0 0 0 2px rgba(255,255,255,0.16), inset 0 2px 6px rgba(0,0,0,0.6)',
          }}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
            <img
              src={card.imageUrl}
              alt=""
              draggable={false}
              loading={lazy ? 'lazy' : 'eager'}
              decoding="async"
              className="h-full w-full object-cover"
              // Ombre chinoise gris foncé : l'illustration se devine, sans se révéler.
              style={owned ? undefined : { filter: 'grayscale(1) brightness(0.32) contrast(1.4)' }}
            />
            {!owned && (
              <span className="absolute inset-0 grid place-items-center text-cream/35">
                <Lock size={Math.round(width * 0.16)} />
              </span>
            )}
            {/* Ombre de bas d'image : le cartouche se détache. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-ink/80 to-transparent" />
          </div>

          <div aria-hidden className="h-px shrink-0" style={{ background: owned ? frame.rule : 'rgba(255,255,255,0.08)' }} />

          <div
            className="shrink-0 px-[7%] pt-[4%] pb-[6%]"
            style={{ fontSize: font, lineHeight: 1.1, background: 'linear-gradient(180deg, #14131c, #0b0b12)' }}
          >
            <p
              className={`line-clamp-2 font-display ${owned ? 'text-cream' : 'text-cream/30'}`}
              style={{ fontSize: font * 1.28, minHeight: font * 1.28 * 2.2, letterSpacing: '0.01em' }}
            >
              {card.title}
            </p>
            {subtitle && <p className={`-mt-[3%] truncate ${owned ? 'text-mist' : 'text-cream/25'}`} style={{ fontSize: Math.max(7, font * 0.7) }}>{subtitle}</p>}
            <div className="mt-[5%] flex items-center justify-between gap-1">
              {pill}
              <span className="shrink-0 text-mist/80 tabular-nums" style={{ fontSize: Math.max(7, font * 0.66) }}>
                {numberLabel}
              </span>
            </div>
          </div>
        </div>
        </>
      )}

      {/* Reflets holographiques (Épique) : discrets au repos, vifs sous le doigt ou à l'inclinaison. Les grandes ont les leurs. */}
      {holo && !premium && (
        <>
          <div aria-hidden className={`pointer-events-none absolute inset-0 ${radius}`} style={{ ...HOLO_LAYER, opacity: 'calc(0.12 + var(--holo, 0) * 0.36)' }} />
          <div aria-hidden className={`pointer-events-none absolute inset-0 ${radius}`} style={{ ...GLARE_LAYER, opacity: 'var(--holo, 0)' }} />
        </>
      )}

      {badge && <div className="absolute top-[4%] left-[6%] z-10">{badge}</div>}
    </div>
  )
}

interface FullArtProps {
  card: CardFace
  level: number
  radius: string
  border: number
  font: number
  frame: (typeof CARD_FRAMES)[Rarity]
  lazy: boolean
  pill: ReactNode
  numberLabel: string
}

/**
 * Carte de personnage pleine image (Rare, Épique) : l'illustration déborde du cadre (Rare :
 * tout l'intérieur ; Épique : bord à bord, foil gravé, liseré violet), le nom et l'œuvre
 * passent dessus sur un voile sombre.
 */
function FullArt({ card, level, radius, border, font, frame, lazy, pill, numberLabel }: FullArtProps) {
  const accent = FULL_ART_ACCENT[level] ?? FULL_ART_ACCENT[2]!
  const bleed = level >= 2
  const art = (
    <img
      src={card.imageUrl}
      alt=""
      draggable={false}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover object-top"
    />
  )
  const caption = (
    <div className="absolute inset-x-0 bottom-0 flex flex-col px-[8%] pt-[22%] pb-[7%]" style={{ fontSize: font, lineHeight: 1.1, background: 'linear-gradient(180deg, transparent, rgba(8,8,14,0.72) 38%, rgba(8,8,14,0.94))' }}>
      <p className="line-clamp-2 font-display" style={{ fontSize: font * 1.32, color: accent.name, textShadow: accent.glow, letterSpacing: '0.01em' }}>
        {card.title}
      </p>
      {card.mangaTitle && (
        <p className="mt-[2%] truncate text-cream/75" style={{ fontSize: Math.max(7, font * 0.72), textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>
          {card.mangaTitle}
        </p>
      )}
      <div className="mt-[5%] flex items-center justify-between gap-1">
        {pill}
        <span className="shrink-0 text-cream/70 tabular-nums" style={{ fontSize: Math.max(7, font * 0.66), textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          {numberLabel}
        </span>
      </div>
    </div>
  )

  if (!bleed) {
    // Rare : cadre de métal conservé, illustration sur tout l'intérieur.
    return (
      <>
        <div aria-hidden className={`absolute inset-0 overflow-hidden ${radius}`} style={{ background: frame.metal, boxShadow: `${BEVEL}, 0 14px 30px -14px rgba(0,0,0,0.9)` }}>
          {frame.gloss && <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.6), transparent 38%)' }} />}
        </div>
        <div className="absolute overflow-hidden rounded-[7%/5%] bg-ink" style={{ inset: border, boxShadow: '0 0 0 1px rgba(0,0,0,0.65), 0 0 0 2px rgba(255,255,255,0.16)' }}>
          {art}
          {caption}
        </div>
      </>
    )
  }

  return (
    <div className={`absolute inset-0 overflow-hidden bg-ink ${radius}`} style={{ boxShadow: `${BEVEL}, 0 14px 30px -14px rgba(0,0,0,0.9)` }}>
      {art}
      {/* Foil gravé : s'allume à l'inclinaison. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ ...ETCHED_LAYER, opacity: 'calc(0.28 + var(--holo, 0) * 0.5)' }} />
      {caption}
      {/* Liseré intérieur violet. */}
      <div aria-hidden className={`pointer-events-none absolute ${radius}`} style={{ inset: Math.max(2, border * 0.45), boxShadow: `inset 0 0 0 ${Math.max(1.5, border * 0.35)}px ${accent.ring}, 0 0 10px ${accent.ring}` }} />
    </div>
  )
}
