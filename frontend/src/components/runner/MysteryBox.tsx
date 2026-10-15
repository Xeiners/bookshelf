import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { Loader2, Sparkles, X } from 'lucide-react'
import * as THREE from 'three'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { createRun } from '../../lib/runner/engine'
import { ITEM_INFO, RARITIES, RARITY_COLORS, isWardrobeItem, type Outfit } from '../../lib/runner/wardrobe'
import { playBoxBurst, playBoxDrop, playBoxKnock, playRiser } from '../../lib/sfx'
import { runnerApi, type BoxOpening } from '../../services/runnerApi'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { ParticleBurst, type Burst } from '../boosters/ParticleBurst'
import { loadRunnerAssets, type RunnerAssets } from './assets'
import { itemIcon, loadItemIcons } from './wardrobeIcons'
import { HeroModelPart, createHero } from './heroModel'
import { BoxTimeline, MysteryBoxScene } from './mysteryBox'

/*
 * L'ouverture d'une boîte mystère, en plein écran. La boîte tombe sur son autel ; trois
 * coups pour l'ouvrir (ou elle s'ouvre seule si l'on attend) : à chaque coup elle tremble,
 * se fend, et la lumière qui filtre monte vers la couleur de la rareté (bleu, violet, or).
 * Puis elle éclate, et le coureur surgit de la colonne de lumière, paré de la nouvelle
 * pièce : rareté frappée en lettres d'or, nom, « Nouveau ! » ou doublon remboursé.
 *
 * Le tirage est fait par le serveur dès l'apparition : l'animation ne fait que le révéler.
 */

type Phase = 'charge' | 'burst' | 'reveal' | 'error'

const TAPS = 3
const LAND = 0.75
const IDLE_TAP = 1.5
const BURST_TIME = 0.95

/** Couleur des fissures au coup `stage` : on monte vers la rareté finale, cran par cran. */
function teaseColor(stage: number, rarity: number): string {
  const level = Math.min(rarity, Math.round((stage / TAPS) * rarity))
  return RARITY_COLORS[RARITIES[level]!].main
}

/** Où regarder la nouvelle pièce sur le coureur (hauteur, distance). */
const FOCUS: Record<string, [number, number]> = { hat: [1.62, 2.6], top: [1.2, 3.0], accessory: [1.1, 3.2], bottom: [0.72, 3.0], shoes: [0.3, 2.5] }

export function MysteryBox({
  free,
  request,
  assets: given,
  onClose,
  onAgain,
}: {
  free: boolean
  request: number
  /** Modèles du Runner ; `null` (ouverture depuis les activités) : chargés ici, pendant que la boîte tombe. */
  assets: RunnerAssets | null
  onClose: () => void
  onAgain: (free: boolean) => void
}) {
  const t = useT()
  const receive = useRunnerWardrobe((state) => state.receive)
  const equip = useRunnerWardrobe((state) => state.equip)
  const outfit = useRunnerWardrobe((state) => state.outfit)
  const [result, setResult] = useState<BoxOpening | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('charge')
  const [stage, setStage] = useState(0)
  const [burst, setBurst] = useState<Burst | null>(null)
  const [equipped, setEquipped] = useState(false)
  // Le temps de la boîte, partagé avec la scène 3D (lu à chaque image).
  const [timeline] = useState(() => new BoxTimeline())
  const rootRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<RunnerAssets | null>(null)
  const assets = given ?? loaded
  useEffect(() => {
    if (given) return
    let alive = true
    loadRunnerAssets()
      .then((ready) => alive && setLoaded(ready))
      .catch(() => undefined)
    void loadItemIcons()
    return () => {
      alive = false
    }
  }, [given])

  const rarity = result ? RARITIES.indexOf(result.item.rarity) : 0
  const item = result && isWardrobeItem(result.item.id) ? result.item.id : null

  // Le tirage, dès l'ouverture.
  useEffect(() => {
    let alive = true
    playBoxDrop()
    vibrate(20)
    runnerApi
      .openBox(free, request)
      .then((opened) => {
        if (!alive) return
        setResult(opened)
        receive(opened.wardrobe)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setError(apiErrorMessage(cause, t))
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [free, request, receive, t])

  const knock = useCallback(() => {
    if (phase !== 'charge' || !result || !timeline.landed(LAND)) return
    const next = Math.min(TAPS, stage + 1)
    setStage(next)
    timeline.knock(next, teaseColor(next, rarity), rarity)
    playBoxKnock(next)
    vibrate(next === TAPS ? [30, 20, 60] : 18 + next * 8)
    if (next === TAPS) {
      if (rarity >= 2) playRiser(0.4)
      window.setTimeout(() => {
        timeline.explode()
        setPhase('burst')
        playBoxBurst(rarity)
        vibrate(rarity >= 3 ? [60, 40, 120, 40, 200] : [40, 30, 80])
      }, rarity >= 2 ? 420 : 220)
    }
  }, [phase, result, timeline, stage, rarity])

  // Sans coup pendant un moment : la boîte s'ouvre d'elle-même, un coup après l'autre.
  useEffect(() => {
    if (phase !== 'charge' || !result) return
    const timer = window.setInterval(() => {
      if (timeline.landed(LAND) && timeline.idle(IDLE_TAP)) knock()
    }, 250)
    return () => window.clearInterval(timer)
  }, [phase, result, timeline, knock])

  // Explosion → révélation (et confettis pour l'épique et la légendaire).
  useEffect(() => {
    if (phase !== 'burst') return
    const timer = window.setTimeout(() => {
      setPhase('reveal')
      const colors = rarity >= 3 ? ['#ffd35c', '#fff0a8', '#ff9f1a', '#ffffff'] : rarity === 2 ? ['#b05cff', '#dcb2ff', '#ff6fb5', '#ffffff'] : [RARITY_COLORS[RARITIES[rarity]!].main, '#ffffff']
      setBurst({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight * 0.38, colors, count: rarity >= 2 ? 200 : 70, spread: Math.PI * 2, kind: rarity >= 2 ? 'confetti' : 'sparks' })
    }, BURST_TIME * 1000)
    return () => window.clearTimeout(timer)
  }, [phase, rarity])

  useGSAP(
    () => {
      if (phase !== 'reveal') return
      gsap.fromTo('[data-box-rarity]', { scale: 2.6, autoAlpha: 0, letterSpacing: '0.6em' }, { scale: 1, autoAlpha: 1, letterSpacing: '0.32em', duration: 0.5, ease: 'back.out(2.2)' })
      gsap.fromTo('[data-box-card]', { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.25, ease: EASE.spring })
      gsap.fromTo('[data-box-badge]', { scale: 0, rotation: -25 }, { scale: 1, rotation: -6, duration: 0.5, delay: 0.7, ease: 'back.out(3)' })
    },
    { scope: rootRef, dependencies: [phase] },
  )

  const revealOutfit: Outfit = item ? { ...outfit, [ITEM_INFO[item].slot]: item } : outfit
  const colors = RARITY_COLORS[RARITIES[rarity]!]
  const view = result?.wardrobe
  const canFree = view ? view.freeAt === null : false
  const canBuy = view ? view.balance >= view.price : false

  const wear = async () => {
    if (!item) return
    try {
      await equip({ ...outfit, [ITEM_INFO[item].slot]: item })
      setEquipped(true)
      vibrate(15)
    } catch {
      // La tenue revient en arrière (cf. le magasin) ; rien d'autre à faire.
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[120] touch-none overflow-hidden select-none"
      style={{ background: `radial-gradient(120% 90% at 50% 62%, ${colors.deep} 0%, #12062a 45%, #05010d 100%)` }}
      onPointerDown={knock}
      role="dialog"
      aria-modal="true"
      aria-label={t.runner.wardrobe.box.title}
    >
      <ParticleBurst burst={burst} />
      <Canvas dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ fov: 38, position: [0, 1.6, 4.6] }} className="absolute inset-0">
        <hemisphereLight args={['#fff1f6', '#7d5aa8', 1.6]} />
        <directionalLight position={[3, 5, 6]} intensity={1.8} color="#ffe6cc" />
        <BoxStage timeline={timeline} />
        {phase === 'reveal' && assets && <RevealHero assets={assets} outfit={revealOutfit} />}
        <CameraRig timeline={timeline} phase={phase} focus={item ? (FOCUS[ITEM_INFO[item].slot] ?? FOCUS.top!) : FOCUS.top!} />
      </Canvas>

      {/* Lueur de la rareté sur les bords, éclair blanc à l'explosion. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-[box-shadow] duration-300" style={{ boxShadow: `inset 0 0 ${60 + stage * 40}px ${teaseColor(stage, rarity)}66` }} />
      {phase === 'burst' && <div aria-hidden className="pointer-events-none absolute inset-0 animate-[runner-hit_0.7s_ease-out_forwards] bg-white" />}

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
        aria-label={t.runner.wardrobe.box.close}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 grid size-11 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm"
      >
        <X size={20} aria-hidden />
      </button>

      {phase === 'charge' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(2.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3">
          {result ? (
            <>
              <p className="animate-pulse text-base font-bold tracking-[0.18em] text-white uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">{t.runner.wardrobe.box.tap}</p>
              <div className="flex gap-2">
                {Array.from({ length: TAPS }, (_, index) => (
                  <span
                    key={index}
                    className="size-3 rounded-full border border-white/50 transition-all duration-200"
                    style={index < stage ? { background: teaseColor(index + 1, rarity), boxShadow: `0 0 12px ${teaseColor(index + 1, rarity)}`, transform: 'scale(1.25)' } : undefined}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-white/80">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t.runner.wardrobe.box.opening}
            </p>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-x-5 bottom-[max(2rem,env(safe-area-inset-bottom))] mx-auto max-w-sm rounded-[1.5rem] border border-white/10 bg-[#140a2e]/95 p-5 text-center" onPointerDown={(event) => event.stopPropagation()}>
          <p className="text-sm text-cream">{error}</p>
          <button type="button" onClick={onClose} className="mt-4 h-11 w-full rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
            {t.runner.wardrobe.box.close}
          </button>
        </div>
      )}

      {phase === 'reveal' && result && item && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onPointerDown={(event) => event.stopPropagation()}>
          <p data-box-rarity className="text-sm font-black uppercase" style={{ color: colors.main, textShadow: `0 0 18px ${colors.main}, 0 2px 0 #000` }}>
            {result.guaranteed ? `${t.runner.wardrobe.rarity[result.item.rarity]} · ${t.runner.wardrobe.box.guaranteed}` : t.runner.wardrobe.rarity[result.item.rarity]}
          </p>
          <div data-box-card className="relative w-full max-w-sm rounded-[1.75rem] border bg-[#12082a]/90 p-5 text-center backdrop-blur-md" style={{ borderColor: `${colors.main}88`, boxShadow: `0 0 50px -10px ${colors.main}` }}>
            <span
              data-box-badge
              className="absolute -top-3 -right-2 rounded-full px-3 py-1 text-xs font-black tracking-wider uppercase shadow-lg"
              style={result.duplicate ? { background: '#2a2140', color: '#ffd35c', border: '1px solid #ffd35c66' } : { background: colors.main, color: '#12082a' }}
            >
              {result.duplicate ? t.runner.wardrobe.box.duplicate(result.refund) : t.runner.wardrobe.box.isNew}
            </span>
            {!assets && itemIcon(item) && <img src={itemIcon(item)} alt="" className="mx-auto -mt-2 mb-1 size-28 object-contain" />}
            <p className="font-display text-3xl leading-tight text-cream">{t.runner.wardrobe.items[item]}</p>
            <p className="mt-1 text-xs tracking-[0.18em] text-cream/55 uppercase">
              {ITEM_INFO[item].anime} · {t.runner.wardrobe.slots[ITEM_INFO[item].slot]}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void wear()}
                disabled={equipped || outfit[ITEM_INFO[item].slot] === item}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-void disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${colors.glow}, ${colors.main})` }}
              >
                {equipped || outfit[ITEM_INFO[item].slot] === item ? t.runner.wardrobe.equipped : t.runner.wardrobe.equip}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => (canFree || canBuy) && onAgain(canFree)}
                  disabled={!canFree && !canBuy}
                  className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 text-sm font-bold text-gold disabled:opacity-45"
                >
                  <Sparkles size={15} aria-hidden />
                  {canFree ? t.runner.wardrobe.box.againFree : t.runner.wardrobe.box.again(view?.price ?? 0)}
                </button>
                <button type="button" onClick={onClose} className="h-12 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-cream">
                  {t.runner.wardrobe.box.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/** La boîte et ses lumières : le temps avance ici (âge, temps depuis le dernier coup, explosion). */
function BoxStage({ timeline }: { timeline: BoxTimeline }) {
  const [scene] = useState(() => new MysteryBoxScene())
  useEffect(() => () => scene.dispose(), [scene])
  useFrame(({ clock }, delta) => {
    timeline.tick(delta)
    scene.update(timeline.frame, clock.elapsedTime, delta)
  })
  return <primitive object={scene.object} />
}

/** Le coureur paré de la nouvelle pièce : il jaillit de la colonne de lumière, et se réjouit. */
function RevealHero({ assets, outfit }: { assets: RunnerAssets; outfit: Outfit }) {
  const [rig] = useState(() => new RevealRig(createHero('adventurer', assets, true, outfit) as HeroModelPart))
  useEffect(() => {
    rig.attach()
    return () => rig.detach()
  }, [rig])
  useFrame(({ clock }, delta) => rig.update(clock.elapsedTime, delta))
  return <primitive object={rig.group} />
}

/** Le coureur de la révélation : il surgit en grandissant (léger dépassement) et se réjouit. */
class RevealRig {
  readonly group = new THREE.Group()
  private readonly part: HeroModelPart
  private readonly idle = createRun(0)
  private age = 0

  constructor(part: HeroModelPart) {
    this.part = part
  }

  /** Monté (ou remonté, en mode strict) : le coureur entre en scène et se réjouit. */
  attach(): void {
    this.group.add(this.part.object)
    this.part.cheer()
  }

  update(time: number, delta: number): void {
    this.age += delta
    const t = Math.min(1, this.age / 0.7)
    const grow = t < 1 ? 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2 : 1
    this.group.scale.setScalar(Math.max(0.001, grow))
    this.group.position.y = Math.max(0, (1 - t) * 0.6)
    this.group.rotation.y = Math.sin(time * 0.4) * 0.3
    this.part.update(this.idle, time, delta)
  }

  detach(): void {
    this.group.remove(this.part.object)
    this.part.dispose()
  }
}

/** La caméra : elle s'approche à chaque coup, tremble à l'explosion, puis cadre la nouvelle pièce. */
function CameraRig({ timeline, phase, focus }: { timeline: BoxTimeline; phase: Phase; focus: [number, number] }) {
  const [look] = useState(() => new THREE.Vector3(0, 0.55, 0))
  const [goal] = useState(() => new THREE.Vector3())
  const [lookGoal] = useState(() => new THREE.Vector3())
  const revealAge = useRef(0)
  useFrame(({ camera }, delta) => {
    const frame = timeline.frame
    const ease = 1 - Math.exp(-Math.min(delta, 0.05) * 3.5)
    // Écran en portrait : on recule, pour que la boîte (puis le coureur) tienne en largeur.
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1
    const back = Math.min(1.9, Math.max(1, 0.8 / aspect))
    if (phase === 'reveal') {
      revealAge.current += delta
      // D'abord tout le personnage, puis la pièce gagnée.
      const [height, distance] = revealAge.current < 1.1 ? [0.95, 4.2] : focus
      goal.set(Math.sin(revealAge.current * 0.25) * 0.6, height + 0.25, distance * Math.min(back, 1.45))
      lookGoal.set(0, height, 0)
    } else {
      goal.set(0, 1.55 - frame.stage * 0.08, (4.6 - frame.stage * 0.35) * back)
      lookGoal.set(0, 0.6, 0)
    }
    camera.position.lerp(goal, ease)
    look.lerp(lookGoal, ease)
    const shake = frame.burst !== null && frame.burst < 0.6 ? (0.6 - frame.burst) * 0.25 * (1 + frame.rarity * 0.4) : Math.max(0, 1 - frame.sinceTap / 0.25) * 0.04 * frame.stage
    camera.position.x += (Math.random() - 0.5) * shake
    camera.position.y += (Math.random() - 0.5) * shake
    camera.lookAt(look)
  })
  return null
}
