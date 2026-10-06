import { useRef, useState, type FormEvent } from 'react'
import { DoorOpen, Loader2, Sparkle, Swords, Target, Trophy } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { BOMB_GRADIENT } from '../../lib/bomb'
import { parseRoomCode } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { BOMB_MODES } from '../../services/bombApi'
import { useBombStore } from '../../store/useBombStore'
import { useUiStore } from '../../store/useUiStore'
import { Bomb } from './Bomb'


/** Accueil : le mode (vocabulaire ou manga), le solo, les salons, les records. */
export function BombHome() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const mode = useBombStore((state) => state.mode)
  const setMode = useBombStore((state) => state.setMode)
  const overview = useBombStore((state) => state.overview)
  const startSolo = useBombStore((state) => state.startSolo)
  const createRoom = useBombStore((state) => state.createRoom)
  const joinRoom = useBombStore((state) => state.joinRoom)
  const notify = useUiStore((state) => state.notify)
  const [busy, setBusy] = useState<'solo' | 'create' | 'join' | null>(null)
  const [code, setCode] = useState('')

  useGSAP(
    () => {
      gsap.fromTo('[data-bomb-in]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const run = async (kind: 'solo' | 'create' | 'join', action: () => Promise<void>) => {
    if (busy) return
    vibrate(10)
    setBusy(kind)
    try {
      await action()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(null)
    }
  }

  const join = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseRoomCode(code)
    if (!parsed) {
      notify(t.bomb.home.badCode, 'nope')
      return
    }
    void run('join', () => joinRoom(parsed))
  }

  const records = overview?.records
  const best = records ? (mode === 'classic' ? records.bestClassic : records.bestManga) : 0

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-12">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header data-bomb-in className="flex flex-col items-center gap-1 text-center">
          <div data-bomb-fx style={{ animation: 'bomb-float 3.2s ease-in-out infinite' }}>
            <Bomb syllable={mode === 'classic' ? 'par' : 'lu'} endsAt={null} totalMs={1} size={176} />
          </div>
          <h2 className="-mt-2 font-display text-[2.6rem] leading-none" style={{ backgroundImage: BOMB_GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            {t.bomb.title}
          </h2>
          <p className="max-w-xs text-sm text-cream/70">{t.bomb.tagline}</p>
        </header>

        {/* Le mode de jeu. */}
        <div data-bomb-in role="radiogroup" aria-label={t.bomb.home.modeAria} className="grid grid-cols-2 gap-2.5">
          {BOMB_MODES.map((entry) => {
            const selected = mode === entry
            return (
              <button
                key={entry}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  vibrate(6)
                  setMode(entry)
                }}
                className={`relative overflow-hidden rounded-2xl border p-3.5 text-left transition-all ${selected ? 'border-transparent' : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}
                style={
                  selected
                    ? {
                        // Fond opaque sous la teinte : le dégradé de la bordure ne doit pas transparaître.
                        background:
                          'linear-gradient(160deg, rgba(124,92,255,0.3), rgba(255,94,156,0.12)) padding-box, linear-gradient(#120d20, #120d20) padding-box, linear-gradient(135deg, #6fd6ff, #ff5e9c) border-box',
                        border: '1.5px solid transparent',
                      }
                    : undefined
                }
              >
                <span className="text-2xl" aria-hidden>
                  {t.bomb.modes[entry].emoji}
                </span>
                <span className="mt-1 block text-sm font-semibold text-cream">{t.bomb.modes[entry].title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-mist">{t.bomb.modes[entry].body}</span>
              </button>
            )
          })}
        </div>

        {/* Jouer. */}
        <div data-bomb-in className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => void run('solo', startSolo)}
            className="group flex items-center gap-3.5 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-3 pr-4 text-left transition-colors hover:bg-white/[0.07]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-void" style={{ background: 'linear-gradient(135deg, #6fd6ff, #7c5cff)' }}>
              {busy === 'solo' ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Target size={22} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl text-cream">{t.bomb.home.solo}</span>
              <span className="block text-[11px] text-mist">{t.bomb.home.soloBody}</span>
            </span>
            {best > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold tabular-nums">
                <Trophy size={12} aria-hidden />
                {best}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void run('create', createRoom)}
            className="group flex items-center gap-3.5 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-3 pr-4 text-left transition-colors hover:bg-white/[0.07]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-void" style={{ background: 'linear-gradient(135deg, #ff8ad8, #ff5e7e)' }}>
              {busy === 'create' ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Swords size={22} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl text-cream">{t.bomb.home.versus}</span>
              <span className="block text-[11px] text-mist">{t.bomb.home.versusBody}</span>
            </span>
          </button>
          <form onSubmit={join} className="flex items-center gap-2 rounded-[1.4rem] border border-white/10 bg-white/[0.02] p-2 pl-4">
            <DoorOpen size={18} className="shrink-0 text-mist" aria-hidden />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t.bomb.home.codePlaceholder}
              aria-label={t.bomb.home.codePlaceholder}
              maxLength={8}
              autoCapitalize="characters"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm tracking-[0.2em] text-cream uppercase outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-mist/70 placeholder:normal-case"
            />
            <button type="submit" disabled={!code.trim() || busy !== null} className="rounded-full bg-cream px-4 py-2 text-xs font-semibold text-void disabled:opacity-40">
              {busy === 'join' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : t.bomb.home.join}
            </button>
          </form>
        </div>

        {/* Règles en trois lignes. */}
        <ol data-bomb-in className="flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-4 text-xs leading-relaxed text-cream/75">
          {t.bomb.home.rules.map((rule, index) => (
            <li key={index} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-glow/20 text-[10px] font-bold text-cream">{index + 1}</span>
              {rule}
            </li>
          ))}
        </ol>

        {records && (
          <p data-bomb-in className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-mist tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Sparkle size={11} className="fill-current text-gold" aria-hidden />
              {t.bomb.home.earned(records.earnedToday, records.dailyCap)}
            </span>
            <span>{t.bomb.home.wins(records.wins)}</span>
          </p>
        )}
      </div>
    </div>
  )
}
