import { useEffect, useState, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MathUtils, PerspectiveCamera } from 'three'
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
      dpr={lite ? [1, 1.25] : [1, 1.75]}
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
    </Canvas>
  )
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
