import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

/*
 * Les coureurs « réalistes » : des personnages VRM (format d'avatar anime, os humanoïdes
 * normalisés, expressions, mèches à ressort). Leurs mouvements sont des captures de
 * mouvement humaines (Universal Animation Library de Quaternius, CC0), reciblées au
 * chargement sur le squelette du personnage, quelles que soient ses proportions.
 */

/** Os de l'UAL → os humanoïdes VRM (les deux côtés, doigts compris). */
const HUMAN_BONES: Record<string, VRMHumanBoneName> = {
  pelvis: 'hips',
  spine_01: 'spine',
  spine_02: 'chest',
  spine_03: 'upperChest',
  neck_01: 'neck',
  Head: 'head',
}
/** Os suivant dans la chaîne (pour la direction de chaque os) ; plusieurs candidats si un os VRM manque. */
const NEXT: Record<string, string[]> = {
  pelvis: ['spine_01'],
  spine_01: ['spine_02', 'spine_03', 'neck_01'],
  spine_02: ['spine_03', 'neck_01'],
  spine_03: ['neck_01', 'Head'],
  neck_01: ['Head'],
}
for (const [s, side] of [
  ['l', 'left'],
  ['r', 'right'],
] as const) {
  const limbs: [string, string, string[]][] = [
    ['clavicle', 'Shoulder', ['upperarm']],
    ['upperarm', 'UpperArm', ['lowerarm']],
    ['lowerarm', 'LowerArm', ['hand']],
    ['hand', 'Hand', ['middle_01']],
    ['thigh', 'UpperLeg', ['calf']],
    ['calf', 'LowerLeg', ['foot']],
    ['foot', 'Foot', ['ball']],
    ['ball', 'Toes', []],
    ['thumb_01', 'ThumbMetacarpal', ['thumb_02']],
    ['thumb_02', 'ThumbProximal', ['thumb_03']],
    ['thumb_03', 'ThumbDistal', []],
  ]
  for (const [finger, name] of [
    ['index', 'Index'],
    ['middle', 'Middle'],
    ['ring', 'Ring'],
    ['pinky', 'Little'],
  ] as const) {
    limbs.push([`${finger}_01`, `${name}Proximal`, [`${finger}_02`]], [`${finger}_02`, `${name}Intermediate`, [`${finger}_03`]], [`${finger}_03`, `${name}Distal`, []])
  }
  for (const [bone, vrmBone, next] of limbs) {
    HUMAN_BONES[`${bone}_${s}`] = `${side}${vrmBone}` as VRMHumanBoneName
    NEXT[`${bone}_${s}`] = next.map((child) => `${child}_${s}`)
  }
}

/**
 * Les clips de l'UAL, sous les noms que le coureur connaît (ceux des figurines KayKit),
 * recadrés au besoin (secondes) : l'élan du saut sans l'accroupissement (le coureur a déjà
 * décollé), la roulade sans son petit bond d'appel.
 */
const CLIPS: Record<string, { names: string[]; from?: number; to?: number }> = {
  Idle_LookAround_Loop: { names: ['Idle'] },
  Sprint_Loop: { names: ['Running_A', 'Running_B'] },
  Jump_Start: { names: ['Jump_Start'], from: 0.1, to: 0.6 },
  Jump_Loop: { names: ['Jump_Idle'] },
  Jump_Land: { names: ['Jump_Land'] },
  Roll: { names: ['Dodge_Forward'], from: 0.3, to: 1.15 },
  Death01: { names: ['Death_A'] },
  Celebration: { names: ['Cheer'] },
  Hit_Chest: { names: ['Hit_A'] },
}
const REFERENCE = 'A_TPose'
const FPS = 30

const world = new THREE.Quaternion()
const swing = new THREE.Quaternion()
const delta = new THREE.Quaternion()
const position = new THREE.Vector3()
const from = new THREE.Vector3()
const to = new THREE.Vector3()

/**
 * Recible les mouvements de l'UAL sur un VRM. Pour chaque os, on mesure de combien il a
 * tourné, dans le repère du monde, par rapport à la pose en T de référence (corrigée pour
 * que chaque os y pointe exactement comme celui du VRM au repos) ; c'est la rotation à
 * donner à l'os normalisé du VRM, dont la pose de repos est cette pose en T. Le bassin
 * suit le mouvement capté, à l'échelle de la taille du personnage. Échantillonné à 30 i/s.
 */
export function retargetHuman(clips: THREE.AnimationClip[], source: THREE.Object3D, vrm: VRM): THREE.AnimationClip[] {
  const humanoid = vrm.humanoid
  const nodes = new Map<string, THREE.Object3D>()
  source.traverse((node) => nodes.set(node.name, node))
  const mixer = new THREE.AnimationMixer(source)
  const pose = (clip: THREE.AnimationClip, time: number) => {
    mixer.stopAllAction()
    const action = mixer.clipAction(clip)
    action.play()
    action.time = time
    mixer.update(0)
    source.updateMatrixWorld(true)
  }

  // Os VRM présents, parents avant enfants, et leur parent humanoïde le plus proche.
  vrm.scene.updateMatrixWorld(true)
  const order: { bone: VRMHumanBoneName; node: THREE.Object3D; parent: VRMHumanBoneName | null; source: string | null }[] = []
  const byNode = new Map<THREE.Object3D, VRMHumanBoneName>()
  for (const name of Object.keys(humanoid.humanBones) as VRMHumanBoneName[]) {
    const node = humanoid.getNormalizedBoneNode(name)
    if (node) byNode.set(node, name)
  }
  const sourceOf = new Map(Object.entries(HUMAN_BONES).map(([key, value]) => [value, key]))
  const visit = (node: THREE.Object3D, parent: VRMHumanBoneName | null) => {
    const bone = byNode.get(node)
    if (bone) order.push({ bone, node, parent, source: sourceOf.get(bone) ?? null })
    for (const child of node.children) visit(child, bone ?? parent)
  }
  visit(humanoid.normalizedHumanBonesRoot, null)

  // Référence : la pose en T de la source, chaque os tourné pour pointer comme celui du VRM.
  const reference = clips.find((clip) => clip.name === REFERENCE)
  if (reference) pose(reference, 0)
  const rest = new Map<VRMHumanBoneName, THREE.Quaternion>()
  for (const { bone, source: key } of order) {
    const node = key ? nodes.get(key) : undefined
    if (!node || !key) continue
    const quaternion = node.getWorldQuaternion(new THREE.Quaternion())
    const next = (NEXT[key] ?? []).find((child) => nodes.has(child) && humanoid.getNormalizedBoneNode(HUMAN_BONES[child]!))
    if (next) {
      nodes.get(next)!.getWorldPosition(from).sub(node.getWorldPosition(position)).normalize()
      humanoid.getNormalizedBoneNode(HUMAN_BONES[next]!)!.getWorldPosition(to).sub(humanoid.getNormalizedBoneNode(bone)!.getWorldPosition(position)).normalize()
      quaternion.premultiply(swing.setFromUnitVectors(from, to))
    }
    rest.set(bone, quaternion.invert())
  }
  const sourceHips = nodes.get('pelvis')
  const sourceHeight = sourceHips ? sourceHips.getWorldPosition(position).y : 1
  const targetHips = humanoid.getNormalizedBoneNode('hips')
  const scale = targetHips ? targetHips.getWorldPosition(position).y / Math.max(0.01, sourceHeight) : 1
  const hipsParent = targetHips?.parent ?? null

  const result: THREE.AnimationClip[] = []
  for (const clip of clips) {
    const recipe = CLIPS[clip.name]
    if (!recipe) continue
    const frames = Math.max(2, Math.round(clip.duration * FPS) + 1)
    const times = Array.from({ length: frames }, (_, index) => Math.min(clip.duration, index / FPS))
    const rotations = new Map<VRMHumanBoneName, number[]>()
    const hips: number[] = []
    const worlds = new Map<VRMHumanBoneName, THREE.Quaternion>()
    for (const time of times) {
      pose(clip, time)
      worlds.clear()
      for (const { bone, parent, source: key } of order) {
        const node = key ? nodes.get(key) : undefined
        const parentWorld = parent ? worlds.get(parent)! : new THREE.Quaternion()
        const restInverse = rest.get(bone)
        // Os sans équivalent : il suit son parent (rotation locale nulle).
        const target = node && restInverse ? node.getWorldQuaternion(world).multiply(restInverse).clone() : parentWorld.clone()
        worlds.set(bone, target)
        if (!node || !restInverse) continue
        delta.copy(parentWorld).invert().multiply(target)
        const values = rotations.get(bone) ?? []
        // Continuité : pas de saut de signe entre deux images (interpolation par le plus court).
        const last = values.length - 4
        if (last >= 0 && delta.x * values[last]! + delta.y * values[last + 1]! + delta.z * values[last + 2]! + delta.w * values[last + 3]! < 0) {
          delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
        }
        values.push(delta.x, delta.y, delta.z, delta.w)
        rotations.set(bone, values)
      }
      if (sourceHips) {
        sourceHips.getWorldPosition(position).multiplyScalar(scale)
        if (hipsParent) hipsParent.worldToLocal(position)
        hips.push(position.x, position.y, position.z)
      }
    }
    const tracks: THREE.KeyframeTrack[] = []
    for (const [bone, values] of rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${humanoid.getNormalizedBoneNode(bone)!.name}.quaternion`, times, values))
    if (targetHips && hips.length) tracks.push(new THREE.VectorKeyframeTrack(`${targetHips.name}.position`, times, hips))
    const whole = new THREE.AnimationClip(clip.name, clip.duration, tracks)
    const from = Math.round((recipe.from ?? 0) * FPS)
    const to = Math.min(frames - 1, Math.round((recipe.to ?? clip.duration) * FPS))
    const cut = from > 0 || to < frames - 1 ? THREE.AnimationUtils.subclip(whole, clip.name, from, to, FPS) : whole
    for (const name of recipe.names) result.push(Object.assign(cut.clone(), { name }))
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(source)
  return result
}

/**
 * L'animation de surface d'un VRM, après le mixeur : clignements, humeur, vent dans les
 * mèches pendant la course ; puis `vrm.update` recopie la pose et fait vivre les ressorts.
 */
export class VrmLife {
  private readonly vrm: VRM
  private time = 0
  private nextBlink = 2.5
  private readonly wind = new THREE.Vector3()
  private readonly gravity: { dir: THREE.Vector3; power: number }[]

  constructor(vrm: VRM) {
    this.vrm = vrm
    this.gravity = [...(vrm.springBoneManager?.joints ?? [])].map((joint) => ({ dir: joint.settings.gravityDir.clone(), power: joint.settings.gravityPower }))
  }

  /** `windward` : direction (monde) où l'air pousse les mèches ; `strength` de 0 à 1. */
  update(delta: number, options: { strength: number; windward: THREE.Vector3; mood?: 'happy' | 'hurt' | null }): void {
    this.time += delta
    const { expressionManager, springBoneManager } = this.vrm
    if (expressionManager) {
      // Clignement de 0,16 s toutes les 2 à 5 s ; sourire ou yeux fermés selon l'instant.
      if (this.time > this.nextBlink + 0.16) this.nextBlink = this.time + 2 + Math.random() * 3
      const blink = this.time > this.nextBlink ? Math.sin(((this.time - this.nextBlink) / 0.16) * Math.PI) : 0
      expressionManager.setValue('blink', options.mood === 'hurt' ? 1 : blink)
      expressionManager.setValue('happy', options.mood === 'happy' ? 0.8 : 0)
    }
    if (springBoneManager) {
      let index = 0
      for (const joint of springBoneManager.joints) {
        const rest = this.gravity[index++]
        if (!rest) continue
        this.wind.copy(rest.dir).multiplyScalar(rest.power).addScaledVector(options.windward, options.strength * 0.55)
        joint.settings.gravityPower = this.wind.length()
        joint.settings.gravityDir.copy(this.wind).normalize()
      }
    }
    this.vrm.update(delta)
  }
}
