import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  // `host: true` expose le serveur sur le LAN : indispensable pour tester
  // les gestes de swipe sur un vrai téléphone (mobile-first oblige).
  server: { host: true },
})
