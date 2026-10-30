import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Hand, Smartphone, X } from 'lucide-react'
import { requestTiltPermission } from '../../hooks/useHoloTilt'
import { useT } from '../../i18n'
import moonUrl from '../../assets/moon-soul-eater.svg'
import { WORLD_WIDTH } from '../../lib/jump/constants'
import { SKINS, worldOf, type Skin } from '../../lib/jump/worlds'
import { useThemeStore } from '../../store/useThemeStore'
import type { JumpCharacterId } from '../../lib/jump/characters'
import type { JumpOutcome } from '../../lib/jump/engine'
import { SfxVolume } from '../ui/SfxVolume'
import { JumpBoard } from './scene'

/** Après la chute, le temps de la voir avant le bilan (s). */
const OVER_DELAY = 0.6
/** Durée d'affichage du nom d'un nouvel univers (ms). */
const WORLD_BANNER_MS = 2200
/** Durée d'affichage de l'explication d'un bonus (ms). */
const POWER_TIP_MS = 2600

type Power = 'spring' | 'rocket' | 'shield' | 'wide' | 'magnet' | 'feather'
/** Inclinaison (degrés) qui donne la vitesse maximale, et zone morte. */
const TILT_FULL = 22
const TILT_DEAD = 2
const CONTROLS_KEY = 'bookshelf:jump:controls'

type Controls = 'touch' | 'tilt'

function savedControls(): Controls {
  try {
    return localStorage.getItem(CONTROLS_KEY) === 'tilt' ? 'tilt' : 'touch'
  } catch {
    return 'touch'
  }
}

/** Inclinaison gauche-droite de l'appareil (degrés), selon l'orientation de l'écran. */
function sideTilt(event: DeviceOrientationEvent): number {
  const angle = (screen.orientation?.angle ?? 0) % 360
  const beta = event.beta ?? 0
  const gamma = event.gamma ?? 0
  if (angle === 90) return beta
  if (angle === 270 || angle === -90) return -beta
  if (angle === 180) return -gamma
  return gamma
}

/**
 * Les côtés de l'écran, autour de la colonne de jeu : le ciel de l'univers en cours, des lignes de
 * vitesse de manga, une trame de points et un assombrissement vers les bords. Que du CSS statique
 * (aucun flou) : il ne change qu'avec l'univers.
 */
function sidesStyle(skin: Skin, index: number): CSSProperties {
  const [top, bottom] = worldOf(skin, index).sky
  return {
    backgroundColor: '#07040c',
    backgroundImage: [
      'radial-gradient(ellipse at center, rgba(5,3,10,0) 30%, rgba(5,3,10,0.7) 100%)',
      'repeating-conic-gradient(from 0deg at 50% 45%, rgba(255,255,255,0.06) 0deg 1.5deg, rgba(255,255,255,0) 1.5deg 7deg)',
      'radial-gradient(rgba(20,12,34,0.35) 1.3px, rgba(20,12,34,0) 1.8px)',
      `linear-gradient(180deg, ${top}, ${bottom})`,
    ].join(', '),
    backgroundSize: 'auto, auto, 11px 11px, auto',
  }
}

interface JumpGameProps {
  /** Le personnage joué. */
  character: JumpCharacterId
  onOver: (outcome: JumpOutcome) => void
  onQuit: (outcome: JumpOutcome) => void
}

/**
 * Page Jump en plein écran : le canvas (une colonne de téléphone, centrée sur ordinateur), le score
 * et l'altitude. Contrôles : flèches ou A/D (Q/D) au clavier ; sur téléphone, toucher la moitié
 * gauche ou droite de l'écran, ou incliner l'appareil (au choix, retenu sur l'appareil).
 */
export function JumpGame({ character, onOver, onQuit }: JumpGameProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scoreRef = useRef<HTMLParagraphElement>(null)
  const heightRef = useRef<HTMLParagraphElement>(null)
  const boardRef = useRef<JumpBoard | null>(null)
  const callbacks = useRef({ onOver, onQuit })
  const labels = useRef(t.jump.game.height)
  useEffect(() => {
    callbacks.current = { onOver, onQuit }
    labels.current = t.jump.game.height
    worldNames.current = t.jump.worlds
  })

  const [controls, setControls] = useState<Controls>(savedControls)
  const [hint, setHint] = useState(true)
  /** Univers qu'on vient d'atteindre : son nom s'affiche un instant. */
  const [world, setWorld] = useState<{ index: number; name: string } | null>(null)
  /** Bonus qu'on vient de prendre pour la première fois de la partie : à quoi il sert. */
  const [tip, setTip] = useState<Power | null>(null)
  /** Univers en cours : il habille aussi les côtés de l'écran (ordinateur, tablette). */
  const [worldIndex, setWorldIndex] = useState(0)
  // L'habillage suit le thème saisonnier de l'app, figé pour la partie.
  const [skin] = useState(() => SKINS[useThemeStore.getState().theme])
  const worldNames = useRef(t.jump.worlds)
  const touchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  // Ce que veut le joueur, lu par la boucle : clavier, doigts posés, inclinaison.
  const keys = useRef({ left: false, right: false })
  const pointers = useRef(new Map<number, -1 | 1>())
  const tilt = useRef(0)
  const controlsRef = useRef(controls)
  useEffect(() => {
    controlsRef.current = controls
  }, [controls])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const board = new JumpBoard({ sound: true, reduced, skin, character })
    boardRef.current = board
    // Le héros : la lune, dessinée une fois chargée (un croissant la remplace d'ici là).
    const moon = new Image()
    moon.src = moonUrl
    void moon
      .decode()
      .then(() => board.setMoon(moon))
      .catch(() => undefined)
    // Chaque bonus s'explique la première fois qu'on le prend dans la partie, pas à chaque fois.
    const explained = new Set<Power>()
    board.onPower = (kind) => {
      if (explained.has(kind)) return
      explained.add(kind)
      setTip(kind)
    }
    board.onWorld = (index) => {
      const id = worldOf(skin, index).id
      setWorld({ index, name: worldNames.current[id as keyof typeof worldNames.current] ?? id })
      setWorldIndex(index)
    }
    // Score et altitude : écrits directement dans le DOM (aucun rendu React à chaque image).
    board.onChange = (score, height) => {
      if (scoreRef.current) scoreRef.current.textContent = score.toLocaleString()
      if (heightRef.current) heightRef.current.textContent = labels.current(Math.floor(height / 10))
    }
    if (import.meta.env?.DEV) Object.assign(window, { __pageJump: { get state() { return board.state } } })

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
      board.pixelRatio = ratio
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      let input = 0
      if (controlsRef.current === 'tilt' && touchDevice) input = tilt.current
      else {
        for (const side of pointers.current.values()) input += side
        input += (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0)
      }
      if (width > 0) board.update(dt, Math.max(-1, Math.min(1, input)), (height * WORLD_WIDTH) / width)
      board.draw(ctx, width, height)
      if (board.overFor !== null && !settled && board.overFor >= OVER_DELAY) {
        settled = true
        callbacks.current.onOver(board.outcome)
      }
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      boardRef.current = null
    }
  }, [touchDevice, skin, character])

  useEffect(() => {
    if (!tip) return
    const timer = window.setTimeout(() => setTip(null), POWER_TIP_MS)
    return () => window.clearTimeout(timer)
  }, [tip])

  useEffect(() => {
    if (!world) return
    const timer = window.setTimeout(() => setWorld(null), WORLD_BANNER_MS)
    return () => window.clearTimeout(timer)
  }, [world])

  // Clavier : flèches, A/D (et Q/D en AZERTY).
  useEffect(() => {
    const set = (event: KeyboardEvent, down: boolean) => {
      const left = event.code === 'ArrowLeft' || event.code === 'KeyA' || event.key === 'q' || event.key === 'Q'
      const right = event.code === 'ArrowRight' || event.code === 'KeyD'
      if (!left && !right) return
      event.preventDefault()
      if (left) keys.current.left = down
      if (right) keys.current.right = down
      if (down) setHint(false)
    }
    const onDown = (event: KeyboardEvent) => set(event, true)
    const onUp = (event: KeyboardEvent) => set(event, false)
    const onBlur = () => {
      keys.current = { left: false, right: false }
      pointers.current.clear()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Inclinaison : écoutée seulement dans ce mode.
  useEffect(() => {
    if (controls !== 'tilt') return
    const onOrientation = (event: DeviceOrientationEvent) => {
      const degrees = sideTilt(event)
      tilt.current = Math.abs(degrees) < TILT_DEAD ? 0 : Math.max(-1, Math.min(1, degrees / TILT_FULL))
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      tilt.current = 0
    }
  }, [controls])

  // L'astuce s'efface d'elle-même.
  useEffect(() => {
    const timer = window.setTimeout(() => setHint(false), 4000)
    return () => window.clearTimeout(timer)
  }, [])

  const switchControls = () => {
    const next: Controls = controls === 'tilt' ? 'touch' : 'tilt'
    // iOS : l'autorisation des capteurs se demande pendant ce geste.
    if (next === 'tilt') requestTiltPermission()
    setControls(next)
    try {
      localStorage.setItem(CONTROLS_KEY, next)
    } catch {
      // Sans stockage : le choix vaut pour cette partie.
    }
  }

  const quit = () => {
    const board = boardRef.current
    callbacks.current.onQuit(board ? board.outcome : { score: 0, height: 0, stars: 0, stomps: 0 })
  }

  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-jump-ui]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    pointers.current.set(event.pointerId, event.clientX < rect.left + rect.width / 2 ? -1 : 1)
    setHint(false)
  }
  const release = (event: ReactPointerEvent<HTMLDivElement>) => pointers.current.delete(event.pointerId)

  const hintText = touchDevice ? (controls === 'tilt' ? t.jump.game.hintTilt : t.jump.game.hintTouch) : t.jump.game.hintKeys

  return (
    <div className="fixed inset-0 z-[80] touch-none overflow-hidden bg-[#07040c] select-none" style={sidesStyle(skin, worldIndex)} role="application" aria-label={t.jump.game.aria}>
      <div
        // Sur un écran plus large que la colonne de jeu : un cadre d'encre, comme une case de manga.
        className="relative mx-auto h-full w-full max-w-[520px] min-[521px]:border-x-[3px] min-[521px]:border-[#140c22]"
        onPointerDown={onPointer}
        onPointerMove={(event) => {
          if (pointers.current.has(event.pointerId)) onPointer(event)
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center px-16 pt-[max(1rem,env(safe-area-inset-top))]">
          <p ref={scoreRef} className="font-display text-5xl leading-none text-white tabular-nums [text-shadow:0_2px_0_#1a1030]">
            0
          </p>
          <p ref={heightRef} className="mt-1 text-xs font-semibold text-white/85 [text-shadow:0_1px_0_#1a1030]">
            {t.jump.game.height(0)}
          </p>
        </div>
        <button
          type="button"
          data-jump-ui
          onClick={quit}
          aria-label={t.jump.game.quit}
          className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 grid size-10 place-items-center rounded-full border border-white/25 bg-black/30 text-white"
        >
          <X size={18} />
        </button>
        <div data-jump-ui className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex flex-col items-center gap-2">
          <span className="grid size-10 place-items-center rounded-full border border-white/25 bg-black/30">
            <SfxVolume />
          </span>
          {touchDevice && (
            <button
              type="button"
              onClick={switchControls}
              aria-label={controls === 'tilt' ? t.jump.game.useTouch : t.jump.game.useTilt}
              className="grid size-10 place-items-center rounded-full border border-white/25 bg-black/30 text-white"
            >
              {controls === 'tilt' ? <Smartphone size={18} /> : <Hand size={18} />}
            </button>
          )}
        </div>
        {world && (
          <div key={world.index} className="pointer-events-none absolute inset-x-0 top-[22%] flex flex-col items-center px-6 text-center motion-safe:animate-[jump-world_2.2s_ease-out_both]">
            <p className="text-[11px] font-bold tracking-[0.3em] text-white/85 uppercase [text-shadow:0_1px_0_#140c22]">{t.jump.game.world(world.index + 1)}</p>
            <p className="font-display text-3xl leading-tight text-white [text-shadow:0_2px_0_#140c22]">{world.name}</p>
          </div>
        )}
        {tip && (
          <div key={tip} className="pointer-events-none absolute inset-x-0 bottom-[22%] flex justify-center px-6 motion-safe:animate-[jump-world_2.6s_ease-out_both]">
            <p className="max-w-xs rounded-2xl border-2 border-[#140c22] bg-[#fff6dc] px-4 py-2 text-center text-[#140c22]">
              <span className="block font-display text-lg leading-tight">{t.jump.game.powers[tip].name}</span>
              <span className="block text-xs leading-snug font-semibold text-[#140c22]/75">{t.jump.game.powers[tip].text}</span>
            </p>
          </div>
        )}
        {hint && (
          <p className="pointer-events-none absolute inset-x-0 bottom-[14%] px-6 text-center text-sm font-semibold tracking-wide text-white [text-shadow:0_1px_0_#1a1030] motion-safe:animate-pulse">
            {hintText}
          </p>
        )}
      </div>
    </div>
  )
}
