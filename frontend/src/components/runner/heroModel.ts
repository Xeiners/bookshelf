import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MAX_SPEED, SLIDE_TIME } from '../../lib/runner/constants'
import { isFlying, isShielded, isSliding, type RunState } from '../../lib/runner/engine'
import type { HeroModel, RunnerAssets } from './assets'
import type { ScenePart } from './parts'
import { outlineMaterial, toonMaterial } from './toon'

/*
 * Le coureur, en vrai modèle animé (KayKit, squelette et 13 clips) : course, saut en trois
 * temps (élan, suspension, réception), roulade sous les obstacles, chute, joie, réveil.
 * Chaque changement d'animation est un fondu enchaîné ; la course accélère avec la
 * vitesse, le corps s'incline et pivote en changeant de voie.
 */

/** Taille du modèle à l'écran (m) : un peu plus grand que la boîte de collision (1,75 m). */
const HEIGHT = 1.95
const FADE = 0.16

type Clip = 'Idle' | 'Running_A' | 'Running_B' | 'Jump_Start' | 'Jump_Idle' | 'Jump_Land' | 'Dodge_Forward' | 'Death_A' | 'Cheer' | 'Hit_A' | 'Lie_StandUp'

const damp = (current: number, target: number, rate: number) => current + (target - current) * rate

export class HeroModelPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly root = new THREE.Group()
  private readonly model: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<Clip, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private currentName: Clip | null = null
  private readonly cloud = new THREE.Group()
  private readonly shield: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly preview: boolean
  private wasGrounded = true
  private wasSliding = false
  private landingUntil = 0
  private lastX = 0
  private yaw = 0
  private roll = 0
  private time = 0
  private nextCheer = 4

  constructor(assets: RunnerAssets, hero: HeroModel, options: { preview?: boolean } = {}) {
    this.preview = options.preview ?? false
    this.model = cloneSkinned(assets.heroes[hero].scene)
    this.model.traverse((node) => {
      if (node instanceof THREE.Mesh) node.frustumCulled = false
    })
    // À l'échelle, pieds au sol, tourné vers l'avant de la piste (−z).
    const box = new THREE.Box3().setFromObject(this.model)
    const size = box.getSize(new THREE.Vector3())
    const scale = HEIGHT / Math.max(0.01, size.y)
    this.model.scale.setScalar(scale)
    this.model.position.y = -box.min.y * scale
    this.model.rotation.y = this.preview ? 0 : Math.PI
    this.root.add(this.model)
    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of assets.heroClips) {
      const action = this.mixer.clipAction(clip)
      this.actions.set(clip.name as Clip, action)
    }
    for (const once of ['Jump_Start', 'Jump_Land', 'Dodge_Forward', 'Death_A', 'Cheer', 'Hit_A', 'Lie_StandUp'] as const) {
      const action = this.actions.get(once)
      if (!action) continue
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.play(this.preview ? 'Idle' : 'Running_A', 0)

    // Nuage magique, bulle du bouclier, ombre au sol.
    const ink = outlineMaterial(0.02)
    const puff = toonMaterial('#ffffff', '#ffe0ee', 0.25)
    for (let bump = 0; bump < 6; bump += 1) {
      const angle = (bump / 6) * Math.PI * 2
      const geometry = new THREE.SphereGeometry(0.34 - (bump % 2) * 0.06, 14, 12)
      const mesh = new THREE.Mesh(geometry, puff)
      mesh.add(new THREE.Mesh(geometry, ink))
      mesh.position.set(Math.cos(angle) * 0.38, (bump % 2) * 0.07, Math.sin(angle) * 0.3)
      this.cloud.add(mesh)
    }
    this.cloud.visible = false
    this.root.add(this.cloud)
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 28, 20),
      new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.shield.position.y = 1
    this.shield.visible = false
    this.root.add(this.shield)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: '#2a1838', transparent: true, opacity: 0.35, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.object.add(this.root, this.shadow)
  }

  /** Fondu enchaîné vers un clip ; `restart` relance un clip déjà en cours. */
  private play(name: Clip, fade = FADE, restart = false): THREE.AnimationAction | null {
    const next = this.actions.get(name)
    if (!next) return null
    if (this.currentName === name && !restart) return next
    next.reset().setEffectiveWeight(1).play()
    if (this.current && this.current !== next && fade > 0) this.current.crossFadeTo(next, fade, false)
    else if (this.current && this.current !== next) this.current.stop()
    this.current = next
    this.currentName = name
    return next
  }

  private animate(run: RunState): void {
    // Après un nettoyage suivi d'un remontage (mode strict), on repart du clip de base.
    if (!this.currentName) this.play(this.preview ? 'Idle' : 'Running_A', 0)
    if (this.preview) {
      // Vitrine : attente, et une joie de temps en temps.
      if (this.time > this.nextCheer && this.currentName === 'Idle') {
        this.play('Cheer', 0.25)
        this.nextCheer = this.time + 7
      } else if (this.currentName === 'Cheer' && !this.actions.get('Cheer')!.isRunning()) this.play('Idle', 0.35)
      return
    }
    if (run.over) {
      this.play('Death_A', 0.12)
      return
    }
    const sliding = isSliding(run)
    if (sliding) {
      // Roulade sous l'obstacle, calée sur la durée de la glissade.
      if (!this.wasSliding) {
        const roll = this.play('Dodge_Forward', 0.08, true)
        if (roll) roll.timeScale = roll.getClip().duration / (SLIDE_TIME + 0.08)
      }
      this.wasSliding = true
      return
    }
    this.wasSliding = false
    if (isFlying(run)) {
      this.play('Jump_Idle', 0.2)
      return
    }
    if (!run.grounded) {
      if (run.vy > 2) {
        const start = this.play('Jump_Start', 0.08)
        if (start) start.timeScale = 1.8
      } else this.play('Jump_Idle', 0.18)
      this.wasGrounded = false
      return
    }
    if (!this.wasGrounded) {
      // Réception : un temps, puis la course reprend.
      const land = this.play('Jump_Land', 0.06, true)
      if (land) land.timeScale = 2.2
      this.landingUntil = this.time + 0.18
      this.wasGrounded = true
    }
    if (this.time < this.landingUntil) return
    const run_ = this.play(run.speed > MAX_SPEED * 0.75 ? 'Running_B' : 'Running_A', 0.25)
    if (run_) run_.timeScale = 0.85 + (run.speed / MAX_SPEED) * 0.75
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    this.time += dt
    this.animate(run)
    this.mixer.update(dt)
    if (this.preview) {
      this.root.rotation.y = Math.sin(this.time * 0.5) * 0.45
      return
    }

    // Changement de voie : le corps pivote et s'incline vers où il va.
    const vx = (run.x - this.lastX) / Math.max(dt, 1e-3)
    this.lastX = run.x
    const smooth = 1 - Math.exp(-dt * 12)
    this.yaw = damp(this.yaw, Math.max(-0.45, Math.min(0.45, -vx * 0.028)), smooth)
    this.roll = damp(this.roll, Math.max(-0.3, Math.min(0.3, -vx * 0.02)), smooth)
    this.root.position.set(run.x, run.y, 0)
    this.root.rotation.set(0, this.yaw, this.roll)

    this.shadow.position.set(run.x, 0.02, 0)
    const shrink = Math.max(0.3, 1 - run.y * 0.15)
    this.shadow.scale.set(shrink, shrink, 1)
    this.cloud.visible = isFlying(run)
    if (this.cloud.visible) this.cloud.rotation.y += dt * 0.8
    // Clignote après un choc ou une résurrection.
    this.root.visible = run.over || run.invulnerableUntil <= run.t || isShielded(run) || Math.floor(run.t * 12) % 2 === 0
    this.shield.visible = isShielded(run)
    if (this.shield.visible) {
      this.shield.scale.setScalar(1 + Math.sin(run.t * 8) * 0.04)
      ;(this.shield.material as THREE.MeshBasicMaterial).opacity = 0.15 + Math.sin(run.t * 6) * 0.05
    }
  }

  dispose(): void {
    // Sans `uncacheRoot` : React (mode strict) peut remonter la même partie après ce nettoyage.
    this.mixer.stopAllAction()
    this.current = null
    this.currentName = null
    // Les maillages du modèle sont partagés avec l'original chargé : seuls nos ajouts sont libérés.
    for (const owned of [this.cloud, this.shield, this.shadow]) {
      owned.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          for (const material of [node.material].flat()) material.dispose()
        }
      })
    }
  }
}
