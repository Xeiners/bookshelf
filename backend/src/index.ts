import { createApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'
import { dragonBallPortraits, jjkPortraits, jojoPortraits, mhaPortraits, narutoPortraits, onePiecePortraits } from './modules/dle/dle.games.js'
import { refreshWorkCovers } from './modules/higherlower/hl.covers.js'
import { ensureSeries3 } from './modules/cards/series3.seed.js'
import { startCatalogSync } from './services/catalog.service.js'

const app = createApp()

// Catalogue MangaDex : indexé en tâche de fond, le serveur répond déjà.
if (config.catalogSync) startCatalogSync()
// Portraits du BookshelfDLE (Jikan, lent) : préparés en tâche de fond, aucun joueur ne les attend.
if (config.env !== 'test') {
  for (const source of [narutoPortraits, onePiecePortraits, jojoPortraits, jjkPortraits, dragonBallPortraits, mhaPortraits]) void source.charactersWithPortrait().catch(() => undefined)
  // Couvertures du Higher or Lower (catalogue, puis recherche MangaDex).
  void refreshWorkCovers()
  // Série 3 des cartes (personnages, Jikan) : dès le démarrage, puis toutes les cinq minutes
  // tant qu'elle n'est pas complète (chaque passage reprend où le précédent s'est arrêté).
  ensureSeries3()
  setInterval(() => ensureSeries3(), 5 * 60 * 1000).unref()
}
// Mode recette oublié en production : il doit se voir dans les journaux.
if (config.cards.unlimited) console.warn('[cartes] BOOSTER_UNLIMITED_MODE actif : boosters illimités (recette). À couper en production.')

const server = app.listen(config.port, () => {
  console.log(`[api] Bookshelf API prête sur http://localhost:${config.port}/api (${config.env})`)
})

async function shutdown(signal: string) {
  console.log(`[api] ${signal} reçu, arrêt en cours…`)
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
