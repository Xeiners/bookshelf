import { useEffect, useState, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { step, type QuizQuestion, type RunState } from '../../lib/runner/engine'
import { HeroPart } from './hero'
import type { HeroLookId } from './looks'
import { GroundPart, HORIZON, PetalsPart, SceneryPart, SkyPart } from './japan'
import { CameraFollow, ObstaclesPart, PickupsPart, type ScenePart } from './parts'

/*
 * La scène du Manga Runner. Une seule boucle (`useFrame`, priorité −1) fait avancer la
 * simulation ; chaque partie de la scène (`parts.ts`) relit ensuite l'état et met à jour
 * ses instances. Pas d'ombres portées (une tache sous le coureur suffit), du brouillard
 * pour cacher l'horizon où naît la piste, une résolution plafonnée : 60 images/s visées
 * sur téléphone.
 */

export interface RunnerSceneProps {
  state: RefObject<RunState>
  paused: RefObject<boolean>
  ask: () => QuizQuestion | null
  /** Après chaque pas de simulation : l'interface lit l'état (HUD, sons, fin). */
  onTick: (state: RunState) => void
  /** Rendu allégé (résolution, pétales, lissage) : téléphones modestes. */
  lite: boolean
  look: HeroLookId
}

export function RunnerScene({ state, paused, ask, onTick, lite, look }: RunnerSceneProps) {
  return (
    <Canvas
      dpr={lite ? [1, 1.25] : [1, 1.75]}
      gl={{ antialias: !lite, powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: 62, near: 0.1, far: 240, position: [0, 3.4, 6.8] }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[HORIZON]} />
      <fog attach="fog" args={[HORIZON, 50, 175]} />
      <hemisphereLight args={['#fff1f6', '#b98bb4', 1.35]} />
      <directionalLight position={[6, 12, 6]} intensity={1.65} color="#ffe6cc" />
      <Simulation state={state} paused={paused} ask={ask} onTick={onTick} />
      <Part state={state} make={() => new SkyPart()} />
      <Part state={state} make={() => new GroundPart()} />
      <Part state={state} make={() => new SceneryPart()} />
      <Part state={state} make={() => new ObstaclesPart()} />
      <Part state={state} make={() => new PickupsPart()} />
      <Part state={state} make={() => new HeroPart({ look })} />
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

function Camera({ state }: { state: RefObject<RunState> }) {
  const [follow] = useState(() => new CameraFollow())
  useFrame(({ camera }, delta) => {
    const run = state.current
    if (run) follow.update(camera, run, delta)
  })
  return null
}
