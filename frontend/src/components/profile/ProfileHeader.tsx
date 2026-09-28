import { Crown, PencilLine, UserRound } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import type { ProfileCard, TitleId } from '../../services/profileApi'
import { Pressable } from '../ui/Pressable'
import { CardAvatar } from './CardAvatar'

interface ProfileHeaderProps {
  name: string
  avatar: ProfileCard | null
  avatarUrl: string | null
  title: TitleId | null
  bio: string | null
  /** Date déjà mise en forme (« septembre 2026 »). */
  memberSince: string | null
  signedIn: boolean
  onEdit: () => void
  onSignIn: () => void
}

/** Carte d'identité du profil : avatar, pseudo, titre, ancienneté, bio. */
export function ProfileHeader({ name, avatar, avatarUrl, title, bio, memberSince, signedIn, onEdit, onSignIn }: ProfileHeaderProps) {
  const t = useT()

  return (
    <section data-anim className="glass rounded-4xl p-5">
      <div className="flex items-center gap-4">
        {signedIn ? (
          <CardAvatar card={avatar} avatarUrl={avatarUrl} initial={name.charAt(0).toUpperCase()} size={76} />
        ) : (
          <div className="grid size-[76px] shrink-0 place-items-center rounded-[30%] bg-glow/15 text-glow">
            <UserRound size={30} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[1.75rem] leading-[1.05] text-cream">{name}</h2>
          {title && (
            <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-gold/35 bg-gold/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-gold uppercase">
              <Crown size={11} className="shrink-0" />
              <span className="truncate">{t.profile.titles[title]}</span>
            </span>
          )}
          {memberSince && (
            <p className="mt-2 text-[10px] tracking-[0.16em] text-mist/70 uppercase">{t.profile.memberSince(memberSince)}</p>
          )}
        </div>
      </div>

      {signedIn && bio && <p className="mt-4 text-[13px] leading-relaxed whitespace-pre-line text-cream/80">{bio}</p>}

      {signedIn ? (
        <Pressable
          onClick={() => {
            vibrate(6)
            onEdit()
          }}
          press={0.96}
          className="glass mt-4 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-medium text-cream/85"
        >
          <PencilLine size={14} />
          {t.profile.edit}
        </Pressable>
      ) : (
        <>
          <p className="mt-4 text-[11px] leading-relaxed text-mist">{t.profile.signInToCustomize}</p>
          <Pressable
            onClick={() => {
              vibrate(8)
              onSignIn()
            }}
            press={0.96}
            className="mt-3 w-full rounded-full bg-cream py-3 text-xs font-medium text-void"
          >
            {t.account.cta}
          </Pressable>
        </>
      )}
    </section>
  )
}
