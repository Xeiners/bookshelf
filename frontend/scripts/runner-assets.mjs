/**
 * Prépare les modèles 3D du Manga Runner (packs KayKit de Kay Lousberg et Universal
 * Animation Library de Quaternius, licence CC0).
 *
 * Sources (git, dossier `SRC`) :
 *   KayKit-Character-Pack-Skeletons-1.0,
 *   KayKit-Halloween-Bits-1.0 (github.com/KayKit-Game-Assets) ;
 *   ual/UAL1.glb (Universal Animation Library, Unreal-Godot, sans déplacement racine).
 *
 * Sorties (frontend/public/runner/) : un fichier par squelette monstre, `skeleton-anims.glb`, et `props.glb` (décor : arbres,
 * tombes, lanternes… un nœud par accessoire). Textures réduites (WebP), maillages
 * compressés (meshopt) : quelques centaines de Ko par fichier. `human-anims.glb` : les
 * mouvements captés de l'UAL (course, saut, roulade…), rotations seules, reciblés au
 * chargement sur les coureurs VRM. `ONLY=human` ne refait que ce fichier.
 *
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp
 *   SRC=/chemin/vers/les/packs node scripts/runner-assets.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, meshopt, prune, resample, textureCompress, unpartition } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const SRC = process.env.SRC ?? '/tmp/claude-0/kk'
const ONLY = process.env.ONLY
const OUT = process.env.OUT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/runner')
mkdirSync(OUT, { recursive: true })

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

const SKELETONS = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`
const HALLOWEEN = `${SRC}/hw/addons/kaykit_halloween_bits/Assets/gltf`

/** Mouvements humains (UAL) ; `A_TPose` sert de pose de référence au reciblage. */
const HUMAN_CLIPS = ['A_TPose', 'Idle_LookAround_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Death01', 'Celebration', 'Hit_Chest']
const SKELETON_CLIPS = ['Idle_Combat', 'Idle_B', 'Taunt', 'Taunt_Longer', '1H_Melee_Attack_Chop', '2H_Melee_Attack_Spin', 'Skeletons_Inactive_Floor_Pose', 'Skeletons_Awaken_Floor', 'Lie_Idle', 'Cheer', 'Blocking']
const PROPS = [
  'tree_dead_large',
  'tree_dead_medium',
  'tree_pine_orange_large',
  'tree_pine_orange_medium',
  'tree_pine_yellow_large',
  'tree_pine_yellow_medium',
  'grave_A',
  'grave_B',
  'gravestone',
  'gravemarker_A',
  'crypt',
  'shrine_candles',
  'lantern_standing',
  'post_lantern',
  'fence',
  'fence_pillar',
  'pumpkin_orange_jackolantern',
  'pumpkin_yellow',
  'arch_gate',
  'candle_triple',
  'skull_candle',
  'bone_A',
]

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

// Décor : chaque accessoire devient un nœud nommé d'une même scène ; armes des squelettes comprises.
const props = new Document()
const scene = props.createScene('props')
const sources = [
  ...PROPS.map((name) => [name, `${HALLOWEEN}/${name}.gltf`]),
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
