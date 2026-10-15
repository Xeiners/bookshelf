import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { objectX, type Realm, type RunState, type TrackObject } from '../../lib/runner/engine'
import { SKELETON_MODELS, type RunnerAssets, type SkeletonModel } from './assets'
import { monsterOf } from './biomes'
import type { ScenePart } from './parts'

/*
 * Les monstres du Manga Runner : des squelettes (KayKit) qui barrent une voie, armés, en
 * garde ou qui provoquent le coureur — et qui frappent quand il arrive sur eux ; ou
 * étendus en travers de la voie, à sauter. Ils se tiennent toujours sur leur support : le
 * sol, ou le toit d'un train. Un tir les pulvérise. Chaque royaume a les siens : gardiens
 * célestes de Skypia (os blancs dorés, auréole et ailes), spectres de cristal sous terre.
 * Un réservoir d'instances (clones avec leur squelette et leur mixeur d'animations) est
 * attribué aux obstacles visibles : rien n'est créé pendant la course.
 */

const STANDING = 9
const LYING = 5
const REALM_STANDING = 6
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
  /** Ailes (gardiens de Skypia) : elles battent. */
  wings: THREE.Object3D[]
}

/** Armes en main, selon le squelette (accessoires du pack). */
const WEAPONS: Record<SkeletonModel, { right?: string; left?: string }> = {
  skeleton_warrior: { right: 'Skeleton_Blade', left: 'Skeleton_Shield_Small_A' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_minion: { right: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_mage: { right: 'Skeleton_Staff' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_rogue: { right: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
}

/** Teinte des os et lueur, par royaume (la Terre garde les couleurs du modèle). */
const REALM_LOOK: Record<Exclude<Realm, 'earth'>, { color: string; emissive: string; glow: number; aura: string }> = {
  sky: { color: '#fffaf0', emissive: '#ffcf6b', glow: 0.32, aura: '#ffe08a' },
  under: { color: '#8a6bff', emissive: '#4b12a8', glow: 0.55, aura: '#38f2d0' },
}

/** Une aile de plumes : un éventail de trois pennes arrondies. */
function wingGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.bezierCurveTo(0.25, 0.35, 0.7, 0.55, 0.95, 0.5)
  shape.bezierCurveTo(0.85, 0.38, 0.9, 0.3, 0.8, 0.22)
  shape.bezierCurveTo(0.7, 0.12, 0.72, 0.05, 0.6, -0.02)
  shape.bezierCurveTo(0.45, -0.1, 0.4, -0.18, 0.28, -0.2)
  shape.bezierCurveTo(0.15, -0.12, 0.05, -0.05, 0, 0)
  return new THREE.ShapeGeometry(shape, 10)
}

export class MonstersPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly standing: Monster[] = []
  private readonly lying: Monster[] = []
  private readonly realms: Record<Exclude<Realm, 'earth'>, Monster[]> = { sky: [], under: [] }
  private readonly aura: THREE.MeshBasicMaterial
  private readonly realmAura: Record<Exclude<Realm, 'earth'>, THREE.MeshBasicMaterial>

  constructor(assets: RunnerAssets) {
    const auraMaterial = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    this.aura = auraMaterial('#b04dff')
    this.realmAura = { sky: auraMaterial(REALM_LOOK.sky.aura), under: auraMaterial(REALM_LOOK.under.aura) }
    const auraGeometry = new THREE.CircleGeometry(1, 28)
    const halo = new THREE.TorusGeometry(0.3, 0.045, 8, 28)
    const haloMaterial = new THREE.MeshBasicMaterial({ color: '#ffe27a', toneMapped: false })
    const wing = wingGeometry()
    const wingMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#fff1c9', emissiveIntensity: 0.35, side: THREE.DoubleSide })
    const crystal = new THREE.ConeGeometry(0.11, 0.55, 5)
    const crystalMaterial = new THREE.MeshBasicMaterial({ color: '#7ef9ff', toneMapped: false })
    const make = (model: SkeletonModel, lying: boolean, realm: Realm = 'earth'): Monster => {
      const body = cloneSkinned(assets.skeletons[model].scene)
      const look = realm === 'earth' ? null : REALM_LOOK[realm]
      const tinted = new Map<THREE.Material, THREE.Material>()
      body.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        node.frustumCulled = false
        if (!look) return
        // Matériaux propres au royaume (les clones partagent ceux du modèle) : teinte et lueur.
        node.material = [node.material].flat().map((material: THREE.Material) => {
          const known = tinted.get(material)
          if (known) return known
          const copy = material.clone() as THREE.MeshStandardMaterial
          if ('color' in copy) copy.color.set(look.color)
          if ('emissive' in copy) {
            copy.emissive.set(look.emissive)
            copy.emissiveIntensity = look.glow
          }
          tinted.set(material, copy)
          return copy
        })
        if (Array.isArray(node.material) && node.material.length === 1) node.material = node.material[0]!
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
      const aura = new THREE.Mesh(auraGeometry, realm === 'earth' ? this.aura : this.realmAura[realm])
      aura.rotation.x = -Math.PI / 2
      aura.position.y = 0.03
      root.add(aura)
      const wings: THREE.Object3D[] = []
      if (realm === 'sky') {
        // Gardien céleste : une auréole, deux ailes dans le dos.
        const ring = new THREE.Mesh(halo, haloMaterial)
        ring.rotation.x = Math.PI / 2
        ring.position.y = HEIGHT + 0.12
        root.add(ring)
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group()
          pivot.position.set(side * 0.12, 1.72, -0.22)
          const feather = new THREE.Mesh(wing, wingMaterial)
          feather.scale.set(side * 0.95, 0.95, 0.95)
          pivot.add(feather)
          root.add(pivot)
          wings.push(pivot)
        }
      } else if (realm === 'under') {
        // Spectre de cristal : des éclats lumineux plantés dans les épaules et le dos.
        for (const [x, y, z, tilt] of [
          [-0.28, 1.85, -0.1, 0.5],
          [0.28, 1.85, -0.1, -0.5],
          [0, 1.6, -0.3, 0],
          [-0.12, 2.05, -0.22, 0.25],
        ] as const) {
          const shard = new THREE.Mesh(crystal, crystalMaterial)
          shard.position.set(x, y, z)
          shard.rotation.set(-0.4, 0, tilt)
          root.add(shard)
        }
      }
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
      return { root, mixer, actions, playing: null, object: null, aura, wings }
    }
    for (let index = 0; index < STANDING; index += 1) this.standing.push(make(SKELETON_MODELS[index % SKELETON_MODELS.length]!, false))
    for (let index = 0; index < LYING; index += 1) this.lying.push(make(SKELETON_MODELS[(index + 1) % SKELETON_MODELS.length]!, true))
    for (let index = 0; index < REALM_STANDING; index += 1) {
      this.realms.sky.push(make(SKELETON_MODELS[(index + 2) % SKELETON_MODELS.length]!, false, 'sky'))
      this.realms.under.push(make(SKELETON_MODELS[(index + 3) % SKELETON_MODELS.length]!, false, 'under'))
    }
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
    const sky: TrackObject[] = []
    const under: TrackObject[] = []
    for (const object of run.objects) {
      const ahead = object.s - run.distance
      if (ahead > 150 || ahead < -10 || object.cleared) continue
      // Chaque monde ne montre que les siens.
      const realm = object.realm ?? 'earth'
      if (realm !== run.realm) continue
      const kind = monsterOf(object)
      if (realm === 'sky' && kind === 'standing') sky.push(object)
      else if (realm === 'under' && kind === 'standing') under.push(object)
      else if (kind === 'standing') standing.push(object)
      else if (kind === 'lying') lying.push(object)
    }
    this.assign(this.standing, standing)
    this.assign(this.lying, lying)
    this.assign(this.realms.sky, sky)
    this.assign(this.realms.under, under)
    const byId = new Map(run.objects.map((object) => [object.id, object]))
    const glow = 0.25 + Math.sin(time * 4) * 0.1
    this.aura.opacity = glow
    this.realmAura.sky.opacity = glow
    this.realmAura.under.opacity = glow + 0.1

    for (const pool of [this.standing, this.realms.sky, this.realms.under]) {
      for (const monster of pool) {
        const object = monster.object === null ? undefined : byId.get(monster.object)
        if (!object) continue
        const ahead = object.s - run.distance
        // Debout sur son support : le sol, ou le toit d'un train.
        const base = object.base ?? 0
        // Pulvérisé par l'Éveil ou par un tir : projeté en l'air, en tournoyant, loin devant.
        if (object.smashedAt !== undefined) {
          this.fling(monster, object, run, base, dt)
          continue
        }
        monster.root.rotation.x = 0
        monster.aura.visible = true
        // La feinte : un bond de côté (arc, corps penché vers la voie visée).
        const shift = object.shiftTo === undefined ? 0 : (object.shift ?? 0)
        const hop = Math.sin(Math.PI * shift)
        const side = object.shiftTo === undefined ? 0 : Math.sign(object.shiftTo - object.lane)
        monster.root.position.set(objectX(object), base + hop * 1.1, -(object.s + object.length / 2 - run.distance))
        monster.root.rotation.y = Math.sin(time * 0.7 + object.id) * 0.15 - side * hop * 0.9
        monster.root.rotation.z = -side * hop * 0.25
        // Les ailes battent doucement, plus vite quand il frappe.
        const beat = Math.sin(time * (ahead < 9 ? 14 : 6) + object.id) * 0.35
        monster.wings.forEach((wing, index) => (wing.rotation.y = (index === 0 ? 1 : -1) * (0.55 + beat)))
        // De loin : en garde ou provocation ; de près : il frappe.
        if (object.done) this.play(monster, 'Cheer', 0.15)
        else if (ahead < 9) this.play(monster, object.variant % 2 ? '1H_Melee_Attack_Chop' : '2H_Melee_Attack_Spin', 0.12, 1.4)
        else this.play(monster, object.variant % 4 < 2 ? 'Taunt' : 'Idle_Combat', 0.2)
        monster.aura.scale.setScalar(1.1 + Math.sin(time * 3 + object.id) * 0.08)
        monster.mixer.update(dt)
      }
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
    for (const monster of [...this.standing, ...this.lying, ...this.realms.sky, ...this.realms.under]) {
      monster.mixer.stopAllAction()
      monster.playing = null
    }
  }
}
