import { useEffect, useRef, useState } from 'react'
import { Flame, X } from 'lucide-react'
import { useT } from '../../i18n'
import { chooseCovers, coverList, loadCovers } from '../../lib/stack/covers'
import { outcomeOf, pageCount, type StackOutcome } from '../../lib/stack/engine'
import { Board, popScore } from './board'

/** Après la chute de la dernière page, le temps de la voir tomber avant le bilan. */
const OVER_DELAY = 1.05

interface StackGameProps {
  /** La page ratée est tombée : le bilan. */
  onOver: (outcome: StackOutcome) => void
  /** Quitter en cours de partie. */
  onQuit: (outcome: StackOutcome) => void
}

/**
 * Page Stack en solo : une pile plein écran (`Board`). Une page glisse d'un bord à l'autre, on la
 * pose d'un toucher (ou de la barre d'espace). Ce qui dépasse tombe ; une pose parfaite garde toute
 * la largeur et lance une série. Les pages portent des affiches d'anime quand le serveur en a.
 */
export function StackGame({ onOver, onQuit }: StackGameProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scoreRef = useRef<HTMLParagraphElement>(null)
  const boardRef = useRef<Board | null>(null)
  const [hud, setHud] = useState({ score: 0, pages: 0, combo: 0 })
  const [hint, setHint] = useState(true)
  const labels = useRef({ perfect: t.stack.game.perfect, worlds: t.stack.worlds, world: t.stack.game.world })
  const callbacks = useRef({ onOver, onQuit })
  // Valeurs lues par la boucle de jeu : mises à jour après chaque rendu, jamais pendant.
  useEffect(() => {
    labels.current = { perfect: t.stack.game.perfect, worlds: t.stack.worlds, world: t.stack.game.world }
    callbacks.current = { onOver, onQuit }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const board = new Board({ sound: true, reduced, perfectLabel: labels.current.perfect, worldNames: labels.current.worlds, worldLabel: labels.current.world })
    board.coverOffset = Math.floor(Math.random() * 1000)
    boardRef.current = board
    board.onChange = (state) => {
      setHud({ score: state.score, pages: pageCount(state), combo: state.combo })
      popScore(scoreRef.current, state.combo > 0)
    }
    // Recette : la pile est lisible depuis la console du navigateur (jamais en production).
    if (import.meta.env?.DEV) Object.assign(window, { __pageStack: { get state() { return board.state } } })

    // Les affiches arrivent une à une : la partie ne les attend pas.
    const controller = new AbortController()
    void coverList(controller.signal).then((list) => {
      if (controller.signal.aborted) return
      void loadCovers(chooseCovers(list), (image) => board.addImage(image))
    })

    let width = 0
    let height = 0
    let frame = 0
    let last = performance.now()
    let settled = false

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      board.update(dt, width, height)
      board.draw(ctx, width, height)
      if (board.overFor !== null && !settled && board.overFor >= OVER_DELAY) {
        settled = true
        callbacks.current.onOver(outcomeOf(board.state))
      }
    }
    frame = requestAnimationFrame(tick)

    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      boardRef.current = null
    }
  }, [])

  /** Un toucher, un clic ou la barre d'espace : la page se pose. */
  const place = () => {
    if (boardRef.current?.tap()) setHint(false)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'ArrowDown') {
        event.preventDefault()
        place()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const quit = () => {
    const board = boardRef.current
    callbacks.current.onQuit(board ? outcomeOf(board.state) : { score: 0, pages: 0, perfects: 0, bestCombo: 0 })
  }

  return (
    <div
      className="fixed inset-0 z-[80] touch-none overflow-hidden bg-[#1a1038] select-none"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-stack-ui]')) return
        place()
      }}
      role="application"
      aria-label={t.stack.game.aria}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p ref={scoreRef} className="font-display text-6xl leading-none text-white tabular-nums drop-shadow-[0_3px_14px_rgba(30,10,70,0.7)]">
          {hud.score.toLocaleString()}
        </p>
        <p className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-white/80 drop-shadow">
          <span>{t.stack.game.pages(hud.pages)}</span>
          {hud.combo >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ff9b3d]/90 px-2 py-0.5 text-[11px] font-bold text-[#3a1a00]">
              <Flame size={12} aria-hidden />×{hud.combo}
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        data-stack-ui
        onClick={quit}
        aria-label={t.stack.game.quit}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 grid size-10 place-items-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur-sm"
      >
        <X size={18} />
      </button>
      {hint && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[12%] animate-pulse text-center text-sm font-semibold tracking-wide text-white/90 drop-shadow-[0_2px_8px_rgba(30,10,70,0.8)]">
          {t.stack.game.hint}
        </p>
      )}
    </div>
  )
}
