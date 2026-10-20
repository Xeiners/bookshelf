import { createApp } from './app.js'
import { config } from './core/config.js'
import { prisma } from './core/db.js'
import { aotPortraits, dragonBallPortraits, fireForcePortraits, hxhPortraits, jjkPortraits, jojoPortraits, mhaPortraits, narutoPortraits, onePiecePortraits } from './modules/dle/dle.games.js'
import { refreshWorkCovers } from './modules/higherlower/hl.covers.js'
import { ensureSeries3 } from './modules/cards/seeds/series3.seed.js'
import { startCatalogSync } from './modules/catalog/catalog.service.js'
import { attachCanvas, ensureCanvas, shutdownCanvas } from './modules/canvas/canvas.boot.js'
import { refuseUnknownUpgrades } from './core/security/socketAuth.js'
import { CANVAS_SOCKET_PATH } from './modules/canvas/realtime/canvas.hub.js'
import { STACK_SOCKET_PATH, attachStackSocket } from './modules/stack/stack.socket.js'

const app = createApp()

// Catalogue MangaDex : indexé en tâche de fond, le serveur répond déjà.
if (config.catalogSync) startCatalogSync()
// Portraits du BookshelfDLE (Jikan, lent) : préparés en tâche de fond, aucun joueur ne les attend.
if (config.env !== 'test') {
  for (const source of [narutoPortraits, onePiecePortraits, jojoPortraits, jjkPortraits, dragonBallPortraits, mhaPortraits, aotPortraits, hxhPortraits, fireForcePortraits]) void source.charactersWithPortrait().catch(() => undefined)
  // Couvertures du Higher or Lower (catalogue, puis recherche MangaDex).
  void refreshWorkCovers()
  // Série 3 des cartes (personnages, Jikan) : dès le démarrage, puis toutes les cinq minutes
  // tant qu'elle n'est pas complète (chaque passage reprend où le précédent s'est arrêté).
  ensureSeries3()
  setInterval(() => ensureSeries3(), 5 * 60 * 1000).unref()
}
// Mode recette oublié en production : il donnerait des boosters à l'infini, le démarrage est refusé.
if (config.cards.unlimited && config.env === 'production') {
  throw new Error('BOOSTER_UNLIMITED_MODE est interdit en production : retire-le de l’environnement.')
}
if (config.cards.unlimited) console.warn('[cartes] BOOSTER_UNLIMITED_MODE actif : boosters illimités (recette). À couper en production.')

const server = app.listen(config.port, () => {
  console.log(`[api] Bookshelf API prête sur http://localhost:${config.port}/api (${config.env})`)
})

// Toile partagée : WebSocket sur le même serveur, saison du mois prête avant la première connexion.
const detachCanvas = attachCanvas(server)
// Page Stack : les salons multijoueur (versus, coop) parlent aussi en WebSocket.
const detachStack = attachStackSocket(server)
const detachUpgrades = refuseUnknownUpgrades(server, [CANVAS_SOCKET_PATH, STACK_SOCKET_PATH])
if (config.env !== 'test') void ensureCanvas().catch((error) => console.error('[canvas] démarrage', error))

async function shutdown(signal: string) {
  console.log(`[api] ${signal} reçu, arrêt en cours…`)
  detachCanvas()
  detachStack()
  detachUpgrades()
  server.close()
  await shutdownCanvas().catch((error) => console.error('[canvas] arrêt', error))
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
