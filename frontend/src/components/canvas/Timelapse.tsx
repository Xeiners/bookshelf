import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { boundsOf, unionBox } from '../../lib/canvas/geometry'
import { PAPER, drawData } from '../../lib/canvas/render'
import type { Data } from '../../lib/canvas/types'
import { canvasApi } from '../../services/canvasApi'

const MAX_ITEMS = 40_000
const SPEEDS = [1, 4, 16, 64] as const

/**
 * Time-lapse d'une saison : les dessins réapparaissent dans l'ordre où ils ont été faits, cadrés
 * sur toute la toile. Les objets arrivent par pages (3 000 à la fois), puis la lecture démarre ;
 * le curseur permet d'aller et venir.
 */
export function Timelapse({ season, label, onClose }: { season: string; label: string; onClose: () => void }) {
  const t = useT()
  const canvas = useRef<HTMLCanvasElement>(null)
  const items = useRef<Data[]>([])
  const view = useRef({ minX: 0, minY: 0, k: 1 })
  const drawn = useRef(0)
  const [loaded, setLoaded] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4)
  const [position, setPosition] = useState(0)
  const [empty, setEmpty] = useState(false)
  const playingRef = useRef(true)
  const speedRef = useRef<number>(4)

  const render = (upTo: number) => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const { minX, minY, k } = view.current
    context.setTransform(1, 0, 0, 1, 0, 0)
    // Repartir de zéro si l'on recule.
    if (upTo < drawn.current) {
      context.fillStyle = PAPER
      context.fillRect(0, 0, element.width, element.height)
      drawn.current = 0
    }
    context.setTransform(k, 0, 0, k, -minX * k, -minY * k)
    for (let index = drawn.current; index < upTo; index += 1) drawData(context, items.current[index]!)
    drawn.current = upTo
  }

  useEffect(() => {
    let alive = true
    const load = async () => {
      const list: Data[] = []
      let after: string | undefined
      for (let page = 0; page < 20 && list.length < MAX_ITEMS; page += 1) {
        const result = await canvasApi.timelapse(season, after)
        if (!alive) return
        for (const item of result.items) list.push(item.d as Data)
        setLoaded(list.length)
        after = result.next ?? undefined
        if (!after) break
      }
      if (!alive) return
      items.current = list
      setTotal(list.length)
      if (list.length === 0) return setEmpty(true)
      const element = canvas.current
      if (!element) return
      const box = unionBox(list.map((data) => boundsOf(data)))
      const width = Math.max(1, box.maxX - box.minX)
      const height = Math.max(1, box.maxY - box.minY)
      const side = Math.min(1600, Math.max(600, window.innerWidth * 2))
      const k = Math.min(side / width, (side * 0.75) / height)
      element.width = Math.ceil(width * k)
      element.height = Math.ceil(height * k)
      view.current = { minX: box.minX, minY: box.minY, k }
      const context = element.getContext('2d')
      if (context) {
        context.fillStyle = PAPER
        context.fillRect(0, 0, element.width, element.height)
      }
    }
    void load().catch(() => alive && setEmpty(true))
    return () => {
      alive = false
    }
  }, [season])

  useEffect(() => {
    playingRef.current = playing
    speedRef.current = speed
  }, [playing, speed])

  // Lecture : un pas par image, à la vitesse choisie (objets par seconde).
  useEffect(() => {
    if (total === 0) return
    let raf = 0
    let last = performance.now()
    let float = drawn.current
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (playingRef.current && drawn.current < total) {
        float = Math.min(total, float + dt * speedRef.current * Math.max(8, total / 40))
        render(Math.floor(float))
        setPosition(Math.floor(float))
        if (Math.floor(float) >= total) setPlaying(false)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-void/95" role="dialog" aria-modal aria-label={t.canvas.seasons.timelapse}>
      <header className="flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl text-cream">{t.canvas.seasons.timelapse}</h2>
          <p className="truncate text-xs text-mist capitalize">{label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="glass grid size-10 place-items-center rounded-full text-cream/80">
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="relative grid min-h-0 flex-1 place-items-center px-3">
        {(loaded === null || (total === 0 && !empty)) && (
          <div className="absolute flex flex-col items-center gap-2 text-sm text-mist">
            <Loader2 className="animate-spin text-glow" size={24} aria-hidden />
            {t.canvas.seasons.loading} {loaded ? `(${loaded.toLocaleString()})` : ''}
          </div>
        )}
        {empty && <p className="text-sm text-mist">{t.canvas.seasons.empty}</p>}
        <canvas ref={canvas} className="max-h-full max-w-full rounded-xl border border-white/10 shadow-2xl" style={{ visibility: total > 0 ? 'visible' : 'hidden' }} />
      </div>
      {total > 0 && (
        <footer className="flex items-center gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              if (drawn.current >= total) {
                render(0)
                setPosition(0)
              }
              setPlaying((state) => !state)
            }}
            aria-label={playing ? t.canvas.seasons.pause : t.canvas.seasons.play}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-glow text-white active:scale-95"
          >
            {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>
          <input
            type="range"
            min={0}
            max={total}
            value={position}
            aria-label={t.canvas.seasons.timelapse}
            onChange={(event) => {
              const next = Number(event.target.value)
              setPlaying(false)
              render(next)
              setPosition(next)
            }}
            className="canvas-range h-2 min-w-0 flex-1 bg-white/15"
          />
          <div className="flex shrink-0 gap-1" role="group" aria-label={t.canvas.seasons.speed}>
            {SPEEDS.map((value) => (
              <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)} className={`h-8 rounded-full px-2.5 text-[11px] font-semibold ${speed === value ? 'bg-white text-void' : 'bg-white/10 text-cream/80'}`}>
                ×{value}
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>,
    document.body,
  )
}

