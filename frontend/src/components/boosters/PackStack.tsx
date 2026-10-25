import type { CardSeries } from '../../services/cardsApi'
import { BoosterPackArt } from './BoosterPackArt'

/** Les boosters choisis, en éventail : on voit combien on en prend. */
export function PackStack({ count, width, series }: { count: number; width: number; series: CardSeries }) {
  const height = Math.round(width * 1.55)
  const spread = width * 0.34
  return (
    <div aria-hidden className="relative" style={{ width: width + spread * 2, height: height + 16 }}>
      {Array.from({ length: count }, (_, index) => {
        // Centré : de part et d'autre du milieu, le dernier devant.
        const offset = count === 1 ? 0 : index / (count - 1) - 0.5
        return (
          <span
            key={index}
            className="absolute top-2 left-1/2 transition-transform duration-300"
            style={{ marginLeft: -width / 2, transform: `translateX(${offset * spread * 2}px) rotate(${offset * 22}deg)`, transformOrigin: '50% 120%' }}
          >
            <BoosterPackArt width={width} series={series} lit />
          </span>
        )
      })}
    </div>
  )
}
