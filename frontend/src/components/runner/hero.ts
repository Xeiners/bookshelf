import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { MAX_SPEED, START_SPEED } from '../../lib/runner/constants'
import { isFlying, isShielded, isSliding, type RunState } from '../../lib/runner/engine'
import { HERO_LOOKS, type HeroLook, type HeroLookId } from './looks'
import type { ScenePart } from './parts'
import { outlineMaterial, toonMaterial } from './toon'

/*
 * Le coureur : un petit ninja « chibi » (grosse tête, corps menu) — cheveux en mèches
 * pointues, grands yeux, bandeau frontal à plaque de métal dont les pans flottent, veste
 * à empiècements sombres et col de fourrure, sandales. Ses couleurs viennent d'une
 * apparence (`looks.ts`), pour les personnalisations à venir.
 *
 * Chaque articulation vise une pose (course, saut, glissade, vol, chute, attente) et
 * l'atteint en douceur (amortissement exponentiel) : aucune transition sèche.
 */

const damp = (current: number, target: number, rate: number) => current + (target - current) * rate
const UP = new THREE.Vector3(0, 1, 0)

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

/** Hauteur du bassin au repos. */
const PELVIS = 0.56

export interface HeroOptions {
  look?: HeroLookId
  /** Aperçu (accueil) : le héros attend, de face, et se balance doucement. */
  preview?: boolean
}

export class HeroPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly root = new THREE.Group()
  private readonly pelvis = new THREE.Group()
  private readonly spine = new THREE.Group()
  private readonly neck = new THREE.Group()
  private readonly hips: THREE.Group[] = []
  private readonly knees: THREE.Group[] = []
  private readonly shoulders: THREE.Group[] = []
  private readonly elbows: THREE.Group[] = []
  private readonly tails: THREE.Group[] = []
  private readonly cloud = new THREE.Group()
  private readonly shield: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly ink = outlineMaterial(0.018)
  private readonly pose: Pose = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shoulderL: 0, shoulderR: 0, armOutL: 0, armOutR: 0, elbowL: 0, elbowR: 0, lean: 0, pelvisY: PELVIS, head: 0 }
  private readonly target: Pose = { ...this.pose }
  private readonly preview: boolean
  private phase = 0
  private yaw = 0
  private roll = 0
  private lastX = 0
  private wasGrounded = true
  private squash = 0
  private time = 0

  constructor(options: HeroOptions = {}) {
    const look: HeroLook = HERO_LOOKS[options.look ?? 'ninja']
    this.preview = options.preview ?? false
    const m = {
      skin: toonMaterial(look.skin),
      hair: toonMaterial(look.hair, look.hairShine, 0.22),
      jacket: toonMaterial(look.jacket),
      dark: toonMaterial(look.jacketDark),
      collar: toonMaterial(look.collar, '#ffffff', 0.15),
      pants: toonMaterial(look.pants),
      band: toonMaterial(look.pantsBand),
      headband: toonMaterial(look.headband),
      plate: toonMaterial(look.plate, '#ffffff', 0.25),
      sandals: toonMaterial(look.sandals),
      emblem: toonMaterial(look.emblem),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      iris: new THREE.MeshBasicMaterial({ color: look.eyes }),
      black: new THREE.MeshBasicMaterial({ color: '#1a1328' }),
      blush: new THREE.MeshBasicMaterial({ color: '#ff9fb2', transparent: true, opacity: 0.55, depthWrite: false }),
    }

    this.root.add(this.pelvis)
    this.pelvis.position.y = PELVIS
    this.pelvis.add(this.outlined(new THREE.CapsuleGeometry(0.14, 0.12, 4, 12), m.pants, (mesh) => (mesh.rotation.z = Math.PI / 2)))

    // Jambes courtes : cuisse, tibia avec bande claire, sandale et pied.
    for (const side of [-1, 1]) {
      const thigh = this.limb(m.pants, 0.095, 0.12)
      thigh.pivot.position.set(side * 0.1, -0.02, 0)
      const shin = this.limb(m.pants, 0.088, 0.12)
      thigh.end.add(shin.pivot)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 14), m.band)
      band.position.y = -0.18
      shin.pivot.add(band)
      const sandal = this.outlined(new RoundedBoxGeometry(0.17, 0.05, 0.27, 2, 0.02), m.sandals)
      sandal.position.set(0, -0.03, -0.05)
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.07, 0.2, 2, 0.03), m.skin)
      foot.position.set(0, 0.05, -0.03)
      sandal.add(foot)
      shin.end.add(sandal)
      if (side === 1) {
        // Étui sur la cuisse droite.
        const pouch = this.outlined(new RoundedBoxGeometry(0.08, 0.13, 0.12, 2, 0.02), m.dark)
        pouch.position.set(0.1, -0.1, 0)
        thigh.pivot.add(pouch)
      }
      this.pelvis.add(thigh.pivot)
      this.hips.push(thigh.pivot)
      this.knees.push(shin.pivot)
    }

    // Buste : veste, empiècement sombre, col de fourrure, fermeture, emblème au dos.
    this.spine.position.y = 0.05
    this.pelvis.add(this.spine)
    this.spine.add(
      this.outlined(new THREE.CapsuleGeometry(0.19, 0.16, 6, 14), m.jacket, (mesh) => {
        mesh.scale.set(1.12, 1, 0.92)
        mesh.position.y = 0.22
      }),
    )
    this.spine.add(this.outlined(new RoundedBoxGeometry(0.44, 0.15, 0.36, 3, 0.07), m.dark, (mesh) => (mesh.position.y = 0.37)))
    this.spine.add(
      this.outlined(new THREE.TorusGeometry(0.16, 0.075, 10, 22), m.collar, (mesh) => {
        mesh.rotation.x = Math.PI / 2
        mesh.position.y = 0.46
      }),
    )
    const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), m.collar)
    zipper.position.set(0, 0.24, -0.19)
    const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 8, 20, Math.PI * 1.7), m.emblem)
    emblem.position.set(0, 0.24, 0.185)
    this.spine.add(zipper, emblem)

    // Bras : épaule sombre, manche, avant-bras, main.
    for (const side of [-1, 1]) {
      const upper = this.limb(m.dark, 0.07, 0.09)
      upper.pivot.position.set(side * 0.25, 0.38, 0)
      const fore = this.limb(m.jacket, 0.064, 0.08)
      upper.end.add(fore.pivot)
      fore.end.add(this.outlined(new THREE.SphereGeometry(0.07, 12, 10), m.skin))
      this.spine.add(upper.pivot)
      this.shoulders.push(upper.pivot)
      this.elbows.push(fore.pivot)
    }

    // Grosse tête : visage, grands yeux, joues, puis la crinière.
    this.neck.position.y = 0.5
    this.spine.add(this.neck)
    const head = new THREE.Group()
    head.position.y = 0.36
    this.neck.add(head)
    head.add(this.outlined(new THREE.SphereGeometry(0.38, 26, 20), m.skin, (mesh) => mesh.scale.set(1.04, 0.98, 1)))
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), m.white)
      eye.scale.set(0.85, 1.15, 0.45)
      eye.position.set(side * 0.14, -0.03, -0.345)
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), m.iris)
      iris.scale.set(1, 1.15, 0.4)
      iris.position.set(side * 0.135, -0.04, -0.37)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), m.black)
      pupil.scale.set(1, 1.2, 0.4)
      pupil.position.set(side * 0.133, -0.045, -0.385)
      const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), m.white)
      sparkle.position.set(side * 0.115, -0.015, -0.392)
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), m.blush)
      cheek.position.set(side * 0.22, -0.13, -0.3)
      cheek.rotation.y = side * 0.55 + Math.PI
      head.add(eye, iris, pupil, sparkle, cheek)
      // Trois marques fines sur chaque joue.
      for (let mark = 0; mark < 3; mark += 1) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.01), m.black)
        line.position.set(side * 0.24, -0.08 - mark * 0.04, -0.29)
        line.rotation.set(0, side * 0.6, side * (0.1 - mark * 0.08))
        head.add(line)
      }
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), m.black)
    mouth.position.set(0, -0.19, -0.345)
    head.add(mouth)

    // Calotte de cheveux, puis les mèches pointues tout autour (sauf sur le visage).
    head.add(
      this.outlined(new THREE.SphereGeometry(0.4, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair, (mesh) => {
        mesh.position.set(0, 0.05, 0.03)
        mesh.rotation.x = 0.35
      }),
    )
    // Arrière du crâne : la chevelure descend jusqu'à la nuque (vue de dos, plus de peau).
    head.add(
      this.outlined(new THREE.SphereGeometry(0.405, 24, 18, 0, Math.PI, 0, Math.PI * 0.82), m.hair, (mesh) => {
        mesh.position.set(0, 0.01, 0.015)
      }),
    )
    const spike = new THREE.ConeGeometry(0.13, 1, 7)
    // [azimut (0 : la nuque), élévation, longueur], en degrés et en mètres.
    const spikes: [number, number, number][] = []
    for (const azimuth of [0, 60, 120, 180, 240, 300]) spikes.push([azimuth, 62, 0.5])
    for (const azimuth of [0, 40, 80, -40, -80, 130, -130]) spikes.push([azimuth, 30, 0.5])
    for (const azimuth of [0, 50, -50, 100, -100]) spikes.push([azimuth, 0, 0.42])
    for (const azimuth of [20, -20]) spikes.push([azimuth, -30, 0.32])
    spikes.push([0, 88, 0.52])
    for (const [azimuth, elevation, length] of spikes) {
      const a = THREE.MathUtils.degToRad(azimuth)
      const e = THREE.MathUtils.degToRad(elevation)
      const direction = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
      // Les mèches se relèvent un peu, comme coiffées par le vent.
      direction.y += 0.25
      direction.normalize()
      head.add(
        this.outlined(spike, m.hair, (mesh) => {
          mesh.quaternion.setFromUnitVectors(UP, direction)
          mesh.scale.set(1, length, 1)
          mesh.position.copy(direction).multiplyScalar(0.3 + length * 0.42)
          mesh.position.y += 0.06
        }),
      )
    }
    // Mèches du front, qui retombent sur le bandeau.
    for (const [x, tilt] of [
      [-0.16, 0.5],
      [0, 0],
      [0.16, -0.5],
    ] as const) {
      head.add(
        this.outlined(spike, m.hair, (mesh) => {
          mesh.scale.set(0.8, 0.28, 0.8)
          mesh.position.set(x, 0.27, -0.33)
          mesh.rotation.set(Math.PI - 0.5, 0, tilt)
        }),
      )
    }

    // Bandeau frontal : tissu sombre, plaque de métal à spirale, nœud et pans dans le dos.
    head.add(
      this.outlined(new THREE.TorusGeometry(0.418, 0.045, 10, 40), m.headband, (mesh) => {
        mesh.rotation.x = Math.PI / 2 - 0.12
        mesh.position.y = 0.13
      }),
    )
    const plate = this.outlined(new RoundedBoxGeometry(0.34, 0.15, 0.035, 2, 0.02), m.plate)
    plate.position.set(0, 0.16, -0.425)
    plate.rotation.x = -0.12
    const spiral = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI * 1.6), m.black)
    spiral.position.z = -0.02
    plate.add(spiral)
    head.add(plate)
    const knot = this.outlined(new THREE.SphereGeometry(0.05, 10, 8), m.headband)
    knot.position.set(0, 0.11, 0.43)
    head.add(knot)
    for (const side of [-1, 1]) {
      const tail = new THREE.Group()
      tail.position.set(side * 0.03, 0.1, 0.44)
      const ribbon = this.outlined(new RoundedBoxGeometry(0.07, 0.02, 0.36, 2, 0.008), m.headband)
      ribbon.position.z = 0.18
      tail.add(ribbon)
      head.add(tail)
      this.tails.push(tail)
    }

    // Nuage magique, bulle du bouclier, ombre au sol.
    const puff = toonMaterial('#ffffff', '#ffe0ee', 0.25)
    for (let bump = 0; bump < 6; bump += 1) {
      const angle = (bump / 6) * Math.PI * 2
      this.cloud.add(this.outlined(new THREE.SphereGeometry(0.32 - (bump % 2) * 0.06, 14, 12), puff, (mesh) => mesh.position.set(Math.cos(angle) * 0.34, (bump % 2) * 0.07, Math.sin(angle) * 0.28)))
    }
    this.cloud.visible = false
    this.root.add(this.cloud)
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 28, 20),
      new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.shield.position.y = 1
    this.shield.visible = false
    this.root.add(this.shield)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: '#5a2f55', transparent: true, opacity: 0.35, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.object.add(this.root, this.shadow)
  }

  /** Un maillage avec son contour d'encre ; `setup` le place. */
  private outlined(geometry: THREE.BufferGeometry, material: THREE.Material, setup?: (mesh: THREE.Mesh) => void): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.add(new THREE.Mesh(geometry, this.ink))
    setup?.(mesh)
    return mesh
  }

  /** Une articulation : un pivot, le membre (capsule) qui pend dessous, et son extrémité. */
  private limb(material: THREE.Material, radius: number, length: number): { pivot: THREE.Group; end: THREE.Group } {
    const pivot = new THREE.Group()
    pivot.add(this.outlined(new THREE.CapsuleGeometry(radius, length, 4, 12), material, (mesh) => (mesh.position.y = -(length / 2 + radius * 0.6))))
    const end = new THREE.Group()
    end.position.y = -(length + radius * 1.2)
    pivot.add(end)
    return { pivot, end }
  }

  /** La pose visée, selon ce que fait le coureur. */
  private aim(run: RunState): void {
    const target = this.target
    const pace = (run.speed - START_SPEED) / (MAX_SPEED - START_SPEED)
    const swing = Math.sin(this.phase)
    if (this.preview) {
      // Attente : il respire, se dandine, salue de temps en temps.
      const breath = Math.sin(this.time * 2.2)
      const wave = Math.max(0, Math.sin(this.time * 0.7)) ** 6
      Object.assign(target, {
        hipL: 0.05,
        hipR: -0.05,
        kneeL: -0.1,
        kneeR: -0.1,
        shoulderL: 0.15,
        shoulderR: 0.2 + wave * 2.6,
        armOutL: -0.3,
        armOutR: 0.3 + wave * 0.5 + Math.sin(this.time * 9) * 0.25 * wave,
        elbowL: 0.3,
        elbowR: 0.3 + wave * 0.8,
        lean: 0.02 + breath * 0.02,
        pelvisY: PELVIS + breath * 0.012,
        head: Math.sin(this.time * 0.9) * 0.08,
      })
    } else if (run.over) {
      Object.assign(target, { hipL: 0.6, hipR: -0.2, kneeL: -0.4, kneeR: -0.8, shoulderL: 2.2, shoulderR: 2.0, armOutL: -0.3, armOutR: 0.3, elbowL: 0.3, elbowR: 0.3, lean: -0.8, pelvisY: PELVIS - 0.12, head: 0.3 })
    } else if (isSliding(run)) {
      Object.assign(target, { hipL: 1.45, hipR: 1.2, kneeL: -0.2, kneeR: -0.7, shoulderL: -0.7, shoulderR: 1.1, armOutL: -0.5, armOutR: 0.3, elbowL: 0.2, elbowR: 0.9, lean: 1.0, pelvisY: 0.24, head: -0.45 })
    } else if (isFlying(run)) {
      const sway = Math.sin(this.time * 3) * 0.08
      Object.assign(target, { hipL: 0.35, hipR: -0.2, kneeL: -0.6, kneeR: -0.4, shoulderL: 0.4, shoulderR: 0.4, armOutL: -1.1 + sway, armOutR: 1.1 + sway, elbowL: 0.4, elbowR: 0.4, lean: -0.2, pelvisY: PELVIS - 0.04, head: 0.1 })
    } else if (!run.grounded) {
      const rising = run.vy > 0
      Object.assign(target, {
        hipL: rising ? 1.4 : 0.7,
        hipR: rising ? 0.25 : -0.35,
        kneeL: rising ? -1.7 : -0.7,
        kneeR: rising ? -1.4 : -0.4,
        shoulderL: rising ? 2.6 : 1.5,
        shoulderR: rising ? -0.9 : 1.2,
        armOutL: -0.3,
        armOutR: 0.3,
        elbowL: 0.5,
        elbowR: 1.0,
        lean: rising ? -0.2 : -0.05,
        pelvisY: PELVIS,
        head: rising ? 0.12 : -0.1,
      })
    } else {
      // Course « ninja » : buste penché ; à pleine vitesse, les bras filent en arrière.
      const stride = 0.95 + pace * 0.15
      const kneeL = 0.2 + 1.3 * Math.max(0, Math.sin(this.phase - 1.2))
      const kneeR = 0.2 + 1.3 * Math.max(0, Math.sin(this.phase + Math.PI - 1.2))
      const sprint = pace > 0.55
      Object.assign(target, {
        hipL: swing * stride,
        hipR: -swing * stride,
        kneeL: -kneeL,
        kneeR: -kneeR,
        shoulderL: sprint ? -1.25 : -swing * 0.95,
        shoulderR: sprint ? -1.25 : swing * 0.95,
        armOutL: sprint ? -0.25 : -0.15,
        armOutR: sprint ? 0.25 : 0.15,
        elbowL: sprint ? 0.15 : 1.3 + Math.max(0, -swing) * 0.3,
        elbowR: sprint ? 0.15 : 1.3 + Math.max(0, swing) * 0.3,
        lean: -(0.22 + pace * 0.28),
        pelvisY: PELVIS - 0.02 + Math.abs(Math.cos(this.phase)) * 0.06,
        head: 0.16 + pace * 0.18,
      })
    }
  }

  update(run: RunState, _time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    this.time += dt
    if (!run.over && run.grounded && !isFlying(run) && !this.preview) this.phase += dt * Math.PI * 2 * (1.6 + run.speed * 0.055)
    this.aim(run)

    const rate = 1 - Math.exp(-dt * (this.preview ? 6 : run.grounded && !isSliding(run) ? 24 : 13))
    for (const key of POSE_KEYS) this.pose[key] = damp(this.pose[key], this.target[key], rate)
    const pose = this.pose

    if (run.grounded && !this.wasGrounded) this.squash = 1
    this.wasGrounded = run.grounded
    this.squash = Math.max(0, this.squash - dt * 5)

    if (this.preview) {
      this.root.position.set(0, 0, 0)
      this.root.rotation.set(0, Math.PI + Math.sin(this.time * 0.6) * 0.55, 0)
    } else {
      const vx = (run.x - this.lastX) / Math.max(dt, 1e-3)
      this.lastX = run.x
      const smooth = 1 - Math.exp(-dt * 12)
      this.yaw = damp(this.yaw, Math.max(-0.5, Math.min(0.5, -vx * 0.03)), smooth)
      this.roll = damp(this.roll, Math.max(-0.35, Math.min(0.35, -vx * 0.022)), smooth)
      this.root.position.set(run.x, run.y, 0)
      this.root.rotation.set(0, this.yaw, this.roll)
    }
    this.pelvis.position.y = pose.pelvisY - this.squash * 0.08
    this.pelvis.scale.set(1 + this.squash * 0.07, 1 - this.squash * 0.12, 1 + this.squash * 0.07)
    this.spine.rotation.x = pose.lean
    this.neck.rotation.x = pose.head
    this.hips[0]!.rotation.x = pose.hipL
    this.hips[1]!.rotation.x = pose.hipR
    this.knees[0]!.rotation.x = pose.kneeL
    this.knees[1]!.rotation.x = pose.kneeR
    this.shoulders[0]!.rotation.set(pose.shoulderL, 0, pose.armOutL)
    this.shoulders[1]!.rotation.set(pose.shoulderR, 0, pose.armOutR)
    this.elbows[0]!.rotation.x = pose.elbowL
    this.elbows[1]!.rotation.x = pose.elbowR

    // Pans du bandeau : ils flottent, d'autant plus vite que l'on court vite.
    const wind = this.preview ? 0.35 : run.over ? 0.3 : 0.7 + (run.speed / MAX_SPEED) * 0.8
    this.tails.forEach((tail, index) => {
      tail.rotation.x = (this.preview ? 0.9 : 0.45 - wind * 0.25) + Math.sin(this.time * 12 * wind + index * 1.3) * 0.28 * wind
      tail.rotation.y = (index ? 1 : -1) * (0.3 + Math.sin(this.time * 8 + index) * 0.12)
    })

    if (this.preview) {
      this.shadow.position.set(0, 0.02, 0)
      return
    }
    this.shadow.position.set(run.x, 0.02, 0)
    const shrink = Math.max(0.3, 1 - run.y * 0.15)
    this.shadow.scale.set(shrink * (1 + this.squash * 0.15), shrink, 1)
    this.cloud.visible = isFlying(run)
    if (this.cloud.visible) this.cloud.rotation.y += dt * 0.8
    this.root.visible = run.over || run.invulnerableUntil <= run.t || isShielded(run) || Math.floor(run.t * 12) % 2 === 0
    this.shield.visible = isShielded(run)
    if (this.shield.visible) {
      this.shield.scale.setScalar(1 + Math.sin(run.t * 8) * 0.04)
      ;(this.shield.material as THREE.MeshBasicMaterial).opacity = 0.15 + Math.sin(run.t * 6) * 0.05
    }
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        geometries.add(node.geometry)
        for (const material of [node.material].flat()) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
}
