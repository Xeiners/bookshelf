import { BookCopy, Coins, ScrollText, Star } from 'lucide-react'
import type { HlMetric } from '../../services/higherLowerApi'

/** Icône d'une métrique (un vrai composant : pas d'icône choisie pendant le rendu). */
export function MetricIcon({ metric, size = 16, className }: { metric: HlMetric; size?: number; className?: string }) {
  switch (metric) {
    case 'bounty':
      return <Coins size={size} className={className} aria-hidden />
    case 'sales':
      return <BookCopy size={size} className={className} aria-hidden />
    case 'chapters':
      return <ScrollText size={size} className={className} aria-hidden />
    case 'score':
      return <Star size={size} className={className} aria-hidden />
  }
}
