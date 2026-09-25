import { useState } from 'react'
import { CloudCheck, CloudOff, CloudUpload, LogOut, UserRound } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { useAuthStore, usePendingSync } from '../../store/useAuthStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/**
 * Carte compte du Profil. Invité par défaut : l'app reste pleinement utilisable
 * sans compte, celui-ci ne sert qu'à sauvegarder et retrouver sa bibliothèque.
 */
export function AccountCard() {
  const t = useT()
  const user = useAuthStore((state) => state.user)
  const offline = useAuthStore((state) => state.offline)
  const logout = useAuthStore((state) => state.logout)
  const openAuth = useUiStore((state) => state.openAuth)
  const notify = useUiStore((state) => state.notify)
  const pending = usePendingSync()

  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)

  if (!user) {
    return (
      <section data-anim className="glass rounded-4xl p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-glow/15 text-glow">
            <UserRound size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl leading-tight">{t.account.guestTitle}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-mist">{t.account.guestBody}</p>
          </div>
        </div>

        <Pressable
          onClick={() => {
            vibrate(8)
            openAuth()
          }}
          press={0.96}
          className="mt-4 w-full rounded-full bg-cream py-3 text-xs font-medium text-void"
        >
          {t.account.cta}
        </Pressable>
      </section>
    )
  }

  const name = user.displayName ?? user.email.split('@')[0]
  const sync = offline
    ? { icon: CloudOff, label: t.account.offline, tone: 'text-gold' }
    : pending > 0
      ? { icon: CloudUpload, label: t.account.pending(pending), tone: 'text-gold' }
      : { icon: CloudCheck, label: t.account.synced, tone: 'text-like' }
  const SyncIcon = sync.icon

  const onLogout = async () => {
    // Des actions non envoyées seraient perdues : on demande confirmation.
    if (pending > 0 && !confirming) {
      setConfirming(true)
      return
    }
    setLeaving(true)
    await logout()
    notify(t.account.loggedOut, 'neutral')
  }

  return (
    <section data-anim className="glass rounded-4xl p-5">
      <div className="flex items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-glow to-like font-display text-xl text-void">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl leading-tight">{name}</h2>
          <p className="truncate text-[11px] text-mist">{user.email}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/8 pt-4">
        <span className={`flex min-w-0 items-center gap-1.5 text-[11px] ${sync.tone}`}>
          <SyncIcon size={14} className="shrink-0" />
          <span className="truncate">{sync.label}</span>
        </span>

        <Pressable
          onClick={() => void onLogout()}
          disabled={leaving}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] disabled:opacity-50 ${
            confirming ? 'bg-nope/15 text-nope' : 'glass text-cream/70'
          }`}
        >
          <LogOut size={12} />
          {confirming ? t.account.logoutConfirm : t.account.logout}
        </Pressable>
      </div>
    </section>
  )
}
