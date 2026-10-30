import type { JumpCharacterId } from '../../lib/jump/characters'

/*
 * Page Jump : les personnages, en chibi (grosse tête, petit corps), dessinés au canvas dans un
 * carré de 100 × 100 (les pieds en bas). Contours d'encre épais, aplats, un reflet dans les yeux :
 * le style des plateformes. Chaque dessin est fait une fois, en image hors écran (cf. `scene.ts`),
 * puis recopié : son coût ne compte pas pendant la partie. La Lune est une image (le SVG du site).
 */

const INK = '#140c22'
const SKIN = '#ffdcbc'

type Ctx = CanvasRenderingContext2D

function outline(ctx: Ctx, width = 3.2): void {
  ctx.strokeStyle = INK
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

function fillPath(ctx: Ctx, color: string, draw: () => void, line = 3.2): void {
  ctx.beginPath()
  draw()
  ctx.fillStyle = color
  ctx.fill()
  if (line > 0) outline(ctx, line)
}

function circle(ctx: Ctx, x: number, y: number, r: number, color: string, line = 3.2): void {
  fillPath(ctx, color, () => ctx.arc(x, y, r, 0, Math.PI * 2), line)
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, line = 3.2, rotation = 0): void {
  fillPath(ctx, color, () => ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2), line)
}

function round(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string, line = 3.2): void {
  fillPath(ctx, color, () => ctx.roundRect(x, y, w, h, r), line)
}

function poly(ctx: Ctx, points: readonly (readonly [number, number])[], color: string, line = 3.2): void {
  fillPath(
    ctx,
    color,
    () => {
      ctx.moveTo(points[0]![0], points[0]![1])
      for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
      ctx.closePath()
    },
    line,
  )
}

/** Grands yeux de manga : iris, pupille, deux reflets. */
function eyes(ctx: Ctx, iris: string, y = 50, spread = 11, size = 1): void {
  for (const side of [-1, 1]) {
    const x = 50 + side * spread
    ellipse(ctx, x, y, 4.6 * size, 6.4 * size, iris, 0)
    ellipse(ctx, x, y + 1.2 * size, 2.6 * size, 3.8 * size, INK, 0)
    circle(ctx, x - 1.6 * size, y - 2.6 * size, 1.7 * size, '#ffffff', 0)
    circle(ctx, x + 1.6 * size, y + 2.4 * size, 0.8 * size, '#ffffff', 0)
  }
}

function blush(ctx: Ctx, y = 58, spread = 19): void {
  for (const side of [-1, 1]) ellipse(ctx, 50 + side * spread, y, 4.5, 2.4, 'rgba(255,105,150,0.45)', 0)
}

function smile(ctx: Ctx, y = 60, width = 5): void {
  ctx.beginPath()
  ctx.arc(50, y - 2, width, 0.15 * Math.PI, 0.85 * Math.PI)
  outline(ctx, 2.4)
}

/** Le petit corps et les pieds, sous la tête. */
function body(ctx: Ctx, color: string, feet = INK): void {
  ellipse(ctx, 42, 95, 7, 4.5, feet)
  ellipse(ctx, 58, 95, 7, 4.5, feet)
  round(ctx, 34, 70, 32, 25, 11, color)
}

function head(ctx: Ctx, color = SKIN, r = 29, y = 46): void {
  circle(ctx, 50, y, r, color)
}

/** Bandeau frontal de ninja : tissu et plaque de métal à la spirale. */
function headband(ctx: Ctx, y: number, cloth: string): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(50, 46, 29, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = cloth
  ctx.fillRect(15, y, 70, 9)
  ctx.restore()
  round(ctx, 38, y - 1.5, 24, 12, 3, '#c9ced6', 2.6)
  ctx.beginPath()
  ctx.arc(50, y + 4.5, 3.2, 0.2, Math.PI * 1.7)
  ctx.lineTo(53.5, y + 1.5)
  outline(ctx, 1.6)
}

/** Mèches en pointes autour du haut de la tête. */
function spikes(ctx: Ctx, color: string, tips: readonly (readonly [number, number])[], base = 42): void {
  fillPath(ctx, color, () => {
    ctx.moveTo(19, base + 8)
    const step = 62 / (tips.length - 1)
    tips.forEach(([dx, dy], index) => {
      const x = 19 + index * step
      ctx.lineTo(x - step / 2, base - 8)
      ctx.lineTo(x + dx, dy)
    })
    ctx.lineTo(81, base + 8)
    ctx.quadraticCurveTo(50, base - 10, 19, base + 8)
    ctx.closePath()
  })
}

function paintPakkun(ctx: Ctx): void {
  // Le petit chien ninja : gilet bleu, bandeau, oreilles tombantes, museau sombre.
  body(ctx, '#3a5a9a', '#c9a66b')
  for (const side of [-1, 1]) ellipse(ctx, 50 + side * 27, 50, 8, 15, '#5a3d2b', 3.2, side * 0.35)
  head(ctx, '#c9a66b')
  headband(ctx, 24, '#2b3a67')
  ellipse(ctx, 50, 60, 14, 10, '#5a3d2b', 0)
  ellipse(ctx, 50, 55, 4.5, 3.2, INK, 0)
  // Yeux mi-clos, l'air blasé.
  for (const side of [-1, 1]) {
    ellipse(ctx, 50 + side * 12, 46, 3.4, 3.4, INK, 0)
    ctx.beginPath()
    ctx.moveTo(50 + side * 7.5, 43.5)
    ctx.lineTo(50 + side * 16.5, 43.5)
    outline(ctx, 2.6)
  }
  ctx.beginPath()
  ctx.moveTo(46, 64)
  ctx.quadraticCurveTo(50, 66, 54, 64)
  outline(ctx, 2)
}

function paintSaitama(ctx: Ctx): void {
  // Le héros chauve : cape rouge, combinaison jaune, gants rouges, regard vide.
  fillPath(ctx, '#e63946', () => {
    ctx.moveTo(32, 70)
    ctx.lineTo(22, 96)
    ctx.lineTo(78, 96)
    ctx.lineTo(68, 70)
    ctx.closePath()
  })
  body(ctx, '#ffd23f', '#e63946')
  for (const side of [-1, 1]) circle(ctx, 50 + side * 16, 72, 3.2, '#ffffff', 2.4)
  head(ctx)
  ellipse(ctx, 40, 30, 7, 3.5, 'rgba(255,255,255,0.65)', 0, -0.5)
  for (const side of [-1, 1]) ellipse(ctx, 50 + side * 10, 50, 2, 2.6, INK, 0)
  ctx.beginPath()
  ctx.moveTo(46, 60)
  ctx.lineTo(54, 60)
  outline(ctx, 2.2)
}

function paintPikachu(ctx: Ctx): void {
  // La souris électrique : oreilles à bout noir, joues rouges, queue en éclair.
  poly(ctx, [[66, 86], [80, 78], [74, 72], [90, 60], [84, 56], [92, 44], [74, 58], [80, 62], [64, 76]], '#ffd23f')
  body(ctx, '#ffd23f', '#ffd23f')
  for (const side of [-1, 1]) {
    poly(ctx, [[50 + side * 12, 26], [50 + side * 30, -2], [50 + side * 22, 28]], '#ffd23f')
    poly(ctx, [[50 + side * 25, 9], [50 + side * 30, -2], [50 + side * 28.5, 12]], INK, 0)
  }
  head(ctx, '#ffd23f')
  eyes(ctx, INK, 46, 12)
  for (const side of [-1, 1]) circle(ctx, 50 + side * 20, 58, 5.5, '#ff4d4d', 2.4)
  ctx.beginPath()
  ctx.moveTo(45, 57)
  ctx.quadraticCurveTo(47.5, 60, 50, 57)
  ctx.quadraticCurveTo(52.5, 60, 55, 57)
  outline(ctx, 2.2)
}

function paintChopper(ctx: Ctx): void {
  // Le petit renne : grand chapeau rose à la croix, bois, nez bleu.
  body(ctx, '#e8463c', '#a0683f')
  head(ctx, '#a0683f')
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(50 + side * 18, 20)
    ctx.lineTo(50 + side * 30, 2)
    ctx.moveTo(50 + side * 26, 9)
    ctx.lineTo(50 + side * 36, 8)
    ctx.moveTo(50 + side * 23, 13)
    ctx.lineTo(50 + side * 21, 2)
    ctx.strokeStyle = INK
    ctx.lineWidth = 6.5
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.strokeStyle = '#8a5a35'
    ctx.lineWidth = 3.4
    ctx.stroke()
  }
  ellipse(ctx, 50, 26, 30, 7, '#ff7aa8')
  round(ctx, 30, 4, 40, 22, 9, '#ff7aa8')
  round(ctx, 30, 18, 40, 6, 2, '#ffffff', 2.4)
  ctx.beginPath()
  ctx.moveTo(45, 6)
  ctx.lineTo(55, 16)
  ctx.moveTo(55, 6)
  ctx.lineTo(45, 16)
  outline(ctx, 2.6)
  eyes(ctx, INK, 47, 11)
  circle(ctx, 50, 58, 4.5, '#4cc9f0', 2.4)
  blush(ctx, 60, 20)
}

function paintAnya(ctx: Ctx): void {
  // La petite télépathe : cheveux roses, deux barrettes en cornes, sourire en coin.
  body(ctx, '#2a2a3a')
  round(ctx, 40, 70, 20, 6, 3, '#ffffff', 2.2)
  head(ctx)
  fillPath(ctx, '#ffa6c9', () => {
    ctx.arc(50, 44, 31, Math.PI, 0)
    ctx.lineTo(81, 62)
    ctx.lineTo(74, 62)
    ctx.lineTo(72, 40)
    ctx.lineTo(60, 34)
    ctx.lineTo(56, 42)
    ctx.lineTo(48, 33)
    ctx.lineTo(42, 42)
    ctx.lineTo(36, 34)
    ctx.lineTo(28, 40)
    ctx.lineTo(26, 62)
    ctx.lineTo(19, 62)
    ctx.closePath()
  })
  for (const side of [-1, 1]) poly(ctx, [[50 + side * 14, 18], [50 + side * 22, 4], [50 + side * 24, 20]], INK, 2)
  eyes(ctx, '#3fbf6a', 52, 11)
  blush(ctx, 60, 18)
  ctx.beginPath()
  ctx.moveTo(46, 63)
  ctx.quadraticCurveTo(52, 65, 55, 61)
  outline(ctx, 2.2)
}

function paintNezuko(ctx: Ctx): void {
  // La sœur au bambou : longs cheveux noirs aux pointes orangées, ruban rose, bambou en bâillon.
  for (const side of [-1, 1]) {
    fillPath(ctx, INK, () => {
      ctx.moveTo(50 + side * 22, 40)
      ctx.quadraticCurveTo(50 + side * 36, 70, 50 + side * 28, 92)
      ctx.lineTo(50 + side * 18, 88)
      ctx.closePath()
    }, 0)
    fillPath(ctx, '#ff8a5c', () => {
      ctx.moveTo(50 + side * 31, 80)
      ctx.quadraticCurveTo(50 + side * 31, 88, 50 + side * 28, 92)
      ctx.lineTo(50 + side * 18, 88)
      ctx.lineTo(50 + side * 20, 80)
      ctx.closePath()
    }, 0)
  }
  body(ctx, '#ff9ec7')
  ctx.beginPath()
  ctx.moveTo(42, 70)
  ctx.lineTo(50, 80)
  ctx.lineTo(58, 70)
  outline(ctx, 2.4)
  head(ctx)
  fillPath(ctx, INK, () => {
    ctx.arc(50, 44, 30.5, Math.PI * 1.02, Math.PI * 1.98)
    ctx.lineTo(70, 34)
    ctx.lineTo(60, 38)
    ctx.lineTo(54, 30)
    ctx.lineTo(46, 38)
    ctx.lineTo(40, 30)
    ctx.lineTo(30, 38)
    ctx.closePath()
  }, 0)
  for (const side of [-1, 1]) ellipse(ctx, 68 + side * 6, 22, 7, 4.5, '#ff6fb5', 2.4, side * 0.5)
  circle(ctx, 68, 22, 3, '#ff6fb5', 2.2)
  eyes(ctx, '#ff6fb5', 49, 11)
  round(ctx, 30, 58, 40, 8, 4, '#7bd34a', 2.6)
  for (const x of [40, 60]) {
    ctx.beginPath()
    ctx.moveTo(x, 58)
    ctx.lineTo(x, 66)
    outline(ctx, 2)
  }
}

function paintNaruto(ctx: Ctx): void {
  // Le ninja blond : mèches en pointes, bandeau, moustaches de renard, veste orange.
  body(ctx, '#ff8a1f')
  round(ctx, 34, 70, 32, 7, 3, INK, 0)
  head(ctx)
  spikes(ctx, '#ffcc33', [[0, 10], [-2, 4], [2, 2], [4, 6], [6, 12]], 32)
  headband(ctx, 28, '#2b3a67')
  eyes(ctx, '#3a8dff', 50, 11)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    for (const dy of [-3, 0, 3]) {
      ctx.moveTo(50 + side * 20, 58 + dy)
      ctx.lineTo(50 + side * 27, 57 + dy * 1.3)
    }
    outline(ctx, 1.8)
  }
  smile(ctx, 62, 6)
}

function paintLuffy(ctx: Ctx): void {
  // Le capitaine au chapeau de paille : gilet rouge, cicatrice sous l'œil, grand sourire.
  body(ctx, '#e63946')
  fillPath(ctx, SKIN, () => {
    ctx.moveTo(44, 70)
    ctx.lineTo(50, 82)
    ctx.lineTo(56, 70)
    ctx.closePath()
  }, 2.4)
  head(ctx)
  fillPath(ctx, INK, () => {
    ctx.arc(50, 44, 30, Math.PI, 0)
    ctx.lineTo(78, 40)
    ctx.lineTo(70, 36)
    ctx.lineTo(64, 42)
    ctx.lineTo(56, 36)
    ctx.lineTo(48, 42)
    ctx.lineTo(40, 36)
    ctx.lineTo(32, 42)
    ctx.lineTo(22, 40)
    ctx.closePath()
  }, 0)
  ellipse(ctx, 50, 22, 40, 8, '#f2d06b')
  fillPath(ctx, '#f2d06b', () => {
    ctx.moveTo(30, 22)
    ctx.quadraticCurveTo(30, 2, 50, 2)
    ctx.quadraticCurveTo(70, 2, 70, 22)
    ctx.closePath()
  })
  round(ctx, 30, 14, 40, 7, 2, '#d62828', 2.4)
  eyes(ctx, INK, 49, 11)
  ctx.beginPath()
  ctx.moveTo(35, 57)
  ctx.lineTo(41, 56)
  ctx.moveTo(37, 54)
  ctx.lineTo(38, 59)
  outline(ctx, 1.6)
  fillPath(ctx, INK, () => {
    ctx.moveTo(41, 59)
    ctx.quadraticCurveTo(50, 70, 59, 59)
    ctx.closePath()
  }, 2.2)
  round(ctx, 44, 59, 12, 3, 1, '#ffffff', 0)
}

function paintGoku(ctx: Ctx): void {
  // Le guerrier au kimono orange : grande coiffure noire en pointes, ceinture bleue.
  body(ctx, '#ff8a1f', '#2b5fd9')
  round(ctx, 34, 82, 32, 5, 2, '#2b5fd9', 2.2)
  round(ctx, 44, 70, 12, 8, 3, '#2b5fd9', 2.2)
  fillPath(ctx, INK, () => {
    ctx.moveTo(18, 52)
    ctx.lineTo(4, 34)
    ctx.lineTo(18, 34)
    ctx.lineTo(10, 14)
    ctx.lineTo(28, 22)
    ctx.lineTo(30, 0)
    ctx.lineTo(44, 16)
    ctx.lineTo(56, -2)
    ctx.lineTo(62, 16)
    ctx.lineTo(80, 6)
    ctx.lineTo(76, 24)
    ctx.lineTo(96, 28)
    ctx.lineTo(82, 40)
    ctx.lineTo(92, 52)
    ctx.closePath()
  }, 0)
  head(ctx)
  fillPath(ctx, INK, () => {
    ctx.moveTo(22, 40)
    ctx.lineTo(34, 30)
    ctx.lineTo(36, 40)
    ctx.lineTo(46, 28)
    ctx.lineTo(50, 38)
    ctx.lineTo(58, 28)
    ctx.lineTo(62, 38)
    ctx.lineTo(72, 30)
    ctx.lineTo(78, 40)
    ctx.lineTo(70, 22)
    ctx.lineTo(30, 22)
    ctx.closePath()
  }, 0)
  eyes(ctx, INK, 50, 11)
  smile(ctx, 62, 5)
}

function paintGojo(ctx: Ctx): void {
  // Le sorcier aux cheveux blancs : bandeau noir sur les yeux, uniforme sombre à col montant.
  body(ctx, '#1c1f2e')
  round(ctx, 38, 66, 24, 9, 4, '#1c1f2e')
  head(ctx)
  spikes(ctx, '#f0f4ff', [[-4, 4], [-2, -2], [0, -6], [2, -2], [4, 4]], 34)
  round(ctx, 19, 42, 62, 11, 3, INK, 0)
  ctx.beginPath()
  ctx.moveTo(44, 62)
  ctx.quadraticCurveTo(50, 65, 56, 61)
  outline(ctx, 2.2)
}

function paintZoro(ctx: Ctx): void {
  // Le sabreur aux cheveux verts : trois sabres à la ceinture, cicatrice sur l'œil, boucles d'oreille.
  for (const [dx, color] of [
    [-6, '#e8e8f0'],
    [0, '#1c1c28'],
    [6, '#d62828'],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(64 + dx * 0.3, 78)
    ctx.lineTo(86 + dx * 0.4, 60 + dx)
    ctx.strokeStyle = INK
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.stroke()
  }
  body(ctx, '#f4f4f8')
  round(ctx, 34, 80, 32, 8, 3, '#3a8d3a', 2.4)
  head(ctx)
  fillPath(ctx, '#4caf50', () => {
    ctx.arc(50, 44, 30, Math.PI * 1.05, Math.PI * 1.95)
    ctx.lineTo(74, 30)
    ctx.lineTo(66, 34)
    ctx.lineTo(62, 26)
    ctx.lineTo(56, 32)
    ctx.lineTo(50, 24)
    ctx.lineTo(44, 32)
    ctx.lineTo(38, 26)
    ctx.lineTo(34, 34)
    ctx.lineTo(26, 30)
    ctx.closePath()
  })
  for (const dy of [0, 5, 10]) circle(ctx, 20, 50 + dy, 1.8, '#ffd35c', 1.2)
  // Œil droit ouvert, l'œil gauche fermé par la cicatrice.
  ellipse(ctx, 61, 49, 3.6, 5, INK, 0)
  circle(ctx, 60, 47, 1.3, '#ffffff', 0)
  ctx.beginPath()
  ctx.moveTo(34, 49)
  ctx.lineTo(44, 49)
  ctx.moveTo(39, 40)
  ctx.lineTo(39, 58)
  outline(ctx, 2)
  ctx.beginPath()
  ctx.moveTo(45, 62)
  ctx.lineTo(55, 61)
  outline(ctx, 2.2)
}

function paintKakashi(ctx: Ctx): void {
  // Le ninja masqué : cheveux argentés penchés, bandeau sur un œil, masque sur le bas du visage.
  body(ctx, '#5a7a3a')
  round(ctx, 34, 70, 32, 6, 3, '#2b3a4a', 0)
  fillPath(ctx, '#d8dde6', () => {
    ctx.moveTo(22, 44)
    ctx.lineTo(18, 22)
    ctx.lineTo(30, 26)
    ctx.lineTo(32, 6)
    ctx.lineTo(44, 18)
    ctx.lineTo(54, 0)
    ctx.lineTo(60, 16)
    ctx.lineTo(76, 6)
    ctx.lineTo(74, 22)
    ctx.lineTo(90, 18)
    ctx.lineTo(80, 44)
    ctx.closePath()
  })
  head(ctx)
  fillPath(ctx, '#2b3a4a', () => {
    ctx.arc(50, 46, 29, Math.PI * 0.02, Math.PI * 0.98)
    ctx.lineTo(21, 54)
    ctx.lineTo(79, 54)
    ctx.closePath()
  }, 3)
  ctx.save()
  ctx.beginPath()
  ctx.arc(50, 46, 29, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(50, 36)
  ctx.rotate(-0.18)
  ctx.fillStyle = '#2b3a4a'
  ctx.fillRect(-36, -6, 72, 9)
  ctx.restore()
  // Le bandeau descend sur l'œil gauche ; l'œil droit, mi-clos.
  fillPath(ctx, '#2b3a4a', () => ctx.ellipse(39, 46, 9, 6, -0.2, 0, Math.PI * 2), 0)
  round(ctx, 40, 27, 22, 10, 3, '#c9ced6', 2.4)
  ctx.beginPath()
  ctx.moveTo(56, 46)
  ctx.lineTo(66, 46)
  outline(ctx, 2.4)
  ellipse(ctx, 61, 48.5, 2.4, 2.2, INK, 0)
}

function paintTanjiro(ctx: Ctx): void {
  // Le pourfendeur au haori à carreaux, la cicatrice au front, les boucles hanafuda.
  body(ctx, '#2e8b57')
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(34, 70, 32, 25, 11)
  ctx.clip()
  ctx.fillStyle = INK
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 7; col += 1) if ((row + col) % 2) ctx.fillRect(34 + col * 5, 70 + row * 5, 5, 5)
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(34, 70, 32, 25, 11)
  outline(ctx)
  head(ctx)
  spikes(ctx, '#5a1e1e', [[-3, 14], [-1, 8], [0, 6], [2, 8], [4, 14]], 34)
  ellipse(ctx, 37, 34, 4.5, 3, '#c0392b', 0, -0.4)
  eyes(ctx, '#8b1e1e', 50, 11)
  for (const side of [-1, 1]) {
    round(ctx, 50 + side * 30 - 3, 54, 6, 10, 1, '#ffffff', 1.6)
    circle(ctx, 50 + side * 30, 59, 2, '#d62828', 0)
  }
  smile(ctx, 62, 4.5)
}

function paintZenitsu(ctx: Ctx): void {
  // L'éclair peureux : cheveux d'or aux pointes orangées, haori orange à triangles, l'air paniqué.
  body(ctx, '#ff9f1c')
  ctx.fillStyle = '#ffffff'
  for (const [x, y] of [
    [38, 74],
    [50, 80],
    [60, 74],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 6, y)
    ctx.lineTo(x + 3, y + 6)
    ctx.closePath()
    ctx.fill()
  }
  head(ctx)
  spikes(ctx, '#ffd23f', [[-4, 18], [-2, 8], [0, 4], [2, 8], [4, 18]], 34)
  for (const side of [-1, 1]) poly(ctx, [[50 + side * 28, 46], [50 + side * 34, 62], [50 + side * 22, 54]], '#ff8a1f', 2.2)
  eyes(ctx, '#a0522d', 49, 11, 1.1)
  // Bouche tremblante et goutte de sueur.
  ctx.beginPath()
  ctx.moveTo(43, 62)
  for (let index = 1; index <= 4; index += 1) ctx.lineTo(43 + index * 3.5, 62 + (index % 2 ? -2 : 1))
  outline(ctx, 2)
  fillPath(ctx, '#7fd4ff', () => {
    ctx.moveTo(74, 30)
    ctx.quadraticCurveTo(79, 38, 74, 40)
    ctx.quadraticCurveTo(69, 38, 74, 30)
  }, 1.6)
}

function paintItadori(ctx: Ctx): void {
  // L'exorciste aux cheveux roses : uniforme noir à capuche rouge, marques sous les yeux, grand sourire.
  body(ctx, '#1c1f2e')
  round(ctx, 36, 66, 28, 8, 4, '#d62828', 2.6)
  head(ctx)
  spikes(ctx, '#ff8fb0', [[-3, 12], [-1, 6], [0, 2], [1, 6], [3, 12]], 33)
  fillPath(ctx, '#3a2a30', () => {
    ctx.moveTo(21, 50)
    ctx.lineTo(23, 38)
    ctx.lineTo(27, 50)
    ctx.closePath()
    ctx.moveTo(79, 50)
    ctx.lineTo(77, 38)
    ctx.lineTo(73, 50)
    ctx.closePath()
  }, 0)
  eyes(ctx, '#7a4a2a', 49, 11)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(50 + side * 7, 57)
    ctx.lineTo(50 + side * 15, 57)
    outline(ctx, 1.6)
  }
  fillPath(ctx, INK, () => {
    ctx.moveTo(42, 60)
    ctx.quadraticCurveTo(50, 70, 58, 60)
    ctx.closePath()
  }, 2)
  round(ctx, 45, 60, 10, 2.5, 1, '#ffffff', 0)
}

function paintDeku(ctx: Ctx): void {
  // Le jeune héros aux cheveux verts en bataille : taches de rousseur, combinaison verte.
  body(ctx, '#2f8f6a', '#d62828')
  round(ctx, 44, 72, 12, 6, 2, '#1c1f2e', 2)
  head(ctx)
  ctx.fillStyle = '#1f5a3a'
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  const curls = [
    [22, 38, 9],
    [30, 26, 10],
    [42, 18, 10],
    [56, 17, 10],
    [69, 24, 10],
    [78, 36, 9],
    [36, 34, 8],
    [52, 30, 8],
    [65, 34, 8],
  ] as const
  ctx.beginPath()
  for (const [x, y, r] of curls) {
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, Math.PI * 2)
  }
  ctx.stroke()
  ctx.fill()
  eyes(ctx, '#2f8f6a', 51, 11, 1.05)
  for (const side of [-1, 1]) for (const [dx, dy] of [[0, 0], [3, 1.5], [-2, 2]] as const) circle(ctx, 50 + side * (18 + dx), 59 + dy, 0.9, '#a0522d', 0)
  smile(ctx, 63, 4.5)
}

function paintKillua(ctx: Ctx): void {
  // L'assassin aux cheveux blancs en nuage : yeux bleus, sourire de chat.
  body(ctx, '#3a3a6a')
  round(ctx, 34, 70, 32, 6, 3, '#ffffff', 2.2)
  head(ctx)
  ctx.fillStyle = '#f2f4ff'
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  const puffs = [
    [20, 40, 10],
    [26, 26, 11],
    [38, 16, 12],
    [52, 12, 12],
    [66, 16, 12],
    [77, 27, 11],
    [81, 41, 9],
    [34, 32, 9],
    [50, 28, 9],
    [64, 31, 9],
  ] as const
  ctx.beginPath()
  for (const [x, y, r] of puffs) {
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, Math.PI * 2)
  }
  ctx.stroke()
  ctx.fill()
  eyes(ctx, '#4cc9f0', 50, 11)
  ctx.beginPath()
  ctx.moveTo(44, 60)
  ctx.quadraticCurveTo(47, 63, 50, 60)
  ctx.quadraticCurveTo(53, 63, 56, 60)
  outline(ctx, 2)
}

function paintPochita(ctx: Ctx): void {
  // Le petit chien-tronçonneuse : tout orange, la lame qui sort du front, la langue tirée.
  ellipse(ctx, 42, 95, 6, 4, '#ff8a3d')
  ellipse(ctx, 58, 95, 6, 4, '#ff8a3d')
  round(ctx, 30, 70, 40, 24, 12, '#ff8a3d')
  ctx.beginPath()
  ctx.moveTo(70, 82)
  ctx.lineTo(82, 78)
  outline(ctx, 2.6)
  circle(ctx, 84, 77, 3, '#c9ced6', 2)
  // La lame : un rectangle gris aux dents d'encre.
  round(ctx, 44, 0, 12, 30, 3, '#c9ced6')
  ctx.beginPath()
  for (let y = 3; y < 28; y += 5) {
    ctx.moveTo(44, y)
    ctx.lineTo(41, y + 2.5)
    ctx.lineTo(44, y + 5)
    ctx.moveTo(56, y)
    ctx.lineTo(59, y + 2.5)
    ctx.lineTo(56, y + 5)
  }
  outline(ctx, 1.8)
  head(ctx, '#ff8a3d', 28, 50)
  for (const side of [-1, 1]) poly(ctx, [[50 + side * 18, 28], [50 + side * 30, 24], [50 + side * 26, 38]], '#ff8a3d', 2.6)
  for (const side of [-1, 1]) circle(ctx, 50 + side * 10, 50, 3, INK, 0)
  ellipse(ctx, 50, 58, 3.5, 2.5, INK, 0)
  fillPath(ctx, '#ff6f91', () => ctx.ellipse(50, 66, 4, 5, 0, 0, Math.PI), 2)
}

const PAINTERS: Record<Exclude<JumpCharacterId, 'moon'>, (ctx: Ctx) => void> = {
  pakkun: paintPakkun,
  saitama: paintSaitama,
  pikachu: paintPikachu,
  chopper: paintChopper,
  anya: paintAnya,
  nezuko: paintNezuko,
  naruto: paintNaruto,
  luffy: paintLuffy,
  goku: paintGoku,
  pochita: paintPochita,
  deku: paintDeku,
  killua: paintKillua,
  zenitsu: paintZenitsu,
  tanjiro: paintTanjiro,
  itadori: paintItadori,
  kakashi: paintKakashi,
  zoro: paintZoro,
  gojo: paintGojo,
}

/**
 * Dessine un personnage dans un carré de `size` pixels, pieds en bas. La Lune n'est pas dessinée
 * ici (c'est une image) : renvoie `false` pour elle.
 */
export function paintCharacter(ctx: Ctx, id: JumpCharacterId, size: number): boolean {
  if (id === 'moon') return false
  ctx.save()
  ctx.scale(size / 100, size / 100)
  PAINTERS[id](ctx)
  ctx.restore()
  return true
}
