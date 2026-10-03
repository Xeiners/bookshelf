import { useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Globe2, Loader2, Lock, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { displayRoomCode, parseRoomCode } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { DLE_MODES } from '../../services/dleApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from './DleBar'
import { modeLabel } from './dleStyle'
import { ModeIcon } from './ModeIcon'
import { KindPicker } from './KindPicker'

/**
 * Multijoueur : le format (deux grandes cartes), le type de partie (VERSUS, COOP),
 * puis partie rapide, salon privé, ou un code reçu d'un ami. Sans compte : un
 * pseudo d'invité d'abord.
 */
export function DleMulti({ currentRoom }: { currentRoom: string | null }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const multiModes = useDleStore((state) => state.multiModes)
  const toggleMultiMode = useDleStore((state) => state.toggleMultiMode)
  const quickMatch = useDleStore((state) => state.quickMatch)
  const createRoom = useDleStore((state) => state.createRoom)
  const joinRoom = useDleStore((state) => state.joinRoom)
  const resumeRoom = useDleStore((state) => state.resumeRoom)
  const category = useDleStore((state) => state.category)
  const openCategory = useDleStore((state) => state.openCategory)
  const notify = useUiStore((state) => state.notify)
  const multiKind = useDleStore((state) => state.multiKind)
  const setMultiKind = useDleStore((state) => state.setMultiKind)
  const ensureGuest = useDleStore((state) => state.ensureGuest)
  const guestName = useDleStore((state) => state.overview?.guest?.name ?? '')
  const signedIn = useAuthStore((state) => state.user !== null)
  const [nickname, setNickname] = useState(guestName)
  const [busy, setBusy] = useState<'quick' | 'create' | 'join' | 'resume' | null>(null)
  const [code, setCode] = useState('')

  useGSAP(
    () => {
      gsap.fromTo('[data-block]', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    vibrate(10)
    setBusy(kind)
    try {
      // Sans compte : le pseudo d'invité (gardé, ou choisi ici) avant d'entrer dans un salon.
      if (!signedIn && kind !== 'resume') await ensureGuest(nickname.trim())
      await action()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
  }

  const join = () => {
    const parsed = parseRoomCode(code)
    if (!parsed) {
      notify(t.dle.home.invalidCode, 'nope')
      return
    }
    void run('join', () => joinRoom(parsed))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={t.dle.categories[category].title} onBack={() => openCategory()} />
      <div ref={rootRef} data-dle-body className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <h2 className="text-center font-display text-3xl text-cream">{t.dle.home.multiHeading}</h2>
        <p className="-mt-3 text-center text-xs font-semibold tracking-[0.14em] text-mist uppercase">{t.dle.categories[category].title}</p>

        {currentRoom && (
          <button
            type="button"
            data-block
            onClick={() => void run('resume', () => resumeRoom(currentRoom))}
            className="flex items-center gap-3 rounded-2xl border-2 border-like/50 bg-like/10 px-4 py-3 text-left font-semibold text-[#dcfff1]"
          >
            <Users size={18} aria-hidden />
            <span className="min-w-0 flex-1">{t.dle.home.room(displayRoomCode(currentRoom))}</span>
            {busy === 'resume' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArrowRight size={18} aria-hidden />}
          </button>
        )}

        {!signedIn && (
          <label data-block className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-[0.14em] text-mist uppercase">{t.dle.guest.name}</span>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={t.dle.guest.placeholder}
              maxLength={20}
              autoComplete="nickname"
              spellCheck={false}
              className="h-12 rounded-2xl border-2 border-white/10 bg-black/40 px-4 text-base text-cream outline-none placeholder:text-mist/60 focus:border-[#ff5ec4]/60"
            />
          </label>
        )}

        {/* Formats : un, ou les deux (Classique, puis Couverture dès que la première manche finit). */}
        <div data-block role="group" aria-label={t.dle.home.modeLabel} className="grid grid-cols-3 gap-2.5">
          {DLE_MODES.map((mode) => {
            const active = multiModes.includes(mode)
            const order = multiModes.length > 1 ? multiModes.indexOf(mode) + 1 : 0
            return (
              <button
                key={mode}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => {
                  vibrate(6)
                  toggleMultiMode(mode)
                }}
                className={`relative flex flex-col items-center gap-2 rounded-2xl border-2 px-1 py-4 transition-colors ${active ? 'border-[#ff5ec4]/70 bg-[#ff5ec4]/10 text-cream' : 'border-white/10 bg-white/[0.03] text-mist hover:text-cream'}`}
              >
                {/* Les deux cochés : leur ordre de passage. */}
                {order > 0 && (
                  <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-[#ff5ec4] text-xs font-black text-[#1a0b1f]">{order}</span>
                )}
                <ModeIcon category={category} mode={mode} size={26} />
                <span className="text-[11px] font-bold tracking-[0.04em] uppercase sm:text-sm sm:tracking-[0.06em]">{modeLabel(t, category, mode)}</span>
              </button>
            )
          })}
        </div>

        <div data-block>
          <KindPicker value={multiKind} onChange={setMultiKind} />
        </div>

        <div data-block className="flex flex-col gap-3">
          <BigButton primary busy={busy === 'quick'} disabled={busy !== null} icon={<Globe2 size={20} aria-hidden />} label={t.dle.home.quick} onClick={() => void run('quick', quickMatch)} />
          <BigButton busy={busy === 'create'} disabled={busy !== null} icon={<Lock size={19} aria-hidden />} label={t.dle.home.create} onClick={() => void run('create', () => createRoom('private'))} />
        </div>

        <form
          data-block
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            join()
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t.dle.home.codePlaceholder}
            aria-label={t.dle.home.codePlaceholder}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-white/10 bg-black/40 px-4 text-center font-mono text-lg tracking-[0.3em] text-cream uppercase outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-mist/70 placeholder:normal-case focus:border-[#ff5ec4]/60"
          />
          <button
            type="submit"
            disabled={busy !== null || code.trim().length === 0}
            aria-label={t.dle.home.join}
            className="grid size-14 shrink-0 place-items-center rounded-2xl bg-cream text-void transition-opacity disabled:opacity-30"
          >
            {busy === 'join' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ArrowRight size={20} aria-hidden />}
          </button>
        </form>
      </div>
      </div>
    </div>
  )
}

function BigButton({ primary = false, busy, disabled, icon, label, onClick }: { primary?: boolean; busy: boolean; disabled: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-bold tracking-[0.04em] uppercase transition-transform active:scale-[0.98] disabled:opacity-60 ${primary ? 'text-white' : 'border-2 border-white/10 bg-white/[0.05] text-cream hover:bg-white/[0.09]'}`}
      style={primary ? { background: 'linear-gradient(135deg, #ff8ad8, #ff5e7e)', boxShadow: 'inset 0 -4px 0 rgba(0,0,0,0.25), 0 12px 30px -14px rgba(255,94,196,0.9)' } : undefined}
    >
      {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  )
}
