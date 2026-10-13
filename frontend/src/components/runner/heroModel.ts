import * as THREE from 'three'
import { MAX_SPEED, SLIDE_TIME } from '../../lib/runner/constants'
import { isFlying, isShielded, isSliding, isStunned, type RunState } from '../../lib/runner/engine'
import type { RunnerAssets, VrmHero } from './assets'
import { HeroPart } from './hero'
import type { HeroLookId } from './looks'
import { sourceOf } from './looks'
import type { ScenePart } from './parts'
import { TalismanAura } from './talismans'
import { outlineMaterial, toonMaterial } from './toon'
import { VrmLife } from './vrm'

/*
 * Le coureur, en vrai modèle animé (personnage VRM aux vraies proportions, mouvements
 * captés) : sprint, saut en trois temps (élan, suspension, réception), culbute sous les
 * obstacles, trébuchement, chute, joie. Chaque changement d'animation est un fondu
 * enchaîné ; la course accélère avec la vitesse, le corps s'incline et pivote selon sa
 * vitesse latérale en changeant de voie. Il cligne des yeux, ses mèches et ses vêtements
 * suivent ses mouvements et le vent de la course ; sonné, des étoiles tournent autour de
 * sa tête.
 */

const FADE = 0.16
/** Taille d'un coureur VRM (m) : silhouette élancée, tête à hauteur de la boîte de collision. */
const VRM_HEIGHT = 1.8

/** Ce que le coureur anime : un modèle, ses clips, sa taille, et sa « vie » s'il s'agit d'un VRM. */
export interface HeroRig {
  model: THREE.Object3D
  clips: THREE.AnimationClip[]
  height: number
  life?: VrmLife
}

/** Le VRM n'est pas cloné (ses ressorts et expressions n'y survivraient pas) : chaque usage a son instance. */
export function vrmRig(hero: VrmHero, preview: boolean): HeroRig {
  const vrm = preview ? hero.preview : hero.game
  vrm.springBoneManager?.reset()
  return { model: vrm.scene, clips: hero.clips, height: VRM_HEIGHT, life: new VrmLife(vrm) }
}

/** Le coureur d'une tenue : `null` tant que les modèles ne sont pas chargés (sauf le ninja chibi). */
export function createHero(look: HeroLookId, assets: RunnerAssets | null, preview = false): ScenePart | null {
  const source = sourceOf(look)
  if (source.kind === 'chibi') return new HeroPart({ preview })
  if (!assets) return null
  return new HeroModelPart(vrmRig(assets.vrm[source.model], preview), { preview })
}

const BACKWARD = new THREE.Vector3(0, -0.15, 1).normalize()

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
  private readonly talismans = new TalismanAura()
  private readonly shadow: THREE.Mesh
  private readonly preview: boolean
  private readonly life: VrmLife | undefined
  private wasGrounded = true
  private wasSliding = false
  private landingUntil = 0
  private stumbleSeen = -10
  private stumbleUntil = 0
  private readonly stars = new THREE.Group()
  private yaw = 0
  private roll = 0
  private time = 0
  private nextCheer = 4

  constructor(rig: HeroRig, options: { preview?: boolean } = {}) {
    this.preview = options.preview ?? false
    this.model = rig.model
    this.life = rig.life
    this.model.traverse((node) => {
      if (node instanceof THREE.Mesh) node.frustumCulled = false
    })
    // À l'échelle, pieds au sol, tourné vers l'avant de la piste (−z). Taille mesurée au
    // repos, à l'échelle 1 (un VRM resservi garde sinon celle de la course précédente).
    const rest = (this.model.userData.rest ??= (() => {
      this.model.scale.setScalar(1)
      this.model.position.set(0, 0, 0)
      this.model.rotation.set(0, 0, 0)
      this.model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(this.model)
      return { height: box.max.y - box.min.y, bottom: box.min.y }
    })()) as { height: number; bottom: number }
    const scale = rig.height / Math.max(0.01, rest.height)
    this.model.scale.setScalar(scale)
    this.model.position.set(0, -rest.bottom * scale, 0)
    this.model.rotation.set(0, this.preview ? 0 : Math.PI, 0)
    this.root.add(this.model)
    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of rig.clips) {
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
    this.root.add(this.talismans.object)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: '#2a1838', transparent: true, opacity: 0.35, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    // Étoiles de l'étourdissement, en couronne au-dessus de la tête.
    const starShape = new THREE.Shape()
    for (let point = 0; point < 10; point += 1) {
      const angle = (point / 10) * Math.PI * 2 + Math.PI / 2
      const radius = point % 2 ? 0.045 : 0.11
      if (point === 0) starShape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
      else starShape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    const starGeometry = new THREE.ExtrudeGeometry(starShape, { depth: 0.03, bevelEnabled: false })
    const starMaterial = new THREE.MeshBasicMaterial({ color: '#ffd84a' })
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2
      const star = new THREE.Mesh(starGeometry, starMaterial)
      star.position.set(Math.sin(angle) * 0.42, 0, Math.cos(angle) * 0.42)
      star.rotation.y = angle
      this.stars.add(star)
    }
    this.stars.position.y = rig.height + 0.12
    this.stars.visible = false
    this.root.add(this.stars)
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
    // Trébuchement : un sursaut, puis la course reprend.
    if (run.stumbleAt !== this.stumbleSeen) {
      this.stumbleSeen = run.stumbleAt
      const hit = this.play('Hit_A', 0.06, true)
      if (hit) hit.timeScale = 0.9
      this.stumbleUntil = this.time + 0.32
    }
    if (this.time < this.stumbleUntil) return
    const run_ = this.play(run.speed > MAX_SPEED * 0.75 ? 'Running_B' : 'Running_A', 0.25)
    if (run_) run_.timeScale = 0.85 + (run.speed / MAX_SPEED) * 0.75
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    this.time += dt
    // Un VRM n'a qu'une instance par usage : on la reprend si une autre partie l'a empruntée.
    if (this.model.parent !== this.root) this.root.add(this.model)
    this.animate(run)
    this.mixer.update(dt)
    this.life?.update(dt, {
      strength: this.preview ? 0 : run.over ? 0 : Math.min(1, run.speed / MAX_SPEED + 0.35),
      windward: BACKWARD,
      mood: run.over ? 'hurt' : run.t - run.stumbleAt < 0.9 ? 'stunned' : this.currentName === 'Cheer' ? 'happy' : null,
    })
    if (this.preview) {
      this.root.rotation.y = Math.sin(this.time * 0.5) * 0.45
      return
    }

    // Changement de voie : le corps pivote et s'incline selon sa vitesse latérale (douce).
    const smooth = 1 - Math.exp(-dt * 10)
    this.yaw = damp(this.yaw, Math.max(-0.4, Math.min(0.4, -run.vx * 0.022)), smooth)
    this.roll = damp(this.roll, Math.max(-0.26, Math.min(0.26, -run.vx * 0.016)), smooth)
    // Sonné : il vacille.
    const stunned = isStunned(run) && !run.over
    const wobble = stunned ? Math.sin(run.t * 9) * 0.07 * Math.min(1, (run.stunnedUntil - run.t) / 0.6) : 0
    this.root.position.set(run.x, run.y, 0)
    this.root.rotation.set(0, this.yaw, this.roll + wobble)
    this.stars.visible = stunned
    if (stunned) {
      this.stars.rotation.y = run.t * 5
      this.stars.children.forEach((star, index) => {
        star.position.y = Math.sin(run.t * 6 + index * 1.7) * 0.06
        star.rotation.z = run.t * 4
      })
    }

    this.shadow.position.set(run.x, 0.02, 0)
    const shrink = Math.max(0.3, 1 - run.y * 0.15)
    this.shadow.scale.set(shrink, shrink, 1)
    this.cloud.visible = isFlying(run)
    if (this.cloud.visible) this.cloud.rotation.y += dt * 0.8
    // Clignote après un choc ou une résurrection.
    this.root.visible = run.over || run.invulnerableUntil <= run.t || isShielded(run) || Math.floor(run.t * 12) % 2 === 0
    this.talismans.update(Math.max(0, run.shieldUntil - run.t), run.t, dt)
  }

  dispose(): void {
    // Sans `uncacheRoot` : React (mode strict) peut remonter la même partie après ce nettoyage.
    this.mixer.stopAllAction()
    this.talismans.dispose()
    this.current = null
    this.currentName = null
    // Les maillages du modèle sont partagés avec l'original chargé : seuls nos ajouts sont libérés.
    for (const owned of [this.cloud, this.shadow, this.stars]) {
      owned.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          for (const material of [node.material].flat()) material.dispose()
        }
      })
    }
  }
}
