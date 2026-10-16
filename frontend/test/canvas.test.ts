/**
 * Toile partagée, logique pure du client : géométrie (mêmes encombrements que le serveur),
 * transformations, tests de clic, courbes, simplification, caméra, index de scène, historique.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HEX, hexToHsl, hslToHex, readableOn } from '../src/lib/canvas/color'
import { Camera, MAX_ZOOM, MIN_ZOOM, clampZoom, tileLevelFor } from '../src/lib/canvas/camera'
import { boundsOf, compose, distanceToSegment, drawOrder, flattenBezier, hitTest, moved, normalizedRect, rotation, scaling, simplifyStroke, topObjectAt, transformData, translation, unionBox } from '../src/lib/canvas/geometry'
import { History } from '../src/lib/canvas/history'
import { Scene } from '../src/lib/canvas/scene'
import type { CanvasObject, Data } from '../src/lib/canvas/types'

const near = (actual: number, expected: number, epsilon = 0.011) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`)
const object = (id: string, data: Data, z = 1, owner = 'u1'): CanvasObject => ({ id, owner, data, z, v: 1, likes: 0, hidden: false, box: boundsOf(data) })

describe('Toile — géométrie', () => {
  it('encombrement : mêmes valeurs que le serveur (golden)', () => {
    const cases: [Data, [number, number, number, number]][] = [
      [{ t: 's', c: '#112233', sw: 4, p: [0, 0, 0.5, 30, 10, 0.6, 55, -8, 0.4] }, [-2, -10, 57, 12]],
      [{ t: 's', c: '#112233', sw: 6, b: 'neon', p: [10, 10, 0.5, 30, 10, 0.6] }, [0.4, 0.4, 39.6, 19.6]],
      [{ t: 'r', x: 10, y: 20, w: 100, h: 50, c: '#000000', f: '#ff0000', sw: 3 }, [8.5, 18.5, 111.5, 71.5]],
      [{ t: 'r', x: 10, y: 20, w: 100, h: 50, c: '#000000', f: null, sw: 3, r: 0.6 }, [3.12, -5.37, 116.88, 95.37]],
      [{ t: 'e', x: -40, y: 20, w: 80, h: 30, c: '#000000', sw: 2, r: -1.1 }, [-32.51, -8.45, 32.51, 78.45]],
      [{ t: 'a', q: [0, 0, 80, 40], c: '#000000', sw: 5 }, [-28, -28, 108, 68]],
      [{ t: 'g', q: [0, 0, 50, 10, 30, 70], cl: 1, c: '#000000', f: '#00ff00', sw: 4 }, [-2, -2, 52, 72]],
      [{ t: 'x', x: 5, y: 7, s: 24, tx: 'Bonjour\nle monde', c: '#000000', sw: 0 }, [5, 7, 124.04, 67]],
      [{ t: 'x', x: 5, y: 7, s: 24, tx: 'Salut', c: '#000000', sw: 0, al: 2 }, [-69.4, 7, 5, 37]],
      [{ t: 'f', x: 100, y: 100, w: 400, h: 300, tt: 'X', c: '#1b1b1f', f: '#ffffff', sw: 2, co: [] }, [100, 56, 500, 400]],
    ]
    for (const [data, [minX, minY, maxX, maxY]] of cases) {
      const box = boundsOf(data)
      near(box.minX, minX)
      near(box.minY, minY)
      near(box.maxX, maxX)
      near(box.maxY, maxY)
    }
  })

  it('transformations : déplacer, mettre à l’échelle, tourner, cuire dans les points', () => {
    const line: Data = { t: 'l', q: [0, 0, 10, 0], c: '#000000', sw: 2 }
    assert.deepEqual((moved(line, 5, -3) as { q: number[] }).q, [5, -3, 15, -3])
    const rect: Data = { t: 'r', x: 0, y: 0, w: 20, h: 10, c: '#000000', f: null, sw: 2 }
    const doubled = transformData(rect, scaling(2, 3, 0, 0)) as { w: number; h: number; x: number; y: number }
    assert.deepEqual([doubled.x, doubled.y, doubled.w, doubled.h], [0, 0, 40, 30])
    // Rotation d'un quart de tour autour du centre : un rectangle garde sa taille et prend `r`.
    const turned = transformData(rect, rotation(Math.PI / 2, 10, 5)) as { r?: number; w: number; h: number; x: number; y: number }
    near(turned.r ?? 0, 1.57)
    near(turned.w, 20)
    near(turned.x + turned.w / 2, 10)
    near(turned.y + turned.h / 2, 5)
    // Un trait : les points sont recalculés, l'épaisseur suit l'échelle moyenne.
    const stroke: Data = { t: 's', c: '#000000', sw: 4, p: [0, 0, 0.5, 10, 0, 0.5] }
    const grown = transformData(stroke, scaling(2, 2, 0, 0)) as { p: number[]; sw: number }
    assert.deepEqual(grown.p, [0, 0, 0.5, 20, 0, 0.5])
    assert.equal(grown.sw, 8)
    // Composition : d'abord déplacer, puis tourner.
    const m = compose(rotation(Math.PI, 0, 0), translation(10, 0))
    const flipped = transformData({ t: 'l', q: [0, 0, 0, 0], c: '#000000', sw: 1 }, m) as { q: number[] }
    near(flipped.q[0]!, -10)
    // Un cadre se redimensionne mais ne tourne pas.
    const frame: Data = { t: 'f', x: 0, y: 0, w: 200, h: 100, tt: '', c: '#000000', f: '#ffffff', sw: 2, co: [] }
    const bigger = transformData(frame, compose(scaling(2, 2, 0, 0), rotation(1, 0, 0))) as { r?: number }
    assert.equal(bigger.r, undefined)
  })

  it('un rectangle tourné, mis à l’échelle dans ses axes, garde sa rotation', () => {
    const rect: Data = { t: 'r', x: 0, y: 0, w: 40, h: 20, c: '#000000', f: null, sw: 2, r: Math.PI / 4 }
    const cx = 20
    const cy = 10
    // Étirer de ×2 le long de l'axe propre : conjugaison de l'échelle par la rotation.
    const m = compose(translation(cx, cy), compose(rotation(Math.PI / 4, 0, 0), compose(scaling(2, 1, 0, 0), compose(rotation(-Math.PI / 4, 0, 0), translation(-cx, -cy)))))
    const next = transformData(rect, m) as { w: number; h: number; r: number }
    near(next.w, 80)
    near(next.h, 20)
    near(next.r, Math.PI / 4)
  })

  it('tests de clic : trait, contour sans remplissage, remplissage, ellipse, texte, courbe', () => {
    const stroke: Data = { t: 's', c: '#000000', sw: 6, p: [0, 0, 0.5, 100, 0, 0.5] }
    assert.equal(hitTest(stroke, 50, 2, 1), true)
    assert.equal(hitTest(stroke, 50, 12, 1), false)
    const hollow: Data = { t: 'r', x: 0, y: 0, w: 100, h: 100, c: '#000000', f: null, sw: 4 }
    assert.equal(hitTest(hollow, 50, 50, 2), false, 'le vide d’un rectangle creux')
    assert.equal(hitTest(hollow, 50, 1, 2), true, 'son contour')
    assert.equal(hitTest({ ...hollow, f: '#ff0000' }, 50, 50, 2), true)
    const ellipse: Data = { t: 'e', x: 0, y: 0, w: 100, h: 50, c: '#000000', f: '#ff0000', sw: 2 }
    assert.equal(hitTest(ellipse, 50, 25, 1), true)
    assert.equal(hitTest(ellipse, 2, 2, 1), false, 'le coin d’une ellipse est vide')
    const text: Data = { t: 'x', x: 0, y: 0, s: 20, tx: 'Salut', c: '#000000', sw: 0 }
    assert.equal(hitTest(text, 10, 10, 1), true)
    assert.equal(hitTest(text, 200, 10, 1), false)
    const curve: Data = { t: 'b', n: [0, 0, 0, 0, 0, 0, 100, 0, 100, 0, 100, 0], c: '#000000', sw: 4 }
    assert.equal(hitTest(curve, 50, 1, 2), true)
    assert.equal(hitTest(curve, 50, 30, 2), false)
    const tilted: Data = { t: 'r', x: 0, y: 0, w: 100, h: 20, c: '#000000', f: '#000000', sw: 0, r: Math.PI / 2 }
    assert.equal(hitTest(tilted, 50, 60, 1), true, 'rotation prise en compte')
  })

  it('l’objet du dessus : empilement, et les cadres toujours au fond', () => {
    const frame = object('f', { t: 'f', x: 0, y: 0, w: 300, h: 300, tt: '', c: '#000000', f: '#ffffff', sw: 2, co: [] }, 99)
    const low = object('a', { t: 'r', x: 10, y: 10, w: 100, h: 100, c: '#000000', f: '#ff0000', sw: 1 }, 1)
    const high = object('b', { t: 'r', x: 10, y: 10, w: 100, h: 100, c: '#000000', f: '#00ff00', sw: 1 }, 2)
    assert.equal(topObjectAt([frame, low, high], 50, 50, 2)?.id, 'b')
    assert.equal(topObjectAt([frame, low], 200, 200, 2)?.id, 'f')
    assert.deepEqual([high, frame, low].sort(drawOrder).map((entry) => entry.id), ['f', 'a', 'b'])
  })

  it('courbes de Bézier et distance à un segment', () => {
    const flat = flattenBezier([0, 0, 0, 0, 33, 0, 100, 0, 66, 0, 100, 0], false, 10)
    assert.equal(flat.length, 22)
    assert.deepEqual([flat[0], flat[1], flat[20], flat[21]], [0, 0, 100, 0])
    near(distanceToSegment(5, 5, 0, 0, 10, 0), 5)
    near(distanceToSegment(-3, 4, 0, 0, 10, 0), 5)
    assert.equal(flattenBezier([0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 20, 0, 20, 0, 20, 0], true, 4).length, 26)
  })

  it('simplification d’un tracé : garde les angles, pas les points alignés', () => {
    const line: number[] = []
    for (let x = 0; x <= 100; x += 2) line.push(x, 0, 0.5)
    assert.equal(simplifyStroke(line, 0.5).length, 6, 'une ligne droite se réduit à ses deux bouts')
    const corner: number[] = []
    for (let x = 0; x <= 50; x += 5) corner.push(x, 0, 0.5)
    for (let y = 5; y <= 50; y += 5) corner.push(50, y, 0.5)
    const simple = simplifyStroke(corner, 0.5)
    assert.equal(simple.length, 9, 'le coin est gardé')
    assert.deepEqual(simple.slice(3, 5), [50, 0])
    assert.deepEqual(normalizedRect(10, 20, 4, 30), { x: 4, y: 20, w: 6, h: 10 })
    assert.deepEqual(unionBox([{ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: -2, minY: 3, maxX: 1, maxY: 9 }]), { minX: -2, minY: 0, maxX: 5, maxY: 9 })
  })
})

describe('Toile — caméra', () => {
  it('le point sous le pointeur ne bouge pas quand on zoome', () => {
    const camera = new Camera()
    camera.setSize(800, 600)
    camera.x = 100
    camera.y = -50
    const [wx, wy] = camera.toWorld(300, 200)
    camera.zoomAt(300, 200, 2.5)
    const [ax, ay] = camera.toWorld(300, 200)
    near(ax, wx, 1e-9)
    near(ay, wy, 1e-9)
    assert.equal(camera.zoom, 2.5)
    camera.zoomAt(0, 0, 1e9)
    assert.equal(camera.zoom, MAX_ZOOM)
    camera.zoomAt(0, 0, 1e-12)
    assert.equal(camera.zoom, MIN_ZOOM)
    assert.equal(clampZoom(10_000), MAX_ZOOM)
  })

  it('déplacement, écran ↔ monde, redimensionnement autour du centre', () => {
    const camera = new Camera()
    camera.setSize(400, 300)
    camera.setCenter(1000, 2000)
    assert.deepEqual(camera.center(), [1000, 2000])
    camera.panBy(100, 0)
    assert.deepEqual(camera.center(), [900, 2000])
    const [sx, sy] = camera.toScreen(900, 2000)
    assert.deepEqual([sx, sy], [200, 150])
    camera.setSize(800, 600)
    assert.deepEqual(camera.center(), [900, 2000])
    const box = camera.bounds()
    near(box.maxX - box.minX, 800)
  })

  it('vol vers un point : arrive à destination, zoom compris ; zoom lissé qui converge', () => {
    const camera = new Camera()
    camera.setSize(500, 500)
    camera.flyTo(5000, -3000, 2, 100, 0)
    assert.equal(camera.tick(0.016, 50), true)
    camera.tick(0.016, 200)
    const [cx, cy] = camera.center()
    near(cx, 5000, 0.01)
    near(cy, -3000, 0.01)
    near(camera.zoom, 2, 1e-6)
    assert.equal(camera.moving, false)
    camera.zoomSmooth(250, 250, 2)
    let steps = 0
    while (camera.moving && steps < 200) {
      camera.tick(0.016)
      steps += 1
    }
    near(camera.zoom, 4, 0.01)
    camera.fit({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 0, 10)
    camera.tick(0.016, performance.now() + 100)
    near(camera.zoom, 0.5, 1e-6)
  })

  it('niveau de tuile : plus on s’éloigne, plus le niveau monte (jusqu’au plafond)', () => {
    assert.equal(tileLevelFor(0.5, 11), 0)
    assert.equal(tileLevelFor(0.25, 11), 1)
    assert.equal(tileLevelFor(0.1, 11), 2)
    assert.equal(tileLevelFor(0.0001, 11), 11)
    assert.equal(tileLevelFor(5, 11), 0)
  })
})

describe('Toile — scène et historique', () => {
  it('index spatial : ne rend que le visible, dans l’ordre ; versions et cases', () => {
    const scene = new Scene()
    const a = object('a', { t: 'r', x: 0, y: 0, w: 10, h: 10, c: '#000000', f: null, sw: 1 }, 5)
    const b = object('b', { t: 'r', x: 5, y: 5, w: 10, h: 10, c: '#000000', f: null, sw: 1 }, 2)
    const far = object('c', { t: 'r', x: 9000, y: 9000, w: 10, h: 10, c: '#000000', f: null, sw: 1 }, 1)
    for (const entry of [a, b, far]) scene.upsert(entry, '0:0')
    assert.deepEqual(scene.query({ minX: -5, minY: -5, maxX: 50, maxY: 50 }).map((entry) => entry.id), ['b', 'a'])
    // Une version plus ancienne ne remplace pas.
    assert.equal(scene.upsert({ ...a, v: 0, z: 99 }), false)
    assert.equal(scene.get('a')?.z, 5)
    assert.equal(scene.upsert({ ...a, v: 2, z: 7 }), true)
    // Un objet déplacé n'est plus à son ancienne place.
    const moved = { ...b, v: 2, data: { ...b.data, x: 500 } as Data }
    moved.box = boundsOf(moved.data)
    scene.upsert(moved)
    assert.deepEqual(scene.query({ minX: -5, minY: -5, maxX: 50, maxY: 50 }).map((entry) => entry.id), ['a'])
    // Une case qui sort de la vue emporte ses objets.
    scene.upsert(object('d', { t: 'r', x: 1, y: 1, w: 1, h: 1, c: '#000000', f: null, sw: 1 }), '7:7')
    scene.dropCell('0:0')
    assert.equal(scene.get('a'), undefined)
    assert.ok(scene.get('d'))
    scene.dropCell('7:7', (id) => id === 'd')
    assert.ok(scene.get('d'), 'un objet en attente de confirmation reste')
  })

  it('aperçus des autres joueurs : par joueur, expirent', () => {
    const scene = new Scene()
    const data: Data = { t: 's', c: '#000000', sw: 2, p: [0, 0, 0.5] }
    scene.setGhost({ conn: 1, id: 'x', data, at: 0 })
    scene.setGhost({ conn: 2, id: 'y', data, at: 0 })
    scene.endGhostsOf(1)
    assert.equal(scene.ghosts.size, 1)
    scene.expireGhosts(100_000)
    assert.equal(scene.ghosts.size, 0)
  })

  it('historique : annuler, rétablir, un nouveau geste efface l’avenir, un refus s’oublie', () => {
    const history = new History()
    const one = { undo: [{ k: 'd' as const, id: 'a' }], redo: [{ k: 'c' as const, id: 'a', o: {} }] }
    const two = { undo: [{ k: 'd' as const, id: 'b' }], redo: [{ k: 'c' as const, id: 'b', o: {} }] }
    history.push(one)
    history.push(two)
    assert.equal(history.undo(), two)
    assert.equal(history.canRedo, true)
    assert.equal(history.redo(), two)
    history.undo()
    history.push({ undo: [], redo: [] })
    assert.equal(history.canRedo, false, 'un nouveau geste efface ce qu’on pouvait rétablir')
    history.discard(one)
    history.forget('b')
    assert.equal(history.undo()?.undo.length, 0)
    assert.equal(history.canUndo, false)
  })
})

describe('Toile — couleurs', () => {
  it('teinte / saturation / clarté ↔ hexadécimal, sans perte visible', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#7c5cff', '#ffc233', '#1b1b1f', '#ffffff', '#000000']) {
      assert.equal(hslToHex(hexToHsl(hex)), hex)
    }
    near(hexToHsl('#ff0000').h, 0, 0.5)
    near(hexToHsl('#00ff00').h, 120, 0.5)
    near(hexToHsl('#808080').s, 0, 0.5)
    assert.equal(HEX.test('#a1b2c3'), true)
    assert.equal(HEX.test('a1b2c3'), false)
    assert.equal(HEX.test('#12345'), false)
  })

  it('texte lisible : noir sur clair, blanc sur sombre', () => {
    assert.equal(readableOn('#ffe66d'), '#000000')
    assert.equal(readableOn('#0b3d91'), '#ffffff')
  })
})
