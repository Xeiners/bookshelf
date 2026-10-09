import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playBombExplosion, playBombFail, playBombWord } from '../../lib/sfx'
import { bombApi, type SoloView, type WordRefusal } from '../../services/bombApi'
import { useBombStore } from '../../store/useBombStore'
import { hlSound } from '../../store/useHigherLowerStore'
import { useUiStore } from '../../store/useUiStore'
import { DleBar } from '../dle/DleBar'
import { SoundToggle } from '../higherlower/SoundToggle'
import { Bomb } from './Bomb'
import { SoloOver } from './SoloOver'
import { Lives, WordInput } from './BombParts'
import { Explosion } from './Explosion'

type Feedback = { kind: 'ok'; text: string; key: number } | { kind: 'fail'; reason: WordRefusal; key: number }

/**
 * Solo / entraînement : désamorcer un maximum de bombes d'affilée. Le serveur tient la
 * partie ; ici, la mèche affichée suit son horloge, et l'explosion se joue dès qu'il la
 * confirme.
 */
export function SoloGame({ solo }: { solo: SoloView }) {
  const t = useT()
  const setSolo = useBombStore((state) => state.setSolo)
  const startSolo = useBombStore((state) => state.startSolo)
  const goHome = useBombStore((state) => state.goHome)
  const collect = useBombStore((state) => state.collect)
  const offset = useBombStore((state) => state.offset)
  const style = useBombStore((state) => state.style)
  const notify = useUiStore((state) => state.notify)
  const stageRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [burst, setBurst] = useState(0)
  const [combo, setCombo] = useState(0)
  const [found, setFound] = useState<string[]>([])
  const [restarting, setRestarting] = useState(false)
  const collected = useRef<string | null>(null)
  const exploding = useRef(false)

  // Fin de partie : les Poussières rejoignent le solde (ou les reçus d'invité), une fois.
  useEffect(() => {
    if (solo.over && collected.current !== solo.id) {
      collected.current = solo.id
      collect(solo.over)
    }
  }, [solo, collect])

  /** Ce que le serveur renvoie : une vie de moins → l'explosion. */
  const apply = (next: SoloView, receivedAt: number) => {
    if (next.lives < solo.lives) {
      setBurst((value) => value + 1)
      setCombo(0)
      setInput('')
      hlSound(playBombExplosion)
    }
    setSolo(next, receivedAt)
  }

  const onZero = () => {
    if (exploding.current || solo.over) return
    exploding.current = true
    const ask = (attempt: number) => {
      const sentAt = Date.now()
      bombApi
        .soloExplode(solo.id)
        .then((next) => {
          // Horloge un poil en avance : le serveur ne la constate pas encore, on redemande.
          if (next.lives === solo.lives && !next.over && attempt < 4) {
            window.setTimeout(() => ask(attempt + 1), 250)
            return
          }
          exploding.current = false
          apply(next, (sentAt + Date.now()) / 2)
        })
        .catch((error: unknown) => {
          exploding.current = false
          notify(apiErrorMessage(error, t), 'nope')
        })
    }
    ask(0)
  }

  const submit = async () => {
    const word = input.trim()
    if (!word || busy || solo.over) return
    setBusy(true)
    const sentAt = Date.now()
    try {
      const { verdict, view } = await bombApi.soloWord(solo.id, word)
      if (verdict?.ok) {
        hlSound(() => playBombWord(combo))
        vibrate(12)
        setCombo((value) => value + 1)
        setFound((list) => [verdict.display, ...list].slice(0, 8))
        setFeedback({ kind: 'ok', text: verdict.display, key: Date.now() })
        setInput('')
      } else if (verdict) {
        hlSound(playBombFail)
        vibrate([20, 30, 20])
        setFeedback({ kind: 'fail', reason: verdict.reason, key: Date.now() })
        gsap.fromTo(inputRef.current?.parentElement ?? null, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' })
      }
      apply(view, (sentAt + Date.now()) / 2)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
      if (document.activeElement !== inputRef.current) inputRef.current?.focus({ preventScroll: true })
    }
  }

  const quit = async () => {
    if (solo.over) {
      goHome()
      return
    }
    try {
      setSolo(await bombApi.soloQuit(solo.id))
    } catch {
      goHome()
    }
  }

  const replay = async () => {
    setRestarting(true)
    try {
      await startSolo()
      setFound([])
      setCombo(0)
      setFeedback(null)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setRestarting(false)
    }
  }

  // Le message d'un mot s'efface après un moment.
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 1600)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const endsAt = solo.over ? null : solo.fuseEndsAt - offset

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DleBar label={solo.over ? t.bomb.title : t.bomb.quit} onBack={() => void quit()} danger={!solo.over}>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-cream/80">{t.bomb.modes[solo.mode].short}</span>
        <SoundToggle />
      </DleBar>

      <div className="mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col px-5 pb-5">
        {/* Vies, mots, prime en cours. */}
        <div className="flex items-center justify-between gap-3">
          <Lives lives={solo.lives} size={14} />
          <span className="font-display text-3xl text-cream tabular-nums">
            {solo.words}
            <span className="ml-1.5 font-sans text-xs text-mist">{t.bomb.wordsShort(solo.words)}</span>
          </span>
          {combo >= 3 ? (
            <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold">{t.bomb.combo(combo)}</span>
          ) : (
            <span className="w-14" />
          )}
        </div>

        <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-2 will-change-transform">
          {/* Le verdict du dernier mot, au-dessus de la bombe. */}
          <div className="h-8">
            {feedback && (
              <span
                key={feedback.key}
                className={`inline-flex animate-[bomb-float_0.6s_ease-out] items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
                  feedback.kind === 'ok' ? 'bg-like/15 text-like' : 'bg-nope/15 text-nope'
                }`}
              >
                {feedback.kind === 'ok' ? `✓ ${feedback.text.toUpperCase()}` : t.bomb.refused[feedback.reason]}
              </span>
            )}
          </div>
          <Bomb syllable={solo.syllable} endsAt={endsAt} totalMs={solo.fuseMs} variant={style} audible={!solo.over} shakeRef={stageRef} onZero={onZero} />
          <div className="h-10 text-center">
            {solo.missed && !solo.over && solo.missed.example && (
              <p className="text-xs text-mist">
                {t.bomb.missed(solo.missed.syllable.toUpperCase())} <span className="font-semibold text-gold uppercase">{solo.missed.example}</span>
              </p>
            )}
          </div>
        </div>

        {/* Les derniers mots trouvés. */}
        <div className="mb-3 flex min-h-7 flex-wrap justify-center gap-1.5">
          {found.map((word, index) => (
            <span key={`${word}-${index}`} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-cream/70 uppercase" style={{ opacity: 1 - index * 0.1 }}>
              {word}
            </span>
          ))}
        </div>

        <WordInput
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={Boolean(solo.over)}
          error={feedback?.kind === 'fail'}
          placeholder={t.bomb.placeholder(solo.syllable.toUpperCase())}
        />
      </div>

      <Explosion burst={burst} label={t.bomb.boom} />

      {solo.over && <SoloOver over={solo.over} restarting={restarting} onHome={goHome} onReplay={() => void replay()} />}
    </div>
  )
}
