import { useEffect, useState } from 'react'
import { Check, Gift, Loader2, Search } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { ApiError } from '../../services/api'
import { cardsApi } from '../../services/cardsApi'
import { profileApi, type MemberSummary } from '../../services/profileApi'
import { useBoosterStore } from '../../store/useBoosterStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'

interface GiftCardSheetProps {
  card: { id: string; title: string }
  /** Exemplaires possédés : au dernier, on prévient que la carte quittera l'album. */
  copies: number
  onClose: () => void
  /** Carte offerte : la vue agrandie se ferme si c'était le dernier exemplaire. */
  onSent: (remaining: number) => void
}

/**
 * Offrir une carte : on cherche un membre par son pseudo, on joint un mot si l'on veut, et
 * un exemplaire part dans son album. Lui la découvre, face cachée, à sa prochaine visite.
 */
export function GiftCardSheet({ card, copies, onClose, onSent }: GiftCardSheetProps) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const collectionChanged = useBoosterStore((state) => state.collectionChanged)
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  const [chosen, setChosen] = useState<MemberSummary | null>(null)
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

  const send = async (dismiss: () => void) => {
    if (!chosen || sending) return
    setSending(true)
    try {
      const result = await cardsApi.gift(card.id, chosen.id, message.trim() || null)
      vibrate([10, 40, 18])
      notify(t.cards.gift.sent(chosen.displayName), 'like')
      collectionChanged()
      onSent(result.remaining)
      dismiss()
    } catch (error) {
      notify(error instanceof ApiError && error.code === 'gift_unavailable' ? t.cards.gift.unavailable : error instanceof Error ? error.message : String(error), 'nope')
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet
      label={t.cards.gift.title}
      title={t.cards.gift.title}
      subtitle={t.cards.gift.subtitle(card.title)}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={!chosen || sending}
          onClick={() => void send(dismiss)}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {sending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Gift size={17} aria-hidden />}
          {chosen ? t.cards.gift.send(chosen.displayName) : t.cards.gift.pick}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 focus-within:border-glow/60">
          <Search size={16} className="shrink-0 text-mist" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.cards.gift.search}
            aria-label={t.cards.gift.search}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-cream outline-none placeholder:text-mist/70"
          />
        </label>

        <ul className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto overscroll-contain" role="listbox" aria-label={t.cards.gift.pick}>
          {members === null ? (
            <li className="grid place-items-center py-6 text-mist">
              <Loader2 size={18} className="animate-spin" aria-hidden />
            </li>
          ) : members.length === 0 ? (
            <li className="px-2 py-4 text-sm text-mist">{t.cards.gift.none}</li>
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
          placeholder={t.cards.gift.message}
          aria-label={t.cards.gift.message}
          className="resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-cream outline-none placeholder:text-mist/70 focus:border-glow/60"
        />
        {copies <= 1 && <p className="text-xs text-gold">{t.cards.gift.lastCopy}</p>}
      </div>
    </Sheet>
  )
}
