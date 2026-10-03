import type { WorkSummary } from '../../services/dleApi'
import { CollectibleCard } from '../cards/CollectibleCard'
import { accentOf } from './dleStyle'

/**
 * La réponse révélée : la carte de collection d'une œuvre (inclinable, cadre de
 * sa rareté), ou le portrait d'un personnage dans un cadre aux couleurs de Naruto.
 */
export function AnswerCard({ work, width }: { work: WorkSummary; width: number }) {
  const color = accentOf(work)
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 rounded-full" style={{ background: `radial-gradient(closest-side, ${color}55, transparent)` }} />
      {work.rarity && work.number !== null ? (
        <CollectibleCard card={{ title: work.name, imageUrl: work.imageUrl, rarity: work.rarity, number: work.number }} width={width} interactive lazy={false} />
      ) : (
        <div
          className="relative overflow-hidden rounded-2xl border-[3px] bg-ink"
          style={{ width, height: Math.round(width * 1.4), borderColor: color, boxShadow: `0 0 0 3px rgba(11,9,24,1), 0 0 30px -6px ${color}` }}
        >
          <img src={work.imageUrl} alt={work.name} decoding="async" className="h-full w-full object-cover object-top" />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pt-6 pb-2 text-center text-sm font-bold text-white">{work.name}</span>
        </div>
      )}
    </div>
  )
}
