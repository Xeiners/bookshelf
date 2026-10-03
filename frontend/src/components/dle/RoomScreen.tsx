import { useEffect, useState } from 'react'
import { Globe2, Lock, Share2 } from 'lucide-react'
import { useT } from '../../i18n'
import { displayRoomCode, roomLink } from '../../lib/dle'
import { vibrate } from '../../lib/haptics'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from './DleBar'
import { RoomLobby } from './RoomLobby'
import { RoomPlay } from './RoomPlay'
import { RoomResults } from './RoomResults'

/** Quitter en pleine manche se confirme d'un second tap (dans ce délai). */
const CONFIRM_MS = 3000

/**
 * Un salon du BookshelfDLE : salle d'attente, manche, résultats. Suivi en
 * attente longue tant que l'écran est ouvert : l'arrivée d'un joueur, le
 * départ, l'essai d'un adversaire s'affichent aussitôt.
 */
export function RoomScreen() {
  const t = useT()
  const room = useDleStore((state) => state.room)
  const watch = useDleStore((state) => state.watch)
  const leaveRoom = useDleStore((state) => state.leaveRoom)
  const notify = useUiStore((state) => state.notify)
  const [armed, setArmed] = useState(false)
  const code = room?.code ?? null

  useEffect(() => (code ? watch() : undefined), [code, watch])

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  if (!room) return null
  const midRound = (room.phase === 'playing' || room.phase === 'countdown') && !room.mine.done

  const leave = () => {
    if (midRound && !armed) {
      setArmed(true)
      return
    }
    void leaveRoom()
  }

  // Inviter : le lien du salon, copié tel quel (pas de feuille de partage ni d'e-mail).
  const share = async () => {
    vibrate(6)
    const url = roomLink(room.code, window.location.origin, window.location.pathname)
    try {
      await navigator.clipboard.writeText(url)
      notify(t.dle.room.copied, 'like')
    } catch {
      // Presse-papiers refusé : le lien s'affiche, à copier à la main.
      notify(url, 'neutral')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={armed ? t.dle.room.forfeitConfirm : t.dle.room.leave} onBack={leave} danger={armed}>
        <span className="hidden items-center gap-1 text-[11px] text-mist sm:inline-flex">
          {room.visibility === 'private' ? <Lock size={12} aria-hidden /> : <Globe2 size={12} aria-hidden />}
          {room.visibility === 'private' ? t.dle.room.private : t.dle.room.public}
        </span>
        <button
          type="button"
          onClick={() => void share()}
          className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-black/40 pr-3 pl-3.5 font-mono text-sm font-semibold tracking-[0.18em] text-cream hover:border-glow/50"
          aria-label={`${t.dle.room.share} · ${t.dle.room.code} ${room.code}`}
        >
          {displayRoomCode(room.code)}
          <Share2 size={14} className="text-glow" aria-hidden />
        </button>
      </DleBar>

      <div data-dle-body className="flex min-h-0 flex-1 flex-col">
        {room.phase === 'lobby' ? <RoomLobby room={room} onShare={() => void share()} /> : room.phase === 'results' ? <RoomResults room={room} /> : <RoomPlay room={room} />}
      </div>
    </div>
  )
}
