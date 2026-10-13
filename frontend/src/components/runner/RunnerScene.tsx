import { useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Mesh, PerspectiveCamera, Texture } from 'three'
import { step, type QuizQuestion, type RunState } from '../../lib/runner/engine'
import type { RunnerAssets } from './assets'
import { BIOME_STYLE } from './biomes'
import { createHero } from './heroModel'
import { EnvironmentPart, NaturePart, PetalsPart, SkyPart, TerrainPart, TrackPart, view } from './world'
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
}

export function RunnerScene({ state, paused, ask, onTick, lite, look, assets }: RunnerSceneProps) {
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
      <Camera state={state} />
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

function Camera({ state }: { state: RefObject<RunState> }) {
  const [follow] = useState(() => new CameraFollow())
  useFrame(({ camera }, delta) => {
    const run = state.current
    if (run) follow.update(camera, run, delta)
    // Le paysage ne pose que ce qui entre dans ce champ (étroit en portrait).
    if (camera instanceof PerspectiveCamera) {
      view.spread = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect + 0.08
      view.x = camera.position.x
      view.z = camera.position.z
    }
  })
  return null
}
