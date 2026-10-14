/**
 * Prépare les modèles 3D du Manga Runner (packs KayKit de Kay Lousberg et Universal
 * Animation Library de Quaternius, licence CC0).
 *
 * Sources (git, dossier `SRC`) :
 *   KayKit-Character-Pack-Skeletons-1.0 (github.com/KayKit-Game-Assets) ;
 *   ual/UAL1.glb (Universal Animation Library, Unreal-Godot, sans déplacement racine) ;
 *   nature/ (Stylized Nature MegaKit de Quaternius, dossier glTF).
 *
 * Sorties (frontend/public/runner/) : un fichier par squelette monstre, `skeleton-anims.glb`
 * et `props.glb` (leurs armes, un nœud par accessoire) ; `human-anims.glb` : les mouvements
 * captés de l'UAL (course, saut, roulade…), rotations seules, reciblés au chargement sur les
 * coureurs VRM ; `nature.glb` : arbres, buissons, fleurs, herbes et rochers du paysage
 * (sans cartes de relief, fleurs de cerisier recolorées). Textures réduites (WebP),
 * maillages compressés (meshopt). `ONLY=human` ou `ONLY=nature` ne refait que ce fichier.
 *
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp
 *   SRC=/chemin/vers/les/packs node scripts/runner-assets.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, meshopt, prune, resample, simplify, textureCompress, unpartition, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const SRC = process.env.SRC ?? '/tmp/claude-0/kk'
const ONLY = process.env.ONLY
const OUT = process.env.OUT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/runner')
mkdirSync(OUT, { recursive: true })

await MeshoptEncoder.ready
await MeshoptDecoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

const SKELETONS = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`

/** Paysage (Stylized Nature MegaKit) : douze arbres (les feuillages, en cartes, ne se simplifient guère) et le sous-bois. */
const NATURE_TREES = [
  'CherryBlossom_1',
  'CherryBlossom_4',
  'CommonTree_1',
  'CommonTree_3',
  'CommonTree_5',
  'Birch_2',
  'Birch_4',
  'Pine_1',
  'Pine_4',
  'GiantPine_1',
  'DeadTree_1',
  'DeadTree_3',
]
const NATURE_SMALL = [
  'Bush_Common',
  'Bush_Common_Flowers',
  'Bush_Large',
  'Bush_Large_Flowers',
  'Bush_Long_1',
  'Fern_1',
  'Fern_2',
  'Plant_1_Big',
  'Plant_2',
  'Plant_5',
  'Clover_1',
  'Flower_1_Group',
  'Flower_2_Group',
  'Flower_3_Group',
  'Flower_4_Group',
  'Flower_7_Group',
  'Grass_Common_Short',
  'Grass_Common_Tall',
  'Grass_Wispy_Short',
  'Grass_Wispy_Tall',
  'Grass_Wide_Tall',
  'Grass_Wheat',
  'Mushroom_Common',
  'Mushroom_RedCap',
  'Rock_Big_1',
  'Rock_Big_2',
  'Rock_Medium_1',
  'Rock_Medium_2',
  'Rock_Medium_3',
  'Rock_Medium_4',
  'Pebble_Round_1',
  'Pebble_Round_2',
  'Pebble_Round_3',
]

/** Mouvements humains (UAL) ; `A_TPose` sert de pose de référence au reciblage. */
const HUMAN_CLIPS = ['A_TPose', 'Idle_LookAround_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Death01', 'Celebration', 'Hit_Chest']
const SKELETON_CLIPS = ['Idle_Combat', 'Idle_B', 'Taunt', 'Taunt_Longer', '1H_Melee_Attack_Chop', '2H_Melee_Attack_Spin', 'Skeletons_Inactive_Floor_Pose', 'Skeletons_Awaken_Floor', 'Lie_Idle', 'Cheer', 'Blocking']

function keepClips(document, clips) {
  for (const animation of document.getRoot().listAnimations()) {
    if (clips.includes(animation.getName())) continue
    // Les échantillonneurs et leurs données partent avec le clip (sauf ce que d'autres clips partagent).
    const data = animation.listSamplers().flatMap((sampler) => [sampler.getInput(), sampler.getOutput()]).filter(Boolean)
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
    for (const accessor of new Set(data)) {
      if (accessor.listParents().every((parent) => parent.propertyType === 'Root')) accessor.dispose()
    }
  }
}

async function finish(document, file, { textures = 512 } = {}) {
  await document.transform(
    dedup(),
    resample(),
    prune({ keepLeaves: false, keepAttributes: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textures, textures], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(path.join(OUT, file), document)
  const { size } = await import('node:fs').then((fs) => fs.statSync(path.join(OUT, file)))
  console.log(`${file.padEnd(28)} ${(size / 1024).toFixed(0)} Ko`)
}

/**
 * Animations seules : on garde le squelette (nœuds animés), on retire les maillages.
 * `rotationsOnly` : seules les rotations comptent (et le déplacement de `rootBone`).
 */
async function animationsOnly(source, clips, file, { rotationsOnly = false, rootBone = '' } = {}) {
  const document = await io.read(source)
  keepClips(document, clips)
  if (rotationsOnly) {
    for (const animation of document.getRoot().listAnimations()) {
      for (const channel of animation.listChannels()) {
        const keep = channel.getTargetPath() === 'rotation' || (channel.getTargetPath() === 'translation' && channel.getTargetNode()?.getName() === rootBone)
        if (keep) continue
        const sampler = channel.getSampler()
        channel.dispose()
        if (sampler && !sampler.listParents().some((parent) => parent.propertyType === 'AnimationChannel')) sampler.dispose()
      }
    }
  }
  for (const node of document.getRoot().listNodes()) {
    node.setMesh(null)
    node.setSkin(null)
  }
  for (const mesh of document.getRoot().listMeshes()) mesh.dispose()
  await document.transform(resample(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  await io.write(path.join(OUT, file), document)
}

/** Le paysage : un nœud nommé par modèle, matériaux et textures partagés, cartes de relief retirées. */
async function nature() {
  const document = new Document()
  const scene = document.createScene('nature')
  for (const name of [...NATURE_TREES, ...NATURE_SMALL]) {
    const part = await io.read(`${SRC}/nature/${name}.gltf`)
    if (NATURE_TREES.includes(name)) await part.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.004 }))
    const map = mergeDocuments(document, part)
    const group = document.createNode(name)
    for (const node of part.getRoot().getDefaultScene().listChildren()) group.addChild(map.get(node))
    scene.addChild(group)
  }
  for (const extra of document.getRoot().listScenes()) if (extra !== scene) extra.dispose()
  document.getRoot().setDefaultScene(scene)
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null)
    material.setMetallicFactor(0)
  }
  await document.transform(unpartition(), dedup())
  // Les fleurs de cerisier du pack sont violettes (son moteur les teinte) : rose sakura ici.
  for (const texture of document.getRoot().listTextures()) {
    if (!/CherryBlossom/.test(texture.getName() || texture.getURI())) continue
    const image = texture.getImage()
    if (image) texture.setImage(await sharp(image).modulate({ hue: 52, saturation: 0.55, brightness: 1.22 }).png().toBuffer())
  }
  // Feuillages et fleurs (découpes) plus nets que les écorces, à peine visibles.
  await document.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 86, pattern: /Leaves|Leaf|Flowers|Grass|Mushrooms/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 82 }),
  )
  await finish(document, 'nature.glb', { textures: 512 })
}

if (ONLY === 'nature') {
  await nature()
  process.exit(0)
}

if (ONLY === 'human') {
  await animationsOnly(`${SRC}/ual/UAL1.glb`, HUMAN_CLIPS, 'human-anims.glb', { rotationsOnly: true, rootBone: 'pelvis' })
  process.exit(0)
}

await animationsOnly(`${SRC}/ual/UAL1.glb`, HUMAN_CLIPS, 'human-anims.glb', { rotationsOnly: true, rootBone: 'pelvis' })

for (const skeleton of ['Skeleton_Warrior', 'Skeleton_Minion', 'Skeleton_Mage', 'Skeleton_Rogue']) {
  const document = await io.read(`${SKELETONS}/Characters/gltf/${skeleton}.glb`)
  keepClips(document, [])
  await finish(document, `${skeleton.toLowerCase()}.glb`, { textures: 256 })
}
await animationsOnly(`${SKELETONS}/Characters/gltf/Skeleton_Warrior.glb`, SKELETON_CLIPS, 'skeleton-anims.glb')

// Armes des squelettes : chaque accessoire devient un nœud nommé d'une même scène.
const props = new Document()
const scene = props.createScene('props')
const sources = [
  ['Skeleton_Blade', `${SKELETONS}/Assets/gltf/Skeleton_Blade.gltf`],
  ['Skeleton_Shield_Small_A', `${SKELETONS}/Assets/gltf/Skeleton_Shield_Small_A.gltf`],
  ['Skeleton_Staff', `${SKELETONS}/Assets/gltf/Skeleton_Staff.gltf`],
]
for (const [name, file] of sources) {
  const part = await io.read(file)
  const map = mergeDocuments(props, part)
  const group = props.createNode(name)
  for (const node of part.getRoot().getDefaultScene().listChildren()) group.addChild(map.get(node))
  scene.addChild(group)
}
for (const extra of props.getRoot().listScenes()) if (extra !== scene) extra.dispose()
props.getRoot().setDefaultScene(scene)
await props.transform(unpartition())
await finish(props, 'props.glb', { textures: 256 })
await nature()
