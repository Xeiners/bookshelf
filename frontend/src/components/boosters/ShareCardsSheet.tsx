import { useEffect, useState } from 'react'
import { Check, Loader2, Megaphone, Search } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { cardsApi } from '../../services/cardsApi'
import { profileApi, type MemberSummary } from '../../services/profileApi'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'

/** Au plus, comme le serveur (`SHARE_MAX_RECIPIENTS`). */
const MAX_RECIPIENTS = 20

interface ShareCardsSheetProps {
  cardIds: string[]
  onClose: () => void
  /** Envoyé : le tirage quitte le mode « Informer ». */
  onSent: () => void
}

/**
 * « Informer » : on coche les membres à prévenir, on joint un mot si l'on veut. Chacun
 * découvre les cartes à sa prochaine visite ; elles ne quittent pas l'album.
 */
export function ShareCardsSheet({ cardIds, onClose, onSent }: ShareCardsSheetProps) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  /** Gardés même s'ils sortent des résultats de la recherche. */
  const [chosen, setChosen] = useState<ReadonlyMap<string, MemberSummary>>(() => new Map())
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // Recherche au fil de la frappe (les derniers inscrits sans texte), un peu différée.
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      profileApi
        .searchMembers(query, controller.signal)
        .then((found) => setMembers(found.filter((member) => !member.isSelf)))
        .catch(() => {
          if (!controller.signal.aborted) setMembers([])
        })
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const toggle = (member: MemberSummary) => {
    vibrate(8)
    setChosen((current) => {
      const next = new Map(current)
      if (next.has(member.id)) next.delete(member.id)
      else if (next.size < MAX_RECIPIENTS) next.set(member.id, member)
      return next
    })
  }

  const send = async (dismiss: () => void) => {
    if (chosen.size === 0 || sending) return
    setSending(true)
    try {
      const { notified } = await cardsApi.share(cardIds, [...chosen.keys()], message.trim() || null)
      vibrate([10, 40, 18])
      notify(t.boosters.share.sent(notified), 'like')
      onSent()
      dismiss()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'nope')
    } finally {
      setSending(false)
    }
  }

  // Choisis d'abord (même hors de la recherche en cours), puis les autres résultats.
  const listed = members === null ? null : [...[...chosen.values()].filter((member) => !members.some((found) => found.id === member.id)), ...members]

  return (
    <Sheet
      label={t.boosters.share.title}
      title={t.boosters.share.title}
      subtitle={t.boosters.share.subtitle(cardIds.length)}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={chosen.size === 0 || sending}
          onClick={() => void send(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {sending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Megaphone size={17} aria-hidden />}
          {t.boosters.share.send(chosen.size)}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 focus-within:border-glow/60">
          <Search size={16} className="shrink-0 text-mist" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.boosters.share.search}
            aria-label={t.boosters.share.search}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-cream outline-none placeholder:text-mist/70"
          />
        </label>

        {chosen.size > 0 && <p className="px-1 text-xs font-semibold text-glow">{t.boosters.share.chosen(chosen.size)}</p>}

        <ul className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto overscroll-contain" role="listbox" aria-multiselectable aria-label={t.boosters.share.title}>
          {listed === null ? (
            <li className="grid place-items-center py-6 text-mist">
              <Loader2 size={18} className="animate-spin" aria-hidden />
            </li>
          ) : listed.length === 0 ? (
            <li className="px-2 py-4 text-sm text-mist">{t.boosters.share.none}</li>
          ) : (
            listed.map((member) => {
              const selected = chosen.has(member.id)
              return (
                <li key={member.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => toggle(member)}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${selected ? 'bg-glow/20' : 'hover:bg-white/[0.05]'}`}
                  >
                    {member.avatarUrl || member.avatar ? (
                      <img src={member.avatarUrl ?? member.avatar?.imageUrl} alt="" className="size-9 shrink-0 rounded-full bg-ink object-cover object-top" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-cream/80">{member.displayName.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-cream">{member.displayName}</span>
                    <span
                      aria-hidden
                      className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${selected ? 'border-glow bg-glow text-void' : 'border-white/25'}`}
                    >
                      {selected && <Check size={14} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 140))}
          rows={2}
          placeholder={t.boosters.share.message}
          aria-label={t.boosters.share.message}
          className="resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-cream outline-none placeholder:text-mist/70 focus:border-glow/60"
        />
      </div>
    </Sheet>
  )
}
