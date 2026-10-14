import { useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CatmullRomCurve3, MathUtils, Mesh, PerspectiveCamera, Texture, Vector3 } from 'three'
import { step, type QuizQuestion, type RunState } from '../../lib/runner/engine'
import type { RunnerAssets } from './assets'
import { BIOME_STYLE } from './biomes'
import { createHero } from './heroModel'
import { EnvironmentPart, NaturePart, PetalsPart, SkyPart, TerrainPart, TrackPart, view } from './world'
import type { IntroClock } from './intro'
import type { HeroLookId } from './looks'
import { MonstersPart } from './monsters'
import { CameraFollow, ObstaclesPart, PickupsPart, type ScenePart } from './parts'

/*
 * La scène du Manga Runner. Une seule boucle (`useFrame`, priorité −1) fait avancer la
 * simulation ; chaque partie de la scène relit ensuite l'état et se met à jour : ciel,
 * montagnes, prés, voie ferrée et végétation du biome traversé (`world.ts`, `biomes.ts`),
 * obstacles et monstres, objets à ramasser, coureur animé. Pas d'ombres portées (des
 * taches douces au pied des arbres et des personnages), de la brume couleur d'horizon,
 * une résolution plafonnée : 60 images/s visées sur téléphone.
 */

export interface RunnerSceneProps {
  state: RefObject<RunState>
  paused: RefObject<boolean>
  ask: () => QuizQuestion | null
  /** Après chaque pas de simulation : l'interface lit l'état (HUD, sons, fin). */
  onTick: (state: RunState) => void
  /** Rendu allégé (résolution, particules, lissage) : téléphones modestes. */
  lite: boolean
  look: HeroLookId
  assets: RunnerAssets
  intro: IntroClock
}

export function RunnerScene({ state, paused, ask, onTick, lite, look, assets, intro }: RunnerSceneProps) {
  return (
    <Canvas
      dpr={lite ? [1, 1.1] : [1, MAX_DPR]}
      gl={{ antialias: !lite, powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: 62, near: 0.2, far: 900, position: [0, 3.4, 6.8] }}
      style={{ touchAction: 'none' }}
      onCreated={({ gl }) => {
        // Développement : compteurs de rendu (triangles, appels de dessin) pour les tests.
        if (import.meta.env.DEV) (window as unknown as { __runnerGl?: unknown }).__runnerGl = gl
      }}
    >
      <color attach="background" args={[BIOME_STYLE.sakura.horizon]} />
      <fog attach="fog" args={[BIOME_STYLE.sakura.horizon, BIOME_STYLE.sakura.fogNear, BIOME_STYLE.sakura.fogFar]} />
      <Simulation state={state} paused={paused} ask={ask} onTick={onTick} />
      <Environment state={state} />
      <Part state={state} make={() => new SkyPart()} />
      <Part state={state} make={() => new TerrainPart()} />
      <Part state={state} make={() => new TrackPart()} />
      <Part state={state} make={() => new NaturePart(assets, lite)} />
      <Part state={state} make={() => new ObstaclesPart()} />
      <Part state={state} make={() => new MonstersPart(assets)} />
      <Part state={state} make={() => new PickupsPart()} />
      <Part state={state} make={() => createHero(look, assets)!} />
      <Part state={state} make={() => new PetalsPart(lite ? 90 : 260)} />
      <Camera state={state} intro={intro} />
      <Warmup />
      <AdaptiveResolution max={lite ? 1.1 : MAX_DPR} />
    </Canvas>
  )
}

/** Résolution maximale (rapport de pixels) hors mode allégé ; abaissée si l'appareil peine. */
const MAX_DPR = 1.5

/**
 * Prépare tout avant la course : programmes des matériaux compilés et textures envoyées à
 * la carte graphique, y compris ce qui n'apparaîtra que plus loin (arbres d'automne, pins
 * de la nuit…). Sans cela, leur première apparition, en pleine vitesse, ferait un à-coup.
 */
function Warmup() {
  const gl = useThree((three) => three.gl)
  const scene = useThree((three) => three.scene)
  const camera = useThree((three) => three.camera)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      gl.compile(scene, camera)
      scene.traverse((node) => {
        if (!(node instanceof Mesh)) return
        for (const material of [node.material].flat()) {
          for (const value of Object.values(material)) if (value instanceof Texture) gl.initTexture(value)
        }
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [gl, scene, camera])
  return null
}

/**
 * Résolution adaptative : si les images tardent (moins de ~45 par seconde en moyenne sur
 * une seconde), on baisse la définition par paliers, jusqu'à 1. La fluidité d'abord.
 */
function AdaptiveResolution({ max }: { max: number }) {
  const setDpr = useThree((three) => three.setDpr)
  const sample = useRef({ time: 0, frames: 0, dpr: max })
  useFrame((_, delta) => {
    const current = sample.current
    // On ignore les pauses et les retours au premier plan (une image très longue).
    if (delta > 0.25) return
    current.time += delta
    current.frames += 1
    if (current.time < 1) return
    const fps = current.frames / current.time
    current.time = 0
    current.frames = 0
    if (fps < 45 && current.dpr > 1) {
      current.dpr = Math.max(1, current.dpr - 0.2)
      setDpr(current.dpr)
    }
  })
  return null
}

/** La boucle : pas de simulation borné (un onglet revenu au premier plan ne téléporte pas le coureur). */
function Simulation({ state, paused, ask, onTick }: Pick<RunnerSceneProps, 'state' | 'paused' | 'ask' | 'onTick'>) {
  useFrame((_, delta) => {
    const run = state.current
    if (!run || paused.current) return
    const dt = Math.min(delta, 1 / 20)
    // Deux demi-pas sous 40 images/s : les collisions restent précises.
    if (dt > 1 / 40) {
      step(run, dt / 2, ask)
      step(run, dt / 2, ask)
    } else step(run, dt, ask)
    onTick(run)
  }, -1)
  return null
}

/** Monte une partie de la scène, l'appelle à chaque image, la libère au démontage. */
function Part({ state, make }: { state: RefObject<RunState>; make: () => ScenePart }) {
  const [part] = useState(make)
  useEffect(() => () => part.dispose(), [part])
  useFrame(({ clock }, delta) => {
    const run = state.current
    if (run) part.update(run, clock.elapsedTime, delta)
  })
  return <primitive object={part.object} />
}

/** Lumières, brume et fond : ils suivent le biome où court le joueur. */
function Environment({ state }: { state: RefObject<RunState> }) {
  const [environment] = useState(() => new EnvironmentPart())
  useEffect(() => () => environment.dispose(), [environment])
  useFrame(({ scene }) => {
    const run = state.current
    if (run) environment.update(run, scene)
  })
  return <primitive object={environment.object} />
}

/**
 * La cinématique de départ : plan de héros en contre-plongée, de face, sur fond de ciel ;
 * la caméra glisse autour de lui, passe sur le côté, s'élève derrière lui et révèle la voie, puis se pose à sa
 * place de jeu (dernière clé = pose de la caméra de jeu : aucun raccord visible).
 */
const SHOTS: { at: number; position: [number, number, number]; look: [number, number, number]; fov: number }[] = [
  { at: 0, position: [0.95, 0.72, -2.15], look: [0, 1.62, 0.4], fov: 40 },
  { at: 0.28, position: [-0.35, 0.85, -2.45], look: [0, 1.55, 0.2], fov: 40 },
  { at: 0.48, position: [-2.3, 1.5, -0.3], look: [0, 1.35, 0], fov: 44 },
  { at: 0.62, position: [-1.7, 2.4, 2.4], look: [0, 1.3, 0], fov: 48 },
  { at: 0.78, position: [-0.6, 3.7, 4.6], look: [0, 1.2, -3], fov: 55 },
  { at: 1, position: [0, 3.4, 6.8], look: [0, 1.3, -8], fov: 62 },
]

class IntroPath {
  private readonly positions = new CatmullRomCurve3(SHOTS.map((shot) => new Vector3(...shot.position)), false, 'centripetal')
  private readonly looks = new CatmullRomCurve3(SHOTS.map((shot) => new Vector3(...shot.look)), false, 'centripetal')
  private readonly position = new Vector3()
  private readonly look = new Vector3()

  /** Pose la caméra à l'avancement `progress` (0 à 1) de la cinématique. */
  apply(camera: PerspectiveCamera, progress: number): void {
    // Démarrage et arrivée en douceur ; entre les clés, la vitesse reste continue.
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
    let segment = 0
    while (segment < SHOTS.length - 2 && eased > SHOTS[segment + 1]!.at) segment += 1
    const from = SHOTS[segment]!
    const to = SHOTS[segment + 1]!
    const local = MathUtils.clamp((eased - from.at) / (to.at - from.at), 0, 1)
    const along = (segment + local) / (SHOTS.length - 1)
    camera.position.copy(this.positions.getPoint(along, this.position))
    camera.lookAt(this.looks.getPoint(along, this.look))
    const fov = from.fov + (to.fov - from.fov) * local
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }
}

function Camera({ state, intro }: { state: RefObject<RunState>; intro: IntroClock }) {
  const [follow] = useState(() => new CameraFollow())
  const [path] = useState(() => new IntroPath())
  const frames = useRef(0)
  useFrame(({ camera }, delta) => {
    const run = state.current
    if (!run) return
    // Avant le premier pas de la course : la cinématique ; ensuite, la caméra de jeu.
    // L'horloge part après quelques images : la toute première porte la préparation (compilation).
    if (run.t === 0 && ++frames.current >= 3) intro.begin()
    const progress = intro.progress()
    const cinematic = run.t === 0 && progress < 1 && camera instanceof PerspectiveCamera
    view.all = cinematic
    if (cinematic) path.apply(camera, Math.max(0, progress))
    else follow.update(camera, run, delta)
    // Le paysage ne pose que ce qui entre dans ce champ (étroit en portrait).
    if (camera instanceof PerspectiveCamera) {
      view.spread = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect + 0.08
      view.x = camera.position.x
      view.z = camera.position.z
    }
  })
  return null
}
