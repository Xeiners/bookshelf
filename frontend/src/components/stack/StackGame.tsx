import { useEffect, useRef, useState } from 'react'
import { Flame, X } from 'lucide-react'
import { useT } from '../../i18n'
import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playStackCut, playStackMilestone, playStackOver, playStackPerfect, playStackPlace } from '../../lib/sfx'
import { createStack, drain, outcomeOf, pageCount, step, tap, type StackOutcome, type StackState } from '../../lib/stack/engine'
import { PAGES_PER_SKY, camTarget, drawDesk, drawGuides, drawPage, drawPetals, drawSky, makePetals, makeView, rowTop } from './scene'

/** Après la chute de la dernière page, le temps de la voir tomber avant le bilan. */
const OVER_DELAY = 1.05

interface Piece {
  x: number
  y: number
  w: number
  vx: number
  vy: number
  angle: number
  spin: number
  index: number
  /** Page entière (celle qui est ratée) ou simple morceau. */
  whole: boolean
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

interface Ring {
  x: number
  y: number
  w: number
  h: number
  life: number
}

interface Float {
  text: string
  sub: string
  x: number
  y: number
  life: number
}

interface Scene {
  state: StackState
  cam: number
  time: number
  pieces: Piece[]
  sparks: Spark[]
  rings: Ring[]
  floats: Float[]
  shake: number
  overAt: number | null
  settled: boolean
  tapped: boolean
}

interface StackGameProps {
  /** La page ratée est tombée : le bilan. */
  onOver: (outcome: StackOutcome) => void
  /** Quitter en cours de partie. */
  onQuit: (outcome: StackOutcome) => void
}

/**
 * Page Stack : une page de manga glisse d'un bord à l'autre, on la pose d'un toucher (ou de la
 * barre d'espace). Ce qui dépasse tombe ; une pose parfaite garde toute la largeur et lance une
 * série. Le moteur (`lib/stack/engine.ts`) est pur ; ce composant le fait tourner à 60 i/s, dessine
 * la scène en Canvas 2D (`scene.ts`) et met en scène chaque pose.
 */
export function StackGame({ onOver, onQuit }: StackGameProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scoreRef = useRef<HTMLParagraphElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const [hud, setHud] = useState({ score: 0, pages: 0, combo: 0 })
  const [hint, setHint] = useState(true)
  const labels = useRef({ perfect: t.stack.game.perfect })
  const callbacks = useRef({ onOver, onQuit })
  // Valeurs lues par la boucle de jeu : mises à jour après chaque rendu, jamais pendant.
  useEffect(() => {
    labels.current = { perfect: t.stack.game.perfect }
    callbacks.current = { onOver, onQuit }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const petals = makePetals(reduced ? 8 : 34)
    const scene: Scene = { state: createStack(), cam: 0, time: 0, pieces: [], sparks: [], rings: [], floats: [], shake: 0, overAt: null, settled: false, tapped: false }
    sceneRef.current = scene
    // Recette : la scène est lisible depuis la console du navigateur (jamais en production).
    if (import.meta.env?.DEV) Object.assign(window, { __pageStack: scene })
    let width = 0
    let height = 0
    let frame = 0
    let last = performance.now()

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

    const burst = (x: number, y: number, count: number, colors: string[], power: number) => {
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
        const speed = power * (0.4 + Math.random() * 0.8)
        scene.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, max: 0.55 + Math.random() * 0.5, size: 2 + Math.random() * 3, color: colors[index % colors.length]! })
      }
    }

    /** Met en scène ce que le moteur vient de produire. */
    const stage = (view: ReturnType<typeof makeView>) => {
      for (const event of drain(scene.state)) {
        if (event.type === 'place') {
          const top = rowTop(view, event.index)
          const centre = view.left + event.x * view.stage
          setHud({ score: scene.state.score, pages: pageCount(scene.state), combo: scene.state.combo })
          if (scoreRef.current) gsap.fromTo(scoreRef.current, { scale: event.perfect ? 1.3 : 1.12 }, { scale: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true })
          if (event.perfect) {
            playStackPerfect(event.combo)
            vibrate(event.combo >= 3 ? [8, 20, 12] : 8)
            scene.rings.push({ x: centre, y: top + view.page / 2, w: event.w * view.stage, h: view.page, life: 0 })
            burst(centre, top, 10 + Math.min(14, event.combo * 2), ['#ffd35c', '#ffffff', '#ff8fb8', '#7ad7ff'], view.stage * 0.9)
            // Un seul message à la fois : une nouvelle parfaite remplace la précédente.
            scene.floats = [{ text: labels.current.perfect, sub: event.combo > 1 ? `×${event.combo}` : '', x: centre, y: top - view.page * 0.4, life: 0 }]
          } else {
            playStackPlace()
            vibrate(5)
          }
          if (event.cut && event.cut.w > 0.004) {
            playStackCut()
            const dir = event.cut.x > event.x ? 1 : -1
            scene.pieces.push({ x: view.left + event.cut.x * view.stage, y: top, w: event.cut.w * view.stage, vx: dir * view.stage * 0.25, vy: -view.stage * 0.1, angle: 0, spin: dir * 1.6, index: event.index, whole: false })
          }
          if (event.index % PAGES_PER_SKY === 0) {
            playStackMilestone()
            burst(view.width / 2, view.height * 0.35, 36, ['#ff8fb8', '#ffd1e3', '#ffffff'], view.stage * 1.1)
          }
        } else {
          playStackOver()
          vibrate([30, 40, 60])
          const moving = scene.state.pages[scene.state.pages.length - 1]!
          void moving
          scene.shake = 0.55
          scene.overAt = scene.time
          // La page ratée tombe de côté, depuis l'endroit où elle glissait.
          scene.pieces.push({
            x: view.left + (event.x - event.w / 2) * view.stage,
            y: rowTop(view, pageCount(scene.state) + 1),
            w: event.w * view.stage,
            vx: (event.x > 0.5 ? 1 : -1) * view.stage * 0.18,
            vy: -view.stage * 0.2,
            angle: 0,
            spin: (event.x > 0.5 ? 1 : -1) * 1.2,
            index: pageCount(scene.state) + 1,
            whole: true,
          })
        }
      }
    }

    const draw = (view: ReturnType<typeof makeView>) => {
      const { state } = scene
      const count = pageCount(state)
      ctx.save()
      if (scene.shake > 0 && !reduced) ctx.translate((Math.random() - 0.5) * 16 * scene.shake, (Math.random() - 0.5) * 16 * scene.shake)
      const sky = drawSky(ctx, view, count, scene.time)
      drawPetals(ctx, view, petals, scene.time, sky)
      drawDesk(ctx, view)

      // Une ombre portée sous la pile.
      const first = Math.max(0, Math.floor((view.cam - view.page * 2) / view.page))
      for (let row = first; row <= count; row += 1) {
        const top = rowTop(view, row)
        if (top > view.height + view.page) continue
        if (top < -view.page * 2) break
        const page = state.pages[row]!
        drawPage(ctx, view, page.x, page.w, top, row)
      }
      if (state.moving) {
        drawGuides(ctx, view, state)
        drawPage(ctx, view, state.moving.x, state.moving.w, rowTop(view, count + 1), count + 1)
      }

      for (const ring of scene.rings) {
        const grow = ring.life / 0.5
        ctx.strokeStyle = `rgba(255,236,170,${1 - grow})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.roundRect(ring.x - (ring.w / 2) * (1 + grow * 0.25), ring.y - (ring.h / 2) * (1 + grow * 0.9), ring.w * (1 + grow * 0.25), ring.h * (1 + grow * 0.9), 8)
        ctx.stroke()
      }
      for (const piece of scene.pieces) {
        drawPage(ctx, view, (piece.x + piece.w / 2 - view.left) / view.stage, piece.w / view.stage, piece.y, piece.index, {
          alpha: Math.max(0, 1 - Math.max(0, piece.y - view.height * 0.9) / 200),
          angle: piece.angle,
        })
      }
      for (const spark of scene.sparks) {
        const fade = 1 - spark.life / spark.max
        ctx.globalAlpha = Math.max(0, fade)
        ctx.fillStyle = spark.color
        ctx.beginPath()
        ctx.arc(spark.x, spark.y, spark.size * (0.4 + fade * 0.6), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      for (const float of scene.floats) {
        const progress = float.life / 0.9
        ctx.globalAlpha = Math.max(0, 1 - progress * progress)
        ctx.textAlign = 'center'
        ctx.lineJoin = 'round'
        ctx.font = `800 ${Math.round(view.page * 0.62)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
        ctx.strokeStyle = 'rgba(40,10,60,0.75)'
        ctx.lineWidth = 5
        const y = float.y - progress * view.page * 1.4
        ctx.strokeText(float.text, float.x, y)
        ctx.fillStyle = '#ffe8a0'
        ctx.fillText(float.text, float.x, y)
        if (float.sub) {
          ctx.font = `800 ${Math.round(view.page * 0.5)}px Inter, system-ui, sans-serif` // i18n-ignore : police Canvas
          ctx.strokeText(float.sub, float.x, y + view.page * 0.6)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(float.sub, float.x, y + view.page * 0.6)
        }
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      scene.time += dt
      const probe = makeView(width, height, scene.cam)
      scene.cam += (camTarget(probe, pageCount(scene.state)) - scene.cam) * (1 - Math.exp(-6 * dt))
      const view = makeView(width, height, scene.cam)
      step(scene.state, dt)
      stage(view)

      const gravity = view.stage * 4.2
      for (const piece of scene.pieces) {
        piece.vy += gravity * dt
        piece.x += piece.vx * dt
        piece.y += piece.vy * dt
        piece.angle += piece.spin * dt
      }
      scene.pieces = scene.pieces.filter((piece) => piece.y < view.height + view.page * 3)
      for (const spark of scene.sparks) {
        spark.life += dt
        spark.vy += view.stage * 1.6 * dt
        spark.x += spark.vx * dt
        spark.y += spark.vy * dt
      }
      scene.sparks = scene.sparks.filter((spark) => spark.life < spark.max)
      for (const ring of scene.rings) ring.life += dt
      scene.rings = scene.rings.filter((ring) => ring.life < 0.5)
      for (const float of scene.floats) float.life += dt
      scene.floats = scene.floats.filter((float) => float.life < 0.9)
      scene.shake = Math.max(0, scene.shake - dt * 1.6)

      draw(view)

      if (scene.overAt !== null && !scene.settled && scene.time - scene.overAt >= OVER_DELAY) {
        scene.settled = true
        callbacks.current.onOver(outcomeOf(scene.state))
      }
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      sceneRef.current = null
    }
  }, [])

  /** Un toucher, un clic ou la barre d'espace : la page se pose. */
  const place = () => {
    const scene = sceneRef.current
    if (!scene || scene.state.over) return
    if (!scene.tapped) {
      scene.tapped = true
      setHint(false)
    }
    tap(scene.state)
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
    const scene = sceneRef.current
    callbacks.current.onQuit(scene ? outcomeOf(scene.state) : { score: 0, pages: 0, perfects: 0, bestCombo: 0 })
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
