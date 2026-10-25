import { useRef } from 'react'
import { ChevronRight, Crown, Loader2, Lock, Search as SearchIcon, UserRoundSearch, X } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useMembers } from '../../hooks/useMembers'
import type { MemberSummary } from '../../services/profileApi'
import { useSearchStore } from '../../store/useSearchStore'
import { useUiStore } from '../../store/useUiStore'
import { CardAvatar } from '../profile/CardAvatar'

/** Pause de frappe avant d'interroger l'API. */
const DEBOUNCE_MS = 300

type Phase = { state: 'loading' } | { state: 'error' } | { state: 'ready'; members: MemberSummary[] }

/**
 * Recherche de membres par pseudo, dès la première lettre. Sans texte : tous les
 * membres, les plus récents d'abord, page après page. Un profil privé se trouve
 * aussi, mais n'affiche que sa vitrine une fois ouvert.
 */
export function MemberSearch() {
  const t = useT()
  const copy = t.search.members
  const query = useSearchStore((state) => state.memberQuery)
  const setQuery = useSearchStore((state) => state.setMemberQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const term = query.trim()
  const list = useMembers(query, { debounceMs: DEBOUNCE_MS })
  const phase: Phase = list.error ? { state: 'error' } : list.members === null ? { state: 'loading' } : { state: 'ready', members: list.members }
  const members = phase.state === 'ready' ? phase.members : []
  useGSAP(
    () => {
      if (members.length === 0) return
      gsap.from('[data-member]', {
        y: 16,
        autoAlpha: 0,
        duration: 0.4,
        stagger: Math.min(0.035, 0.4 / members.length),
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    },
    { dependencies: [phase], scope: listRef },
  )

  return (
    <>
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-shadow focus-within:shadow-glow">
        <SearchIcon size={18} className="shrink-0 text-mist" />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-cream placeholder:text-mist focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label={copy.clear}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-cream/10 text-cream/70"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <p className="min-h-4 text-[10px] tracking-[0.2em] text-mist uppercase" aria-live="polite">
        {phase.state === 'loading' ? copy.searching : term ? copy.results : copy.recent}
      </p>

      <div ref={listRef} className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-1 pb-4">
        {phase.state === 'loading' && (
          <ul className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="relative h-[4.5rem] overflow-hidden rounded-3xl bg-carbon">
                <div className="animate-shimmer absolute inset-y-0 -left-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
              </li>
            ))}
          </ul>
        )}

        {phase.state === 'error' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-xs text-mist">{copy.error}</p>
            <button
              type="button"
              onClick={list.retry}
              className="rounded-full bg-cream px-5 py-2.5 text-xs font-medium text-void"
            >
              {copy.retry}
            </button>
          </div>
        )}

        {phase.state === 'ready' && members.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-mist">
            <UserRoundSearch size={28} />
            <p className="max-w-xs text-xs">{term ? copy.empty : copy.emptyRecent}</p>
          </div>
        )}

        {members.length > 0 && (
          <ul className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0 xl:grid-cols-3">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        )}
        {/* Sans recherche : tous les membres, page après page. */}
        {phase.state === 'ready' && list.next && (
          <button
            type="button"
            onClick={list.loadMore}
            disabled={list.loadingMore}
            className="mx-auto mt-3 flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-5 py-2.5 text-xs font-semibold text-cream/85 disabled:opacity-60"
          >
            {list.loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {copy.more}
          </button>
        )}
      </div>
    </>
  )
}

function MemberRow({ member }: { member: MemberSummary }) {
  const t = useT()
  const copy = t.search.members
  const openPublicProfile = useUiStore((state) => state.openPublicProfile)
  const meta =
    member.cardsOwned === null || member.readsCount === null
      ? null
      : `${copy.cards(member.cardsOwned)} · ${copy.reads(member.readsCount)}`

  return (
    <li data-member>
      <button
        type="button"
        onClick={() => {
          vibrate(6)
          openPublicProfile(member.id)
        }}
        aria-label={copy.open(member.displayName)}
        className="glass flex w-full items-center gap-3.5 rounded-3xl p-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <CardAvatar card={member.avatar} avatarUrl={member.avatarUrl} initial={member.displayName.charAt(0).toUpperCase()} size={48} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-cream">{member.displayName}</span>
            {member.isSelf && (
              <span className="shrink-0 rounded-full bg-glow/20 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-glow uppercase">
                {copy.you}
              </span>
            )}
          </span>
          {member.activeTitle && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
              <Crown size={10} className="shrink-0" />
              <span className="truncate">{t.profile.titles[member.activeTitle]}</span>
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-mist">
            {meta ?? (
              <>
                <Lock size={11} className="shrink-0" />
                {copy.private}
              </>
            )}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-cream/40" />
      </button>
    </li>
  )
}
