import { useEffect, useRef } from 'react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { canvasApi, type FrameSummary } from '../../services/canvasApi'

const WIDTH = 168
const HEIGHT = 112

/**
 * Mini-carte : le quartier autour de la vue (cadres de la saison, artistes, écran), à ~12 fois
 * l'écran. Un clic y envoie la caméra. Les cadres se rafraîchissent toutes les 20 s.
 */
export function Minimap() {
  const t = useT()
  const canvas = useRef<HTMLCanvasElement>(null)
  const frames = useRef<FrameSummary[]>([])
  const scale = useRef({ minX: 0, minY: 0, k: 1 })

  useEffect(() => {
    let alive = true
    const load = () => {
      canvasApi
        .frames()
        .then((result) => {
          if (alive) frames.current = result.frames
        })
        .catch(() => undefined)
    }
    load()
    const reload = setInterval(load, 20_000)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const element = canvas.current
    if (element) {
      element.width = WIDTH * dpr
      element.height = HEIGHT * dpr
    }
    const draw = () => {
      const engine = getEngine()
      const context = canvas.current?.getContext('2d')
      if (!engine || !context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const view = engine.viewBox()
      const [cx, cy] = engine.camera.center()
      const spanX = Math.max((view.maxX - view.minX) * 10, 9000)
      const k = WIDTH / spanX
      const spanY = HEIGHT / k
      const minX = cx - spanX / 2
      const minY = cy - spanY / 2
      scale.current = { minX, minY, k }
      context.fillStyle = '#14141d'
      context.fillRect(0, 0, WIDTH, HEIGHT)
      for (const frame of frames.current) {
        const x = (frame.x - minX) * k
        const y = (frame.y - minY) * k
        if (x > WIDTH || y > HEIGHT || x + frame.w * k < 0 || y + frame.h * k < 0) continue
        context.fillStyle = 'rgba(255,196,107,0.55)'
        context.fillRect(x, y, Math.max(2, frame.w * k), Math.max(2, frame.h * k))
      }
      for (const [conn, cursor] of engine.peers) {
        const place = cursor.seen > 0 ? { x: cursor.x, y: cursor.y } : engine.places.get(conn)
        if (!place) continue
        context.fillStyle = cursor.color
        context.beginPath()
        context.arc((place.x - minX) * k, (place.y - minY) * k, 2.6, 0, Math.PI * 2)
        context.fill()
      }
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1.2
      context.strokeRect((view.minX - minX) * k, (view.minY - minY) * k, (view.maxX - view.minX) * k, (view.maxY - view.minY) * k)
    }
    const timer = setInterval(draw, 160)
    draw()
    return () => {
      alive = false
      clearInterval(reload)
      clearInterval(timer)
    }
  }, [])

  return (
    <canvas
      ref={canvas}
      aria-label={t.canvas.view.minimap}
      title={t.canvas.view.minimap}
      width={WIDTH}
      height={HEIGHT}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const { minX, minY, k } = scale.current
        getEngine()?.flyTo(minX + ((event.clientX - rect.left) / rect.width) * (WIDTH / k), minY + ((event.clientY - rect.top) / rect.height) * (HEIGHT / k))
      }}
      className="pointer-events-auto cursor-pointer rounded-xl border border-white/15 shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
      style={{ width: WIDTH, height: HEIGHT }}
    />
  )
}
