import { RARITY_STYLE, rarityRank, type Rarity } from '../../lib/boosters'
import { avatarMaskStyle, parseAvatarUrl } from '../../lib/avatarCrop'
import { CARD_FRAMES, IRIDESCENT } from '../cards/cardFrames'

interface CardAvatarProps {
  /** Carte choisie comme avatar ; `null` : initiale du pseudo. */
  card: { imageUrl: string; rarity: Rarity } | null
  /** Couverture de bibliothèque, prioritaire sur la carte. */
  avatarUrl?: string | null
  /** Initiale affichée sans carte. */
  initial: string
  size: number
  className?: string
}

/**
 * Avatar d'un profil : l'illustration d'une carte, cerclée du métal de sa
 * rareté (argent, cobalt, néon violet, or, iridescence). À partir d'Épique,
 * un double liseré de la couleur de rareté fait l'effet néon — sans flou.
 */
export function CardAvatar({ card, avatarUrl = null, initial, size, className = '' }: CardAvatarProps) {
  if (avatarUrl) {
    const { src, crop } = parseAvatarUrl(avatarUrl)
    return (
      <div
        aria-hidden
        className={`relative shrink-0 overflow-hidden bg-ink ring-2 ring-cream/25 ${className}`}
        style={{ width: size, height: size, clipPath: avatarMaskStyle(crop.mask) }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="h-full w-full object-cover will-change-transform"
          style={{ objectPosition: `${crop.x}% ${crop.y}%`, transform: `scale(${crop.zoom})` }}
        />
      </div>
    )
  }

  if (!card) {
    return (
      <div
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-[30%] bg-linear-to-br from-glow to-like font-display text-void ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.44 }}
      >
        {initial}
      </div>
    )
  }

  const frame = CARD_FRAMES[card.rarity]
  const color = RARITY_STYLE[card.rarity].color
  const neon = rarityRank(card.rarity) >= rarityRank('EPIC')

  return (
    <div
      aria-hidden
      className={`relative shrink-0 rounded-[30%] p-[3px] ${className}`}
      style={{
        width: size,
        height: size,
        background: frame.iridescent ? IRIDESCENT : frame.metal,
        boxShadow: neon ? `0 0 0 2px rgb(6 6 10), 0 0 0 3.5px ${color}` : undefined,
      }}
    >
      <img
        src={card.imageUrl}
        alt=""
        draggable={false}
        decoding="async"
        className="h-full w-full rounded-[27%] bg-ink object-cover object-top"
      />
    </div>
  )
}
