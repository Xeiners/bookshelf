import * as THREE from 'three'
import { SHOT_RANGE } from '../../lib/runner/constants'
import { objectX, shotReady, type RunState } from '../../lib/runner/engine'
import { Batch } from './batch'
import { monsterOf } from './biomes'
import type { ScenePart } from './parts'
import { canvasTexture } from './toon'

/*
 * Le tir sur les monstres : un viseur tourne sur chaque monstre à portée quand le tir est
 * rechargé (on peut le toucher du doigt), et un rayon d'énergie part de la main du coureur
 * vers sa cible. `ShotAim` retrouve le monstre sous le doigt (projection à l'écran, avec
 * une bonne marge : un monstre lointain est petit).
 */

interface Target {
  id: number
  x: number
  y: number
  z: number
  ahead: number
  lane: number
}

const MAX_TARGETS = 24
const point = new THREE.Vector3()

/** Les monstres visés (remplis à chaque image par `ShotPart`) et la caméra qui les montre. */
export class ShotAim {
  readonly targets: Target[] = Array.from({ length: MAX_TARGETS }, () => ({ id: 0, x: 0, y: 0, z: 0, ahead: 0, lane: 0 }))
  count = 0
  private camera: THREE.Camera | null = null
  private element: HTMLElement | null = null

  attach(camera: THREE.Camera, element: HTMLElement): void {
    this.camera = camera
    this.element = element
  }

  /** Le monstre sous le doigt (coordonnées de la fenêtre), ou `null`. */
  pick(clientX: number, clientY: number): number | null {
    const camera = this.camera
    const element = this.element
    if (!camera || !element || this.count === 0) return null
    const rect = element.getBoundingClientRect()
    const radius = Math.max(56, rect.width * 0.14)
    let best: number | null = null
    let bestDistance = radius
    for (let index = 0; index < this.count; index += 1) {
      const target = this.targets[index]!
      point.set(target.x, target.y, target.z).project(camera)
      if (point.z > 1) continue
      const x = rect.left + ((point.x + 1) / 2) * rect.width
      const y = rect.top + ((1 - point.y) / 2) * rect.height
      const distance = Math.hypot(x - clientX, y - clientY)
      if (distance < bestDistance) {
        bestDistance = distance
        best = target.id
      }
    }
    return best
  }

  /** Visée automatique (bouton, clavier) : le plus proche dans sa voie, sinon le plus proche. */
  nearest(lane: number): number | null {
    let best: Target | null = null
    for (let index = 0; index < this.count; index += 1) {
      const target = this.targets[index]!
      const score = target.ahead + (target.lane === lane ? 0 : 1000)
      if (!best || score < best.ahead + (best.lane === lane ? 0 : 1000)) best = target
    }
    return best?.id ?? null
  }
}

/** Viseur : un anneau rose à quatre crans, cerné d'encre. */
function reticleTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (context) => {
    const ring = (color: string, width: number) => {
      context.strokeStyle = color
      context.lineWidth = width
      context.beginPath()
      context.arc(64, 64, 44, 0, Math.PI * 2)
      context.stroke()
      for (let tick = 0; tick < 4; tick += 1) {
        const angle = (tick * Math.PI) / 2
        context.beginPath()
        context.moveTo(64 + Math.cos(angle) * 30, 64 + Math.sin(angle) * 30)
        context.lineTo(64 + Math.cos(angle) * 60, 64 + Math.sin(angle) * 60)
        context.stroke()
      }
    }
    context.lineCap = 'round'
    ring('#170b2e', 16)
    ring('#ffffff', 8)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(64, 64, 6, 0, Math.PI * 2)
    context.fill()
  })
}

const BEAM_TIME = 0.32

export class ShotPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly reticle = new Batch(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }),
    MAX_TARGETS,
  )
  private readonly beam: THREE.Mesh
  private readonly core: THREE.Mesh
  private readonly flash: THREE.Mesh
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly aim: ShotAim

  constructor(aim: ShotAim) {
    this.aim = aim
    this.reticle.mesh.renderOrder = 12
    const glow = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })
    // Le rayon : un cœur blanc dans une gaine rose, et une petite étincelle à la main.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), glow('#ff4fd8', 0.75))
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), glow('#fff4fb', 1))
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glow('#ffd6f4', 0.9))
    for (const mesh of [this.beam, this.core, this.flash]) {
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 11
    }
    this.object.add(this.reticle.group, this.beam, this.core, this.flash)
  }

  update(run: RunState, time: number): void {
    // Les monstres à portée : cibles du doigt, et viseurs quand le tir est prêt.
    const aim = this.aim
    aim.count = 0
    const ready = shotReady(run) && !run.over
    this.reticle.begin()
    for (const object of run.objects) {
      if (aim.count >= MAX_TARGETS) break
      if (object.done || object.cleared || object.smashedAt !== undefined) continue
      const ahead = object.s - run.distance
      if (ahead < 1.5 || ahead > SHOT_RANGE) continue
      const kind = monsterOf(object)
      if (!kind) continue
      const target = aim.targets[aim.count++]!
      target.id = object.id
      target.x = objectX(object)
      target.y = kind === 'lying' ? 0.55 : object.kind === 'flyer' ? object.y + 1.1 : 1.35
      target.z = -(object.s + object.length / 2 - run.distance)
      target.ahead = ahead
      target.lane = object.shiftTo ?? object.lane
      if (!ready) continue
      // Le viseur se lit de loin : sa taille grandit un peu avec la distance.
      const size = (1.1 + ahead * 0.012) * (1 + Math.sin(time * 6 + object.id) * 0.08)
      this.reticle.push(target.x, target.y, target.z + 0.6, size, size, 1, '#ff6fd1', 0, 0, time * 1.6 + object.id)
    }
    this.reticle.end()

    // Le rayon du dernier tir, qui s'efface.
    const shot = run.lastShot
    const age = shot ? run.t - shot.at : Infinity
    const visible = age < BEAM_TIME
    this.beam.visible = this.core.visible = this.flash.visible = visible
    if (!visible || !shot) return
    const fade = 1 - age / BEAM_TIME
    this.from.set(run.x + 0.3, run.y + 1.25, -0.3)
    this.to.set(shot.x, shot.y, -(shot.s - run.distance))
    this.direction.subVectors(this.to, this.from)
    const length = this.direction.length()
    this.direction.normalize()
    for (const [mesh, width] of [
      [this.beam, 0.22],
      [this.core, 0.07],
    ] as const) {
      mesh.position.addVectors(this.from, this.to).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(this.up, this.direction)
      mesh.scale.set(width * fade, length, width * fade)
    }
    this.flash.position.copy(this.from)
    this.flash.scale.setScalar(0.07 + (1 - fade) * 0.12)
    ;(this.flash.material as THREE.MeshBasicMaterial).opacity = fade * 0.9
  }

  dispose(): void {
    this.reticle.dispose()
    for (const mesh of [this.beam, this.core, this.flash]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  }
}
