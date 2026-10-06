import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter, servie par l'app (disponible hors-ligne), avec sa taille optique : à grande taille,
// elle prend le dessin serré d'Inter Display, pour les titres.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import './index.css'
import App from './App'
import { registerServiceWorker } from './lib/pwa'
import { resumeDownloads } from './lib/reader/downloads'

const container = document.getElementById('root')
if (!container) throw new Error('#root introuvable dans index.html')

registerServiceWorker()
// Téléchargements de chapitres interrompus (app fermée) : ils reprennent.
resumeDownloads()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
