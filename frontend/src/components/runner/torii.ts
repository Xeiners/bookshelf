import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { canvasTexture } from './toon'

/*
 * Le torii du Manga Runner, de style myōjin, à ses vraies proportions : piliers vermillon
 * à peine inclinés vers l'intérieur, manchons noirs (kamaki) sur un socle de pierre,
 * anneaux noirs (daiwa) en tête ; poutre basse (nuki) qui traverse les piliers, tenue par
 * des cales ; double linteau, vermillon (shimaki) sous noir (kasagi), aux extrémités
 * relevées et coiffées d'or ; au centre, la plaque (gaku) cerclée d'or. Sous la poutre,
 * la corde sacrée (shimenawa) torsadée, ses papiers en zigzag (shide) et une clochette :
 * c'est elle qu'on passe en glissant.
 *
 * Chaque partie est une géométrie fusionnée à couleurs par sommet : un seul appel de
 * dessin pour tous les torii, un autre pour les cordes (qui se balancent), un pour les
 * plaques (texture).
 */

const VERMILION = '#d23a22'
const VERMILION_DARK = '#a92a18'
const BLACK = '#1d1719'
const GOLD = '#e0b04a'
const STONE = '#8f8a84'
const STRAW = '#d7c38a'
const STRAW_DARK = '#b59f63'
const PAPER = '#fbf8f1'

/** Demi-écart des piliers (m) ; hauteur du dessous de la poutre basse. */
export const TORII_HALF_SPAN = 1.05
const NUKI_Y = 2.85

/** Donne une couleur unie aux sommets d'une géométrie (non indexée, prête à fusionner). */
function paint(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  const tint = new THREE.Color(color)
  const colors = new Float32Array(flat.attributes.position!.count * 3)
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r
    colors[index + 1] = tint.g
    colors[index + 2] = tint.b
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (!flat.attributes.uv) flat.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(flat.attributes.position!.count * 2), 2))
  return flat
}

/** Une poutre courbe : relevée vers les bouts (sorimashi), un peu plus large en haut. */
function curvedBeam(width: number, height: number, depth: number, lift: number, flare: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 40, 1, 1)
  const position = geometry.attributes.position!
  const half = width / 2
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / half
    const top = position.getY(index) > 0
    position.setY(index, position.getY(index) + lift * (0.25 * x * x + 0.75 * Math.abs(x) ** 3.2) + (top ? flare * Math.abs(x) ** 3 : 0))
    if (top) position.setZ(index, position.getZ(index) * 1.12)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Le torii, sans sa corde ni sa plaque, posé au sol, centré sur sa voie. */
export function toriiGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    const x = side * TORII_HALF_SPAN
    // Pilier, légèrement incliné vers l'intérieur (le haut plus près du centre).
    const pillar = new THREE.CylinderGeometry(0.155, 0.19, 3.62, 20)
    pillar.translate(0, 1.81, 0)
    pillar.rotateZ(side * 0.025)
    pillar.translate(x, 0, 0)
    parts.push(paint(pillar, VERMILION))
    const plinth = new THREE.CylinderGeometry(0.32, 0.36, 0.14, 20)
    plinth.translate(x, 0.07, 0)
    parts.push(paint(plinth, STONE))
    const kamaki = new THREE.CylinderGeometry(0.235, 0.25, 0.46, 20)
    kamaki.translate(x, 0.37, 0)
    parts.push(paint(kamaki, BLACK))
    const band = new THREE.CylinderGeometry(0.255, 0.255, 0.05, 20)
    band.translate(x, 0.62, 0)
    parts.push(paint(band, GOLD))
    // Anneau noir en tête de pilier (daiwa), sous le linteau.
    const daiwa = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 20)
    daiwa.translate(x - side * 0.075, 3.48, 0)
    parts.push(paint(daiwa, BLACK))
    // Cales (kusabi) de la poutre basse, de part et d'autre du pilier.
    for (const face of [-1, 1]) {
      const wedge = new THREE.BoxGeometry(0.12, 0.17, 0.05)
      wedge.translate(x - side * 0.07, NUKI_Y + 0.1, face * 0.13)
      parts.push(paint(wedge, BLACK))
    }
  }
  // Poutre basse (nuki) : elle traverse les piliers et dépasse un peu.
  const nuki = new THREE.BoxGeometry(2.95, 0.2, 0.15)
  nuki.translate(0, NUKI_Y + 0.1, 0)
  parts.push(paint(nuki, VERMILION_DARK))
  // Montant central (gakuzuka) entre la poutre et le linteau.
  const strut = new THREE.BoxGeometry(0.16, 0.6, 0.13)
  strut.translate(0, NUKI_Y + 0.5, 0)
  parts.push(paint(strut, VERMILION_DARK))
  // Double linteau : shimaki vermillon, kasagi noir par-dessus, bouts relevés coiffés d'or.
  const shimaki = curvedBeam(3.55, 0.2, 0.26, 0.12, 0)
  shimaki.translate(0, 3.66, 0)
  parts.push(paint(shimaki, VERMILION))
  const kasagi = curvedBeam(3.95, 0.24, 0.36, 0.3, 0.06)
  kasagi.translate(0, 3.88, 0)
  parts.push(paint(kasagi, BLACK))
  for (const side of [-1, 1]) {
    const cap = new THREE.BoxGeometry(0.06, 0.32, 0.42)
    cap.translate(side * 1.97, 4.2, 0)
    parts.push(paint(cap, GOLD))
  }
  return mergeGeometries(parts)!
}

/**
 * La corde sacrée, ses papiers et sa clochette, accrochée sous la poutre basse : origine au
 * point d'attache (pour qu'elle se balance autour), entre les deux piliers.
 */
export function shimenawaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const half = TORII_HALF_SPAN - 0.17
  const sag = (t: number) => -Math.sin(t * Math.PI) * 0.28
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, step) => new THREE.Vector3(-half + (step / 12) * half * 2, sag(step / 12), 0)))
  // Deux torons enroulés l'un sur l'autre : la corde paraît tressée.
  parts.push(paint(new THREE.TubeGeometry(curve, 48, 0.085, 10, false), STRAW))
  const twist = new THREE.CatmullRomCurve3(
    Array.from({ length: 97 }, (_, step) => {
      const t = step / 96
      const angle = t * Math.PI * 22
      return new THREE.Vector3(-half + t * half * 2, sag(t) + Math.cos(angle) * 0.07, Math.sin(angle) * 0.07)
    }),
  )
  parts.push(paint(new THREE.TubeGeometry(twist, 192, 0.032, 6, false), STRAW_DARK))
  // Papiers en zigzag (shide), quatre le long de la corde.
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    const x = -half + t * half * 2
    const top = sag(t) - 0.06
    const shape = new THREE.Shape()
    const steps = [
      [0, 0],
      [0.1, 0],
      [0.1, -0.11],
      [0.16, -0.11],
      [0.16, -0.24],
      [0.08, -0.24],
      [0.08, -0.37],
      [0.14, -0.37],
      [0.14, -0.5],
      [0.04, -0.5],
      [0.04, -0.37],
      [-0.02, -0.37],
      [-0.02, -0.24],
      [0.06, -0.24],
      [0.06, -0.11],
      [0, -0.11],
    ] as const
    shape.moveTo(steps[0][0], steps[0][1])
    for (const [px, py] of steps.slice(1)) shape.lineTo(px, py)
    shape.closePath()
    const paper = new THREE.ShapeGeometry(shape)
    paper.translate(x - 0.07, top, 0.02)
    parts.push(paint(paper, PAPER))
    const back = paper.clone()
    back.rotateY(Math.PI)
    back.translate(2 * x, 0, 0)
    parts.push(paint(back, PAPER))
  }
  // Clochette dorée (suzu) au milieu, sur son cordon rouge.
  const cord = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6)
  cord.translate(0, sag(0.5) - 0.17, 0)
  parts.push(paint(cord, VERMILION))
  const bell = new THREE.SphereGeometry(0.075, 16, 12)
  bell.translate(0, sag(0.5) - 0.3, 0)
  parts.push(paint(bell, GOLD))
  return mergeGeometries(parts)!
}

/** La plaque du torii : cadre d'or, fond noir laqué, « 漫画 » (manga) en lettres d'or. */
export function plaqueTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 192, (context) => {
    context.fillStyle = GOLD
    context.fillRect(0, 0, 128, 192)
    context.fillStyle = '#7c5a1c'
    context.fillRect(8, 8, 112, 176)
    context.fillStyle = BLACK
    context.fillRect(14, 14, 100, 164)
    context.fillStyle = '#f2cf6c'
    context.font = 'bold 64px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('漫', 64, 60) // i18n-ignore (inscription du torii)
    context.fillText('画', 64, 134) // i18n-ignore (inscription du torii)
  })
}
