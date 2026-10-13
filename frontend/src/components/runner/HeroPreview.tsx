import { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { createRun } from '../../lib/runner/engine'
import type { RunnerAssets } from './assets'
import { HeroPart } from './hero'
import { HeroModelPart } from './heroModel'
import { modelOf, type HeroLookId } from './looks'
import type { ScenePart } from './parts'

/** Le coureur choisi, en vitrine (accueil du Runner) : il attend, respire, se réjouit. */
export function HeroPreview({ look, assets, className }: { look: HeroLookId; assets: RunnerAssets | null; className?: string }) {
  const model = modelOf(look)
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ fov: 30, position: [0, 1.2, 5.2] }} onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}>
        <hemisphereLight args={['#fff1f6', '#b98bb4', 1.5]} />
        <directionalLight position={[3, 5, 6]} intensity={1.7} color="#ffe6cc" />
        {model && assets ? <Hero key={look} make={() => new HeroModelPart(assets, model, { preview: true })} /> : !model && <Hero key={look} make={() => new HeroPart({ preview: true })} />}
      </Canvas>
    </div>
  )
}

function Hero({ make }: { make: () => ScenePart }) {
  const [part] = useState(make)
  const [idle] = useState(() => createRun(0))
  useEffect(() => () => part.dispose(), [part])
  useFrame(({ clock }, delta) => part.update(idle, clock.elapsedTime, delta))
  return <primitive object={part.object} />
}
