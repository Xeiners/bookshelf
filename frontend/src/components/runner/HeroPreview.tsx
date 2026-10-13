import { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { createRun } from '../../lib/runner/engine'
import { HeroPart } from './hero'
import type { HeroLookId } from './looks'

/** Le coureur en vitrine (accueil du Runner) : il attend, respire, salue. Base des futures personnalisations. */
export function HeroPreview({ look, className }: { look: HeroLookId; className?: string }) {
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ fov: 30, position: [0, 1.2, 5.2] }} onCreated={({ camera }) => camera.lookAt(0, 1.12, 0)}>
        <hemisphereLight args={['#fff1f6', '#b98bb4', 1.4]} />
        <directionalLight position={[3, 5, 6]} intensity={1.6} color="#ffe6cc" />
        <Hero look={look} />
      </Canvas>
    </div>
  )
}

function Hero({ look }: { look: HeroLookId }) {
  const [part] = useState(() => new HeroPart({ look, preview: true }))
  const [idle] = useState(() => createRun(0))
  useEffect(() => () => part.dispose(), [part])
  useFrame(({ clock }, delta) => part.update(idle, clock.elapsedTime, delta))
  return <primitive object={part.object} />
}
