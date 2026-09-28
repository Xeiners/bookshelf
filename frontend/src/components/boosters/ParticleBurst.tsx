import { useEffect, useRef } from 'react'

export interface Burst {
  /** Change à chaque nouvelle gerbe. */
  id: number
  /** Origine, en pixels de la fenêtre. */
  x: number
  y: number
  colors: string[]
  count: number
  /** `confetti` : papiers qui retombent ; `sparks` : étincelles vives et brèves, en lumière additive. */
  kind?: 'confetti' | 'sparks'
  /** Ouverture du cône d'émission (radians), centré vers le haut ; 2π = toutes directions. */
  spread?: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  color: string
  life: number
  ttl: number
  /** Confetti rectangulaire, ou point rond. */
  confetti: boolean
  /** Étincelle : lumière additive, gravité faible. */
  spark: boolean
}

const GRAVITY = 900
/** Au-delà, la gerbe coûte plus qu'elle n'apporte sur un téléphone. */
const MAX_PARTICLES = 220

/**
 * Gerbe de particules (confettis et étincelles) sur un canevas plein écran :
 * une seule boucle `requestAnimationFrame`, active tant qu'il reste des
 * particules, et aucun élément DOM par particule — 60 images/s sur mobile.
 * Rien si l'utilisateur a demandé moins d'animations.
 */
export function ParticleBurst({ burst }: { burst: Burst | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const frame = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!burst || !canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const context = canvas.getContext('2d')
    if (!context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    // Redimensionner efface le canevas : seulement si la fenêtre a changé (les gerbes de la découpe se suivent vite).
    const width = Math.round(window.innerWidth * ratio)
    const height = Math.round(window.innerHeight * ratio)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    const sparks = burst.kind === 'sparks'
    const spread = burst.spread ?? Math.PI * 1.6
    for (let index = 0; index < burst.count && particles.current.length < MAX_PARTICLES; index += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread
      const speed = sparks ? 320 + Math.random() * 640 : 260 + Math.random() * 520
      particles.current.push({
        x: burst.x,
        y: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: sparks ? 1.6 + Math.random() * 2.4 : 3 + Math.random() * 5,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        color: burst.colors[index % burst.colors.length] ?? '#ffffff',
        life: 0,
        ttl: sparks ? 0.55 + Math.random() * 0.7 : 1.4 + Math.random() * 1.1,
        confetti: !sparks && index % 3 !== 0,
        spark: sparks,
      })
    }

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      particles.current = particles.current.filter((particle) => {
        particle.life += dt
        if (particle.life >= particle.ttl) return false
        particle.vy += (particle.spark ? GRAVITY * 0.45 : GRAVITY) * dt
        particle.vx *= 0.985
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt
        particle.rotation += particle.spin * dt
        context.globalAlpha = 1 - particle.life / particle.ttl
        context.globalCompositeOperation = particle.spark ? 'lighter' : 'source-over'
        context.fillStyle = particle.color
        context.save()
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        if (particle.confetti) context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2)
        else {
          context.beginPath()
          context.arc(0, 0, particle.size / 2.4, 0, Math.PI * 2)
          context.fill()
        }
        context.restore()
        return true
      })
      frame.current = particles.current.length > 0 ? requestAnimationFrame(tick) : 0
    }
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }, [burst])

  // Démontage : la boucle s'arrête, les particules restantes sont oubliées.
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      particles.current = []
    },
    [],
  )

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[3] h-full w-full" />
}
