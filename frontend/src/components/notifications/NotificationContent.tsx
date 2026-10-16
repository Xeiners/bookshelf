import { Gift, Palette, Trophy } from 'lucide-react'
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
      {visual.kind === 'box' && (
        <span className="absolute inset-0 m-auto grid size-[78%] -rotate-[6deg] place-items-center overflow-hidden rounded-xl" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: 'inset 0 0 0 2px #ffc93c, 0 0 14px -2px #b05cff' }}>
          <span className="absolute inset-y-0 left-1/2 w-[18%] -translate-x-1/2 bg-[#ffc93c]" />
          <span className="absolute inset-x-0 top-[38%] h-[18%] bg-[#ffc93c]" />
          <span className="relative font-display text-lg text-[#ffe9a8]">?</span>
        </span>
      )}
      {visual.kind === 'promo' && (
        <span className="absolute inset-0 m-auto flex size-[86%] -rotate-[6deg] flex-col items-center justify-center rounded-xl leading-none" style={{ background: 'linear-gradient(150deg, #ff4d6d, #b3124a)', boxShadow: 'inset 0 0 0 2px #ffd1dc' }}>
          <span className="text-[9px] font-bold text-white/70 line-through">{visual.regular}</span>
          <span className="font-display text-sm text-white">{visual.price}✦</span>
        </span>
      )}
      {visual.kind === 'trophy' && (
        <span className="absolute inset-0 m-auto grid size-[82%] -rotate-[6deg] place-items-center rounded-xl text-[#3a2200]" style={{ background: 'linear-gradient(150deg, #fff0a8, #ffc23a 55%, #ff9f43)', boxShadow: '0 0 14px -2px #ffc23a' }}>
          <Trophy size={Math.round(size * 0.5)} strokeWidth={2.4} />
        </span>
      )}
      {visual.kind === 'canvas' && (
        <span className="absolute inset-0 m-auto grid size-[82%] -rotate-[6deg] place-items-center rounded-xl text-white" style={{ background: 'linear-gradient(150deg, #2bc3ff, #7c5cff 60%, #ff5cb4)', boxShadow: '0 0 14px -2px #2bc3ff' }}>
          <Palette size={Math.round(size * 0.5)} strokeWidth={2.2} />
        </span>
      )}
      {/* Cadeau de l'équipe : un ruban doré dans le coin. */}
      {visual.kind !== 'trade' && visual.kind !== 'promo' && visual.kind !== 'trophy' && visual.kind !== 'canvas' && (
        <span className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full bg-gold text-void shadow-[0_0_0_2px_#0b0b12]">
          <Gift size={11} strokeWidth={2.5} />
        </span>
      )}
    </span>
  )
}
