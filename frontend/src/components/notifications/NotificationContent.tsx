import { Gift } from 'lucide-react'
import { accentOf, type NotificationCopy } from '../../lib/notifications'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CollectibleCard } from '../cards/CollectibleCard'

/**
 * Vignette. Un échange : la carte reçue devant, légèrement inclinée, la carte
 * cédée derrière — il se lit d'un coup d'œil. Un cadeau : la carte offerte, ou
 * le paquet de boosters, marqué d'un ruban. Lueur de la rareté (ou de l'or) en
 * `box-shadow` : aucun flou.
 */
export function NotificationThumb({ copy, size = 40 }: { copy: NotificationCopy; size?: number }) {
  const { visual } = copy
  const color = accentOf(visual)
  const glow = { boxShadow: `0 0 0 1px ${color}, 0 6px 18px -6px ${color}` }
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size * 1.35, height: Math.round(size * 1.4) }}>
      {visual.kind === 'trade' && (
        <>
          <span className="absolute top-0 right-0 rotate-[8deg] opacity-70">
            <CollectibleCard card={visual.behind} width={Math.round(size * 0.82)} effects={false} />
          </span>
          <span className="absolute bottom-0 left-0 -rotate-[5deg] rounded-[9%/6.5%]" style={glow}>
            <CollectibleCard card={visual.card} width={size} effects={false} />
          </span>
        </>
      )}
      {visual.kind === 'card' && (
        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 -rotate-[4deg] rounded-[9%/6.5%]" style={glow}>
          <CollectibleCard card={visual.card} width={size} effects={false} />
        </span>
      )}
      {visual.kind === 'booster' && (
        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 -rotate-[6deg]">
          <BoosterPackArt width={Math.round(size * 0.9)} lit />
        </span>
      )}
      {/* Cadeau de l'équipe : un ruban doré dans le coin. */}
      {visual.kind !== 'trade' && (
        <span className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full bg-gold text-void shadow-[0_0_0_2px_#0b0b12]">
          <Gift size={11} strokeWidth={2.5} />
        </span>
      )}
    </span>
  )
}
