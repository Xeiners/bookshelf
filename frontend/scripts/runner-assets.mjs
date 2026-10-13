/**
 * Prépare les modèles 3D du Manga Runner (packs KayKit de Kay Lousberg, licence CC0).
 *
 * Sources (git, dossier `SRC`) :
 *   KayKit-Character-Pack-Adventures-1.0, KayKit-Character-Pack-Skeletons-1.0,
 *   KayKit-Halloween-Bits-1.0 (github.com/KayKit-Game-Assets).
 *
 * Sorties (frontend/public/runner/) : un fichier par héros (sans animations, une arme
 * légère gardée), `hero-anims.glb` (les clips du héros, communs à tous : même squelette),
 * un fichier par squelette monstre, `skeleton-anims.glb`, et `props.glb` (décor : arbres,
 * tombes, lanternes… un nœud par accessoire). Textures réduites (WebP), maillages
 * compressés (meshopt) : quelques centaines de Ko par fichier.
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
const OUT = process.env.OUT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/runner')
mkdirSync(OUT, { recursive: true })

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

const ADVENTURERS = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf`
const SKELETONS = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`
const HALLOWEEN = `${SRC}/hw/addons/kaykit_halloween_bits/Assets/gltf`

/** Héros : ce qu'on garde de leur équipement (le reste est retiré). */
const HEROES = {
  Rogue_Hooded: ['Knife'],
  Rogue: ['Knife'],
  Knight: ['1H_Sword'],
  Barbarian: ['1H_Axe'],
  Mage: ['1H_Wand'],
}
const HERO_ACCESSORIES = ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', '1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff']
const HERO_CLIPS = ['Idle', 'Running_A', 'Running_B', 'Jump_Start', 'Jump_Idle', 'Jump_Land', 'Dodge_Forward', 'Dodge_Left', 'Dodge_Right', 'Death_A', 'Cheer', 'Hit_A', 'Lie_StandUp']
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

/** Retire des nœuds par nom (et ce qui n'est plus utilisé, au `prune`). */
function dropNodes(document, names) {
  for (const node of document.getRoot().listNodes()) if (names.includes(node.getName())) node.dispose()
}

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

/** Animations seules : on garde le squelette (nœuds animés), on retire les maillages. */
async function animationsOnly(source, clips, file) {
  const document = await io.read(source)
  keepClips(document, clips)
  for (const node of document.getRoot().listNodes()) {
    node.setMesh(null)
    node.setSkin(null)
  }
  for (const mesh of document.getRoot().listMeshes()) mesh.dispose()
  await document.transform(resample(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  await io.write(path.join(OUT, file), document)
}

for (const [hero, keep] of Object.entries(HEROES)) {
  const document = await io.read(`${ADVENTURERS}/${hero}.glb`)
  keepClips(document, [])
  dropNodes(document, HERO_ACCESSORIES.filter((name) => !keep.includes(name)))
  await finish(document, `${hero.toLowerCase()}.glb`)
}
await animationsOnly(`${ADVENTURERS}/Rogue_Hooded.glb`, HERO_CLIPS, 'hero-anims.glb')

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
