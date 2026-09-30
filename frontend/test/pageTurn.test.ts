import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  STRIP,
  compose,
  constrain,
  dragPoint,
  foldLayout,
  invert,
  pointAt,
  progressOf,
  restClip,
  transformPoint,
  turnPath,
  type Point,
  type TurnGeometry,
} from '../src/lib/reader/pageTurn'

const W = 400
const H = 700
const DESKTOP = 1200

const single = (direction: 'next' | 'prev'): TurnGeometry => ({ mode: 'single', direction, width: W, height: H, spine: 0, swap: false })
const spread = (direction: 'next' | 'prev', swap = true): TurnGeometry => ({
  mode: 'spread',
  direction,
  width: DESKTOP,
  height: H,
  spine: DESKTOP / 2,
  swap,
})

const near = (actual: number, expected: number, tolerance = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`)
const nearPoint = (actual: Point, expected: Point, tolerance = 1e-3) => {
  near(actual.x, expected.x, tolerance)
  near(actual.y, expected.y, tolerance)
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

describe('page qui se plie — chemin du coin', () => {
  it('en avant, le coin du bord libre passe de l’autre côté de la reliure', () => {
    assert.deepEqual(turnPath(single('next'), 'bottom'), { start: { x: W, y: H }, end: { x: -W, y: H } })
    assert.deepEqual(turnPath(spread('next'), 'top'), { start: { x: DESKTOP, y: 0 }, end: { x: 0, y: 0 } })
    assert.deepEqual(turnPath(spread('prev'), 'bottom'), { start: { x: 0, y: H }, end: { x: DESKTOP, y: H } })
  })

  it('en arrière (page simple), la page précédente se déplie : même chemin, à l’envers', () => {
    assert.deepEqual(turnPath(single('prev'), 'bottom'), { start: { x: -W, y: H }, end: { x: W, y: H } })
  })

  it('un tap soulève d’abord le coin en diagonale', () => {
    assert.ok(pointAt(single('next'), 'bottom', 0.5).y < H - 50)
    assert.ok(pointAt(single('next'), 'top', 0.5).y > 50)
  })

  it('la feuille ne s’étire jamais : le coin reste à portée de la reliure', () => {
    const geometry = single('next')
    for (const point of [{ x: -900, y: -500 }, { x: 50, y: 2000 }, { x: -399, y: 690 }]) {
      const held = constrain(geometry, 'bottom', point)
      assert.ok(distance(held, { x: 0, y: H }) <= W + 1e-6)
      assert.ok(distance(held, { x: 0, y: 0 }) <= Math.hypot(W, H) + 1e-6)
    }
  })
})

describe('page qui se plie — transformations', () => {
  it('au repos, rien n’est plié et la découpe couvre toute la scène', () => {
    const layout = foldLayout(single('next'), 'bottom', pointAt(single('next'), 'bottom', 0))
    assert.equal(layout.fold, null)
    const { clip, unclip } = restClip(single('next'))
    for (const corner of [{ x: 0, y: 0 }, { x: W, y: H }]) {
      const inside = transformPoint(invert(clip), corner)
      assert.ok(inside.x > 0 && inside.x < layout.size && inside.y > 0 && inside.y < layout.size)
    }
    nearPoint(transformPoint(compose(clip, unclip), { x: 12, y: 34 }), { x: 12, y: 34 })
  })

  it('la découpe s’arrête au pli : son bord droit est à égale distance du coin et du doigt', () => {
    const geometry = single('next')
    const point = pointAt(geometry, 'bottom', 0.35)
    const { clip, size } = foldLayout(geometry, 'bottom', point)
    for (const y of [0, size / 3, size]) {
      const onFold = transformPoint(clip, { x: size, y })
      near(distance(onFold, { x: W, y: H }), distance(onFold, point), 1e-6)
    }
  })

  it('la page à plat reste en place dans son cadre', () => {
    const layout = foldLayout(single('next'), 'bottom', pointAt(single('next'), 'bottom', 0.5))
    nearPoint(transformPoint(compose(layout.clip, layout.unclip), { x: 100, y: 250 }), { x: 100, y: 250 })
  })

  it('le dos de la feuille est rabattu : son coin arrive sous le doigt', () => {
    const geometry = single('next')
    const point = pointAt(geometry, 'bottom', 0.3)
    const layout = foldLayout(geometry, 'bottom', point)
    assert.ok(layout.fold)
    // Coin bas-droit de la feuille (coordonnées de la boîte du dos) → scène.
    const corner = transformPoint(compose(layout.clip, layout.fold.back), { x: layout.sheet.width, y: H })
    nearPoint(corner, point, 1e-6)
  })

  it('le relief part du pli et couvre toute la partie rabattue', () => {
    const geometry = single('next')
    const point = { x: 100, y: H }
    const layout = foldLayout(geometry, 'bottom', point)
    assert.ok(layout.fold)
    // Pli vertical en x = 250 ; la bande (dans la feuille, avant rabat) va de 250 au bord, 400.
    const toStage = (q: Point) => transformPoint(layout.fold!.crease, q)
    near(toStage({ x: 0, y: layout.size / 2 }).x, (W + 100) / 2)
    near(toStage({ x: STRIP, y: layout.size / 2 }).x, W)
  })

  it('l’ombre sur la page découverte part du pli', () => {
    const layout = foldLayout(single('next'), 'bottom', { x: 100, y: H })
    near(transformPoint(layout.fold!.under, { x: 0, y: layout.size / 2 }).x, (W + 100) / 2)
  })
})

describe('page qui se plie — double page', () => {
  it('le dos de la feuille montre la page atteinte, qui se pose à l’endroit à la fin', () => {
    const geometry = spread('next')
    const layout = foldLayout(geometry, 'bottom', pointAt(geometry, 'bottom', 0.999))
    assert.ok(layout.fold?.verso)
    const content = compose(layout.clip, layout.fold.back, layout.fold.verso.mirror)
    nearPoint(transformPoint(content, { x: 100, y: 200 }), { x: 100, y: 200 }, 2)
  })

  it('chapitre suivant (pas de dos à montrer) : papier nu', () => {
    const geometry = spread('next', false)
    assert.equal(foldLayout(geometry, 'bottom', pointAt(geometry, 'bottom', 0.5)).fold?.verso, null)
  })

  it('la feuille est la moitié qui tourne', () => {
    assert.deepEqual(foldLayout(spread('next'), 'top', { x: DESKTOP, y: 0 }).sheet, { left: DESKTOP / 2, width: DESKTOP / 2 })
    assert.deepEqual(foldLayout(spread('prev'), 'top', { x: 0, y: 0 }).sheet, { left: 0, width: DESKTOP / 2 })
  })
})

describe('page qui se plie — au doigt', () => {
  it('sans mouvement, le coin est à sa place', () => {
    nearPoint(dragPoint(single('next'), 'bottom', 0, 0), { x: W, y: H }, 0.1)
    near(progressOf(single('next'), 'bottom', dragPoint(single('next'), 'bottom', 0, 0)), 0)
  })

  it('l’avancement suit le doigt, sans jamais reculer', () => {
    let previous = -1
    for (let dx = 0; dx >= -2 * W; dx -= 40) {
      const progress = progressOf(single('next'), 'bottom', dragPoint(single('next'), 'bottom', dx, -30))
      assert.ok(progress >= previous - 1e-9, `${dx} px : ${progress} < ${previous}`)
      previous = progress
    }
    near(previous, 1, 0.01)
  })

  it('en arrière, tirer vers la droite déplie la page précédente', () => {
    const geometry = single('prev')
    assert.ok(progressOf(geometry, 'bottom', dragPoint(geometry, 'bottom', W, 0)) > 0.4)
  })
})
