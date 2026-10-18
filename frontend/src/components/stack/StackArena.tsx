import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../i18n'
import { gsap } from '../../lib/gsap'
import { loadCover } from '../../lib/stack/covers'
import { outcomeOf, pageCount } from '../../lib/stack/engine'
import { layoutPanels, type Rect } from '../../lib/stack/layout'
import { PLAYER_COLORS, type StackRelay, type StackRoom } from '../../lib/stack/net'
import { useStackRoom } from '../../store/useStackRoom'
import { Board } from './board'

/** Position envoyée aux autres joueurs toutes les 50 ms (versus : sa pile ; coop : quand c'est son tour). */
const TICK_EVERY = 0.05
const TEAM = 'team'

interface StackArenaProps {
  /** Le salon au départ de la partie : joueurs, mode, affiches, heure de départ. */
  room: StackRoom
  meId: string
  onLeave: () => void
}

interface Panel {
  id: string
  board: Board
  color: string
}

/**
 * L'arène : un seul canevas plein écran, partagé en autant de panneaux que de joueurs (versus) —
 * le sien, et celui des autres, rejoués en direct à partir de leurs gestes — ou une seule pile
 * commune (coop), où l'on pose chacun son tour. Chaque panneau est un `Board`, comme au solo.
 */
export function StackArena({ room, meId, onLeave }: StackArenaProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [count, setCount] = useState<string | null>(null)
  const roomRef = useRef(room)
  const labels = useRef({ worlds: t.stack.worlds, world: t.stack.game.world, pages: t.stack.game.pages, perfect: t.stack.game.perfect, eliminated: t.stack.arena.eliminated, you: t.stack.arena.you, yourTurn: t.stack.arena.yourTurn, turnOf: t.stack.arena.turnOf, waiting: t.stack.arena.waiting })
  const turn = useRef<string | null>(room.turn)
  const roomCode = room.code
  const roomSeed = room.seed

  useEffect(() => {
    roomRef.current = room
    if (room.turn) turn.current = room.turn
    labels.current = { worlds: t.stack.worlds, world: t.stack.game.world, pages: t.stack.game.pages, perfect: t.stack.game.perfect, eliminated: t.stack.arena.eliminated, you: t.stack.arena.you, yourTurn: t.stack.arena.yourTurn, turnOf: t.stack.arena.turnOf, waiting: t.stack.arena.waiting }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const room = roomRef.current
    const store = useStackRoom.getState()
    const coop = room.mode === 'coop'
    const players = [...room.players].sort((a, b) => Number(b.id === meId) - Number(a.id === meId))
    const nameOf = (id: string) => players.find((player) => player.id === id)?.name ?? '—'
    const colorOf = (id: string) => PLAYER_COLORS[Math.max(0, room.players.findIndex((player) => player.id === id)) % PLAYER_COLORS.length]!

    // Même suite d'affiches pour tout le monde : celles du salon, dans l'ordre du serveur.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || players.length > 2
    const make = (id: string, sound: boolean): Panel => {
      const board = new Board({ sound, reduced, perfectLabel: labels.current.perfect, worldNames: labels.current.worlds, worldLabel: labels.current.world })
      board.coverOffset = room.seed % 1000
      return { id, board, color: colorOf(id) }
    }
    const panels: Panel[] = coop ? [make(TEAM, true)] : players.map((player) => make(player.id, player.id === meId))
    // Un décor par panneau : plus on est nombreux, plus chacun est dessiné petit et rarement (l'adversaire plus que soi),
    // et si la machine peine, ça baisse encore (`level`).
    let level = 0
    const tuneBackdrops = (): void => {
      const crowd = panels.length
      for (const panel of panels) {
        const own = panel.id === meId || panel.id === TEAM
        const side = crowd <= 1 ? 640 : crowd === 2 ? (own ? 560 : 460) : own ? 480 : 360
        const fps = crowd <= 1 ? 30 : crowd === 2 ? (own ? 30 : 24) : own ? 30 : 18
        panel.board.setBackdropQuality(side * 0.8 ** level, fps * 0.75 ** level)
      }
    }
    tuneBackdrops()
    let slow = 0
    let smooth = 16
    const mine = coop ? panels[0]! : panels.find((panel) => panel.id === meId)
    const controller = new AbortController()
    // Même suite d'affiches pour tout le monde, rangée comme le serveur l'a donnée.
    room.covers.forEach((cover, slot) => {
      void loadCover(cover.url).then((image) => {
        if (image && !controller.signal.aborted) for (const panel of panels) panel.board.setImage(slot, room.covers.length, image, cover.title)
      })
    })

    /** Temps de trajet d'un geste (s) : l'heure d'émission annoncée contre l'heure du salon ici, bornée. */
    const lagOf = (sentAt: number | undefined): number => {
      if (sentAt === undefined) return 0
      return Math.min(0.35, Math.max(0, (Date.now() + useStackRoom.getState().clockOffset - sentAt) / 1000))
    }
    store.onRelay((event: StackRelay) => {
      if (event.k === 'turn') {
        turn.current = event.p
        return
      }
      const panel = coop ? panels[0] : panels.find((candidate) => candidate.id === event.p)
      if (!panel) return
      if (event.k === 'tk') panel.board.sync(event.x, event.d, lagOf(event.a))
      else if (event.k === 'tp') {
        panel.board.remoteTap(event.x, lagOf(event.a))
        if (coop) turn.current = event.next
      } else panel.board.forceOver()
    })

    let width = 0
    let height = 0
    let frame = 0
    let last = performance.now()
    let sinceTick = 0
    let sentOver = false
    let lastCount = ''

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

    const text = (value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
      ctx.textAlign = align
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(20,8,50,0.7)'
      ctx.strokeText(value, x, y)
      ctx.fillStyle = color
      ctx.fillText(value, x, y)
    }

    /** Bandeau d'un panneau : le nom, le score, l'élimination. */
    const decorate = (panel: Panel, rect: Rect) => {
      const size = Math.max(11, Math.min(17, rect.w / 18))
      const state = panel.board.state
      if (coop) {
        const active = turn.current
        const myTurn = active === meId
        text(state.score.toLocaleString(), rect.w / 2, size * 2.2, size * 3.2, '#ffffff', 'center')
        text(labels.current.pages(pageCount(state)), rect.w / 2, size * 4.3, size * 0.95, 'rgba(255,255,255,0.85)', 'center')
        // Qui pose : un bandeau à la couleur du joueur, et la liste de l'équipe.
        const label = myTurn ? labels.current.yourTurn : labels.current.turnOf(nameOf(active ?? ''))
        const chipColor = active ? colorOf(active) : '#ffffff'
        ctx.fillStyle = 'rgba(14,6,36,0.55)'
        ctx.beginPath()
        ctx.roundRect(rect.w / 2 - rect.w * 0.34, rect.h - size * 4.6, rect.w * 0.68, size * 2.3, size * 1.1)
        ctx.fill()
        ctx.strokeStyle = chipColor
        ctx.lineWidth = myTurn ? 3 : 1.5
        ctx.stroke()
        text(label, rect.w / 2, rect.h - size * 3.45, size * 1.15, myTurn ? '#ffffff' : chipColor, 'center')
        let x = size
        for (const player of players) {
          const turnHere = player.id === active
          ctx.fillStyle = colorOf(player.id)
          ctx.globalAlpha = turnHere ? 1 : 0.55
          ctx.beginPath()
          ctx.arc(x + size * 0.4, size * 6.2, size * (turnHere ? 0.55 : 0.4), 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
          if (turnHere) text(player.id === meId ? labels.current.you : (player.name ?? '—'), x + size * 1.2, size * 6.2, size * 0.9, '#ffffff')
          x += turnHere ? size * 1.8 + ctx.measureText(player.name ?? '').width : size * 1.5
        }
        return
      }
      const over = state.over
      ctx.fillStyle = 'rgba(14,6,36,0.5)'
      ctx.fillRect(0, 0, rect.w, size * 2.6)
      ctx.fillStyle = panel.color
      ctx.beginPath()
      ctx.arc(size * 0.9, size * 1.3, size * 0.42, 0, Math.PI * 2)
      ctx.fill()
      // Le bouton « quitter » occupe le coin haut droit de l'écran : le score s'en écarte.
      const corner = rect.y < 1 && rect.x + rect.w >= width - 1 ? 44 : 0
      const name = nameOf(panel.id)
      const ellipsis = '…' // i18n-ignore : signe de ponctuation
      text(name.length > 14 ? `${name.slice(0, 13)}${ellipsis}` : name, size * 1.7, size * 1.3, size, '#ffffff')
      text(state.score.toLocaleString(), rect.w - size * 0.7 - corner, size * 1.3, size * 1.35, '#ffe8a0', 'right')
      if (state.combo >= 2) text(`×${state.combo}`, rect.w - size * 0.7 - corner, size * 3.4, size * 1.1, '#ff9b3d', 'right')
      if (over) {
        ctx.fillStyle = 'rgba(10,4,28,0.45)'
        ctx.fillRect(0, 0, rect.w, rect.h)
        text(labels.current.eliminated, rect.w / 2, rect.h * 0.45, size * 1.6, '#ffffff', 'center')
        text(labels.current.pages(pageCount(state)), rect.w / 2, rect.h * 0.45 + size * 2, size, 'rgba(255,255,255,0.8)', 'center')
      }
      if (panel.id === meId) {
        ctx.strokeStyle = panel.color
        ctx.lineWidth = 3
        ctx.strokeRect(1.5, 1.5, rect.w - 3, rect.h - 3)
        text(labels.current.you, size * 1.7, size * 3.3, size * 0.85, panel.color)
      }
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Image trop longue pendant près de deux secondes : le décor passe au palier moins cher.
      smooth += (dt * 1000 - smooth) * 0.05
      slow = smooth > 24 ? slow + dt : 0
      if (slow > 1.8 && level < 3) {
        level += 1
        slow = 0
        smooth = 16
        tuneBackdrops()
      }
      const live = roomRef.current
      const serverNow = Date.now() + useStackRoom.getState().clockOffset
      const startsAt = live.startsAt ?? serverNow
      const started = live.phase !== 'countdown' && serverNow >= startsAt - 20
      const remaining = Math.ceil((startsAt - serverNow) / 1000)
      const label = started ? '' : remaining > 0 ? String(remaining) : labels.current.waiting
      if (label !== lastCount) {
        lastCount = label
        setCount(started ? null : label)
      }
      const rects = layoutPanels(panels.length, width, height, 4)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#120a28'
      ctx.fillRect(0, 0, width, height)
      panels.forEach((panel, index) => {
        const rect = rects[index]!
        ctx.save()
        ctx.translate(rect.x, rect.y)
        ctx.beginPath()
        ctx.rect(0, 0, rect.w, rect.h)
        ctx.clip()
        panel.board.update(started ? dt : 0, rect.w, rect.h)
        panel.board.draw(ctx, rect.w, rect.h)
        decorate(panel, rect)
        ctx.restore()
      })

      if (!started || !mine) return
      // Ma pile : ma position part régulièrement, et ma chute est annoncée.
      const board = mine.board
      const myTurn = !coop || turn.current === meId
      sinceTick += dt
      if (sinceTick >= TICK_EVERY && myTurn && board.state.moving) {
        sinceTick = 0
        store.tick(board.state.moving.x, board.state.moving.dir, board.state.score)
      }
      if (board.state.over && !sentOver && myTurn) {
        sentOver = true
        const outcome = outcomeOf(board.state)
        store.over({ score: outcome.score, pages: outcome.pages, perfects: outcome.perfects, combo: outcome.bestCombo })
      }
    }
    frame = requestAnimationFrame(tick)

    /** Un toucher : ma page se pose (en coop, seulement à mon tour). */
    const place = () => {
      if (!mine) return
      const live = roomRef.current
      const serverNow = Date.now() + useStackRoom.getState().clockOffset
      if (live.phase !== 'playing' && !(live.phase === 'countdown' && serverNow >= (live.startsAt ?? Infinity))) return
      if (coop && turn.current !== meId) return
      const x = mine.board.state.moving?.x
      if (x !== undefined && mine.board.tap()) store.tap(x)
    }
    placeRef.current = place
    if (import.meta.env?.DEV) Object.assign(window, { __pageStackArena: { me: meId, boards: panels.map((panel) => ({ id: panel.id, state: panel.board.state })), turn: () => turn.current } })

    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      store.onRelay(null)
      placeRef.current = null
    }
  }, [roomCode, roomSeed, meId])

  const placeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'ArrowDown') {
        event.preventDefault()
        placeRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const bump = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (count && bump.current) gsap.fromTo(bump.current, { scale: 1.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.45, ease: 'back.out(2)' })
  }, [count])

  return (
    <div
      className="fixed inset-0 z-[80] touch-none overflow-hidden bg-[#120a28] select-none"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-stack-ui]')) return
        placeRef.current?.()
      }}
      role="application"
      aria-label={t.stack.game.aria}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <button
        type="button"
        data-stack-ui
        onClick={onLeave}
        aria-label={t.stack.arena.leave}
        className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-10 grid size-9 place-items-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-sm"
      >
        <X size={16} />
      </button>
      {count && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
          <p ref={bump} className="font-display text-[7rem] leading-none text-white drop-shadow-[0_4px_24px_rgba(255,160,90,0.7)]">
            {count}
          </p>
        </div>
      )}
    </div>
  )
}
