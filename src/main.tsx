import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerServiceWorker } from './lib/pwa'

const container = document.getElementById('root')
if (!container) throw new Error('#root introuvable dans index.html')

registerServiceWorker()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
