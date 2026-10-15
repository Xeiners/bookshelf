import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { MeshoptSimplifier } from 'meshoptimizer'
import { uploadUsed } from './batch'
import { captureRest } from './outfit'
import { retargetHuman } from './vrm'

/*
 * Modèles 3D du Manga Runner : monstres et accessoires des packs KayKit de Kay Lousberg
 * (licence CC0), préparés par `scripts/runner-assets.mjs` (textures WebP, maillages
 * compressés meshopt) et servis depuis `public/runner/`. Chargés une seule fois, à
 * l'ouverture du Runner ; les clips d'animation sont communs à tous les monstres d'un
 * même squelette. Les coureurs VRM (`scripts/runner-vrm.mjs`) sont
 * instanciés deux fois (la vitrine de l'accueil et la course ont chacune le leur) et
 * bougent avec les captures de mouvement de `human-anims.glb`, reciblées au chargement.
 */

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
  skeletons: Record<SkeletonModel, GLTF>
  skeletonClips: THREE.AnimationClip[]
  /** Armes des monstres (un groupe par accessoire, à sa taille d'origine). */
  props: Map<string, THREE.Object3D>
  /** Paysage (Stylized Nature MegaKit) : arbres, buissons, fleurs, herbes, rochers, par nom. */
  nature: Map<string, THREE.Object3D>
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
  const files = ['human-anims', ...SKELETON_MODELS, 'skeleton-anims', 'props', 'nature']
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
  pending = Promise.all([Promise.all(files.map(load)), Promise.all(VRM_MODELS.map(loadVrm)), MeshoptSimplifier.ready])
    .then(([entries, vrms]) => {
      const byName = new Map<string, GLTF>(entries)
      const props = new Map<string, THREE.Object3D>()
      for (const child of byName.get('props')!.scene.children) props.set(child.name, child)
      const nature = new Map<string, THREE.Object3D>()
      for (const child of byName.get('nature')!.scene.children) nature.set(child.name, child)
      lightenNature(nature)
      return {
        nature,
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

/** Familles d'arbres : elles reçoivent en plus une version lointaine (`<nom>__far`), très allégée. */
const TREES = /^(CherryBlossom|CommonTree|Birch|Pine|GiantPine|DeadTree|TwistedTree)/

/** Triangles d'un maillage. */
const triangles = (geometry: THREE.BufferGeometry) => (geometry.index ? geometry.index.count : geometry.attributes.position!.count) / 3

/**
 * Simplifie un maillage (meshoptimizer) : on garde au moins `floor` triangles, ou la part
 * `ratio`, avec une erreur tolérée relative à sa taille (plus grande au loin).
 */
function simplified(geometry: THREE.BufferGeometry, ratio: number, floor: number, error: number): THREE.BufferGeometry {
  const count = triangles(geometry)
  if (!geometry.index || count <= floor * 1.2) return geometry
  // Positions en flottants (le pack les stocke quantifiées : entiers normalisés).
  const attribute = geometry.attributes.position!
  const positions = new Float32Array(attribute.count * 3)
  for (let index = 0; index < attribute.count; index += 1) positions.set([attribute.getX(index), attribute.getY(index), attribute.getZ(index)], index * 3)
  // Le pack est « à facettes » : chaque face a ses propres sommets. On les soude par position
  // (un représentant par point), sinon rien ne se simplifie ; le représentant garde ses UV.
  const representative = new Uint32Array(attribute.count)
  const seen = new Map<string, number>()
  for (let index = 0; index < attribute.count; index += 1) {
    const key = `${Math.round(positions[index * 3]! * 1e4)},${Math.round(positions[index * 3 + 1]! * 1e4)},${Math.round(positions[index * 3 + 2]! * 1e4)}`
    const first = seen.get(key)
    if (first === undefined) seen.set(key, index)
    representative[index] = first ?? index
  }
  const welded = Uint32Array.from(geometry.index.array, (vertex) => representative[vertex]!)
  const target = Math.max(floor, Math.floor(count * ratio)) * 3
  // Renvoie les nouveaux indices (déjà à la bonne longueur) et l'erreur atteinte.
  const [indices] = MeshoptSimplifier.simplify(welded, positions, 3, target, error, ['Permissive'])
  if (indices.length === 0 || indices.length >= geometry.index.count * 0.95) return geometry
  const lighter = geometry.clone()
  lighter.setIndex(new THREE.BufferAttribute(indices, 1))
  // Sommets désormais partagés : normales lissées (l'ombrage « cel » les aplatit de toute façon).
  lighter.deleteAttribute('normal')
  lighter.computeVertexNormals()
  return lighter
}

/**
 * Le paysage, allégé au chargement : les modèles du pack sont très détaillés (un tronc de
 * cerisier fait près de 9 000 triangles, et une quarantaine d'arbres sont visibles). On les
 * simplifie une fois, sans différence visible à la distance où on les voit, et les arbres
 * reçoivent une version lointaine, posée au-delà de quelques dizaines de mètres.
 */
function lightenNature(nature: Map<string, THREE.Object3D>): void {
  for (const [name, model] of [...nature]) {
    model.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry = simplified(node.geometry, 0.15, 400, 0.012)
    })
    if (!TREES.test(name)) continue
    const far = model.clone()
    far.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry = simplified(node.geometry, 0.06, 150, 0.08)
    })
    far.name = `${name}__far`
    nature.set(far.name, far)
  }
}

/** Allège un VRM chargé (sommets et os inutiles) et le rend toujours dessiné. */
function prepareVrm(gltf: GLTF): VRM {
  const vrm = gltf.userData.vrm as VRM
  VRMUtils.removeUnnecessaryVertices(vrm.scene)
  VRMUtils.combineSkeletons(vrm.scene)
  vrm.scene.traverse((node) => {
    node.frustumCulled = false
  })
  // Pose de repos relevée avant toute animation : la garde-robe s'y accroche (cf. `outfit.ts`).
  captureRest(vrm)
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
  private readonly parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4; tinted: boolean }[] = []
  private count = 0
  private readonly white = new THREE.Color('#ffffff')

  readonly max: number

  /**
   * `material` remplace au besoin le matériau d'un maillage (paysage : matériaux légers,
   * vent) ; `tinted` dit quels maillages prennent la teinte de chaque instance (feuillages).
   */
  constructor(
    template: THREE.Object3D | undefined,
    max: number,
    options: { material?: (source: THREE.Material) => THREE.Material; tinted?: (source: THREE.Material) => boolean } = {},
  ) {
    this.max = max
    if (!template) return
    template.updateMatrixWorld(true)
    const root = template.matrixWorld.clone().invert()
    template.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const source = node.material as THREE.Material
      const mesh = new THREE.InstancedMesh(node.geometry, options.material ? options.material(source) : source, max)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = 0
      const tinted = options.tinted?.(source) ?? false
      if (tinted) for (let index = 0; index < max; index += 1) mesh.setColorAt(index, this.white)
      this.parts.push({ mesh, local: root.clone().multiply(node.matrixWorld), tinted })
      this.group.add(mesh)
    })
  }

  begin(): void {
    this.count = 0
  }

  push(x: number, y: number, z: number, size = 1, yaw = 0, tint?: THREE.Color): void {
    if (this.count >= this.max) return
    position.set(x, y, z)
    rotation.setFromEuler(euler.set(0, yaw, 0))
    scale.setScalar(size)
    placement.compose(position, rotation, scale)
    for (const part of this.parts) {
      part.mesh.setMatrixAt(this.count, work.multiplyMatrices(placement, part.local))
      if (part.tinted) part.mesh.setColorAt(this.count, tint ?? this.white)
    }
    this.count += 1
  }

  end(): void {
    for (const part of this.parts) {
      part.mesh.count = this.count
      uploadUsed(part.mesh.instanceMatrix, this.count * 16)
      if (part.mesh.instanceColor) uploadUsed(part.mesh.instanceColor, this.count * 3)
    }
  }

  /** Géométries et matériaux appartiennent au modèle chargé (partagé) : rien à libérer ici. */
  dispose(): void {
    for (const part of this.parts) part.mesh.dispose()
  }
}
