import { RARITY_STYLE } from '../../lib/boosters'
import type { NotificationCopy } from '../../lib/notifications'
import { CollectibleCard } from '../cards/CollectibleCard'

/**
 * Vignette : la carte reçue devant, légèrement inclinée, la carte cédée
 * derrière — l'échange se lit d'un coup d'œil. Lueur de la rareté en
 * `box-shadow` (aucun flou).
 */
export function NotificationThumb({ copy, size = 40 }: { copy: NotificationCopy; size?: number }) {
  const color = RARITY_STYLE[copy.card.rarity].color
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size * 1.35, height: Math.round(size * 1.4) }}>
      <span className="absolute top-0 right-0 rotate-[8deg] opacity-70">
        <CollectibleCard card={copy.behind} width={Math.round(size * 0.82)} effects={false} />
      </span>
      <span className="absolute bottom-0 left-0 -rotate-[5deg] rounded-[9%/6.5%]" style={{ boxShadow: `0 0 0 1px ${color}, 0 6px 18px -6px ${color}` }}>
        <CollectibleCard card={copy.card} width={size} effects={false} />
      </span>
    </span>
  )
}
