import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BOSS_COUNTER, BOSS_DEATH, BOSS_DISTANCE, BOSS_IMPACT, BOSS_INTRO } from '../../lib/runner/constants'
import type { BossFight, RunState } from '../../lib/runner/engine'
import type { RunnerAssets, SkeletonModel } from './assets'
import type { ScenePart } from './parts'
import { glowTexture } from './realms'

/*
 * Les boss du Manga Runner : des squelettes géants (quatre fois la taille des monstres), chacun
 * avec son allure — Gashadokuro (os blancs, yeux rouges, cornes noires, flammes violettes),
 * le Roi Liche (spectre bleu, couronne d'or, cercle de runes), l'Oni des cendres (rouge braise,
 * cornes d'ivoire, flammes orange). Il surgit du sol, nous provoque, encaisse nos trois
 * attaques (vague de ki, lame de lune, pluie de météores), contre-attaque quand on tarde
 * (onde de choc au sol), et à la fin s'effondre et explose en lumière.
 */

/** Taille du boss par rapport à un monstre (2,5 m) : 10 m, il domine la route. */
const SCALE = 4
const MONSTER_HEIGHT = 2.5
/** Poitrine du boss (impact des attaques), dans le repère de la scène. */
const CHEST = new THREE.Vector3(0, 1.45 * SCALE, -BOSS_DISTANCE + 1)

interface BossLook {
  model: SkeletonModel
  color: string
  emissive: string
  glow: number
  eyes: string
  aura: string
  flame: string
  crest: 'horns' | 'crown' | 'oni'
}

/** Les boss, dans l'ordre (le quatrième reprend le premier). */
export const BOSS_LOOKS: readonly BossLook[] = [
  { model: 'skeleton_warrior', color: '#f3ead6', emissive: '#ff2a2a', glow: 0.1, eyes: '#ff3030', aura: '#ff3b3b', flame: '#a23cff', crest: 'horns' },
  { model: 'skeleton_mage', color: '#8a96ff', emissive: '#1f2cff', glow: 0.35, eyes: '#7ff6ff', aura: '#5aa8ff', flame: '#3d7bff', crest: 'crown' },
  { model: 'skeleton_rogue', color: '#ff8a62', emissive: '#ff3300', glow: 0.3, eyes: '#ffd35c', aura: '#ff8a00', flame: '#ff5a00', crest: 'oni' },
]

/** Armes en main (accessoires du pack). */
const WEAPONS: Record<SkeletonModel, { right?: string; left?: string }> = {
  skeleton_warrior: { right: 'Skeleton_Blade', left: 'Skeleton_Shield_Large_A' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_minion: { right: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_mage: { right: 'Skeleton_Staff' }, // i18n-ignore (noms d'accessoires du modèle)
  skeleton_rogue: { right: 'Skeleton_Blade', left: 'Skeleton_Blade' }, // i18n-ignore (noms d'accessoires du modèle)
}

const FLAMES = 14

interface BossModel {
  root: THREE.Group
  body: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  playing: string | null
  /** Matériaux teintés : leur lueur s'emballe quand il est touché, et en mourant. */
  materials: THREE.MeshStandardMaterial[]
  aura: THREE.Mesh
  flames: THREE.Mesh[]
  runes: THREE.Object3D | null
}

/** Une étoile épaisse (le météore de la troisième attaque). */
function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 ? 0.45 : 1
    const angle = (point / 10) * Math.PI * 2 + Math.PI / 2
    if (point === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 })
  geometry.center()
  return geometry
}

const additive = (color: string, opacity = 1, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side })

const SHARDS = 90

export class BossPart implements ScenePart {
  readonly object = new THREE.Group()
  private readonly bosses: BossModel[] = []
  private active: number | null = null
  private lastPhase = ''
  // Compétences.
  private readonly orb = new THREE.Group()
  private readonly orbTrail: THREE.Mesh[] = []
  private readonly crescent: THREE.Mesh
  private readonly meteor = new THREE.Group()
  // Impacts, contre-attaque, mort.
  private readonly flash: THREE.Sprite
  private readonly ring: THREE.Mesh
  private readonly shock: THREE.Mesh
  private readonly pillar: THREE.Mesh
  private readonly shards: THREE.InstancedMesh
  private readonly shardState = Array.from({ length: SHARDS }, () => ({ life: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), size: 0 }))
  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly scale = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly color = new THREE.Color()
  private impactAt = -10
  private impactColor = '#ffffff'
  private burstDone = false

  constructor(assets: RunnerAssets) {
    const glow = glowTexture()
    const halo = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
    BOSS_LOOKS.forEach((look) => this.bosses.push(this.makeBoss(assets, look)))

    // Vague de ki : un orbe bleu, son halo et sa traînée.
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), additive('#e9fbff'))
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), additive('#38b6ff', 0.55))
    const orbHalo = new THREE.Sprite(halo.clone())
    orbHalo.material.color.set('#4fc3ff')
    orbHalo.scale.setScalar(4.5)
    this.orb.add(core, shell, orbHalo)
    for (let index = 0; index < 7; index += 1) {
      const trail = new THREE.Mesh(new THREE.SphereGeometry(0.5 - index * 0.055, 12, 8), additive('#4fc3ff', 0.5 - index * 0.06))
      this.orbTrail.push(trail)
      this.object.add(trail)
    }
    // Lame de lune : un croissant blanc et cyan qui tournoie.
    this.crescent = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.22, 10, 40, Math.PI * 0.95), additive('#d8fbff'))
    const crescentGlow = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.5, 10, 40, Math.PI * 0.95), additive('#5ef0ff', 0.35))
    this.crescent.add(crescentGlow)
    // Pluie de météores : une étoile d'or enflammée qui tombe du ciel.
    const star = new THREE.Mesh(starGeometry(), new THREE.MeshBasicMaterial({ color: '#ffe27a', toneMapped: false }))
    star.scale.setScalar(1.3)
    const starHalo = new THREE.Sprite(halo.clone())
    starHalo.material.color.set('#ffb300')
    starHalo.scale.setScalar(7)
    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 16, 1, true), additive('#ff9f1a', 0.45))
    tail.position.y = 4.5
    this.meteor.add(star, starHalo, tail)

    this.flash = new THREE.Sprite(halo.clone())
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), additive('#ffffff', 0.9, THREE.DoubleSide))
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), additive('#ff3b3b', 0.9, THREE.DoubleSide))
    this.shock.rotation.x = -Math.PI / 2
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 40, 24, 1, true), additive('#fff3c4', 0.5, THREE.DoubleSide))
    this.shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), SHARDS)
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let index = 0; index < SHARDS; index += 1) this.shards.setColorAt(index, this.color.set('#ffffff'))
    this.shards.count = 0
    this.shards.frustumCulled = false
    for (const node of [this.orb, this.crescent, this.meteor, this.flash, this.ring, this.shock, this.pillar]) {
      node.visible = false
      node.frustumCulled = false
      node.renderOrder = 8
    }
    this.object.add(this.orb, this.crescent, this.meteor, this.flash, this.ring, this.shock, this.pillar, this.shards)
  }

  /** Un boss : le squelette teinté, ses yeux qui brûlent, ses armes, sa coiffe, son aura, ses flammes. */
  private makeBoss(assets: RunnerAssets, look: BossLook): BossModel {
    const body = cloneSkinned(assets.skeletons[look.model].scene)
    const materials: THREE.MeshStandardMaterial[] = []
    const tinted = new Map<THREE.Material, THREE.Material>()
    const eyes = new THREE.MeshBasicMaterial({ color: look.eyes, toneMapped: false })
    body.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.frustumCulled = false
      if (/Eyes/i.test(node.name)) {
        node.material = eyes
        return
      }
      node.material = [node.material].flat().map((material: THREE.Material) => {
        const known = tinted.get(material)
        if (known) return known
        const copy = material.clone() as THREE.MeshStandardMaterial
        if ('color' in copy) copy.color.set(look.color)
        if ('emissive' in copy) {
          copy.emissive.set(look.emissive)
          copy.emissiveIntensity = look.glow
          materials.push(copy)
        }
        tinted.set(material, copy)
        return copy
      })
      if (Array.isArray(node.material) && node.material.length === 1) node.material = node.material[0]!
    })
    const box = new THREE.Box3().setFromObject(body)
    const fit = MONSTER_HEIGHT / Math.max(0.01, box.getSize(new THREE.Vector3()).y)
    body.scale.setScalar(fit)
    body.position.y = -box.min.y * fit
    const weapons = WEAPONS[look.model]
    for (const [slot, prop] of [
      ['handslot.r', weapons.right],
      ['handslot.l', weapons.left],
    ] as const) {
      const template = prop ? assets.props.get(prop) : undefined
      const bone = body.getObjectByName(slot)
      if (template && bone) bone.add(template.clone())
    }
    // Coiffe, accrochée à l'os de la tête (en unités du modèle : on compense son échelle).
    const head = body.getObjectByName('head')
    if (head) {
      const crest = new THREE.Group()
      crest.scale.setScalar(1 / fit)
      if (look.crest === 'crown') {
        const gold = new THREE.MeshStandardMaterial({ color: '#ffd35c', emissive: '#ffb300', emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 })
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.12, 16, 1, true), gold.clone())
        band.material.side = THREE.DoubleSide
        crest.add(band)
        for (let spike = 0; spike < 7; spike += 1) {
          const angle = (spike / 7) * Math.PI * 2
          const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), gold)
          point.position.set(Math.cos(angle) * 0.24, 0.15, Math.sin(angle) * 0.24)
          crest.add(point)
        }
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: '#7ff6ff', toneMapped: false }))
        gem.position.set(0, 0.04, 0.27)
        crest.add(gem)
        crest.position.y = 0.42
      } else {
        // Cornes : noires et recourbées (Gashadokuro), ivoire et droites (Oni).
        const horn = new THREE.MeshStandardMaterial({ color: look.crest === 'oni' ? '#f4ead2' : '#2a0b12', emissive: look.crest === 'oni' ? '#000000' : '#5a0010', emissiveIntensity: 0.4, roughness: 0.5 })
        for (const side of [-1, 1]) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, look.crest === 'oni' ? 0.42 : 0.55, 10), horn)
          cone.position.set(side * 0.17, 0.42, 0.02)
          cone.rotation.z = -side * (look.crest === 'oni' ? 0.25 : 0.65)
          cone.rotation.x = look.crest === 'oni' ? 0 : -0.35
          crest.add(cone)
        }
      }
      head.add(crest)
    }
    const root = new THREE.Group()
    root.add(body)
    // Aura au sol et flammes qui dansent autour des pieds.
    const aura = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), additive(look.aura, 0.45))
    aura.rotation.x = -Math.PI / 2
    aura.position.y = 0.03
    root.add(aura)
    const flames: THREE.Mesh[] = []
    const flameGeometry = new THREE.ConeGeometry(0.22, 1.1, 8, 1, true)
    for (let index = 0; index < FLAMES; index += 1) {
      const flame = new THREE.Mesh(flameGeometry, additive(look.flame, 0.55))
      const angle = (index / FLAMES) * Math.PI * 2
      flame.position.set(Math.cos(angle) * 1.25, 0.5, Math.sin(angle) * 1.25)
      flames.push(flame)
      root.add(flame)
    }
    // Le Roi Liche : un cercle de runes qui tourne autour de lui.
    let runes: THREE.Object3D | null = null
    if (look.crest === 'crown') {
      runes = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.04, 6, 64), additive('#7ff6ff', 0.8))
      runes.rotation.x = Math.PI / 2
      runes.position.y = 1.4
      root.add(runes)
    }
    root.scale.setScalar(SCALE)
    root.visible = false
    this.object.add(root)
    const mixer = new THREE.AnimationMixer(body)
    const actions = new Map<string, THREE.AnimationAction>()
    for (const clip of assets.skeletonClips) actions.set(clip.name, mixer.clipAction(clip))
    for (const once of ['1H_Melee_Attack_Chop', '2H_Melee_Attack_Spin', 'Skeletons_Awaken_Floor', 'Blocking', 'Cheer']) {
      const action = actions.get(once)
      if (action) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
    }
    return { root, body, mixer, actions, playing: null, materials, aura, flames, runes }
  }

  private play(boss: BossModel, name: string, fade = 0.2, options: { timeScale?: number; reverse?: boolean } = {}): void {
    if (boss.playing === name) return
    const next = boss.actions.get(name)
    if (!next) return
    next.reset().setEffectiveWeight(1)
    next.timeScale = options.reverse ? -Math.abs(options.timeScale ?? 1) : (options.timeScale ?? 1)
    if (options.reverse) next.time = next.getClip().duration
    next.play()
    const previous = boss.playing ? boss.actions.get(boss.playing) : null
    if (previous && fade > 0) previous.crossFadeTo(next, fade, false)
    else previous?.stop()
    boss.playing = name
  }

  update(run: RunState, time: number, delta: number): void {
    const dt = Math.min(delta, 0.05)
    const fight = run.boss
    const index = fight ? fight.index % this.bosses.length : null
    // Changement de boss (ou fin) : on cache l'ancien, on remet le nouveau à zéro.
    if (index !== this.active) {
      if (this.active !== null) {
        const old = this.bosses[this.active]!
        old.root.visible = false
        old.mixer.stopAllAction()
        old.playing = null
      }
      this.active = index
      this.lastPhase = ''
      this.burstDone = false
    }
    this.updateShards(dt)
    this.updateFlash(run)
    if (!fight || index === null) {
      for (const node of [this.orb, this.crescent, this.meteor, this.shock]) node.visible = false
      this.orbTrail.forEach((trail) => (trail.visible = false))
      this.pillar.visible = false
      return
    }
    const boss = this.bosses[index]!
    const look = BOSS_LOOKS[index]!
    const elapsed = run.t - fight.phaseAt
    boss.root.visible = true
    const phaseKey = `${fight.phase}:${fight.round}:${fight.counters}`
    const entering = phaseKey !== this.lastPhase
    this.lastPhase = phaseKey

    // Pose et animation selon la phase.
    let lift = 0
    let recoil = 0
    let sink = 1
    let glow = look.glow
    switch (fight.phase) {
      case 'intro':
        // Il surgit du sol, puis nous provoque.
        if (entering) this.play(boss, 'Skeletons_Awaken_Floor', 0, { timeScale: 1.4 })
        if (elapsed > BOSS_INTRO * 0.6) this.play(boss, 'Taunt_Longer', 0.3)
        lift = -Math.max(0, 1 - elapsed / 0.6) * 2
        break
      case 'combo':
        this.play(boss, (fight.round + fight.counters) % 2 ? 'Taunt' : 'Idle_Combat', 0.25)
        break
      case 'strike':
        if (elapsed > BOSS_IMPACT) {
          // Touché : il recule, sa lueur s'emballe.
          const hit = Math.max(0, 1 - (elapsed - BOSS_IMPACT) / 0.5)
          recoil = hit * 1.6
          glow = look.glow + hit * 2.2
          this.play(boss, 'Blocking', 0.08, { timeScale: 1.6 })
        } else this.play(boss, 'Idle_Combat', 0.2)
        break
      case 'counter':
        if (entering) this.play(boss, fight.counters % 2 ? '2H_Melee_Attack_Spin' : '1H_Melee_Attack_Chop', 0.1, { timeScale: 1.3 })
        break
      case 'dying': {
        // Il s'effondre (l'apparition à l'envers), brûle de plus en plus, puis éclate en lumière.
        if (entering) this.play(boss, 'Skeletons_Awaken_Floor', 0.15, { reverse: true, timeScale: 0.9 })
        const progress = elapsed / BOSS_DEATH
        glow = look.glow + progress * 4 + Math.sin(time * 40) * progress
        sink = progress < 0.62 ? 1 : Math.max(0, 1 - (progress - 0.62) / 0.12)
        recoil = Math.sin(time * 60) * 0.12 * progress
        if (progress >= 0.62 && !this.burstDone) {
          this.burstDone = true
          this.impact(run, look.aura, 3.4, CHEST.y - 1)
        }
        break
      }
    }
    for (const material of boss.materials) material.emissiveIntensity = glow
    boss.root.position.set(0, lift, -BOSS_DISTANCE - recoil)
    boss.root.scale.setScalar(SCALE * sink)
    boss.root.visible = sink > 0.01
    boss.mixer.update(dt)
    // Aura, flammes, runes.
    boss.aura.scale.setScalar(1 + Math.sin(time * 3) * 0.08)
    boss.flames.forEach((flame, flameIndex) => {
      const flicker = 0.7 + 0.5 * Math.abs(Math.sin(time * 7 + flameIndex * 1.7))
      flame.scale.set(1, flicker, 1)
      flame.position.y = 0.5 * flicker
    })
    if (boss.runes) boss.runes.rotation.z = time * 1.2

    // Les compétences en vol, et leur impact.
    this.updateSkill(run, fight, elapsed)
    // Contre-attaque : une onde de choc rouge court au sol vers le coureur.
    const shockAt = elapsed - 0.45
    this.shock.visible = fight.phase === 'counter' && shockAt > 0 && shockAt < BOSS_COUNTER - 0.45
    if (this.shock.visible) {
      const progress = shockAt / 0.55
      this.shock.position.set(0, 0.06, -BOSS_DISTANCE + progress * BOSS_DISTANCE)
      this.shock.scale.setScalar(2 + progress * 4)
      ;(this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - progress * 0.8)
    }
    // Mort : une colonne de lumière monte à sa place.
    const deathProgress = fight.phase === 'dying' ? elapsed / BOSS_DEATH : 0
    this.pillar.visible = deathProgress > 0.6
    if (this.pillar.visible) {
      const fade = Math.min(1, (deathProgress - 0.6) / 0.1) * Math.max(0, 1 - (deathProgress - 0.75) / 0.25)
      this.pillar.position.set(0, 20, -BOSS_DISTANCE)
      this.pillar.scale.set(0.6 + deathProgress, 1, 0.6 + deathProgress)
      ;(this.pillar.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade
    }
  }

  /** La compétence lancée vole vers le boss ; elle le frappe à `BOSS_IMPACT`. */
  private updateSkill(run: RunState, fight: BossFight, elapsed: number): void {
    const flying = fight.phase === 'strike' && elapsed < BOSS_IMPACT
    const skill = fight.round % 3
    this.orb.visible = flying && skill === 0
    this.crescent.visible = flying && skill === 1
    this.meteor.visible = flying && skill === 2
    this.orbTrail.forEach((trail) => (trail.visible = this.orb.visible))
    if (fight.phase === 'strike' && elapsed >= BOSS_IMPACT && this.impactAt < fight.phaseAt) {
      this.impact(run, ['#4fc3ff', '#9ff6ff', '#ffc23a'][skill]!, 1.6 + skill * 0.4, CHEST.y)
    }
    if (!flying) return
    const progress = elapsed / BOSS_IMPACT
    this.from.set(run.x + 0.3, run.y + 1.3, -0.4)
    if (skill === 0) {
      // L'orbe file en légère cloche ; sa traînée le suit.
      const at = (p: number, target: THREE.Vector3) => target.lerpVectors(this.from, CHEST, p).setY(this.from.y + (CHEST.y - this.from.y) * p + Math.sin(Math.PI * p) * 1.4)
      at(progress, this.orb.position)
      this.orb.scale.setScalar(0.8 + progress * 0.6)
      this.orbTrail.forEach((trail, index) => at(Math.max(0, progress - (index + 1) * 0.045), trail.position))
    } else if (skill === 1) {
      // La lame de lune tournoie à plat, à hauteur de poitrine.
      this.crescent.position.lerpVectors(this.from.setY(2.4), CHEST, progress)
      this.crescent.rotation.set(Math.PI / 2 - 0.3, 0, run.t * 26)
      this.crescent.scale.setScalar(0.8 + progress * 0.9)
    } else {
      // Le météore tombe du ciel sur le boss.
      this.to.set(CHEST.x + 6, CHEST.y + 26, CHEST.z - 8)
      this.meteor.position.lerpVectors(this.to, CHEST, progress * progress)
      this.meteor.lookAt(this.to)
      this.meteor.rotateX(Math.PI / 2)
      this.meteor.children[0]!.rotation.z = run.t * 9
    }
  }

  /** Un impact : éclair, anneau qui s'élargit, éclats. */
  private impact(run: RunState, color: string, size: number, y: number): void {
    this.impactAt = run.t
    this.impactColor = color
    this.ring.userData.size = size
    this.flash.userData.size = size
    this.flash.userData.y = y
    this.ring.userData.y = y
    const base = new THREE.Color(color)
    let spawned = 0
    for (const shard of this.shardState) {
      if (shard.life > 0) continue
      shard.life = 0.9 + Math.random() * 0.5
      shard.position.set((Math.random() - 0.5) * 1.5, y + (Math.random() - 0.5) * 1.5, -BOSS_DISTANCE + 1)
      const angle = Math.random() * Math.PI * 2
      const speed = 6 + Math.random() * 10 * size * 0.5
      shard.velocity.set(Math.cos(angle) * speed, 4 + Math.random() * 9, Math.sin(angle) * speed * 0.6 + 3)
      shard.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12)
      shard.size = 0.6 + Math.random() * 1.2
      this.shards.setColorAt(this.shardState.indexOf(shard), this.color.copy(base).lerp(new THREE.Color('#ffffff'), Math.random() * 0.5))
      spawned += 1
      if (spawned >= 40) break
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true
  }

  private updateFlash(run: RunState): void {
    const age = run.t - this.impactAt
    const visible = age >= 0 && age < 0.7
    this.flash.visible = this.ring.visible = visible
    if (!visible) return
    const size = (this.flash.userData.size as number | undefined) ?? 1.5
    const y = (this.flash.userData.y as number | undefined) ?? CHEST.y
    const fade = 1 - age / 0.7
    this.flash.material.color.set(this.impactColor)
    this.flash.position.set(0, y, -BOSS_DISTANCE + 1.2)
    this.flash.scale.setScalar(size * (3 + age * 10))
    this.flash.material.opacity = fade * fade
    ;(this.ring.material as THREE.MeshBasicMaterial).color.set(this.impactColor)
    this.ring.position.set(0, y, -BOSS_DISTANCE + 1.4)
    this.ring.scale.setScalar(size * (0.6 + (1 - (1 - age / 0.7) ** 3) * 5))
    ;(this.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.9
  }

  private updateShards(dt: number): void {
    let used = 0
    this.shardState.forEach((shard, index) => {
      if (shard.life <= 0) {
        this.matrix.makeScale(0, 0, 0)
        this.shards.setMatrixAt(index, this.matrix)
        return
      }
      shard.life -= dt
      shard.velocity.y -= 20 * dt
      shard.position.addScaledVector(shard.velocity, dt)
      this.euler.set(shard.spin.x * shard.life, shard.spin.y * shard.life, shard.spin.z * shard.life)
      this.quaternion.setFromEuler(this.euler)
      const size = shard.size * Math.min(1, shard.life / 0.3)
      this.scale.setScalar(size)
      this.matrix.compose(shard.position, this.quaternion, this.scale)
      this.shards.setMatrixAt(index, this.matrix)
      used = index + 1
    })
    this.shards.count = used
    this.shards.instanceMatrix.needsUpdate = used > 0
  }

  dispose(): void {
    for (const boss of this.bosses) {
      boss.mixer.stopAllAction()
      boss.playing = null
    }
  }
}
