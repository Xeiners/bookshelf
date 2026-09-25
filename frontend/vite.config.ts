import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
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
