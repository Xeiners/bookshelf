/** Page Stack : la simulation (glissade, pose, coupe, parfaite, série, fin de partie) et ses barèmes. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BASE_SPEED, COMBO_CAP, COMBO_STEP, GROW_AFTER, INITIAL_WIDTH, MAX_SPEED, PAGE_POINTS, PERFECT_BONUS, PERFECT_TOLERANCE, placePoints, speedFor } from '../src/lib/stack/constants'
import { createStack, drain, limits, outcomeOf, pageCount, step, tap, type StackState } from '../src/lib/stack/engine'

/** Pose la page mouvante à `offset` du haut de la pile, puis tape. */
function dropAt(state: StackState, offset: number): void {
  const top = state.pages[state.pages.length - 1]!
  state.moving!.x = top.x + offset
  tap(state)
}

describe('page stack — barèmes', () => {
  it('points : page simple, parfaite, combo plafonné', () => {
    assert.equal(placePoints(false, 0), PAGE_POINTS)
    assert.equal(placePoints(true, 1), PAGE_POINTS + PERFECT_BONUS)
    assert.equal(placePoints(true, 4), PAGE_POINTS + PERFECT_BONUS + 3 * COMBO_STEP)
    assert.equal(placePoints(true, 50), placePoints(true, COMBO_CAP))
  })

  it('la vitesse monte avec les pages, jusqu’à un plafond', () => {
    assert.equal(speedFor(0), BASE_SPEED)
    assert.ok(speedFor(20) > speedFor(10))
    assert.equal(speedFor(10_000), MAX_SPEED)
  })
})

describe('page stack — simulation', () => {
  it('départ : une base, une page qui glisse depuis le bord gauche', () => {
    const state = createStack()
    assert.equal(state.pages.length, 1)
    assert.equal(pageCount(state), 0)
    assert.equal(state.moving!.x, limits(INITIAL_WIDTH)[0])
    assert.equal(state.moving!.dir, 1)
  })

  it('la page rebondit sur les bords et ne sort jamais des bornes', () => {
    const state = createStack()
    const [low, high] = limits(state.moving!.w)
    let turned = 0
    let last = state.moving!.dir
    for (let frame = 0; frame < 60 * 12; frame += 1) {
      step(state, 1 / 60)
      assert.ok(state.moving!.x >= low - 1e-9 && state.moving!.x <= high + 1e-9)
      if (state.moving!.dir !== last) turned += 1
      last = state.moving!.dir
    }
    assert.ok(turned >= 4, 'plusieurs allers-retours')
  })

  it('pose parfaite : même largeur, centre aligné, points et série', () => {
    const state = createStack()
    dropAt(state, PERFECT_TOLERANCE * 0.9)
    const [event] = drain(state)
    assert.equal(event!.type, 'place')
    assert.equal((event as { perfect: boolean }).perfect, true)
    assert.equal(state.pages[1]!.x, 0.5, 'recalée sur la pile')
    assert.equal(state.pages[1]!.w, INITIAL_WIDTH)
    assert.equal(state.score, placePoints(true, 1))
    assert.deepEqual([state.combo, state.perfects, pageCount(state)], [1, 1, 1])
    assert.equal(drain(state).length, 0, 'événements consommés une fois')
  })

  it('pose décalée : la page se réduit au chevauchement, le surplus tombe du bon côté', () => {
    const state = createStack()
    dropAt(state, 0.1)
    const placed = state.pages[1]!
    assert.ok(Math.abs(placed.w - (INITIAL_WIDTH - 0.1)) < 1e-9)
    assert.ok(Math.abs(placed.x - (0.5 + 0.05)) < 1e-9, 'centre du chevauchement')
    const event = drain(state)[0] as Extract<ReturnType<typeof drain>[number], { type: 'place' }>
    assert.equal(event.perfect, false)
    assert.ok(Math.abs(event.cut!.w - 0.1) < 1e-9)
    assert.ok(event.cut!.x > placed.x, 'le surplus est à droite')
    assert.equal(state.score, PAGE_POINTS)
    assert.equal(state.combo, 0)

    const mirror = createStack()
    dropAt(mirror, -0.1)
    const cutLeft = (drain(mirror)[0] as { cut: { x: number } }).cut
    assert.ok(cutLeft.x < mirror.pages[1]!.x, 'le surplus est à gauche')
  })

  it('une pose ratée casse la série', () => {
    const state = createStack()
    dropAt(state, 0)
    dropAt(state, 0)
    assert.equal(state.combo, 2)
    dropAt(state, 0.05)
    assert.equal(state.combo, 0)
    assert.equal(state.bestCombo, 2)
  })

  it('en série, les parfaites redonnent de la largeur (jamais au-delà de la largeur de départ)', () => {
    const state = createStack()
    dropAt(state, 0.12)
    const narrowed = state.pages[1]!.w
    assert.ok(narrowed < INITIAL_WIDTH)
    for (let index = 0; index < GROW_AFTER - 1; index += 1) dropAt(state, 0)
    const before = state.pages[state.pages.length - 1]!.w
    assert.equal(before, narrowed, 'pas de gain avant la série')
    dropAt(state, 0)
    const after = state.pages[state.pages.length - 1]!.w
    assert.ok(after > before, 'la série redonne de la largeur')
    for (let index = 0; index < 40; index += 1) dropAt(state, 0)
    assert.equal(state.pages[state.pages.length - 1]!.w, INITIAL_WIDTH)
    assert.equal(drain(state).some((event) => event.type === 'place' && event.grown), true)
  })

  it('sans chevauchement, la page tombe et la partie est finie', () => {
    const state = createStack()
    dropAt(state, 0.9)
    assert.equal(state.over, true)
    assert.equal(state.moving, null)
    assert.deepEqual(drain(state).map((event) => event.type), ['over'])
    const score = state.score
    tap(state)
    step(state, 1)
    assert.equal(state.score, score, 'plus rien ne bouge')
    assert.equal(pageCount(state), 0)
  })

  it('chaque page posée est plus rapide : la vitesse suit le nombre de pages', () => {
    const state = createStack()
    const first = state.moving!.speed
    for (let index = 0; index < 10; index += 1) dropAt(state, 0)
    assert.ok(state.moving!.speed > first)
  })

  it('le bilan : score, pages, parfaites, meilleure série', () => {
    const state = createStack()
    dropAt(state, 0)
    dropAt(state, 0)
    dropAt(state, 0.05)
    assert.deepEqual(outcomeOf(state), { score: placePoints(true, 1) + placePoints(true, 2) + PAGE_POINTS, pages: 3, perfects: 2, bestCombo: 2 })
  })

  it('un joueur qui vise bien ne peut pas dépasser le barème du serveur', () => {
    const state = createStack()
    for (let index = 0; index < 80; index += 1) dropAt(state, 0)
    const { score, pages, perfects } = outcomeOf(state)
    assert.equal(pages, 80)
    assert.ok(score <= pages * PAGE_POINTS + perfects * (PERFECT_BONUS + COMBO_STEP * (COMBO_CAP - 1)))
  })
})
