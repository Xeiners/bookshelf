import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { retargetHuman } from './vrm'

/*
 * Modèles 3D du Manga Runner : personnages, monstres et accessoires des packs KayKit de
 * Kay Lousberg (licence CC0), préparés par `scripts/runner-assets.mjs` (textures WebP,
 * maillages compressés meshopt) et servis depuis `public/runner/`. Chargés une seule
 * fois, à l'ouverture du Runner ; les clips d'animation sont communs à tous les
 * personnages d'un même squelette. Les coureurs VRM (`scripts/runner-vrm.mjs`) sont
 * instanciés deux fois (la vitrine de l'accueil et la course ont chacune le leur) et
 * bougent avec les captures de mouvement de `human-anims.glb`, reciblées au chargement.
 */

export const HERO_MODELS = ['rogue_hooded', 'rogue', 'knight', 'barbarian', 'mage'] as const
export type HeroModel = (typeof HERO_MODELS)[number]
export const SKELETON_MODELS = ['skeleton_warrior', 'skeleton_minion', 'skeleton_mage', 'skeleton_rogue'] as const
export type SkeletonModel = (typeof SKELETON_MODELS)[number]
export const VRM_MODELS = ['adventurer'] as const
export type VrmModel = (typeof VRM_MODELS)[number]

/** Un coureur VRM : deux instances, et ses animations reciblées (communes aux deux). */
export interface VrmHero {
  preview: VRM
  game: VRM
  clips: THREE.AnimationClip[]
}

export interface RunnerAssets {
  heroes: Record<HeroModel, GLTF>
  heroClips: THREE.AnimationClip[]
  skeletons: Record<SkeletonModel, GLTF>
  skeletonClips: THREE.AnimationClip[]
  /** Accessoires du décor (un groupe par accessoire, à sa taille d'origine). */
  props: Map<string, THREE.Object3D>
  vrm: Record<VrmModel, VrmHero>
}

const BASE = `${import.meta.env.BASE_URL}runner/`
let pending: Promise<RunnerAssets> | null = null

function loader(): GLTFLoader {
  const gltf = new GLTFLoader()
  gltf.setMeshoptDecoder(MeshoptDecoder)
  gltf.register((parser) => new VRMLoaderPlugin(parser))
  return gltf
}

/** Charge (une fois) tous les modèles ; `onProgress` reçoit la part chargée, de 0 à 1. */
export function loadRunnerAssets(onProgress?: (share: number) => void): Promise<RunnerAssets> {
  if (pending) return pending
  const gltf = loader()
  const files = [...HERO_MODELS, 'hero-anims', 'human-anims', ...SKELETON_MODELS, 'skeleton-anims', 'props']
  let done = 0
  const total = files.length + VRM_MODELS.length * 2
  const tick = () => {
    done += 1
    onProgress?.(done / total)
  }
  const load = (name: string) =>
    gltf.loadAsync(`${BASE}${name}.glb`).then((result) => {
      tick()
      return [name, result] as const
    })
  /** Un fichier VRM, lu une fois, monté deux fois (vitrine, course). */
  const loadVrm = (name: VrmModel) =>
    new THREE.FileLoader().setResponseType('arraybuffer').loadAsync(`${BASE}${name}.vrm`).then(async (data) => {
      tick()
      const pair = await Promise.all([0, 1].map(() => gltf.parseAsync(data as ArrayBuffer, BASE).then((result) => prepareVrm(result))))
      tick()
      return [name, pair] as const
    })
  pending = Promise.all([Promise.all(files.map(load)), Promise.all(VRM_MODELS.map(loadVrm))])
    .then(([entries, vrms]) => {
      const byName = new Map<string, GLTF>(entries)
      const props = new Map<string, THREE.Object3D>()
      for (const child of byName.get('props')!.scene.children) props.set(child.name, child)
      return {
        heroes: Object.fromEntries(HERO_MODELS.map((name) => [name, byName.get(name)!])) as Record<HeroModel, GLTF>,
        heroClips: byName.get('hero-anims')!.animations,
        skeletons: Object.fromEntries(SKELETON_MODELS.map((name) => [name, byName.get(name)!])) as Record<SkeletonModel, GLTF>,
        skeletonClips: byName.get('skeleton-anims')!.animations,
        props,
        vrm: Object.fromEntries(
          vrms.map(([name, [preview, game]]) => [name, { preview, game, clips: retargetHuman(byName.get('human-anims')!.animations, byName.get('human-anims')!.scene, preview) }]),
        ) as Record<VrmModel, VrmHero>,
      }
    })
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}

/** Allège un VRM chargé (sommets et os inutiles) et le rend toujours dessiné. */
function prepareVrm(gltf: GLTF): VRM {
  const vrm = gltf.userData.vrm as VRM
  VRMUtils.removeUnnecessaryVertices(vrm.scene)
  VRMUtils.combineSkeletons(vrm.scene)
  vrm.scene.traverse((node) => {
    node.frustumCulled = false
  })
  return vrm
}

const work = new THREE.Matrix4()
const placement = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const euler = new THREE.Euler()
const scale = new THREE.Vector3()

/**
 * Un accessoire du décor en instances : chacun de ses maillages devient un `InstancedMesh`
 * (un appel de dessin), et chaque instance reçoit la matrice de l'accessoire composée
 * avec celle du maillage dans l'accessoire.
 */
export class PropBatch {
  readonly group = new THREE.Group()
  private readonly parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = []
  private count = 0

  readonly max: number

  constructor(template: THREE.Object3D | undefined, max: number) {
    this.max = max
    if (!template) return
    template.updateMatrixWorld(true)
    const root = template.matrixWorld.clone().invert()
    template.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const mesh = new THREE.InstancedMesh(node.geometry, node.material, max)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = 0
      this.parts.push({ mesh, local: root.clone().multiply(node.matrixWorld) })
      this.group.add(mesh)
    })
  }

  begin(): void {
    this.count = 0
  }

  push(x: number, y: number, z: number, size = 1, yaw = 0): void {
    if (this.count >= this.max) return
    position.set(x, y, z)
    rotation.setFromEuler(euler.set(0, yaw, 0))
    scale.setScalar(size)
    placement.compose(position, rotation, scale)
    for (const part of this.parts) part.mesh.setMatrixAt(this.count, work.multiplyMatrices(placement, part.local))
    this.count += 1
  }

  end(): void {
    for (const part of this.parts) {
      part.mesh.count = this.count
      part.mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Géométries et matériaux appartiennent au modèle chargé (partagé) : rien à libérer ici. */
  dispose(): void {
    for (const part of this.parts) part.mesh.dispose()
  }
}
