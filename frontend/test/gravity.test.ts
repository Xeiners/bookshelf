import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { CAMPAIGN } from '../src/lib/gravity/campaign'
import { PLAYER_H, START_X, TICK } from '../src/lib/gravity/constants'
import { buildWorld, cloneRun, respawn, spawnRun, startRun, stepRun, type GravityRun, type GravityWorld } from '../src/lib/gravity/engine'
import { buildLevel, generateLevel } from '../src/lib/gravity/generator'
import { solveLevel } from '../src/lib/gravity/solver'
import type { GravityLevel, LevelElement } from '../src/lib/gravity/types'
import { parseLevel, parsePlan } from '../src/lib/gravity/validate'

const level = (elements: LevelElement[], length = 60): GravityLevel => ({ format: 1, id: 't', name: 't', theme: 'konoha', difficulty: 1, speed: 8, length, start: { y: 11, g: 1 }, elements })
const floor = (x: number, w: number): LevelElement => ({ type: 'block', x, y: 11, w, h: 6 })
const ceiling = (x: number, w: number): LevelElement => ({ type: 'block', x, y: -3, w, h: 6 })

/** Laisse courir sans toucher jusqu'à la fin (ou `ticks` pas). */
function idle(world: GravityWorld, run: GravityRun, ticks = 3000): GravityRun {
  for (let index = 0; index < ticks && run.status === 'running'; index += 1) stepRun(world, run, { press: false, hold: false })
  return run
}

describe('Gravity Ninja — moteur', () => {
  it('le ninja court seul, posé sur le sol, et tombe au bout du vide', () => {
    const world = buildWorld(level([floor(-4, 24)]))
    const run = startRun(world)
    assert.equal(run.grounded, true)
    idle(world, run, 30)
    assert.ok(Math.abs(run.x - (START_X + 8 * 30 * TICK)) < 0.01, `x = ${run.x}`)
    idle(world, run)
    assert.equal(run.status, 'dead')
    assert.equal(run.cause, 'fall')
  })

  it('toucher inverse la gravité : il file au plafond et y court la tête en bas', () => {
    const world = buildWorld(level([floor(-4, 24), ceiling(-4, 80)]))
    const run = startRun(world)
    stepRun(world, run, { press: true, hold: false })
    assert.equal(run.g, -1)
    assert.equal(run.events[0]?.kind, 'flip')
    for (let index = 0; index < 60; index += 1) stepRun(world, run, { press: false, hold: false })
    assert.equal(run.grounded, true)
    assert.equal(run.y, 3, 'la tête contre le plafond')
  })

  it('pas d’inversion en l’air, mais un toucher juste avant d’atterrir est gardé', () => {
    const world = buildWorld(level([floor(-4, 80), ceiling(-4, 80)]))
    const run = startRun(world)
    stepRun(world, run, { press: true, hold: false })
    stepRun(world, run, { press: false, hold: false })
    stepRun(world, run, { press: true, hold: false })
    assert.equal(run.g, -1, 'en vol : rien ne change tout de suite')
    for (let index = 0; index < 60 && run.g === -1; index += 1) stepRun(world, run, { press: index === 20, hold: false })
    assert.equal(run.g, 1, 'le toucher gardé part à l’atterrissage')
  })

  it('un mur arrête la course : la caméra le rattrape par la gauche', () => {
    const world = buildWorld(level([floor(-4, 80), { type: 'block', x: 20, y: 8, w: 2, h: 3 }]))
    const run = idle(world, startRun(world))
    assert.equal(run.cause, 'left')
    assert.ok(run.x < 20)
  })

  it('pics et shurikens tuent ; un sceau inverse la gravité tout seul', () => {
    const spiked = buildWorld(level([floor(-4, 80), { type: 'spikes', x: 12, y: 11, w: 2, dir: 'up' }]))
    assert.equal(idle(spiked, startRun(spiked)).cause, 'spikes')
    const blade = buildWorld(level([floor(-4, 80), { type: 'shuriken', x: 14, y: 10.3 }]))
    assert.equal(idle(blade, startRun(blade)).cause, 'shuriken')
    const sealed = buildWorld(level([floor(-4, 80), ceiling(-4, 80), { type: 'flip', x: 12, y: 8.6, w: 1, h: 2.4 }]))
    const run = startRun(sealed)
    for (let index = 0; index < 200 && run.g === 1; index += 1) stepRun(sealed, run, { press: false, hold: false })
    assert.equal(run.g, -1)
  })

  it('la lune : en maintenant, la chute est bien plus lente', () => {
    const world = buildWorld(level([floor(-4, 80), { type: 'moon', x: 5, y: 10 }]))
    const fall = (hold: boolean) => {
      const run = startRun(world)
      stepRun(world, run, { press: false, hold: false })
      assert.ok(run.moonLeft > 0)
      stepRun(world, run, { press: true, hold })
      for (let index = 0; index < 12; index += 1) stepRun(world, run, { press: false, hold })
      return run.y
    }
    assert.ok(fall(true) > fall(false) + 1, 'en planant, on monte moins vite')
  })

  it('une dalle fragile tombe peu après qu’on s’y est posé', () => {
    const world = buildWorld(level([{ type: 'crumble', x: -4, y: 11, w: 60, h: 1 }]))
    const run = idle(world, startRun(world), 10)
    assert.equal(run.status, 'running', 'elle tient un instant')
    idle(world, run, 60)
    assert.equal(run.status, 'dead')
    assert.equal(run.cause, 'fall')
  })

  it('après une chute, retour au dernier point de reprise, au même instant de la partie', () => {
    const world = buildWorld(level([floor(-4, 30), { type: 'checkpoint', x: 15, y: 11, g: 1 }]))
    const run = idle(world, startRun(world))
    assert.equal(run.checkpoint, 0)
    respawn(world, run)
    assert.equal(run.status, 'running')
    assert.equal(run.deaths, 1)
    assert.equal(run.x, 15)
    assert.equal(run.y, 11 - PLAYER_H)
    assert.equal(run.tick, spawnRun(world, 0).tick)
  })
})

describe('Gravity Ninja — solveur et générateur', () => {
  it('le solveur trouve l’inversion, et voit qu’un vide sans plafond est impossible', () => {
    assert.equal(solveLevel(buildWorld(level([floor(-4, 24), ceiling(18, 80)]))).ok, true)
    const report = solveLevel(buildWorld(level([floor(-4, 24)])))
    assert.equal(report.ok, false)
    assert.ok(report.reached > 20 && report.reached < 30)
  })

  it('la fenêtre pour inverser se resserre avec l’intensité', () => {
    const window = (intensity: number) => {
      const { level: built } = buildLevel({ name: 'w', theme: 'konoha', difficulty: 10, sections: [{ kind: 'switch', intensity }] }, 3)
      const world = buildWorld(built)
      const first = startRun(world)
      let ok = 0
      for (let tick = 0; tick < 400; tick += 1) {
        const run = cloneRun(first)
        for (let index = 0; index < 3000 && run.status === 'running'; index += 1) stepRun(world, run, { press: run.tick === tick, hold: false })
        if (run.status === 'finished') ok += 1
      }
      return ok
    }
    const easy = window(1)
    const hard = window(10)
    assert.ok(easy > 40, `facile : ${easy} pas`)
    assert.ok(hard >= 6 && hard < easy / 2, `dur : ${hard} pas`)
  })

  it('un niveau généré est prouvé faisable, à toutes les difficultés, et la même graine donne le même niveau', () => {
    for (const difficulty of [1, 4, 7, 10]) {
      const result = generateLevel({ difficulty, theme: 'night', seed: 5, length: 'short' })
      assert.equal(result.report.ok, true, `difficulté ${difficulty}`)
      assert.equal(result.level.elements.filter((element) => element.type === 'scroll').length, 3)
    }
    const a = generateLevel({ difficulty: 6, theme: 'konoha', seed: 99, length: 'short' })
    const b = generateLevel({ difficulty: 6, theme: 'konoha', seed: 99, length: 'short' })
    assert.deepEqual(a.level, b.level)
  })

  it('le chemin du solveur ramasse les trois rouleaux', () => {
    const { level: built, report } = generateLevel({ difficulty: 4, theme: 'hunter', seed: 7, length: 'short' })
    const world = buildWorld(built)
    let mask = 0
    report.segments.forEach((segment) => {
      const run = spawnRun(world, segment.from)
      const byTick = new Map(segment.decisions.map((decision) => [decision.tick, decision]))
      let hold = false
      for (let index = 0; index < 20_000 && run.status === 'running' && run.x < segment.target; index += 1) {
        const decision = byTick.get(run.tick)
        if (decision) hold = decision.hold
        stepRun(world, run, { press: decision?.press ?? false, hold })
      }
      mask |= run.scrolls
    })
    assert.equal(mask, 0b111)
  })

  it('les niveaux intégrés (écrits pour le serveur) sont à jour et faisables', () => {
    const source = readFileSync(new URL('../../backend/src/modules/gravity/gravity.levels.ts', import.meta.url), 'utf8')
    const shipped = JSON.parse(source.slice(source.indexOf('= [') + 2)) as GravityLevel[]
    assert.equal(shipped.length, CAMPAIGN.length)
    CAMPAIGN.forEach((entry, index) => {
      const { level: built } = buildLevel(entry.plan, entry.seed, entry.id)
      assert.deepEqual(shipped[index], built, `${entry.id} : relancer npm run gravity:levels -w frontend`)
      assert.equal(solveLevel(buildWorld(built)).ok, true, entry.id)
    })
    const difficulties = shipped.map((built) => built.difficulty)
    assert.deepEqual(difficulties, [...difficulties].sort((a, b) => a - b), 'la difficulté monte de niveau en niveau')
  })
})

describe('Gravity Ninja — lecture des niveaux et des plans', () => {
  it('un niveau valide passe, un niveau abîmé est refusé avec le chemin du champ fautif', () => {
    const { level: built } = generateLevel({ difficulty: 2, theme: 'christmas', seed: 1, length: 'short' })
    const parsed = parseLevel(JSON.parse(JSON.stringify(built)))
    assert.equal(parsed.ok, true)
    const broken = parseLevel({ ...built, theme: 'mars', elements: [{ type: 'block', x: 0, y: 11, w: -2, h: 1 }, { type: 'laser' }] })
    assert.equal(broken.ok, false)
    if (!broken.ok) assert.deepEqual(broken.issues, ['theme', 'elements[0].w', 'elements[1].x', 'elements[1].type'])
  })

  it('un plan d’IA est lu (sections inconnues écartées), et bâti en niveau faisable', () => {
    const plan = parsePlan({ name: 'Essai', theme: 'halloween', difficulty: 4, sections: [{ kind: 'switch', intensity: 3 }, { kind: 'teleport', intensity: 5 }, { kind: 'moon', intensity: 4 }, { kind: 'zigzag', intensity: 4 }] })
    assert.ok(plan)
    assert.equal(plan.sections.length, 3)
    assert.equal(buildLevel(plan, 2).report.ok, true)
    assert.equal(parsePlan({ name: '', theme: 'konoha', difficulty: 3, sections: [] }), null)
  })
})
