import { prisma } from '../src/db.js'
import { SERIES_3_SIZE, enrichSeries3, seedSeries3 } from '../src/modules/cards/series3.seed.js'

/* Série 3 à la main : le classement des 1 200 personnages, puis leurs œuvres (≈ 20 min). */
try {
  const result = await seedSeries3()
  console.log(`Série 3 : ${result.total}/${SERIES_3_SIZE} cartes (${result.inserted} ajoutées). Ajout des œuvres…`)
  console.log(`Œuvres ajoutées : ${await enrichSeries3()}.`)
} finally {
  await prisma.$disconnect()
}
