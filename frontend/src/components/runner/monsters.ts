import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { objectX, type RunState, type TrackObject } from '../../lib/runner/engine'
import { SKELETON_MODELS, type RunnerAssets, type SkeletonModel } from './assets'
import { monsterOf } from './biomes'
import type { ScenePart } from './parts'

/*
 * Les monstres du Manga Runner : des squelettes (KayKit) qui barrent une voie, armés, en
 * garde ou qui provoquent le coureur — et qui frappent quand il arrive sur eux ; ou
 * étendus en travers de la voie, à sauter ; ou volant sur un sceau magique (au-dessus de
 * la voie ou d'un toit de train), à passer en glissant. Un tir les pulvérise. Un réservoir d'instances (clones avec leur
 * squelette et leur mixeur d'animations) est attribué aux obstacles visibles : rien
 * n'est créé pendant la course.
 */

const STANDING = 9
const LYING = 5
/** Taille d'un squelette debout (m) : plus grand que le coureur, menaçant. */
const HEIGHT = 2.5

interface Monster {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  playing: string | null
  /** Obstacle servi, ou `null` si libre. */
  object: number | null
  aura: THREE.Mesh
}

/** Armes en main, selon le squelette (accessoires du pack). */
const WEAPONS: Record<SkeletonModel, { right?: string; left?: string }> = {
  skeleton_warrior: { right: 'Skeleton_Blade', left: 'Skeleton_Shield_Small_A' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_minion: { right: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_mage: { right: 'Skeleton_Staff' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_rogue: { right: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
}

export class MonstersPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly standing: Monster[] = []
  private readonly lying: Monster[] = []
  private readonly aura: THREE.MeshBasicMaterial

  constructor(assets: RunnerAssets) {
    this.aura = new THREE.MeshBasicMaterial({ color: '#b04dff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    const auraGeometry = new THREE.CircleGeometry(1, 28)
    const make = (model: SkeletonModel, lying: boolean): Monster => {
      const body = cloneSkinned(assets.skeletons[model].scene)
      body.traverse((node) => {
        if (node instanceof THREE.Mesh) node.frustumCulled = false
      })
      const box = new THREE.Box3().setFromObject(body)
      const scale = HEIGHT / Math.max(0.01, box.getSize(new THREE.Vector3()).y)
      body.scale.setScalar(scale)
      body.position.y = -box.min.y * scale
      // Armes accrochées aux mains (os « handslot »).
      if (!lying) {
        const weapons = WEAPONS[model]
        for (const [slot, prop] of [
          ['handslot.r', weapons.right],
          ['handslot.l', weapons.left],
        ] as const) {
          const template = prop ? assets.props.get(prop) : undefined
          const bone = body.getObjectByName(slot)
          if (template && bone) bone.add(template.clone())
        }
      }
      const root = new THREE.Group()
      root.add(body)
      const aura = new THREE.Mesh(auraGeometry, this.aura)
      aura.rotation.x = -Math.PI / 2
      aura.position.y = 0.03
      root.add(aura)
      root.visible = false
      this.object.add(root)
      const mixer = new THREE.AnimationMixer(body)
      const actions = new Map<string, THREE.AnimationAction>()
      for (const clip of assets.skeletonClips) actions.set(clip.name, mixer.clipAction(clip))
      for (const once of ['1H_Melee_Attack_Chop', '2H_Melee_Attack_Spin', 'Skeletons_Awaken_Floor', 'Cheer']) {
        const action = actions.get(once)
        if (action) {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
        }
      }
      return { root, mixer, actions, playing: null, object: null, aura }
    }
    for (let index = 0; index < STANDING; index += 1) this.standing.push(make(SKELETON_MODELS[index % SKELETON_MODELS.length]!, false))
    for (let index = 0; index < LYING; index += 1) this.lying.push(make(SKELETON_MODELS[(index + 1) % SKELETON_MODELS.length]!, true))
  }

  private play(monster: Monster, name: string, fade = 0.2, timeScale = 1): void {
    if (monster.playing === name) return
    const next = monster.actions.get(name)
    if (!next) return
    next.reset().setEffectiveWeight(1)
    next.timeScale = timeScale
    next.play()
    const previous = monster.playing ? monster.actions.get(monster.playing) : null
    if (previous && fade > 0) previous.crossFadeTo(next, fade, false)
    else previous?.stop()
    monster.playing = name
  }

  /** Attribue les monstres libres aux obstacles visibles, rend les autres au réservoir. */
  private assign(pool: Monster[], wanted: TrackObject[]): void {
    const ids = new Set(wanted.map((object) => object.id))
    for (const monster of pool) {
      if (monster.object !== null && !ids.has(monster.object)) {
        monster.object = null
        monster.root.visible = false
        monster.playing = null
        monster.mixer.stopAllAction()
      }
    }
    for (const object of wanted) {
      if (pool.some((monster) => monster.object === object.id)) continue
      const free = pool.find((monster) => monster.object === null)
      if (!free) break
      free.object = object.id
      free.root.visible = true
      free.aura.visible = true
    }
  }

  update(run: RunState, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const standing: TrackObject[] = []
    const lying: TrackObject[] = []
    for (const object of run.objects) {
      const ahead = object.s - run.distance
      if (ahead > 150 || ahead < -10 || object.cleared) continue
      const kind = monsterOf(object)
      if (kind === 'standing') standing.push(object)
      else if (kind === 'lying') lying.push(object)
    }
    this.assign(this.standing, standing)
    this.assign(this.lying, lying)
    const byId = new Map(run.objects.map((object) => [object.id, object]))
    this.aura.opacity = 0.25 + Math.sin(time * 4) * 0.1

    for (const monster of this.standing) {
      const object = monster.object === null ? undefined : byId.get(monster.object)
      if (!object) continue
      const ahead = object.s - run.distance
      const base = object.kind === 'flyer' ? object.y - 0.15 : 0
      // Pulvérisé par l'Éveil ou par un tir : projeté en l'air, en tournoyant, loin devant.
      if (object.smashedAt !== undefined) {
        this.fling(monster, object, run, base, dt)
        continue
      }
      monster.root.rotation.x = 0
      monster.aura.visible = true
      if (object.kind === 'flyer') {
        // En vol, sur son sceau : il flotte, tourne lentement, et frappe quand on arrive.
        monster.root.position.set(objectX(object), base + Math.sin(time * 2.4 + object.id) * 0.18, -(object.s + object.length / 2 - run.distance))
        monster.root.rotation.set(0, Math.sin(time * 0.9 + object.id) * 0.4, Math.sin(time * 1.7 + object.id) * 0.06)
        if (object.done) this.play(monster, 'Cheer', 0.15)
        else if (ahead < 9) this.play(monster, '2H_Melee_Attack_Spin', 0.12, 1.4)
        else this.play(monster, 'Taunt_Longer', 0.2)
        monster.aura.scale.setScalar(1.25 + Math.sin(time * 5 + object.id) * 0.1)
        monster.mixer.update(dt)
        continue
      }
      // La feinte : un bond de côté (arc, corps penché vers la voie visée).
      const shift = object.shiftTo === undefined ? 0 : (object.shift ?? 0)
      const hop = Math.sin(Math.PI * shift)
      const side = object.shiftTo === undefined ? 0 : Math.sign(object.shiftTo - object.lane)
      monster.root.position.set(objectX(object), hop * 1.1, -(object.s + object.length / 2 - run.distance))
      monster.root.rotation.y = Math.sin(time * 0.7 + object.id) * 0.15 - side * hop * 0.9
      monster.root.rotation.z = -side * hop * 0.25
      // De loin : en garde ou provocation ; de près : il frappe.
      if (object.done) this.play(monster, 'Cheer', 0.15)
      else if (ahead < 9) this.play(monster, object.variant % 2 ? '1H_Melee_Attack_Chop' : '2H_Melee_Attack_Spin', 0.12, 1.4)
      else this.play(monster, object.variant % 4 < 2 ? 'Taunt' : 'Idle_Combat', 0.2)
      monster.aura.scale.setScalar(1.1 + Math.sin(time * 3 + object.id) * 0.08)
      monster.mixer.update(dt)
    }
    for (const monster of this.lying) {
      const object = monster.object === null ? undefined : byId.get(monster.object)
      if (!object) continue
      if (object.smashedAt !== undefined) {
        this.fling(monster, object, run, 0, dt)
        continue
      }
      monster.root.rotation.set(0, 0, 0)
      // Étendu en travers de la voie : on le saute.
      monster.root.position.set(objectX(object), 0, -(object.s + object.length / 2 - run.distance))
      monster.root.rotation.y = Math.PI / 2
      this.play(monster, 'Skeletons_Inactive_Floor_Pose', 0)
      monster.aura.scale.set(1.4, 0.8, 1)
      monster.mixer.update(dt)
    }
  }

  /** Pulvérisé : projeté en l'air en tournoyant, loin devant, puis il disparaît. */
  private fling(monster: Monster, object: TrackObject, run: RunState, base: number, dt: number): void {
    const age = run.t - (object.smashedAt ?? run.t)
    monster.root.visible = age < 1.2
    monster.aura.visible = false
    monster.root.position.set(objectX(object) + age * 3, base + age * 7 - age * age * 6, -(object.s + object.length / 2 - run.distance) - age * 14)
    monster.root.rotation.set(age * 9, age * 4, age * 6)
    monster.mixer.update(dt)
  }

  dispose(): void {
    // Sans `uncacheRoot` : React (mode strict) peut remonter la même partie après ce nettoyage.
    for (const monster of [...this.standing, ...this.lying]) {
      monster.mixer.stopAllAction()
      monster.playing = null
    }
  }
}
