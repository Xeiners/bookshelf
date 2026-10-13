import { useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createRun } from '../../lib/runner/engine'
import type { RunnerAssets } from './assets'
import { createHero } from './heroModel'
import { sourceOf, type HeroLookId } from './looks'
import type { ScenePart } from './parts'

/** Le coureur choisi, en vitrine (accueil du Runner) : il attend, respire, se réjouit. */
export function HeroPreview({ look, assets, className }: { look: HeroLookId; assets: RunnerAssets | null; className?: string }) {
  const kind = sourceOf(look).kind
  const ready = kind === 'chibi' || assets !== null
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ fov: 30, position: [0, 1.2, 5.2] }}>
        <Framing close={kind === 'vrm'} />
        <hemisphereLight args={['#fff1f6', '#b98bb4', 1.5]} />
        <directionalLight position={[3, 5, 6]} intensity={1.7} color="#ffe6cc" />
        {ready && <Hero key={look} make={() => createHero(look, assets, true)!} />}
      </Canvas>
    </div>
  )
}

/** Cadrage : un personnage élancé (VRM) est vu de plus près qu'une figurine trapue. */
function Framing({ close }: { close: boolean }) {
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    camera.position.set(0, close ? 1.1 : 1.2, close ? 4.4 : 5.2)
    camera.lookAt(0, close ? 0.98 : 1.05, 0)
  }, [camera, close])
  return null
}

function Hero({ make }: { make: () => ScenePart }) {
  const [part] = useState(make)
  const [idle] = useState(() => createRun(0))
  useEffect(() => () => part.dispose(), [part])
  useFrame(({ clock }, delta) => part.update(idle, clock.elapsedTime, delta))
  return <primitive object={part.object} />
}
