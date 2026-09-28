import { prisma } from '../src/db.js'
import { SET_LAYOUT } from '../src/modules/cards/boosters.logic.js'
import { seedSeries2 } from '../src/modules/cards/series2.seed.js'

try {
  const result = await seedSeries2()
  for (const [rarity, expected] of Object.entries(SET_LAYOUT)) {
    if (result.byRarity[rarity as keyof typeof SET_LAYOUT] !== expected) {
      throw new Error(`${rarity} : ${result.byRarity[rarity as keyof typeof SET_LAYOUT]}/${expected}`)
    }
  }
  console.log(`Série 2 prête : ${result.total} cartes (${result.inserted} ajoutées).`)
} finally {
  await prisma.$disconnect()
}
