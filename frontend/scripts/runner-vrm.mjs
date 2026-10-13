/*
 * Prépare un personnage VRM (VRoid, VirtualCast…) pour le Manga Runner, sans rien perdre
 * de ce qui fait un VRM (os humanoïdes, expressions, cheveux à ressort, matériaux toon) :
 * le fichier est réécrit en place, indices conservés, seuls les octets changent.
 *
 *   - textures réencodées en WebP (EXT_texture_webp), plafonnées en taille ;
 *   - géométrie compressée meshopt (EXT_meshopt_compression, filtre exponentiel pour les
 *     flottants) : décodée par three.js à l'ouverture ;
 *   - accessoires retirés à la demande (maillages entiers ou sous-maillages par matériau).
 *
 * Dépendances (hors du projet, le temps de la conversion) :
 *   npm i --no-save meshoptimizer sharp
 *   node scripts/runner-vrm.mjs <entrée.vrm> <sortie.vrm>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage : runner-vrm.mjs <entrée.vrm> <sortie.vrm>')

/** Ce qu'on retire de Seed-san : le bras robot et le sac à dos (on garde l'aventurier). */
const DROP_MESHES = new Set(['robo_arm'])
const DROP_MATERIALS = new Set(['robo_face', 'glass', 'backpack_metal', 'green_emit', 'backpack_nm', 'backpack_plastic', 'arm_mat', 'arm_plastic'])
/** Taille maximale des textures (px) ; 0 = image remplacée par un pixel (plus utilisée). */
const TEXTURE_SIZE = { faceparts: 1024, body: 1024, wear: 1024, planekun_face: 512, thumbnail: 128 }
const DEFAULT_TEXTURE_SIZE = 512

// --- Lecture du GLB ---
const file = readFileSync(input)
const jsonLength = file.readUInt32LE(12)
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'))
const bin = file.subarray(20 + jsonLength + 8)
const viewBytes = (index) => {
  const view = gltf.bufferViews[index]
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
}

// --- Accessoires retirés ---
const meshMap = new Map()
const keptMeshes = []
gltf.meshes.forEach((mesh, index) => {
  if (DROP_MESHES.has(mesh.name)) return
  mesh.primitives = mesh.primitives.filter((primitive) => !DROP_MATERIALS.has(gltf.materials[primitive.material]?.name))
  if (!mesh.primitives.length) return
  meshMap.set(index, keptMeshes.length)
  keptMeshes.push(mesh)
})
gltf.meshes = keptMeshes
for (const node of gltf.nodes) {
  if (node.mesh === undefined) continue
  if (meshMap.has(node.mesh)) node.mesh = meshMap.get(node.mesh)
  else {
    delete node.mesh
    delete node.skin
  }
}
// Expressions : les liaisons vers un maillage retiré disparaissent.
const expressions = gltf.extensions?.VRMC_vrm?.expressions
for (const group of [expressions?.preset, expressions?.custom]) {
  for (const expression of Object.values(group ?? {})) {
    if (expression.morphTargetBinds) expression.morphTargetBinds = expression.morphTargetBinds.filter((bind) => gltf.nodes[bind.node]?.mesh !== undefined)
    if (expression.materialColorBinds) expression.materialColorBinds = expression.materialColorBinds.filter((bind) => !DROP_MATERIALS.has(gltf.materials[bind.material]?.name))
  }
}
const firstPerson = gltf.extensions?.VRMC_vrm?.firstPerson
if (firstPerson?.meshAnnotations) firstPerson.meshAnnotations = firstPerson.meshAnnotations.filter((annotation) => gltf.nodes[annotation.node]?.mesh !== undefined)

// --- Accessoires encore utilisés, renumérotés ---
const usedAccessors = new Set()
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    Object.values(primitive.attributes).forEach((index) => usedAccessors.add(index))
    if (primitive.indices !== undefined) usedAccessors.add(primitive.indices)
    for (const target of primitive.targets ?? []) Object.values(target).forEach((index) => usedAccessors.add(index))
  }
}
for (const skin of gltf.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices)
for (const animation of gltf.animations ?? []) for (const sampler of animation.samplers) usedAccessors.add(sampler.input).add(sampler.output)
const accessorMap = new Map()
const accessors = []
gltf.accessors.forEach((accessor, index) => {
  if (!usedAccessors.has(index)) return
  accessorMap.set(index, accessors.length)
  accessors.push(accessor)
})
const remap = (index) => accessorMap.get(index)
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(primitive.attributes[key])
    if (primitive.indices !== undefined) primitive.indices = remap(primitive.indices)
    for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = remap(target[key])
  }
}
for (const skin of gltf.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices)
for (const animation of gltf.animations ?? []) for (const sampler of animation.samplers) [sampler.input, sampler.output] = [remap(sampler.input), remap(sampler.output)]
gltf.accessors = accessors

// --- Textures encore utilisées (matériaux des sous-maillages gardés, vignette) ---
const usedMaterials = new Set(gltf.meshes.flatMap((mesh) => mesh.primitives.map((primitive) => primitive.material)))
const usedTextures = new Set()
const collect = (value) => {
  if (Array.isArray(value)) value.forEach(collect)
  else if (value && typeof value === 'object') {
    // Dans un matériau, tout objet porteur d'un `index` est une référence de texture.
    if (typeof value.index === 'number') usedTextures.add(value.index)
    Object.values(value).forEach(collect)
  }
}
usedMaterials.forEach((index) => collect(gltf.materials[index]))
const usedImages = new Set([...usedTextures].map((index) => gltf.textures[index].source))
const thumbnail = gltf.extensions?.VRMC_vrm?.meta?.thumbnailImage
if (thumbnail !== undefined) usedImages.add(thumbnail)

// --- Nouveau binaire : images WebP, puis vues meshopt ---
await MeshoptEncoder.ready
const chunks = []
let length = 0
const append = (bytes) => {
  const offset = length
  chunks.push(bytes)
  length += bytes.byteLength
  const pad = (4 - (length % 4)) % 4
  if (pad) {
    chunks.push(new Uint8Array(pad))
    length += pad
  }
  return offset
}
const views = []
let fallbackLength = 0

for (const [index, image] of gltf.images.entries()) {
  const used = usedImages.has(index)
  const limit = used ? (TEXTURE_SIZE[image.name] ?? DEFAULT_TEXTURE_SIZE) : 1
  const webp = await sharp(viewBytes(image.bufferView)).resize(limit, limit, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toBuffer()
  views.push({ buffer: 0, byteOffset: append(webp), byteLength: webp.byteLength })
  image.bufferView = views.length - 1
  image.mimeType = 'image/webp'
}
for (const texture of gltf.textures) {
  texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } }
  delete texture.source
}

const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const indexAccessors = new Set(gltf.meshes.flatMap((mesh) => mesh.primitives.filter((primitive) => (primitive.mode ?? 4) === 4).map((primitive) => primitive.indices)))
const positionAccessors = new Set(gltf.meshes.flatMap((mesh) => mesh.primitives.flatMap((primitive) => [primitive.attributes.POSITION, ...(primitive.targets ?? []).map((target) => target.POSITION)])))
const normalAccessors = new Set(gltf.meshes.flatMap((mesh) => mesh.primitives.flatMap((primitive) => [primitive.attributes.NORMAL, ...(primitive.targets ?? []).map((target) => target.NORMAL)])))

/** Une vue compressée (ou gardée telle quelle si meshopt ne peut pas la prendre) ; renvoie son nouvel indice. */
function encodeView(raw, count, stride, { indices = false, float = false, bits = 16, expMode = 'Separate' } = {}) {
  if (!indices && stride % 4 !== 0) {
    views.push({ buffer: 0, byteOffset: append(raw), byteLength: raw.byteLength })
    return views.length - 1
  }
  const fallback = { buffer: 1, byteOffset: fallbackLength, byteLength: raw.byteLength }
  fallbackLength += raw.byteLength + ((4 - (raw.byteLength % 4)) % 4)
  const mode = indices ? 'TRIANGLES' : 'ATTRIBUTES'
  const data = float ? MeshoptEncoder.encodeFilterExp(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), count, stride, bits, expMode) : raw
  const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode, 0)
  views.push({
    ...fallback,
    extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.byteLength, byteStride: stride, count, mode, ...(float && { filter: 'EXPONENTIAL' }) } },
  })
  return views.length - 1
}

for (const [index, accessor] of gltf.accessors.entries()) {
  const stride = SIZES[accessor.type] * BYTES[accessor.componentType]
  // Accessoire creux (cibles de morphose) : quelques sommets déplacés, indices puis valeurs.
  if (accessor.sparse) {
    const { indices, values } = accessor.sparse
    const indexBytes = BYTES[indices.componentType]
    const indexSource = viewBytes(indices.bufferView).subarray(indices.byteOffset ?? 0)
    indices.bufferView = encodeView(new Uint8Array(indexSource.subarray(0, accessor.sparse.count * indexBytes)), accessor.sparse.count, indexBytes)
    delete indices.byteOffset
    const valueSource = viewBytes(values.bufferView).subarray(values.byteOffset ?? 0)
    const float = accessor.componentType === 5126
    values.bufferView = encodeView(new Uint8Array(valueSource.subarray(0, accessor.sparse.count * stride)), accessor.sparse.count, stride, { float, bits: positionAccessors.has(index) ? 18 : 12 })
    delete values.byteOffset
  }
  // Accessoire sans vue : rempli de zéros par le lecteur (puis, s'il est creux, complété).
  if (accessor.bufferView === undefined) continue
  const source = viewBytes(accessor.bufferView)
  const raw = new Uint8Array(source.subarray(accessor.byteOffset ?? 0, (accessor.byteOffset ?? 0) + accessor.count * stride))
  const float = accessor.componentType === 5126 && accessor.type !== 'MAT4'
  const bits = positionAccessors.has(index) ? 18 : normalAccessors.has(index) ? 12 : 16
  accessor.bufferView = encodeView(raw, accessor.count, stride, { indices: indexAccessors.has(index), float, bits, expMode: positionAccessors.has(index) ? 'SharedComponent' : 'Separate' })
  delete accessor.byteOffset
}

gltf.bufferViews = views
gltf.buffers = [{ byteLength: length }, { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } }]
gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'EXT_meshopt_compression', 'EXT_texture_webp'])]
gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired ?? []), 'EXT_meshopt_compression', 'EXT_texture_webp'])]

// --- Écriture du GLB ---
const json = Buffer.from(JSON.stringify(gltf))
const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
const binChunk = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
const chunkHeader = (size, type) => {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(size, 0)
  buffer.writeUInt32LE(type, 4)
  return buffer
}
writeFileSync(output, Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]))
console.log(`${input} → ${output} : ${(file.length / 1024).toFixed(0)} Ko → ${((12 + 16 + jsonChunk.length + binChunk.length) / 1024).toFixed(0)} Ko`)
