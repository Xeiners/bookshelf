/**
 * Manga Runner 3D : simulation (gestes, saut, glissade, collisions, vies, ramassage,
 * aimant, nuage, quiz) et piste (toujours franchissable, reproductible).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LANE_WIDTH, MAX_SPEED, SLIDE_TIME, START_SPEED, reviveCost, scoreFor, speedAt } from '../src/lib/runner/constants'
import { OBSTACLE_SPAN, TrackGenerator, act, createRun, isSliding, revive, step, type ObstacleKind, type QuizQuestion, type RunState, type TrackObject } from '../src/lib/runner/engine'
import { makeQuiz } from '../src/lib/runner/quiz'
import { seededRandom } from '../src/lib/runner/random'

const noQuiz = () => null
/** Piste vide : seuls les objets posés par le test. */
function emptyRun(lives = 3): RunState {
  const state = createRun(1, { lives })
  state.objects.length = 0
  state.track.fill = () => undefined
  return state
}
const place = (state: RunState, kind: TrackObject['kind'], lane: -1 | 0 | 1, s: number, length = 1, y = 1) =>
  state.objects.push({ id: state.objects.length + 1, kind, lane, s, length, y, variant: 0, done: false })
const run = (state: RunState, seconds: number, ask: () => QuizQuestion | null = noQuiz) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) step(state, 1 / 60, ask)
}

describe('Manga Runner — simulation', () => {
  it('vitesse : départ, accélération, plafond ; score', () => {
    assert.equal(speedAt(0), START_SPEED)
    assert.equal(speedAt(10_000), MAX_SPEED)
    assert.equal(scoreFor(1000, 40, 1), 1200 + 250)
  })

  it('changer de voie, sauter, glisser, plonger', () => {
    const state = emptyRun()
    act(state, 'left')
    run(state, 0.3)
    assert.equal(state.lane, -1)
    assert.ok(Math.abs(state.x + LANE_WIDTH) < 1e-9)
    act(state, 'left')
    assert.equal(state.lane, -1, 'pas de voie au-delà du bord')
    act(state, 'up')
    run(state, 0.2)
    assert.ok(state.y > 1, 'en l’air')
    act(state, 'down')
    run(state, 0.3)
    assert.equal(state.y, 0)
    assert.ok(isSliding(state), 'plongeon : glissade à l’atterrissage')
    run(state, SLIDE_TIME)
    assert.ok(!isSliding(state))
  })

  it('obstacles : on saute un tome couché, on glisse sous un torii, un mur coûte un cœur', () => {
    const state = emptyRun()
    place(state, 'low', 0, 4)
    act(state, 'up')
    run(state, 0.7)
    assert.equal(state.lives, 3, 'sauté')
    place(state, 'gate', 0, state.distance + 4)
    act(state, 'down')
    run(state, 0.5)
    assert.equal(state.lives, 3, 'glissé dessous')
    place(state, 'wall', 0, state.distance + 3)
    run(state, 0.5)
    assert.equal(state.lives, 2)
    assert.ok(state.events.includes('hit'))
    // Juste après un choc, on est intouchable un instant.
    place(state, 'wall', 0, state.distance + 2)
    run(state, 0.3)
    assert.equal(state.lives, 2)
  })

  it('mode une vie : le premier choc termine la course', () => {
    const state = emptyRun(1)
    place(state, 'train', 0, 3, 12)
    run(state, 0.5)
    assert.equal(state.over, true)
    assert.ok(state.events.includes('over'))
    const distance = state.distance
    run(state, 0.5)
    assert.equal(state.distance, distance, 'la course est figée')
  })

  it('une seule vie par défaut ; revivre dégage la piste proche et rend invincible un instant', () => {
    const state = createRun(5)
    assert.equal(state.lives, 1)
    state.objects.length = 0
    state.track.fill = () => undefined
    place(state, 'wall', 0, 3)
    place(state, 'wall', 0, 8)
    run(state, 0.5)
    assert.equal(state.over, true)
    revive(state)
    assert.equal(state.over, false)
    assert.equal(state.revives, 1)
    assert.ok(state.events.includes('revive'))
    run(state, 1)
    assert.equal(state.over, false, 'le mur suivant a disparu')
    place(state, 'wall', 0, state.distance + 2)
    run(state, 0.3)
    assert.equal(state.over, false, 'encore invincible')
    assert.deepEqual([reviveCost(0), reviveCost(1), reviveCost(2), reviveCost(3)], [50, 100, 200, null])
  })

  it('ramassage : ✦ dans sa voie, aimant sur les voies voisines, nuage au-dessus des obstacles', () => {
    const state = emptyRun()
    place(state, 'star', 0, 3, 0.6, 1)
    place(state, 'star', 1, 3.5, 0.6, 1)
    run(state, 0.4)
    assert.equal(state.stardust, 1, 'la ✦ de la voie voisine reste')
    place(state, 'magnet', 0, state.distance + 2)
    place(state, 'star', 1, state.distance + 6, 0.6, 1)
    run(state, 0.6)
    assert.equal(state.stardust, 2, 'aimant')
    place(state, 'cloud', 0, state.distance + 2)
    run(state, 0.4)
    place(state, 'wall', 0, state.distance + 5)
    run(state, 0.6)
    assert.equal(state.lives, 3, 'en vol, les obstacles passent dessous')
  })

  it('quiz : la voie où l’on court à l’échéance est la réponse ; bonne réponse = bouclier', () => {
    const question: QuizQuestion = { prompt: '?', options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], answer: 2 }
    const state = emptyRun()
    place(state, 'quiz', 0, 3)
    run(state, 0.4, () => question)
    assert.ok(state.quiz)
    act(state, 'right')
    run(state, 5)
    assert.equal(state.quiz, null)
    assert.equal(state.quizRight, 1)
    assert.ok(state.shieldUntil > state.t)
    place(state, 'wall', 1, state.distance + 3)
    run(state, 0.5)
    assert.equal(state.lives, 3, 'bouclier')
  })
})

describe('Manga Runner — piste', () => {
  it('reproductible et toujours franchissable : jamais trois voies bouchées par des murs ou trains', () => {
    const a: TrackObject[] = []
    const b: TrackObject[] = []
    new TrackGenerator(42).fill(a, 6000)
    new TrackGenerator(42).fill(b, 6000)
    assert.deepEqual(a, b)
    const hard = a.filter((object) => object.kind === 'wall' || object.kind === 'train')
    for (let s = 0; s < 6000; s += 0.5) {
      const lanes = new Set(hard.filter((object) => object.s <= s && object.s + object.length >= s).map((object) => object.lane))
      assert.ok(lanes.size < 3, `trois voies bouchées à ${s} m`)
    }
    assert.ok(a.some((object) => object.kind === 'quiz'))
    assert.ok(a.some((object) => object.kind === 'magnet' || object.kind === 'cloud'))
    assert.ok(a.filter((object) => object.kind === 'star').length > 300)
    for (const kind of Object.keys(OBSTACLE_SPAN) as ObstacleKind[]) assert.ok(a.some((object) => object.kind === kind), kind)
  })

  it('une course simulée, sans geste, finit par un choc', () => {
    const state = createRun(7)
    run(state, 120)
    assert.ok(state.over)
    assert.ok(state.distance > 40, String(state.distance))
  })
})

describe('Manga Runner — quiz', () => {
  it('trois réponses, la bonne à sa place ; il faut trois univers', () => {
    const universes = ['One Piece', 'Naruto', 'Dragon Ball'].map((title) => ({ title, characters: [{ name: `${title} héros`, image: null }] }))
    const text = { whoIsFrom: (u: string) => `Qui vient de ${u} ?`, whereFrom: (c: string) => `D’où vient ${c} ?` }
    const random = seededRandom(3)
    for (let draw = 0; draw < 50; draw += 1) {
      const quiz = makeQuiz(universes, text, random)!
      assert.equal(quiz.options.length, 3)
      const right = quiz.options[quiz.answer]!.label
      const universe = quiz.prompt.startsWith('Qui') ? quiz.prompt.slice(13, -2) : right
      assert.ok(right.startsWith(universe))
      assert.equal(new Set(quiz.options.map((option) => option.label)).size, 3)
    }
    assert.equal(makeQuiz(universes.slice(0, 2), text, random), null)
  })
})
