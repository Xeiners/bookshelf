/** Page Jump : la simulation (rebonds, bonus, onis, chute) et ses barèmes. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JUMP_SPEED, GRAVITY, MAX_CLIMB_PER_SECOND, MAX_GAP, MIN_ENEMY_SPACING, MIN_STAR_SPACING, SPRING_SPEED, WORLD_WIDTH, scoreOf } from '../src/lib/jump/constants'
import { createJump, outcomeOf, stepJump, type JumpState } from '../src/lib/jump/engine'

const VIEW = 640

/** Joueur automatique : vise le tome le plus bas au-dessus de son dernier appui. */
function play(state: JumpState, seconds: number): void {
  let floor = state.player.y
  for (let time = 0; time < seconds && !state.over; time += 1 / 60) {
    const p = state.player
    if (p.vy > 0 && p.y > floor) floor = Math.max(floor, Math.min(p.y, floor + 1))
    const target = state.platforms.filter((platform) => platform.brokeAt === null && platform.y > floor + 1).sort((a, b) => a.y - b.y)[0]
    let input = 0
    if (target) {
      let dx = target.x - p.x
      if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH
      if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH
      input = Math.abs(dx) < 6 ? 0 : Math.sign(dx)
    }
    const before = p.vy
    stepJump(state, 1 / 60, input, VIEW)
    // Un rebond vient d'avoir lieu : le nouvel appui est le tome sous les pieds.
    if (before <= 0 && state.player.vy > 0) floor = state.player.y
  }
}

describe('page jump — barèmes', () => {
  it('un écart entre deux tomes reste toujours sous la hauteur d’un rebond', () => {
    assert.ok(MAX_GAP < (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY) * 0.85)
    assert.ok(SPRING_SPEED > JUMP_SPEED)
  })

  it('score : hauteur, éclats et onis', () => {
    assert.equal(scoreOf(1234, 3, 2), 123 + 30 + 100)
    assert.equal(scoreOf(-5, 0, 0), 0)
  })
})

describe('page jump — simulation', () => {
  it('même graine, même partie', () => {
    const a = createJump(42)
    const b = createJump(42)
    play(a, 20)
    play(b, 20)
    assert.deepEqual(outcomeOf(a), outcomeOf(b))
  })

  it('le monde généré respecte les écarts et les espacements', () => {
    const state = createJump(7)
    stepJump(state, 1 / 120, 0, 30_000)
    // Une vue immense : la génération pose des milliers d'unités d'un coup.
    const ys = state.platforms.map((platform) => platform.y)
    assert.ok(ys[ys.length - 1]! > 25_000)
    assert.ok(state.enemies.length > 0 && state.platforms.some((platform) => platform.kind === 'fragile'))
    for (let index = 1; index < ys.length; index += 1) assert.ok(ys[index]! - ys[index - 1]! <= MAX_GAP + 1e-6, `écart ${ys[index]! - ys[index - 1]!}`)
    const stars = state.items.filter((item) => item.kind === 'star').map((item) => item.y)
    for (let index = 1; index < stars.length; index += 1) assert.ok(stars[index]! - stars[index - 1]! >= MIN_STAR_SPACING)
    const enemies = state.enemies.map((enemy) => enemy.y).sort((a, b) => a - b)
    for (let index = 1; index < enemies.length; index += 1) assert.ok(enemies[index]! - enemies[index - 1]! >= MIN_ENEMY_SPACING - 1)
  })

  it('un joueur appliqué grimpe, sans jamais monter plus vite que le plafond du serveur', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createJump(seed)
      play(state, 90)
      const outcome = outcomeOf(state)
      assert.ok(outcome.height > 2000, `graine ${seed} : ${outcome.height}`)
      assert.ok(outcome.height <= MAX_CLIMB_PER_SECOND * state.time + 800, `graine ${seed} : trop rapide`)
    }
  })

  it('sans rien faire, on finit par tomber', () => {
    const state = createJump(9)
    // Le héros fuit vers la droite sans viser : il rate vite un tome.
    for (let time = 0; time < 60 && !state.over; time += 1 / 60) stepJump(state, 1 / 60, time < 0.5 ? 0 : 1, VIEW)
    assert.equal(state.over, true)
    assert.equal(state.events.some((event) => event.type === 'over'), true)
  })

  it('un oni touché de côté finit la partie ; avec la bulle, il éclate', () => {
    const hit = createJump(3)
    hit.enemies = [{ id: 999, x: hit.player.x, y: hit.player.y + 18, home: hit.player.x, range: 0, phase: 0, alive: true }]
    hit.player.vy = 300
    stepJump(hit, 1 / 120, 0, VIEW)
    assert.equal(hit.player.dead, true)

    const shielded = createJump(3)
    shielded.player.shield = true
    shielded.enemies = [{ id: 999, x: shielded.player.x, y: shielded.player.y + 18, home: shielded.player.x, range: 0, phase: 0, alive: true }]
    shielded.player.vy = 300
    stepJump(shielded, 1 / 120, 0, VIEW)
    assert.equal(shielded.player.dead, false)
    assert.equal(shielded.player.shield, false)
    assert.equal(shielded.enemies[0]!.alive, false)
  })
})

describe('page jump — univers', () => {
  it('un habillage par thème saisonnier ; les univers recommencent à l’infini, en fondu', async () => {
    const { SKINS, WORLD_SPAN, blendAt, worldIndexAt, worldOf } = await import('../src/lib/jump/worlds')
    const { SITE_THEMES } = await import('../src/services/themeApi')
    for (const theme of SITE_THEMES) assert.ok(SKINS[theme].worlds.length > 0, theme)
    const skin = SKINS.none
    assert.equal(worldOf(skin, 0).id, worldOf(skin, skin.worlds.length).id)
    assert.equal(worldOf(skin, 1_000_003).id, worldOf(skin, 1_000_003 % skin.worlds.length).id)
    assert.equal(worldIndexAt(WORLD_SPAN * 5 + 1), 5)
    assert.equal(blendAt(10), 0)
    assert.ok(blendAt(WORLD_SPAN - 1) > 0.99 && blendAt(WORLD_SPAN - 1) <= 1)
  })
})

describe('page jump — personnages', () => {
  it('catalogue : identifiants uniques, la Lune offerte, et chaque dessin se trace sans erreur', async () => {
    const { JUMP_CHARACTERS } = await import('../src/lib/jump/characters')
    const { paintCharacter } = await import('../src/components/jump/characters')
    assert.equal(new Set(JUMP_CHARACTERS.map((character) => character.id)).size, JUMP_CHARACTERS.length)
    assert.equal(JUMP_CHARACTERS.find((character) => character.id === 'moon')?.price, 0)
    // Un faux contexte 2D : chaque méthode compte ses appels, chaque propriété s'écrit.
    let calls = 0
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => void (calls += 1)),
      set: (target, key, value) => ((target[key as string] = value), true),
    }) as unknown as CanvasRenderingContext2D
    for (const { id } of JUMP_CHARACTERS) {
      const before = calls
      const drawn = paintCharacter(ctx, id, 50)
      assert.equal(drawn, id !== 'moon', id)
      if (drawn) assert.ok(calls - before > 20, `${id} : dessin trop vide`)
    }
  })
})

describe('page jump — bonus à durée', () => {
  it('Grand tome : on tient sur un tome bien plus loin de son centre', async () => {
    const { PLATFORM_WIDTH } = await import('../src/lib/jump/constants')
    const setup = (wide: boolean) => {
      const state = createJump(5)
      const platform = state.platforms[0]!
      state.platforms = [platform]
      state.player.x = platform.x + PLATFORM_WIDTH / 2 + 25
      state.player.y = platform.y + 5
      state.player.vy = -400
      state.player.timers.wide = wide ? 5 : 0
      stepJump(state, 1 / 30, 0, VIEW)
      return state.player.vy > 0
    }
    assert.equal(setup(false), false, 'sans bonus : il passe à côté')
    assert.equal(setup(true), true, 'avec le Grand tome : il rebondit')
  })

  it('Plume : la pesanteur s’allège ; Aimant : les éclats viennent à lui ; les durées s’écoulent', () => {
    const light = createJump(6)
    const heavy = createJump(6)
    light.player.timers.feather = 3
    stepJump(light, 0.1, 0, VIEW)
    stepJump(heavy, 0.1, 0, VIEW)
    assert.ok(light.player.vy > heavy.player.vy)
    assert.ok(Math.abs(light.player.timers.feather - 2.9) < 1e-6)

    const magnet = createJump(6)
    magnet.player.timers.magnet = 3
    magnet.player.vy = 0
    magnet.items = [{ id: 999, kind: 'star', x: magnet.player.x + 120, y: magnet.player.y + 18, platformId: null, taken: false }]
    // Un pas de simulation dure au plus 0,1 s : on en enchaîne cinq.
    for (let index = 0; index < 5; index += 1) stepJump(magnet, 0.1, 0, VIEW)
    assert.equal(magnet.stars, 1, 'l’éclat a été attiré puis ramassé')
  })
})
