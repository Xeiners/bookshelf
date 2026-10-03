import { Handshake, Swords } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { ROOM_KINDS, type RoomKind } from '../../services/dleApi'

const KIND_STYLE: Record<RoomKind, { icon: typeof Swords; color: string; glow: string }> = {
  versus: { icon: Swords, color: '#ff5e7e', glow: 'rgba(255,94,126,0.18)' },
  coop: { icon: Handshake, color: '#3fe0a0', glow: 'rgba(63,224,160,0.16)' },
}

/**
 * Type de partie : VERSUS (chacun sa grille, le plus rapide gagne) ou COOP (une
 * grille commune, victoire collective). Deux cartes, une icône, une phrase.
 * `disabled` : affiché seulement (un joueur qui n'est pas l'hôte).
 */
export function KindPicker({ value, onChange, disabled = false }: { value: RoomKind; onChange: (kind: RoomKind) => void; disabled?: boolean }) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t.dle.room.kindLabel} className="grid grid-cols-2 gap-3">
      {ROOM_KINDS.map((kind) => {
        const { icon: Icon, color, glow } = KIND_STYLE[kind]
        const active = kind === value
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled && !active}
            onClick={() => {
              if (disabled || active) return
              vibrate(6)
              onChange(kind)
            }}
            className={`flex flex-col items-start gap-1.5 rounded-2xl border-2 p-3.5 text-left transition-colors disabled:opacity-40 ${active ? 'text-cream' : 'border-white/10 bg-white/[0.03] text-mist hover:text-cream'} ${disabled ? 'cursor-default' : ''}`}
            style={active ? { borderColor: color, background: glow } : undefined}
          >
            <span className="inline-flex items-center gap-2 text-sm font-black tracking-[0.12em]" style={active ? { color } : undefined}>
              <Icon size={18} aria-hidden />
              {t.dle.room.kind[kind].title}
            </span>
            <span className="text-[11px] leading-snug text-cream/65">{t.dle.room.kind[kind].hint}</span>
          </button>
        )
      })}
    </div>
  )
}
