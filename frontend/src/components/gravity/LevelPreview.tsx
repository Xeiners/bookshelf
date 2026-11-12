import { useEffect, useRef } from 'react'
import { PLAYER_H, PLAYER_W, WORLD_HEIGHT } from '../../lib/gravity/constants'
import type { SolveReport } from '../../lib/gravity/solver'
import { themeOf } from '../../lib/gravity/themes'
import type { GravityLevel } from '../../lib/gravity/types'
import { GATE_COLORS, WARP_COLOR } from './scene/world'

/**
 * Le niveau entier en une bande : plateformes, pièges, portes, bûches, rouleaux, et le chemin du solveur (la
 * preuve qu'il se finit d'une traite) ; en rouge, l'endroit où il coince, s'il coince.
 */
export function LevelPreview({ level, report, className }: { level: GravityLevel; report: SolveReport | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const theme = themeOf(level.theme)
    const sx = width / (level.length + 6)
    const sy = height / WORLD_HEIGHT
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, theme.sky[0])
    sky.addColorStop(1, theme.sky[2])
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    for (const element of level.elements) {
      switch (element.type) {
        case 'block':
        case 'crumble':
        case 'mover':
          ctx.fillStyle = element.type === 'block' ? theme.platform.body : element.type === 'crumble' ? '#a8907c' : '#7b86a8'
          ctx.fillRect(element.x * sx, Math.max(0, element.y) * sy, element.w * sx, (Math.min(WORLD_HEIGHT, element.y + element.h) - Math.max(0, element.y)) * sy)
          ctx.fillStyle = theme.platform.top
          if (element.y > 0) ctx.fillRect(element.x * sx, element.y * sy, element.w * sx, 1.5)
          if (element.y + element.h < WORLD_HEIGHT) ctx.fillRect(element.x * sx, (element.y + element.h) * sy - 1.5, element.w * sx, 1.5)
          break
        case 'spikes':
          ctx.fillStyle = '#ff4d6d'
          ctx.fillRect(element.x * sx, (element.dir === 'up' ? element.y - 0.6 : element.y) * sy, element.w * sx, 0.6 * sy)
          break
        case 'shuriken':
          ctx.fillStyle = '#ff4d6d'
          ctx.beginPath()
          ctx.arc(element.x * sx, element.y * sy, Math.max(2, (element.r ?? 0.6) * sy), 0, Math.PI * 2)
          ctx.fill()
          if (element.orbit) {
            // Une roue de lames : son cercle.
            ctx.strokeStyle = '#ff4d6d'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(element.x * sx, element.y * sy, Math.max(2, element.orbit * sx), element.orbit * sy, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          break
        case 'flame':
          ctx.fillStyle = '#ff8a3d'
          ctx.fillRect(element.x * sx, (element.dir === 'up' ? element.y - element.reach : element.y) * sy, Math.max(2, element.w * sx), element.reach * sy)
          break
        case 'ghost':
          ctx.fillStyle = 'rgba(159,232,255,0.75)'
          ctx.fillRect(element.x * sx, element.y * sy, element.w * sx, Math.max(2, element.h * sy))
          break
        case 'warp':
          ctx.fillStyle = WARP_COLOR
          ctx.fillRect(element.x * sx, element.y * sy, Math.max(2, element.w * sx), element.h * sy)
          ctx.fillRect(element.tx * sx, element.ty * sy, Math.max(2, element.w * sx), element.h * sy)
          break
        case 'flip':
          ctx.fillStyle = theme.accent
          ctx.fillRect(element.x * sx, element.y * sy, Math.max(2, element.w * sx), element.h * sy)
          break
        case 'size':
          ctx.fillStyle = element.mini ? GATE_COLORS.mini : GATE_COLORS.full
          ctx.fillRect(element.x * sx, element.y * sy, Math.max(2, element.w * sx), element.h * sy)
          break
        case 'log':
          ctx.fillStyle = '#c88a4a'
          ctx.fillRect(element.x * sx - 2.5, element.y * sy - 1.5, 5, 3)
          break
        case 'moon':
          ctx.fillStyle = '#dfe6ff'
          ctx.beginPath()
          ctx.arc(element.x * sx, element.y * sy, 3, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'scroll':
          ctx.fillStyle = '#ffd66b'
          ctx.fillRect(element.x * sx - 2.5, element.y * sy - 2.5, 5, 5)
          break
      }
    }

    // Le chemin du solveur.
    if (report) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      report.path.forEach((point, index) => {
        const x = (point.x + PLAYER_W / 2) * sx
        const y = (point.y + PLAYER_H / 2) * sy
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      if (!report.ok) {
        ctx.fillStyle = 'rgba(255,60,80,0.35)'
        ctx.fillRect(report.reached * sx - 4, 0, 8, height)
      }
    }
    // L'arrivée.
    ctx.fillStyle = '#d6263b'
    ctx.fillRect(level.length * sx - 1, 0, 3, height)
  }, [level, report])

  return <canvas ref={ref} className={className} />
}
