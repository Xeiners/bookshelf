import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { CAMPAIGN } from '../src/lib/gravity/campaign'
import { PLAYER_H, START_X, TICK, TIERS, tierOf } from '../src/lib/gravity/constants'
import { buildWorld, cloneRun, respawnRun, restartRun, shurikenAt, sizeOf, startRun, stepRun, type GravityRun, type GravityWorld } from '../src/lib/gravity/engine'
import { buildLevel, generateLevel } from '../src/lib/gravity/generator'
import { introsOf } from '../src/lib/gravity/intros'
import { solveLevel } from '../src/lib/gravity/solver'
import type { GravityLevel, LevelElement } from '../src/lib/gravity/types'
import { parseLevel, parsePlan } from '../src/lib/gravity/validate'
import { CHAPTER_IDS, buildTutorial, followCues, type ChapterId } from '../src/lib/gravity/tutorial'
import { TUTORIAL } from '../src/lib/gravity/tutorial.data'
import { fr } from '../src/i18n/fr'
import { apiErrorMessage } from '../src/lib/apiErrors'
import { ApiError } from '../src/services/api'

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

  it('une porte de taille rend le ninja minuscule, les pieds au sol ; une autre lui rend sa taille', () => {
    const gate = (x: number, mini: boolean): LevelElement => ({ type: 'size', x, y: 8.6, w: 0.8, h: 2.4, mini })
    const world = buildWorld(level([floor(-4, 80), gate(10, true), gate(30, false)]))
    const run = startRun(world)
    const kinds: string[] = []
    const runTo = (x: number) => {
      for (let index = 0; index < 1000 && run.status === 'running' && run.x < x; index += 1) {
        stepRun(world, run, { press: false, hold: false })
        kinds.push(...run.events.map((event) => event.kind))
      }
    }
    runTo(20)
    assert.equal(run.mini, true)
    assert.ok(Math.abs(run.y + sizeOf(run).h - 11) < 1e-6, 'minuscule, les pieds sur le sol')
    runTo(36)
    assert.equal(run.mini, false)
    assert.ok(Math.abs(run.y + sizeOf(run).h - 11) < 1e-6, 'de nouveau grand, les pieds sur le sol')
    assert.deepEqual(kinds.filter((kind) => kind === 'shrink' || kind === 'grow'), ['shrink', 'grow'])
  })

  it('un tunnel trop bas : infranchissable à taille normale, franchi en mini-ninja', () => {
    const tunnel: LevelElement[] = [floor(-4, 80), { type: 'block', x: 20, y: 8.75, w: 15, h: 1 }]
    assert.equal(solveLevel(buildWorld(level(tunnel))).ok, false)
    assert.equal(solveLevel(buildWorld(level([...tunnel, { type: 'size', x: 12, y: 8.6, w: 0.8, h: 2.4, mini: true }]))).ok, true)
  })

  it('la bûche (kawarimi) encaisse un piège, une seule fois', () => {
    const spikes = (x: number): LevelElement => ({ type: 'spikes', x, y: 11, w: 2, dir: 'up' })
    const world = buildWorld(level([floor(-4, 80), { type: 'log', x: 8, y: 10.35 }, spikes(16), spikes(30)]))
    const run = startRun(world)
    let substituted = 0
    for (let index = 0; index < 3000 && run.status === 'running'; index += 1) {
      stepRun(world, run, { press: false, hold: false })
      substituted += run.events.filter((event) => event.kind === 'substitute').length
    }
    assert.equal(substituted, 1)
    assert.equal(run.cause, 'spikes')
    assert.ok(run.x > 28, 'la première rangée a été encaissée, pas la seconde')
    restartRun(world, run)
    assert.equal(run.shield, false)
    assert.deepEqual(run.logs, [], 'la bûche est de nouveau à prendre')
  })

  it('après une chute, tout recommence au départ : pas de point de reprise', () => {
    const world = buildWorld(level([floor(-4, 30), { type: 'scroll', x: 10, y: 10.3 }, { type: 'moon', x: 16, y: 10.3 }, { type: 'crumble', x: 26, y: 11, w: 3, h: 1 }]))
    const run = idle(world, startRun(world))
    assert.equal(run.status, 'dead')
    assert.notEqual(run.scrolls, 0, 'le rouleau a été pris')
    assert.equal(run.moons.length, 1)
    assert.equal(run.crumbles.size, 1)
    const reached = run.maxX
    restartRun(world, run)
    assert.equal(run.status, 'running')
    assert.equal(run.deaths, 1)
    assert.equal(run.x, START_X)
    assert.equal(run.y, 11 - PLAYER_H)
    assert.equal(run.tick, 0)
    assert.equal(run.grounded, true)
    assert.equal(run.scrolls, 0, 'le rouleau est à reprendre')
    assert.deepEqual(run.moons, [], 'la lune aussi')
    assert.equal(run.crumbles.size, 0, 'la dalle fragile est de nouveau là')
    assert.equal(run.maxX, reached, 'l’avancement record reste')
  })

  it('jets de flammes : ils brûlent quand ils crachent, pas quand ils dorment ; la bûche en encaisse un', () => {
    // Le ninja passe sur la bouche (x = 20) vers 1,9 s : allumée à ce moment-là, ou éteinte.
    const jet = (phase: number): LevelElement => ({ type: 'flame', x: 20, y: 11, w: 1, reach: 2, dir: 'up', period: 2, on: 0.5, phase })
    const burning = buildWorld(level([floor(-4, 80), jet(0.25 - 1.95 / 2)]))
    assert.equal(idle(burning, startRun(burning), 400).cause, 'flame')
    const asleep = buildWorld(level([floor(-4, 80), jet(0.75 - 1.95 / 2)]))
    const run = idle(asleep, startRun(asleep), 400)
    assert.equal(run.status, 'running', 'éteinte au passage : rien')
    const shielded = buildWorld(level([floor(-4, 80), { type: 'log', x: 8, y: 10.35 }, jet(0.25 - 1.95 / 2)]))
    const saved = idle(shielded, startRun(shielded), 400)
    assert.equal(saved.status, 'running', 'la bûche a pris le jet')
  })

  it('dalle spectrale : elle porte quand elle est là, on passe au travers sinon, et elle n’écrase jamais', () => {
    // Le sol s'arrête en x = 12 ; une spectrale prend le relais de 12 à 40.
    const ghost = (phase: number): LevelElement => ({ type: 'ghost', x: 12, y: 11, w: 28, h: 0.8, period: 10, on: 0.5, phase })
    const there = buildWorld(level([floor(-4, 16), ghost(0)]))
    const carried = idle(there, startRun(there), 120)
    assert.equal(carried.status, 'running', 'là pendant 5 s : elle porte le ninja')
    assert.ok(carried.x > 14 && carried.grounded)
    const gone = buildWorld(level([floor(-4, 16), ghost(0.5)]))
    assert.equal(idle(gone, startRun(gone)).cause, 'fall', 'absente : on tombe au travers')
    // Elle réapparaît autour du ninja qui court sur le sol : il n'est ni écrasé ni hissé dessus.
    const around = buildWorld(level([floor(-4, 80), { type: 'ghost', x: 10, y: 9.8, w: 20, h: 0.8, period: 2, on: 0.5, phase: 0.6 }]))
    const runner = idle(around, startRun(around), 200)
    assert.equal(runner.status, 'running')
    assert.equal(runner.y, 11 - PLAYER_H, 'toujours les pieds sur le sol')
  })

  it('Hiraishin : le sceau téléporte le ninja à la même place dans sa jumelle, la caméra le suit', () => {
    // Un mur sur toute la hauteur en x = 20 ; le sceau, juste avant, renvoie de l'autre côté, sur une voie plus haute.
    const world = buildWorld(level([floor(-4, 26), { type: 'block', x: 20, y: -3, w: 1.4, h: 20 }, { type: 'block', x: 22, y: 8, w: 60, h: 1.2 }, { type: 'warp', x: 17, y: 8.6, w: 1, h: 2.4, tx: 22.5, ty: 5.6 }]))
    const run = startRun(world)
    const kinds: string[] = []
    let before = { x: 0, cameraX: 0 }
    for (let index = 0; index < 600 && run.status === 'running' && !kinds.includes('warp'); index += 1) {
      before = { x: run.x, cameraX: run.cameraX }
      stepRun(world, run, { press: false, hold: false })
      kinds.push(...run.events.map((event) => event.kind))
    }
    assert.ok(kinds.includes('warp'))
    assert.ok(run.x - before.x > 5, 'il a sauté le mur')
    assert.ok(Math.abs(run.x - run.cameraX - (before.x - before.cameraX)) < 0.5, 'la même avance sur la caméra')
    assert.ok(Math.abs(run.y - (8 - PLAYER_H)) < 1e-6 && run.grounded, 'posé sur la voie d’arrivée, plus haute')
    assert.equal(idle(world, run, 2000).status, 'finished')
    // Sans le sceau, le mur arrête tout.
    const walled = buildWorld(level([floor(-4, 26), { type: 'block', x: 20, y: -3, w: 1.4, h: 20 }, { type: 'block', x: 22, y: 8, w: 60, h: 1.2 }]))
    assert.equal(idle(walled, startRun(walled)).cause, 'left')
  })

  it('roue de lames : les shurikens tournent autour de leur centre, et frappent au bon moment', () => {
    const wheel = (phase: number) => buildWorld(level([floor(-4, 80), { type: 'shuriken', x: 30, y: 8, r: 0.7, orbit: 2.5, period: 4, phase }]))
    const at = (t: number) => shurikenAt(wheel(0).shurikens[0]!, t)
    assert.deepEqual(at(0), { x: 32.5, y: 8 })
    assert.ok(Math.abs(at(1).x - 30) < 1e-9 && Math.abs(at(1).y - 10.5) < 1e-9, 'un quart de tour : en bas, au ras du sol')
    // Le ninja passe sous la roue vers 3,2 s : la lame est en haut (il passe), ou en bas (touché).
    assert.equal(idle(wheel(0), startRun(wheel(0)), 600).status, 'finished')
    assert.equal(idle(wheel(0.5), startRun(wheel(0.5)), 600).cause, 'shuriken')
  })

  it('les niveaux intégrés : chaque palier de difficulté en compte au moins trois, et les nouveaux mécanismes y sont', () => {
    const tiers = new Map<string, number>()
    for (const entry of CAMPAIGN) tiers.set(tierOf(entry.plan.difficulty), (tiers.get(tierOf(entry.plan.difficulty)) ?? 0) + 1)
    for (const tier of TIERS) assert.ok((tiers.get(tier) ?? 0) >= 3, tier)
    assert.ok((tiers.get('hard') ?? 0) >= 14 && (tiers.get('extreme') ?? 0) >= 14, 'dix niveaux de plus en Difficile et en Extrême')
    const kinds = new Set(CAMPAIGN.flatMap((entry) => entry.plan.sections.map((section) => section.kind)))
    for (const kind of ['mini', 'kawarimi', 'hiraishin', 'flames', 'ghost', 'orbit'] as const) assert.ok(kinds.has(kind), kind)
    assert.equal(new Set(CAMPAIGN.map((entry) => entry.id)).size, CAMPAIGN.length, 'identifiants uniques')
  })

  it('chaque élément particulier est repéré à sa première apparition, de gauche à droite', () => {
    const world = buildWorld(
      level([
        floor(-4, 80),
        { type: 'moon', x: 30, y: 10 },
        { type: 'flip', x: 20, y: 8, w: 1, h: 2 },
        { type: 'moon', x: 12, y: 10 },
        { type: 'shuriken', x: 50, y: 5, r: 0.75, dx: -4 },
      ]),
    )
    assert.deepEqual(introsOf(world), [
      { kind: 'moon', x: 11.4 },
      { kind: 'seal', x: 20 },
      { kind: 'shuriken', x: 45.25 },
    ])
  })

  it('les nouveaux éléments ont aussi leur explication : Hiraishin, flammes, dalle spectrale, roue de lames', () => {
    const world = buildWorld(
      level([
        floor(-4, 80),
        { type: 'shuriken', x: 50, y: 7, r: 0.7, orbit: 2, period: 2 },
        { type: 'flame', x: 30, y: 11, w: 1, reach: 2, dir: 'up', period: 2, on: 0.5 },
        { type: 'ghost', x: 40, y: 6, w: 4, h: 0.8, period: 2, on: 0.5 },
        { type: 'warp', x: 20, y: 8.6, w: 1, h: 2.4, tx: 25, ty: 8.6 },
      ]),
    )
    assert.deepEqual(introsOf(world), [
      { kind: 'warp', x: 20 },
      { kind: 'flame', x: 30 },
      { kind: 'ghost', x: 40 },
      { kind: 'orbit', x: 47.3 },
    ])
  })

  it('un niveau d’autrefois avec des points de reprise : ils sont ignorés', () => {
    const parsed = parseLevel({ ...level([floor(-4, 80)]), elements: [floor(-4, 80), { type: 'checkpoint', x: 30, y: 11, g: 1 }] })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual(parsed.level.elements, [floor(-4, 80)])
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
    assert.ok(easy > 30, `facile : ${easy} pas`)
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

  it('le chemin du solveur finit le niveau d’une traite et ramasse les trois rouleaux', () => {
    for (const [seed, theme] of [[7, 'hunter'], [3, 'halloween']] as const) {
      const { level: built, report } = generateLevel({ difficulty: 6, theme, seed, length: 'short' })
      const world = buildWorld(built)
      const run = startRun(world)
      const byTick = new Map(report.decisions.map((decision) => [decision.tick, decision]))
      let hold = false
      for (let index = 0; index < 100_000 && run.status === 'running'; index += 1) {
        const decision = byTick.get(run.tick)
        if (decision) hold = decision.hold
        stepRun(world, run, { press: decision?.press ?? false, hold })
      }
      assert.equal(run.status, 'finished', `graine ${seed} : sans chute, du départ à l’arrivée`)
      assert.equal(run.deaths, 0)
      assert.equal(run.scrolls, 0b111)
    }
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

describe('Gravity Ninja — tutoriel', () => {
  const world = buildWorld(TUTORIAL.level)

  it('un seul parcours : chaque mécanisme, sans exception, a son chapitre, dans l’ordre, et y apparaît', () => {
    assert.deepEqual(TUTORIAL.chapters.map((chapter) => chapter.id), [...CHAPTER_IDS])
    const xs = TUTORIAL.chapters.map((chapter) => chapter.x)
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'les chapitres se suivent')
    // Chaque mécanisme est bien dans SON chapitre (entre son début et celui du suivant).
    const within = (id: ChapterId, test: (element: LevelElement) => boolean) => {
      const index = TUTORIAL.chapters.findIndex((chapter) => chapter.id === id)
      const from = TUTORIAL.chapters[index]!.x
      const to = TUTORIAL.chapters[index + 1]?.x ?? TUTORIAL.level.length
      return TUTORIAL.level.elements.some((element) => test(element) && element.x >= from - 1 && element.x < to)
    }
    const shows: [ChapterId, (element: LevelElement) => boolean][] = [
      ['edges', (element) => element.type === 'block' && element.h >= 2 && element.h <= 4 && element.w < 3],
      ['spikes', (element) => element.type === 'spikes'],
      ['seal', (element) => element.type === 'flip'],
      ['crumble', (element) => element.type === 'crumble'],
      ['mover', (element) => element.type === 'mover'],
      ['shuriken', (element) => element.type === 'shuriken' && !element.orbit],
      ['moon', (element) => element.type === 'moon'],
      ['mini', (element) => element.type === 'size' && element.mini],
      ['log', (element) => element.type === 'log'],
      ['scrolls', (element) => element.type === 'scroll'],
      ['warp', (element) => element.type === 'warp'],
      ['flames', (element) => element.type === 'flame'],
      ['ghost', (element) => element.type === 'ghost'],
      ['orbit', (element) => element.type === 'shuriken' && !!element.orbit],
    ]
    for (const [id, test] of shows) assert.ok(within(id, test), id)
    assert.equal(TUTORIAL.level.elements.filter((element) => element.type === 'scroll').length, 3)
    assert.ok(TUTORIAL.cues.some((cue) => cue.hold), 'la lune apprend à maintenir')
  })

  it('suivre les invites finit le parcours avec les trois rouleaux, qu’on touche au début, au milieu ou à la fin', () => {
    for (const where of ['from', 'middle', 'to'] as const) {
      let substituted = 0
      const run = followCues(world, TUTORIAL.cues, where, (state) => {
        substituted += state.events.filter((event) => event.kind === 'substitute').length
      })
      assert.equal(run.status, 'finished', `${where} : ${run.cause}`)
      assert.equal(run.deaths, 0)
      assert.equal(run.scrolls, 0b111, `${where} : les trois rouleaux`)
      assert.equal(substituted, 1, 'la bûche encaisse les pics du kawarimi')
    }
    // Assez de temps pour réagir : au ralenti, au moins une demi-seconde par fenêtre.
    assert.ok(TUTORIAL.cues.every((cue) => cue.to - cue.from + 1 >= 8))
  })

  it('après une chute, on reprend au début du chapitre, et les invites suivantes mènent à l’arrivée', () => {
    for (const chapter of TUTORIAL.chapters) {
      const run = startRun(world)
      run.deaths = 1
      respawnRun(world, run, chapter.checkpoint)
      assert.equal(run.grounded, true, chapter.id)
      assert.equal(run.deaths, 1, 'les chutes restent comptées')
      const cues = TUTORIAL.cues.filter((cue) => cue.to >= chapter.checkpoint.tick)
      let index = 0
      let holding = false
      for (let step = 0; step < 100_000 && run.status === 'running'; step += 1) {
        const cue = cues[index]
        const press = cue !== undefined && run.tick === Math.max(cue.from, Math.round((cue.from + cue.to) / 2))
        if (press) {
          holding = cue.hold
          index += 1
        }
        if (holding && run.grounded && !press) holding = false
        stepRun(world, run, { press, hold: holding })
      }
      assert.equal(run.status, 'finished', `reprise ${chapter.id} : ${run.cause}`)
    }
  })

  it('le parcours livré est à jour (relancer npm run gravity:levels -w frontend)', () => {
    // Comparé tel qu'il est écrit (JSON : un -0 du générateur y devient 0).
    assert.deepEqual(JSON.parse(JSON.stringify(buildTutorial())), TUTORIAL)
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

  it('un niveau aux nouveaux éléments se relit à l’identique', () => {
    const entry = CAMPAIGN.find((candidate) => candidate.id === 'le-dernier-sceau')!
    const { level: built } = buildLevel(entry.plan, entry.seed, entry.id)
    const types = new Set(built.elements.map((element) => element.type))
    for (const type of ['warp', 'flame', 'ghost'] as const) assert.ok(types.has(type), type)
    assert.ok(built.elements.some((element) => element.type === 'shuriken' && element.orbit), 'une roue de lames')
    const parsed = parseLevel(JSON.parse(JSON.stringify(built)))
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual(parsed.level, built)
  })

  it('un plan d’IA est lu (sections inconnues écartées), et bâti en niveau faisable', () => {
    const plan = parsePlan({ name: 'Essai', theme: 'halloween', difficulty: 4, sections: [{ kind: 'switch', intensity: 3 }, { kind: 'teleport', intensity: 5 }, { kind: 'moon', intensity: 4 }, { kind: 'zigzag', intensity: 4 }] })
    assert.ok(plan)
    assert.equal(plan.sections.length, 3)
    assert.equal(buildLevel(plan, 2).report.ok, true)
    assert.equal(parsePlan({ name: '', theme: 'konoha', difficulty: 3, sections: [] }), null)
  })
})

describe('Gravity Ninja — erreurs de l’IA', () => {
  it('chaque refus du serveur (quota, modèle, clé…) a son message', () => {
    const message = (code: string, status: number) => apiErrorMessage(new ApiError(status, code, 'x'), fr)
    assert.equal(message('gravity_ai_busy', 429), fr.gravity.workshop.errors.busy)
    assert.equal(message('gravity_ai_model', 502), fr.gravity.workshop.errors.model)
    assert.equal(message('gravity_ai_refused', 422), fr.gravity.workshop.errors.refused)
    assert.equal(message('gravity_ai_invalid', 502), fr.gravity.workshop.errors.invalid)
    assert.equal(message('gravity_ai_failed', 502), fr.gravity.workshop.errors.failed)
    assert.equal(message('gravity_ai_unavailable', 503), fr.gravity.workshop.aiOff)
    assert.match(fr.gravity.workshop.aiOff, /GEMINI_API_KEY/)
  })
})
