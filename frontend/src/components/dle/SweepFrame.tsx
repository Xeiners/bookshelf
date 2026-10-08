import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Brush, Loader2, RotateCcw, Sparkle } from 'lucide-react'
import { useT } from '../../i18n'
import { SWEEP_COLS, SWEEP_HEIGHT, SWEEP_TILE_PX, SWEEP_WIDTH, reducedMotion, tilesUnder } from '../../lib/dle'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { playGlint, playRub } from '../../lib/sfx'
import type { DleCategory, SweepReveal, SweepState } from '../../services/dleApi'

/** Rayon du chiffon, en pixels de l'image de référence (480 × 640). */
const BRUSH = 24
/** Un tampon tous les… pixels le long du geste : un trait continu, même rapide. */
const STAMP_STEP = 7
/** Les tuiles frottées partent ensemble, toutes les… ms. */
const FLUSH_MS = 110
/** Au plus, par envoi (le serveur refuse au-delà). */
const BATCH = 120
/** Échecs d'affilée avant d'arrêter et de proposer « Réessayer ». */
const MAX_FAILURES = 3

interface SweepFrameProps {
  category: DleCategory
  /** La vitre, telle que le serveur la connaît (tuiles nettoyées, part nettoyée). */
  sweep: SweepState
  /** Frotte ces tuiles : le serveur les compte et les renvoie. */
  reveal: (tiles: number[]) => Promise<SweepReveal>
  /** La vitre a changé (part nettoyée à jour). */
  onSweep: (state: SweepState) => void
  /** Trouvé (ou manche finie) : l'image entière ; la saleté s'efface d'un coup. */
  fullImage: string | null
  /** Pas encore (décompte) ou plus (spectateur) le droit de frotter. */
  disabled?: boolean
  glow: string
  /** Énigme du jour : la prime que vaudrait une bonne réponse maintenant. */
  prize?: number | null
}

/* ---- La saleté : une matière par univers, dessinée une fois (déterministe) ------------- */

/** Hasard reproductible (mulberry32) : la même saleté à chaque visite. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function blob(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function grain(context: CanvasRenderingContext2D, random: () => number, count: number, colors: string[], size: [number, number]) {
  for (let index = 0; index < count; index += 1) {
    context.fillStyle = colors[index % colors.length] as string
    const side = size[0] + random() * (size[1] - size[0])
    context.fillRect(random() * SWEEP_WIDTH, random() * SWEEP_HEIGHT, side, side)
  }
}

/** Peint la saleté d'un univers : buée, fumée, sable, peinture, énergie occulte, nuage magique ou gravats. */
function paintDirt(context: CanvasRenderingContext2D, category: DleCategory): void {
  const random = seeded(category.length * 7919 + category.charCodeAt(0))
  const W = SWEEP_WIDTH
  const H = SWEEP_HEIGHT
  context.globalCompositeOperation = 'source-over'
  const base = (stops: [number, string][]) => {
    const gradient = context.createLinearGradient(0, 0, W * 0.4, H)
    for (const [at, color] of stops) gradient.addColorStop(at, color)
    context.fillStyle = gradient
    context.fillRect(0, 0, W, H)
  }
  switch (category) {
    case 'manga': {
      // Buée : verre dépoli bleuté, halos de condensation, gouttes et coulures.
      base([[0, '#dfe8f3'], [0.5, '#b7c6da'], [1, '#93a6bf']])
      for (let index = 0; index < 26; index += 1) blob(context, random() * W, random() * H, 60 + random() * 120, `rgba(255,255,255,${0.18 + random() * 0.22})`)
      grain(context, random, 2600, ['rgba(255,255,255,0.35)', 'rgba(120,140,170,0.25)'], [1, 2])
      for (let index = 0; index < 70; index += 1) {
        const x = random() * W
        const y = random() * H
        const r = 2 + random() * 6
        context.fillStyle = 'rgba(110,130,160,0.35)'
        context.beginPath()
        context.arc(x, y, r, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = 'rgba(255,255,255,0.75)'
        context.beginPath()
        context.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2)
        context.fill()
      }
      context.strokeStyle = 'rgba(255,255,255,0.28)'
      for (let index = 0; index < 14; index += 1) {
        const x = random() * W
        const y = random() * H * 0.6
        context.lineWidth = 1.5 + random() * 2.5
        context.beginPath()
        context.moveTo(x, y)
        context.bezierCurveTo(x + 6, y + 60, x - 6, y + 120, x + 3, y + 160 + random() * 140)
        context.stroke()
      }
      break
    }
    case 'naruto': {
      // Fumée : volutes chaudes, grises et orangées, après une bombe fumigène.
      base([[0, '#a39283'], [0.5, '#7d6d61'], [1, '#56493f']])
      for (let index = 0; index < 60; index += 1) {
        const warm = random() > 0.7
        blob(context, random() * W, random() * H, 40 + random() * 140, warm ? `rgba(255,150,70,${0.08 + random() * 0.12})` : `rgba(230,225,215,${0.12 + random() * 0.2})`)
      }
      grain(context, random, 1800, ['rgba(40,30,25,0.25)', 'rgba(255,240,220,0.2)'], [1, 2])
      break
    }
    case 'onepiece': {
      // Sable : grain doré, rides du vent, quelques coquillages d'écume.
      base([[0, '#f1d9a4'], [0.5, '#dcb873'], [1, '#bf954d']])
      grain(context, random, 9000, ['rgba(120,80,30,0.35)', 'rgba(255,245,215,0.45)', 'rgba(180,130,60,0.4)'], [1, 2.4])
      context.strokeStyle = 'rgba(140,95,40,0.32)'
      context.lineWidth = 3
      for (let y = 20; y < H; y += 26 + random() * 18) {
        context.beginPath()
        context.moveTo(0, y)
        for (let x = 0; x <= W; x += 40) context.quadraticCurveTo(x + 20, y + (random() - 0.5) * 18, x + 40, y + (random() - 0.5) * 10)
        context.stroke()
      }
      break
    }
    case 'jojo': {
      // Peinture : grands coups de pinceau, couleurs criardes, éclaboussures.
      base([[0, '#6d2bd9'], [1, '#3b1478']])
      const palette = ['#ff4fa3', '#ffd23f', '#3ee0c4', '#9b5cff', '#ff7a3d']
      for (let index = 0; index < 22; index += 1) {
        context.strokeStyle = palette[index % palette.length] as string
        context.lineWidth = 26 + random() * 50
        context.lineCap = 'round'
        context.globalAlpha = 0.75
        context.beginPath()
        const x = random() * W
        const y = random() * H
        context.moveTo(x, y)
        context.bezierCurveTo(x + (random() - 0.5) * 300, y + (random() - 0.5) * 300, x + (random() - 0.5) * 300, y + (random() - 0.5) * 300, x + (random() - 0.5) * 360, y + (random() - 0.5) * 360)
        context.stroke()
      }
      context.globalAlpha = 1
      for (let index = 0; index < 80; index += 1) {
        context.fillStyle = palette[index % palette.length] as string
        context.beginPath()
        context.arc(random() * W, random() * H, 2 + random() * 9, 0, Math.PI * 2)
        context.fill()
      }
      break
    }
    case 'jjk': {
      // Énergie occulte : nuit violette, tourbillons bleus, éclats qui luisent.
      base([[0, '#1d1036'], [0.5, '#140b29'], [1, '#0a0618']])
      for (let index = 0; index < 34; index += 1) blob(context, random() * W, random() * H, 50 + random() * 130, random() > 0.5 ? `rgba(120,70,255,${0.18 + random() * 0.2})` : `rgba(60,140,255,${0.12 + random() * 0.18})`)
      grain(context, random, 500, ['rgba(190,160,255,0.85)', 'rgba(120,200,255,0.8)'], [1, 2.5])
      break
    }
    case 'dragonball': {
      // Nuage magique : le Kinto-un, doré et moelleux, et quelques Dragon Balls perdues dedans.
      base([[0, '#fff1a8'], [0.5, '#ffd257'], [1, '#f5a524']])
      // Une boule de nuage : cœur crème, bord qui s'efface dans sa propre couleur (jamais vers le gris).
      const puff = (x: number, y: number, radius: number, [r, g, b]: [number, number, number], alpha: number) => {
        const gradient = context.createRadialGradient(x - radius * 0.25, y - radius * 0.3, radius * 0.1, x, y, radius)
        gradient.addColorStop(0, `rgba(255,252,235,${alpha})`)
        gradient.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.85})`)
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
        context.fillStyle = gradient
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      }
      for (let index = 0; index < 60; index += 1) {
        const x = random() * W
        const y = random() * H
        const warm: [number, number, number] = random() > 0.5 ? [255, 214, 92] : [255, 236, 160]
        // Une bouffée : quatre ou cinq boules qui se chevauchent, en grappe.
        for (let ball = 0; ball < 4 + Math.floor(random() * 2); ball += 1) {
          puff(x + (random() - 0.5) * 90, y + (random() - 0.5) * 45, 32 + random() * 48, warm, 0.55 + random() * 0.35)
        }
      }
      grain(context, random, 1200, ['rgba(255,255,240,0.55)', 'rgba(240,160,40,0.25)'], [1, 2])
      for (let ball = 0; ball < 7; ball += 1) {
        const x = 40 + random() * (W - 80)
        const y = 40 + random() * (H - 80)
        const r = 9 + random() * 7
        const sphere = context.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
        sphere.addColorStop(0, '#fff3c4')
        sphere.addColorStop(0.45, '#ffad2a')
        sphere.addColorStop(1, '#d86a0b')
        context.fillStyle = sphere
        context.beginPath()
        context.arc(x, y, r, 0, Math.PI * 2)
        context.fill()
        // Les étoiles rouges de la boule (une seule, pour rester lisible à cette taille).
        context.fillStyle = '#d4231b'
        context.beginPath()
        for (let point = 0; point < 10; point += 1) {
          const angle = -Math.PI / 2 + (point * Math.PI) / 5
          const radius = point % 2 === 0 ? r * 0.42 : r * 0.18
          context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
        }
        context.closePath()
        context.fill()
      }
      break
    }
    case 'mha': {
      // Gravats : béton éventré après un combat, poussière, et les éclairs verts de One For All.
      base([[0, '#9a978f'], [0.5, '#77746d'], [1, '#55524c']])
      for (let index = 0; index < 40; index += 1) blob(context, random() * W, random() * H, 40 + random() * 110, `rgba(${random() > 0.5 ? '230,225,215' : '60,58,54'},${0.12 + random() * 0.18})`)
      // Éclats de béton : polygones irréguliers, ombrés.
      for (let index = 0; index < 90; index += 1) {
        const x = random() * W
        const y = random() * H
        const size = 6 + random() * 26
        const tone = 95 + Math.floor(random() * 90)
        context.fillStyle = `rgb(${tone},${tone - 3},${tone - 8})`
        context.beginPath()
        const corners = 4 + Math.floor(random() * 3)
        for (let corner = 0; corner < corners; corner += 1) {
          const angle = (corner / corners) * Math.PI * 2 + random() * 0.6
          const radius = size * (0.55 + random() * 0.45)
          context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
        }
        context.closePath()
        context.fill()
        context.strokeStyle = 'rgba(30,28,25,0.35)'
        context.lineWidth = 1.5
        context.stroke()
      }
      // Fissures.
      context.strokeStyle = 'rgba(25,23,20,0.55)'
      context.lineCap = 'round'
      for (let index = 0; index < 9; index += 1) {
        let x = random() * W
        let y = random() * H
        context.lineWidth = 1.5 + random() * 2.5
        context.beginPath()
        context.moveTo(x, y)
        for (let step = 0; step < 7; step += 1) {
          x += (random() - 0.5) * 90
          y += (random() - 0.5) * 90
          context.lineTo(x, y)
        }
        context.stroke()
      }
      // Éclairs verts de One For All.
      context.strokeStyle = 'rgba(120,255,150,0.85)'
      context.shadowColor = 'rgba(80,255,130,0.9)'
      context.shadowBlur = 10
      for (let index = 0; index < 6; index += 1) {
        let x = random() * W
        let y = random() * H
        context.lineWidth = 1.5 + random() * 1.5
        context.beginPath()
        context.moveTo(x, y)
        for (let step = 0; step < 5; step += 1) {
          x += (random() - 0.5) * 60
          y += (random() - 0.5) * 60
          context.lineTo(x, y)
        }
        context.stroke()
      }
      context.shadowBlur = 0
      context.shadowColor = 'transparent'
      grain(context, random, 3000, ['rgba(40,38,34,0.35)', 'rgba(235,230,220,0.3)'], [1, 2.2])
      break
    }
  }
}

/** Matière de chaque univers : couleur du chiffon et des étincelles. */
const SPARK_COLOR: Record<DleCategory, string> = { manga: '#ffffff', naruto: '#ffb86b', onepiece: '#fff4c8', jojo: '#ffd23f', jjk: '#b69bff', dragonball: '#ffe27a', mha: '#86ff9e' }

/* ---- Le cadre ------------------------------------------------------------------------- */

/**
 * Mode Chiffon : l'image sous une couche de saleté, qu'on frotte du doigt (ou à la
 * souris). La saleté s'efface sous le chiffon en temps réel ; les tuiles touchées
 * partent au serveur par petits paquets, qui les compte et renvoie leur image — elles
 * apparaissent sous la vitre. Le serveur ne livre jamais l'image entière avant la fin.
 */
export function SweepFrame({ category, sweep, reveal, onSweep, fullImage, disabled = false, glow, prize = null }: SweepFrameProps) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLCanvasElement>(null)
  const dirtRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const sparksRef = useRef<HTMLDivElement>(null)
  /** Tuiles déjà demandées (ou en route) : jamais deux fois. */
  const requested = useRef(new Set<number>())
  const pending = useRef(new Set<number>())
  const flushTimer = useRef<number | null>(null)
  const stroke = useRef<{ x: number; y: number; at: number } | null>(null)
  const lastRub = useRef(0)
  const lastBuzz = useRef(0)
  const [started, setStarted] = useState(sweep.revealed.length > 0)
  /**
   * La vitre se prépare (le serveur charge l'image et la découpe) avant le premier coup de
   * chiffon : sans ça, les premiers gestes creusaient des trous noirs le temps de la découpe.
   */
  const [preparation, setStatus] = useState<'warming' | 'ready' | 'error'>('warming')
  // Image entière (trouvé, manche finie) : plus rien à préparer.
  const status = fullImage ? 'ready' : preparation
  /** Un seul envoi à la fois : les suivants attendent sa réponse (jamais de requêtes en rafale). */
  const inFlight = useRef(false)
  const failures = useRef(0)
  const revealRef = useRef(reveal)
  const onSweepRef = useRef(onSweep)
  useEffect(() => {
    revealRef.current = reveal
    onSweepRef.current = onSweep
  })

  /** Pose les tuiles reçues sous la vitre. */
  const drawTiles = useCallback((tiles: Record<number, string>, sparkle: boolean) => {
    const context = imageRef.current?.getContext('2d')
    if (!context) return
    const entries = Object.entries(tiles)
    for (const [key, source] of entries) {
      const index = Number(key)
      const image = new Image()
      image.onload = () => context.drawImage(image, (index % SWEEP_COLS) * SWEEP_TILE_PX, Math.floor(index / SWEEP_COLS) * SWEEP_TILE_PX, SWEEP_TILE_PX, SWEEP_TILE_PX)
      image.src = source
    }
    if (!sparkle || entries.length === 0) return
    playGlint()
    if (reducedMotion() || !sparksRef.current) return
    // Quelques étincelles là où la vitre se dégage.
    for (const [key] of entries.slice(0, 3)) {
      const index = Number(key)
      const spark = document.createElement('span')
      spark.className = 'pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2' // i18n-ignore
      spark.style.left = `${(((index % SWEEP_COLS) + 0.5) / SWEEP_COLS) * 100}%`
      spark.style.top = `${((Math.floor(index / SWEEP_COLS) + 0.5) / (SWEEP_HEIGHT / SWEEP_TILE_PX)) * 100}%`
      spark.style.background = `radial-gradient(circle, ${SPARK_COLOR[category]} 0 30%, transparent 70%)`
      sparksRef.current.appendChild(spark)
      gsap.fromTo(spark, { scale: 0, rotation: 0, opacity: 1 }, { scale: 2.2, rotation: 90, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => spark.remove() })
    }
  }, [category])

  /** Envoie les tuiles frottées depuis le dernier envoi (le reste au suivant). */
  const flushRef = useRef<() => void>(() => {})
  useEffect(() => {
    flushRef.current = () => {
      flushTimer.current = null
      if (inFlight.current) return
      const tiles = [...pending.current].slice(0, BATCH)
      if (tiles.length === 0) return
      for (const index of tiles) pending.current.delete(index)
      inFlight.current = true
      revealRef
        .current(tiles)
        .then((result) => {
          failures.current = 0
          drawTiles(result.tiles, true)
          onSweepRef.current(result.sweep)
        })
        .catch(() => {
          // Ces tuiles repartent au prochain envoi ; après plusieurs échecs, on le dit.
          for (const index of tiles) pending.current.add(index)
          failures.current += 1
          if (failures.current >= MAX_FAILURES) setStatus('error')
        })
        .finally(() => {
          inFlight.current = false
          if (pending.current.size === 0 || failures.current >= MAX_FAILURES) return
          flushTimer.current ??= window.setTimeout(() => flushRef.current(), failures.current > 0 ? 600 * failures.current : FLUSH_MS)
        })
    }
  })

  /** Prépare la vitre côté serveur (demande vide) ; reprend les envois en attente. */
  const warmUp = useCallback(() => {
    failures.current = 0
    revealRef
      .current([])
      .then(() => {
        setStatus('ready')
        flushRef.current()
      })
      .catch(() => setStatus('error'))
  }, [])
  /** « Réessayer » après un échec. */
  const prepare = () => {
    setStatus('warming')
    warmUp()
  }

  // La saleté, peinte une fois ; le fond de l'image, nuit opaque.
  useEffect(() => {
    const dirt = dirtRef.current?.getContext('2d')
    const image = imageRef.current?.getContext('2d')
    if (!dirt || !image) return
    image.fillStyle = '#16141f'
    image.fillRect(0, 0, SWEEP_WIDTH, SWEEP_HEIGHT)
    paintDirt(dirt, category)
  }, [category])

  /** Efface la saleté sous le chiffon (dégradé : des bords doux, jamais un trou net). */
  const wipe = useCallback((x: number, y: number, radius = BRUSH) => {
    const context = dirtRef.current?.getContext('2d')
    if (!context) return
    context.globalCompositeOperation = 'destination-out'
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, 'rgba(0,0,0,1)')
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.9)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
    context.globalCompositeOperation = 'source-over'
  }, [])

  // À l'arrivée : la vitre se prépare. Reprise d'une partie : les tuiles déjà nettoyées,
  // rendues sans rien coûter (et qui préparent la vitre du même coup).
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current) return
    resumed.current = true
    if (fullImage) return
    const known = sweep.revealed
    if (known.length === 0) {
      warmUp()
      return
    }
    for (const index of known) {
      requested.current.add(index)
      wipe(((index % SWEEP_COLS) + 0.5) * SWEEP_TILE_PX, (Math.floor(index / SWEEP_COLS) + 0.5) * SWEEP_TILE_PX, SWEEP_TILE_PX * 0.78)
    }
    const batches = Array.from({ length: Math.ceil(known.length / BATCH) }, (_, batch) => known.slice(batch * BATCH, (batch + 1) * BATCH))
    Promise.all(batches.map((tiles) => revealRef.current(tiles).then((result) => drawTiles(result.tiles, false))))
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'))
  }, [sweep.revealed, fullImage, wipe, drawTiles, warmUp])

  /** Un tampon du chiffon : la saleté s'efface, les tuiles touchées attendent leur envoi. */
  const stamp = (x: number, y: number) => {
    wipe(x, y)
    for (const index of tilesUnder(x, y, BRUSH)) {
      if (requested.current.has(index)) continue
      requested.current.add(index)
      pending.current.add(index)
    }
    flushTimer.current ??= window.setTimeout(() => flushRef.current(), FLUSH_MS)
  }

  const toImage = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * SWEEP_WIDTH, y: ((event.clientY - rect.top) / rect.height) * SWEEP_HEIGHT, rect }
  }

  const moveCursor = (event: ReactPointerEvent<HTMLElement>, visible: boolean) => {
    const cursor = cursorRef.current
    if (!cursor) return
    const rect = event.currentTarget.getBoundingClientRect()
    cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`
    cursor.style.opacity = visible ? '1' : '0'
  }

  const onDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || fullImage || status !== 'ready') return
    event.currentTarget.setPointerCapture(event.pointerId)
    const { x, y } = toImage(event)
    stroke.current = { x, y, at: performance.now() }
    if (!started) setStarted(true)
    stamp(x, y)
    moveCursor(event, true)
  }

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    moveCursor(event, !disabled && !fullImage && (event.pointerType === 'mouse' || stroke.current !== null))
    const from = stroke.current
    if (!from || disabled || fullImage || status !== 'ready') return
    const { x, y } = toImage(event)
    const distance = Math.hypot(x - from.x, y - from.y)
    const now = performance.now()
    // Un tampon tous les quelques pixels : un trait continu, même d'un geste rapide.
    const steps = Math.max(1, Math.ceil(distance / STAMP_STEP))
    for (let step = 1; step <= steps; step += 1) stamp(from.x + ((x - from.x) * step) / steps, from.y + ((y - from.y) * step) / steps)
    const speed = distance / Math.max(1, now - from.at)
    stroke.current = { x, y, at: now }
    if (now - lastRub.current > 70) {
      lastRub.current = now
      playRub(speed * 1.6)
    }
    if (now - lastBuzz.current > 140) {
      lastBuzz.current = now
      vibrate(4)
    }
  }

  const onUp = (event: ReactPointerEvent<HTMLElement>) => {
    stroke.current = null
    if (event.pointerType !== 'mouse') moveCursor(event, false)
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current)
      flushRef.current()
    }
  }

  useEffect(
    () => () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
    },
    [],
  )

  // Fin : l'image entière sous la vitre, puis la saleté s'envole d'un coup.
  const { contextSafe } = useGSAP({ scope: frameRef })
  useEffect(() => {
    if (!fullImage) return
    const image = new Image()
    image.decoding = 'async'
    image.onload = contextSafe(() => {
      const context = imageRef.current?.getContext('2d')
      if (context) {
        const ratio = SWEEP_WIDTH / SWEEP_HEIGHT
        const { naturalWidth: width, naturalHeight: height } = image
        const wide = width / height > ratio
        const sw = wide ? height * ratio : width
        const sh = wide ? height : width / ratio
        const sx = (width - sw) / 2
        const sy = wide || category !== 'manga' ? 0 : (height - sh) / 2
        context.fillStyle = '#16141f'
        context.fillRect(0, 0, SWEEP_WIDTH, SWEEP_HEIGHT)
        context.drawImage(image, sx, sy, sw, sh, 0, 0, SWEEP_WIDTH, SWEEP_HEIGHT)
      }
      gsap.to(dirtRef.current, { opacity: 0, scale: 1.08, duration: 0.9, ease: 'power2.out' })
      gsap.fromTo(frameRef.current, { scale: 0.96 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.5)' })
    })
    image.src = fullImage
    return () => {
      image.onload = null
    }
  }, [fullImage, category, contextSafe])

  // Invitation à frotter : le pinceau se balance tant qu'on n'a pas commencé.
  useGSAP(
    () => {
      if (started || disabled || reducedMotion()) return
      gsap.fromTo('[data-sweep-hint-icon]', { rotation: -18, x: -6 }, { rotation: 18, x: 6, duration: 0.7, ease: 'sine.inOut', repeat: -1, yoyo: true })
    },
    { scope: frameRef, dependencies: [started, disabled] },
  )

  const dirt = sweep.dirt
  // Vert, puis jaune, puis rouge à mesure qu'on nettoie.
  const meter = dirt < 20 ? '#5ef2c2' : dirt < 45 ? '#ffd36b' : '#ff5e7e'

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div aria-hidden className="absolute -inset-8 rounded-full" style={{ background: `radial-gradient(closest-side, ${glow}55, transparent)` }} />
        <div
          ref={frameRef}
          role="img"
          aria-label={t.dle.sweep.aria}
          className="relative aspect-[3/4] w-[17rem] touch-none overflow-hidden rounded-3xl border-2 bg-ink select-none sm:w-[20rem]"
          style={{ borderColor: `${glow}88`, boxShadow: '0 0 0 4px rgba(11,9,24,1), 0 30px 60px -30px rgba(0,0,0,0.95)', cursor: disabled || fullImage || status !== 'ready' ? 'default' : 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={(event) => {
            if (cursorRef.current) cursorRef.current.style.opacity = '0'
            if (event.pointerType === 'mouse' && stroke.current) onUp(event)
          }}
        >
          <canvas ref={imageRef} width={SWEEP_WIDTH} height={SWEEP_HEIGHT} aria-hidden className="absolute inset-0 h-full w-full" />
          <canvas ref={dirtRef} width={SWEEP_WIDTH} height={SWEEP_HEIGHT} aria-hidden className="absolute inset-0 h-full w-full will-change-[opacity,transform]" />
          <div ref={sparksRef} aria-hidden className="pointer-events-none absolute inset-0" />

          {/* Le chiffon, sous le doigt (ou la souris). */}
          <div ref={cursorRef} aria-hidden className="pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-150">
            <span
              className="absolute grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white/80"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.28), rgba(255,255,255,0.05) 70%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}
            >
              <Sparkle size={14} className="fill-white text-white" />
            </span>
          </div>

          {!fullImage && (
            <span className="pointer-events-none absolute top-3 left-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] text-cream uppercase">
              {t.dle.sweep.material[category]}
            </span>
          )}

          {status === 'warming' && !fullImage && (
            <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-4 py-3 text-sm font-semibold text-cream">
                <Loader2 size={24} className="animate-spin" aria-hidden />
                {t.dle.sweep.preparing}
              </span>
            </div>
          )}

          {status === 'error' && !fullImage && (
            <div role="alert" className="absolute inset-0 grid place-items-center bg-black/35 p-5">
              <span className="flex flex-col items-center gap-3 rounded-2xl bg-black/70 px-4 py-4 text-center text-sm text-cream">
                {t.dle.sweep.failed}
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={prepare}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cream px-4 py-2 text-xs font-semibold text-void"
                >
                  <RotateCcw size={14} aria-hidden />
                  {t.dle.sweep.retry}
                </button>
              </span>
            </div>
          )}

          {status === 'ready' && !started && !disabled && !fullImage && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-4 py-3 text-sm font-semibold text-cream">
                <Brush data-sweep-hint-icon size={26} aria-hidden />
                {t.dle.sweep.start}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* La part nettoyée (et, pour l'énigme du jour, ce que vaudrait une bonne réponse). */}
      {!fullImage && (
        <div className="flex w-[17rem] flex-col gap-1.5 sm:w-[20rem]">
          <div className="flex items-center justify-between text-xs font-semibold tabular-nums">
            <span style={{ color: meter }}>{t.dle.sweep.cleaned(dirt)}</span>
            {prize !== null && <span className="text-[#ffd36b]">{t.dle.sweep.prize(prize)}</span>}
          </div>
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full origin-left rounded-full transition-[transform,background-color] duration-300" style={{ transform: `scaleX(${dirt / 100})`, background: meter }} />
          </div>
        </div>
      )}
    </div>
  )
}
