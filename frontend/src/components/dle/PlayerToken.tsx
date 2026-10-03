import { Crown } from 'lucide-react'
import { useT } from '../../i18n'
import type { RoomPlayer } from '../../services/dleApi'
import { CardAvatar } from '../profile/CardAvatar'
import { playerName } from './dleStyle'

/** Avatar d'un joueur (carte, photo ou initiale), couronné s'il est l'hôte. */
export function PlayerAvatar({ player, size, crown = false }: { player: RoomPlayer; size: number; crown?: boolean }) {
  const t = useT()
  const name = playerName(player, t.dle.room.anonymous)
  return (
    <span className="relative inline-block shrink-0">
      <CardAvatar card={player.avatar} avatarUrl={player.avatarUrl} initial={name.charAt(0).toUpperCase()} size={size} />
      {crown && player.isHost && (
        <span className="absolute -top-2 -right-1.5 grid size-5 place-items-center rounded-full bg-gold text-void shadow-[0_0_0_2px_#06060a]" title={t.dle.room.host}>
          <Crown size={11} aria-hidden />
        </span>
      )}
    </span>
  )
}
