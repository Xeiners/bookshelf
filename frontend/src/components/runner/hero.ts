import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { MAX_SPEED, START_SPEED } from '../../lib/runner/constants'
import { isFlying, isShielded, isSliding, type RunState } from '../../lib/runner/engine'
import type { ScenePart } from './parts'
import { outlineMaterial, toonMaterial } from './toon'

/*
 * Le coureur : un héros d'anime articulé (hanches, genoux, épaules, coudes), cheveux en
 * mèches pointues balayées par le vent, bandeau et écharpe rouges qui flottent derrière
 * lui, sac-livre sur le dos. Chaque articulation vise une pose (course, saut, glissade,
 * vol, chute) et l'atteint en douceur (amortissement exponentiel) : aucune transition
 * sèche, même quand on enchaîne saut, glissade et changement de voie.
 */

/** Une articulation : un pivot, et le membre (capsule) qui pend dessous. */
function limb(material: THREE.Material, ink: THREE.Material, radius: number, length: number): { pivot: THREE.Group; end: THREE.Group } {
  const pivot = new THREE.Group()
  const geometry = new THREE.CapsuleGeometry(radius, length, 4, 12)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.add(new THREE.Mesh(geometry, ink))
  mesh.position.y = -(length / 2 + radius * 0.6)
  pivot.add(mesh)
  // Bout du membre : là où s'accroche l'articulation suivante.
  const end = new THREE.Group()
  end.position.y = -(length + radius * 1.2)
  pivot.add(end)
  return { pivot, end }
}

const damp = (current: number, target: number, rate: number) => current + (target - current) * rate

/** Pose visée par chaque articulation (radians, mètres). */
interface Pose {
  hipL: number
  hipR: number
  kneeL: number
  kneeR: number
  shoulderL: number
  shoulderR: number
  armOutL: number
  armOutR: number
  elbowL: number
  elbowR: number
  lean: number
  pelvisY: number
  head: number
}

const POSE_KEYS: (keyof Pose)[] = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shoulderL', 'shoulderR', 'armOutL', 'armOutR', 'elbowL', 'elbowR', 'lean', 'pelvisY', 'head']

export class HeroPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly root = new THREE.Group()
  private readonly pelvis = new THREE.Group()
  private readonly spine = new THREE.Group()
  private readonly neck = new THREE.Group()
  private readonly hips: [THREE.Group, THREE.Group]
  private readonly knees: [THREE.Group, THREE.Group]
  private readonly shoulders: [THREE.Group, THREE.Group]
  private readonly elbows: [THREE.Group, THREE.Group]
  private readonly scarf: THREE.Group[] = []
  private readonly tails: THREE.Group[] = []
  private readonly cloud = new THREE.Group()
  private readonly shield: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly pose: Pose = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shoulderL: 0, shoulderR: 0, armOutL: 0, armOutR: 0, elbowL: 0, elbowR: 0, lean: 0, pelvisY: 0.92, head: 0 }
  private readonly target: Pose = { ...this.pose }
  private phase = 0
  private yaw = 0
  private roll = 0
  private lastX = 0
  private wasGrounded = true
  /** Écrasement à l'atterrissage, de 1 à 0. */
  private squash = 0
  private time = 0

  constructor() {
    const ink = outlineMaterial(0.022)
    const skin = toonMaterial('#ffe0c4')
    const jacket = toonMaterial('#ff8a3c')
    const jacketDark = toonMaterial('#e5652a')
    const pants = toonMaterial('#2b2d6e')
    const hair = toonMaterial('#2a2f7a', '#3b44b8', 0.12)
    const red = toonMaterial('#ff3f5e')
    const white = toonMaterial('#fbf7ff')
    const outlined = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.add(new THREE.Mesh(geometry, ink))
      return mesh
    }

    this.root.add(this.pelvis)
    this.pelvis.position.y = 0.92
    // Bassin et ceinture.
    const hipsMesh = outlined(new THREE.CapsuleGeometry(0.17, 0.16, 4, 12), pants)
    hipsMesh.rotation.z = Math.PI / 2
    this.pelvis.add(hipsMesh)

    // Jambes : cuisse, genou, tibia, chaussure arrondie.
    const legs = [-1, 1].map((side) => {
      const thigh = limb(pants, ink, 0.1, 0.3)
      thigh.pivot.position.set(side * 0.13, -0.02, 0)
      const shin = limb(pants, ink, 0.088, 0.3)
      thigh.end.add(shin.pivot)
      const shoe = outlined(new RoundedBoxGeometry(0.2, 0.13, 0.34, 3, 0.05), white)
      shoe.position.set(0, -0.02, -0.06)
      const sole = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.04, 0.35, 2, 0.015), toonMaterial('#cfc8e8'))
      sole.position.y = -0.06
      shoe.add(sole)
      shin.end.add(shoe)
      this.pelvis.add(thigh.pivot)
      return [thigh.pivot, shin.pivot] as const
    })
    this.hips = [legs[0]![0], legs[1]![0]]
    this.knees = [legs[0]![1], legs[1]![1]]

    // Buste penché, veste à col blanc.
    this.spine.position.y = 0.06
    this.pelvis.add(this.spine)
    const torso = outlined(new THREE.CapsuleGeometry(0.22, 0.28, 6, 14), jacket)
    torso.scale.set(1.15, 1, 0.85)
    torso.position.y = 0.3
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.08, 0.4, 2, 0.03), jacketDark)
    stripe.position.y = 0.18
    const collar = outlined(new THREE.TorusGeometry(0.15, 0.05, 8, 18), white)
    collar.rotation.x = Math.PI / 2
    collar.position.y = 0.58
    this.spine.add(torso, stripe, collar)

    // Sac-livre : couverture violette, tranche de pages crème, bande dorée.
    const book = outlined(new RoundedBoxGeometry(0.42, 0.52, 0.15, 3, 0.04), toonMaterial('#7c5cff'))
    book.position.set(0, 0.34, 0.25)
    const pages = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.46, 0.12, 2, 0.02), toonMaterial('#fff4dc'))
    pages.position.set(0.2, 0, 0)
    const band = new THREE.Mesh(new RoundedBoxGeometry(0.43, 0.06, 0.155, 2, 0.02), toonMaterial('#ffd35c', '#ffb000', 0.3))
    band.position.y = 0.12
    book.add(pages, band)
    this.spine.add(book)

    // Bras : épaule, coude, avant-bras, main.
    const arms = [-1, 1].map((side) => {
      const upper = limb(jacket, ink, 0.075, 0.2)
      upper.pivot.position.set(side * 0.31, 0.5, 0)
      const fore = limb(skin, ink, 0.065, 0.18)
      upper.end.add(fore.pivot)
      const hand = outlined(new THREE.SphereGeometry(0.075, 12, 10), skin)
      fore.end.add(hand)
      this.spine.add(upper.pivot)
      return [upper.pivot, fore.pivot] as const
    })
    this.shoulders = [arms[0]![0], arms[1]![0]]
    this.elbows = [arms[0]![1], arms[1]![1]]

    // Tête : visage, casque de cheveux, mèches pointues balayées vers l'arrière.
    this.neck.position.y = 0.66
    this.spine.add(this.neck)
    const head = outlined(new THREE.SphereGeometry(0.27, 20, 16), skin)
    head.position.y = 0.2
    this.neck.add(head)
    const cap = outlined(new THREE.SphereGeometry(0.29, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair)
    cap.position.set(0, 0.24, 0.03)
    cap.rotation.x = 0.25
    this.neck.add(cap)
    const spikeGeometry = new THREE.ConeGeometry(0.1, 0.42, 8)
    const spikes: [number, number, number, number, number, number][] = [
      // x, y, z, rotation x (vers l'arrière), rotation z (vers le côté), échelle
      [0, 0.46, 0.02, 0.9, 0, 1.15],
      [-0.15, 0.42, 0.04, 0.9, 0.55, 1],
      [0.15, 0.42, 0.04, 0.9, -0.55, 1],
      [0, 0.36, 0.2, 1.5, 0, 1.1],
      [-0.17, 0.32, 0.17, 1.4, 0.6, 0.95],
      [0.17, 0.32, 0.17, 1.4, -0.6, 0.95],
      [-0.25, 0.22, 0.08, 1.1, 1.1, 0.85],
      [0.25, 0.22, 0.08, 1.1, -1.1, 0.85],
      [0, 0.18, 0.26, 2, 0, 0.9],
      [-0.12, 0.1, 0.24, 2.2, 0.4, 0.75],
      [0.12, 0.1, 0.24, 2.2, -0.4, 0.75],
      // Mèches du front.
      [-0.1, 0.36, -0.2, -0.5, 0.3, 0.6],
      [0.08, 0.37, -0.21, -0.5, -0.2, 0.65],
    ]
    for (const [x, y, z, rx, rz, scale] of spikes) {
      const spike = outlined(spikeGeometry, hair)
      spike.position.set(x, y, z)
      spike.rotation.set(rx, 0, rz)
      spike.scale.setScalar(scale)
      this.neck.add(spike)
    }
    // Bandeau rouge et ses deux pans qui flottent.
    const headband = outlined(new THREE.TorusGeometry(0.28, 0.035, 8, 28), red)
    headband.rotation.x = Math.PI / 2 - 0.2
    headband.position.y = 0.27
    this.neck.add(headband)
    for (const side of [-1, 1]) {
      const tail = new THREE.Group()
      tail.position.set(side * 0.06, 0.25, 0.27)
      const ribbon = outlined(new RoundedBoxGeometry(0.07, 0.025, 0.36, 2, 0.01), red)
      ribbon.position.z = 0.18
      tail.add(ribbon)
      this.neck.add(tail)
      this.tails.push(tail)
    }

    // Écharpe : une chaîne de segments qui ondule derrière le coureur.
    let anchor: THREE.Object3D = this.neck
    for (let index = 0; index < 6; index += 1) {
      const segment = new THREE.Group()
      if (index === 0) segment.position.set(0.05, -0.02, 0.16)
      else segment.position.z = 0.16
      const cloth = outlined(new RoundedBoxGeometry(0.17 - index * 0.012, 0.03, 0.17, 2, 0.01), red)
      cloth.position.z = 0.08
      segment.add(cloth)
      anchor.add(segment)
      this.scarf.push(segment)
      anchor = segment
    }

    // Nuage magique, bulle du bouclier, ombre au sol.
    const puffMaterial = toonMaterial('#ffffff', '#d8ecff', 0.25)
    for (let bump = 0; bump < 6; bump += 1) {
      const puff = outlined(new THREE.SphereGeometry(0.34 - (bump % 2) * 0.06, 14, 12), puffMaterial)
      const angle = (bump / 6) * Math.PI * 2
      puff.position.set(Math.cos(angle) * 0.36, (bump % 2) * 0.08, Math.sin(angle) * 0.3)
      this.cloud.add(puff)
    }
    this.cloud.position.y = 0.02
    this.cloud.visible = false
    this.root.add(this.cloud)
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 28, 20),
      new THREE.MeshBasicMaterial({ color: '#3fd0ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.shield.position.y = 0.95
    this.shield.visible = false
    this.root.add(this.shield)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: '#0b0420', transparent: true, opacity: 0.4, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.object.add(this.root, this.shadow)
  }

  /** La pose visée, selon ce que fait le coureur. */
  private aim(run: RunState): void {
    const target = this.target
    const pace = (run.speed - START_SPEED) / (MAX_SPEED - START_SPEED)
    const swing = Math.sin(this.phase)
    const flying = isFlying(run)
    if (run.over) {
      // Trébuche : penché en avant, bras tendus.
      Object.assign(target, { hipL: 0.6, hipR: -0.2, kneeL: -0.4, kneeR: -0.8, shoulderL: 2.2, shoulderR: 2.0, armOutL: -0.3, armOutR: 0.3, elbowL: 0.3, elbowR: 0.3, lean: -0.9, pelvisY: 0.75, head: 0.3 })
    } else if (isSliding(run)) {
      // Glissade de baseball : jambes devant, buste en arrière, un bras au sol.
      Object.assign(target, { hipL: 1.45, hipR: 1.2, kneeL: -0.2, kneeR: -0.7, shoulderL: -0.7, shoulderR: 1.1, armOutL: -0.5, armOutR: 0.3, elbowL: 0.2, elbowR: 0.9, lean: 1.05, pelvisY: 0.42, head: -0.5 })
    } else if (flying) {
      // Debout sur le nuage, en surf : jambes fléchies, bras ouverts.
      const sway = Math.sin(this.time * 3) * 0.08
      Object.assign(target, { hipL: 0.35, hipR: -0.2, kneeL: -0.6, kneeR: -0.4, shoulderL: 0.4, shoulderR: 0.4, armOutL: -1.1 + sway, armOutR: 1.1 + sway, elbowL: 0.4, elbowR: 0.4, lean: -0.25, pelvisY: 0.82, head: 0.1 })
    } else if (!run.grounded) {
      // Saut : genoux groupés en montant, jambes qui se tendent en redescendant.
      const rising = run.vy > 0
      Object.assign(target, {
        hipL: rising ? 1.3 : 0.7,
        hipR: rising ? 0.2 : -0.35,
        kneeL: rising ? -1.6 : -0.7,
        kneeR: rising ? -1.3 : -0.4,
        shoulderL: rising ? 2.5 : 1.5,
        shoulderR: rising ? -0.8 : 1.2,
        armOutL: -0.25,
        armOutR: 0.25,
        elbowL: 0.5,
        elbowR: 1.0,
        lean: rising ? -0.25 : -0.05,
        pelvisY: 0.92,
        head: rising ? 0.15 : -0.1,
      })
    } else {
      // Course : foulée ample, genoux qui remontent, bras pliés en opposition.
      const stride = 0.85 + pace * 0.15
      const kneeL = 0.2 + 1.25 * Math.max(0, Math.sin(this.phase - 1.2))
      const kneeR = 0.2 + 1.25 * Math.max(0, Math.sin(this.phase + Math.PI - 1.2))
      Object.assign(target, {
        hipL: swing * stride,
        hipR: -swing * stride,
        kneeL: -kneeL,
        kneeR: -kneeR,
        shoulderL: -swing * 0.9,
        shoulderR: swing * 0.9,
        armOutL: -0.12,
        armOutR: 0.12,
        elbowL: 1.35 + Math.max(0, -swing) * 0.3,
        elbowR: 1.35 + Math.max(0, swing) * 0.3,
        lean: -(0.18 + pace * 0.14),
        pelvisY: 0.9 + Math.abs(Math.cos(this.phase)) * 0.07,
        head: 0.12 + pace * 0.08,
      })
    }
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    this.time += dt
    if (!run.over && run.grounded && !isFlying(run)) this.phase += dt * Math.PI * 2 * (1.35 + run.speed * 0.05)
    this.aim(run)

    // Amortissement : rapide pour la foulée (elle reste nette), plus doux pour les changements de pose.
    const rate = 1 - Math.exp(-dt * (run.grounded && !isSliding(run) ? 22 : 13))
    for (const key of POSE_KEYS) this.pose[key] = damp(this.pose[key], this.target[key], rate)
    const pose = this.pose

    // Atterrissage : un léger écrasement, qui se résorbe.
    if (run.grounded && !this.wasGrounded) this.squash = 1
    this.wasGrounded = run.grounded
    this.squash = Math.max(0, this.squash - dt * 5)

    // Changement de voie : le corps tourne et s'incline vers où il va.
    const vx = (run.x - this.lastX) / Math.max(dt, 1e-3)
    this.lastX = run.x
    const smooth = 1 - Math.exp(-dt * 12)
    this.yaw = damp(this.yaw, Math.max(-0.5, Math.min(0.5, -vx * 0.03)), smooth)
    this.roll = damp(this.roll, Math.max(-0.35, Math.min(0.35, -vx * 0.022)), smooth)

    this.root.position.set(run.x, run.y, 0)
    this.root.rotation.set(0, this.yaw, this.roll)
    this.pelvis.position.y = pose.pelvisY - this.squash * 0.12
    this.pelvis.scale.set(1 + this.squash * 0.06, 1 - this.squash * 0.1, 1 + this.squash * 0.06)
    this.spine.rotation.x = pose.lean
    this.neck.rotation.x = pose.head
    this.hips[0].rotation.x = pose.hipL
    this.hips[1].rotation.x = pose.hipR
    this.knees[0].rotation.x = pose.kneeL
    this.knees[1].rotation.x = pose.kneeR
    this.shoulders[0].rotation.set(pose.shoulderL, 0, pose.armOutL)
    this.shoulders[1].rotation.set(pose.shoulderR, 0, pose.armOutR)
    this.elbows[0].rotation.x = pose.elbowL
    this.elbows[1].rotation.x = pose.elbowR

    // Écharpe et bandeau : ils ondulent, d'autant plus vite que l'on court vite.
    const wind = run.over ? 0.3 : 0.6 + (run.speed / MAX_SPEED) * 0.8
    this.scarf.forEach((segment, index) => {
      // L'écharpe retombe derrière les épaules puis flotte, la vague courant du cou vers le bout.
      segment.rotation.x = (index === 0 ? 0.55 : 0.12 - wind * 0.08) + Math.sin(this.time * 10 * wind - index * 0.9) * 0.2 * wind
      segment.rotation.y = Math.sin(this.time * 6 - index * 0.7) * 0.1 * wind - this.yaw * 0.4
    })
    this.tails.forEach((tail, index) => {
      tail.rotation.x = -0.2 + Math.sin(this.time * 13 * wind + index * 1.3) * 0.25 * wind
      tail.rotation.y = (index ? 1 : -1) * (0.25 + Math.sin(this.time * 9 + index) * 0.1)
    })

    this.shadow.position.set(run.x, 0.02, 0)
    const shrink = Math.max(0.3, 1 - run.y * 0.15)
    this.shadow.scale.set(shrink * (1 + this.squash * 0.15), shrink, 1)
    this.cloud.visible = isFlying(run)
    if (this.cloud.visible) this.cloud.rotation.y += dt * 0.8
    // Clignote après un choc ou une résurrection.
    this.root.visible = run.over || run.invulnerableUntil <= run.t || isShielded(run) || Math.floor(run.t * 12) % 2 === 0
    this.shield.visible = isShielded(run)
    if (this.shield.visible) {
      this.shield.scale.setScalar(1 + Math.sin(run.t * 8) * 0.04)
      ;(this.shield.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(run.t * 6) * 0.06
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        for (const material of [node.material].flat()) material.dispose()
      }
    })
  }
}
