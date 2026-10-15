import { useEffect, useState } from 'react'
import { Check, Gift, Loader2, Search } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { profileApi, type MemberSummary } from '../../services/profileApi'
import { runnerApi } from '../../services/runnerApi'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'

/**
 * Offrir une boîte mystère : on cherche un membre, on joint un mot si l'on veut, et l'on
 * paie le prix d'une boîte. Le membre la trouve dans sa garde-robe et reçoit une notification.
 */
export function GiftBoxSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const view = useRunnerWardrobe((state) => state.view)
  const receive = useRunnerWardrobe((state) => state.receive)
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  const [chosen, setChosen] = useState<MemberSummary | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const price = view?.price ?? 0

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

  const send = async (dismiss: () => void) => {
    if (!chosen || sending) return
    if (view && view.balance < price) {
      notify(t.runner.wardrobe.box.short(price), 'nope')
      return
    }
    setSending(true)
    try {
      receive(await runnerApi.giftBox(chosen.id, message.trim() || null))
      vibrate([10, 40, 18])
      notify(t.runner.wardrobe.gift.sent(chosen.displayName), 'like')
      dismiss()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet
      label={t.runner.wardrobe.gift.title}
      title={t.runner.wardrobe.gift.title}
      subtitle={t.runner.wardrobe.gift.subtitle(price)}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={!chosen || sending}
          onClick={() => void send(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #fff0a8, #ffc23a 55%, #ff8a3d)' }}
        >
          {sending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Gift size={17} aria-hidden />}
          {chosen ? t.runner.wardrobe.gift.send(chosen.displayName, price) : t.runner.wardrobe.gift.pick}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 focus-within:border-glow/60">
          <Search size={16} className="shrink-0 text-mist" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.runner.wardrobe.gift.search}
            aria-label={t.runner.wardrobe.gift.search}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-cream outline-none placeholder:text-mist/70"
          />
        </label>

        <ul className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto overscroll-contain" role="listbox" aria-label={t.runner.wardrobe.gift.pick}>
          {members === null ? (
            <li className="grid place-items-center py-6 text-mist">
              <Loader2 size={18} className="animate-spin" aria-hidden />
            </li>
          ) : members.length === 0 ? (
            <li className="px-2 py-4 text-sm text-mist">{t.runner.wardrobe.gift.none}</li>
          ) : (
            members.map((member) => {
              const selected = chosen?.id === member.id
              return (
                <li key={member.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => setChosen(member)}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${selected ? 'bg-glow/20' : 'hover:bg-white/[0.05]'}`}
                  >
                    {member.avatarUrl || member.avatar ? (
                      <img src={member.avatarUrl ?? member.avatar?.imageUrl} alt="" className="size-9 shrink-0 rounded-full bg-ink object-cover object-top" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-cream/80">{member.displayName.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-cream">{member.displayName}</span>
                    {selected && <Check size={17} className="shrink-0 text-glow" aria-hidden />}
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
          placeholder={t.runner.wardrobe.gift.message}
          aria-label={t.runner.wardrobe.gift.message}
          className="resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-cream outline-none placeholder:text-mist/70 focus:border-glow/60"
        />
        {view && <p className="text-center text-[11px] text-cream/50 tabular-nums">{t.activities.shop.balance(view.balance)}</p>}
      </div>
    </Sheet>
  )
}
