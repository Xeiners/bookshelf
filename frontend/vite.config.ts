import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * Le front appelle `/api/...` en relatif ; Vite relaie vers l'API Express
 * (http://localhost:5000). Même origine pour le navigateur : le cookie de
 * session HTTP-only passe sans CORS, et un téléphone sur le LAN atteint l'API
 * via le serveur Vite sans connaître l'adresse du backend.
 *
 * Deux réglages par variables d'environnement, pour docker-compose.dev.yml :
 * - `API_PROXY_TARGET` : l'API est le conteneur `backend`, pas `localhost` ;
 * - `VITE_USE_POLLING=true` : les fichiers montés depuis Windows ou macOS
 *   n'émettent pas d'événements dans un conteneur Linux — on les scrute.
 */
// Le fichier de config tourne sous Node, mais son tsconfig est celui du navigateur.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

const apiProxy = {
  '/api': {
    target: env.API_PROXY_TARGET ?? 'http://localhost:5000',
    changeOrigin: false,
  },
}

/**
 * Hors-ligne : injecte dans `sw.js` la liste de TOUS les fichiers du build (lecteur et
 * moteurs chargés à la demande compris) et son empreinte. Le Service Worker les précache
 * à l'installation, et `sw.js` change à chaque déploiement : le navigateur le réinstalle.
 */
function precacheManifest(): Plugin {
  let outDir = 'dist'
  let assets: string[] = []
  return {
    name: 'bookshelf-precache-manifest',
    apply: 'build',
    configResolved: (config) => {
      outDir = config.build.outDir
    },
    generateBundle: (_options, bundle) => {
      assets = Object.keys(bundle).filter((file) => file.startsWith('assets/')).sort()
    },
    closeBundle: async () => {
      const path = join(outDir, 'sw.js')
      const source = await readFile(path, 'utf8')
      const build = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12)
      const manifest = JSON.stringify({ build, assets })
      if (!source.includes('self.__BOOKSHELF_PRECACHE__')) throw new Error('sw.js : emplacement du précache introuvable')
      await writeFile(path, source.replace('self.__BOOKSHELF_PRECACHE__', manifest))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    precacheManifest(),
  ],
  // `host: true` expose le serveur sur le LAN : indispensable pour tester
  // les gestes de swipe sur un vrai téléphone (mobile-first oblige).
  server: {
    host: true,
    proxy: apiProxy,
    ...(env.VITE_USE_POLLING === 'true' && { watch: { usePolling: true, interval: 300 } }),
  },
  preview: { proxy: apiProxy },
})
