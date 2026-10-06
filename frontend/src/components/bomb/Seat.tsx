import { Heart, Skull } from 'lucide-react'
import { useT } from '../../i18n'
import type { BombPlayer } from '../../services/bombApi'
import { CardAvatar } from '../profile/CardAvatar'

/** Teinte stable par joueur (anneau de l'avatar). */
function hueOf(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

interface SeatProps {
  player: BombPlayer
  /** Tient la bombe. */
  active: boolean
  /** Éliminé (partie lancée). */
  out: boolean
  winner: boolean
  me: boolean
  maxLives: number
  name: string
}

/**
 * Un joueur autour de l'arène : avatar rond cerclé de sa couleur, étiquette du nom, vies en
 * cœurs. Celui qui tient la bombe s'entoure d'un anneau de lumière qui tourne.
 */
export function Seat({ player, active, out, winner, me, maxLives, name }: SeatProps) {
  const t = useT()
  const hue = hueOf(player.id)
  return (
    <>
      <span className={`relative grid size-[3.6rem] place-items-center transition-transform duration-300 ${active ? 'scale-110' : ''}`}>
        {active && (
          <span
            aria-hidden
            data-bomb-fx
            className="absolute -inset-[5px] rounded-full"
            style={{ background: 'conic-gradient(from 0deg, var(--heat, #ffd23f), transparent 35%, var(--heat, #ffd23f) 55%, transparent 85%)', animation: 'seal-spin 1.4s linear infinite', filter: 'drop-shadow(0 0 8px var(--heat, #ffd23f))' }}
          />
        )}
        <span
          className={`relative block size-full rounded-full p-[2.5px] ${out ? 'opacity-40 grayscale' : ''}`}
          style={{ background: `linear-gradient(140deg, hsl(${hue} 90% 72%), hsl(${(hue + 60) % 360} 85% 55%))`, boxShadow: '0 6px 18px -6px rgba(0,0,0,0.8)' }}
        >
          <span className="block size-full overflow-hidden rounded-full bg-[#0d0b18]">
            <span className="block size-full scale-[1.12]">
              <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={name.charAt(0).toUpperCase()} size={52} className="!rounded-none !ring-0" />
            </span>
          </span>
        </span>
        {out && (
          <span className="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full border border-white/10 bg-[#140a14] text-nope">
            <Skull size={13} aria-hidden />
          </span>
        )}
        {winner && <span className="absolute -top-4 text-xl" aria-hidden>👑</span>}
        {!player.connected && <span className="absolute -top-0.5 -left-0.5 size-3 rounded-full border-2 border-[#0d0b18] bg-mist" title={t.bomb.room.away} />}
      </span>
      <span
        className={`max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] backdrop-blur ${me ? 'border-white/25 bg-white/15 font-semibold text-cream' : 'border-white/10 bg-black/55 text-cream/85'}`}
      >
        {name}
      </span>
      <span className="flex items-center gap-0.5" role="img" aria-label={t.bomb.livesAria(player.lives)}>
        {Array.from({ length: maxLives }, (_, index) => (
          <Heart
            key={index}
            size={11}
            aria-hidden
            className={index < player.lives ? 'fill-[#ff5e9c] text-[#ff5e9c] drop-shadow-[0_0_4px_rgba(255,94,156,0.7)]' : 'text-white/20'}
          />
        ))}
      </span>
    </>
  )
}
