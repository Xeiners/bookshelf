import { createApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'
import { startCatalogSync } from './services/catalog.service.js'

const app = createApp()

// Catalogue MangaDex : indexé en tâche de fond, le serveur répond déjà.
if (config.catalogSync) startCatalogSync()
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
