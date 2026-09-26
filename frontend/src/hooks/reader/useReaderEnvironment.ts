import { useEffect, useRef, useState } from 'react'

/** Batterie : API absente de Safari et Firefox, d'où le typage manuel et le repli `null`. */
interface BatteryManager extends EventTarget {
  level: number
  charging: boolean
}

export interface DeviceStatus {
  /** « 14:32 » dans la langue de l'interface. */
  time: string
  /** 0 → 100, `null` si le navigateur ne l'expose pas. */
  battery: number | null
  charging: boolean
}

/** Heure (rafraîchie à chaque minute) et batterie, pour l'indicateur discret du lecteur. */
export function useDeviceStatus(locale: string, enabled: boolean): DeviceStatus | null {
  const format = () => new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const [time, setTime] = useState(format)
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const tick = () => setTime(new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))
    tick()
    // Calé sur le changement de minute, puis toutes les minutes.
    let interval: number | undefined
    const align = window.setTimeout(() => {
      tick()
      interval = window.setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(align)
      window.clearInterval(interval)
    }
  }, [locale, enabled])

  useEffect(() => {
    if (!enabled) return
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery
    if (!getBattery) return
    let manager: BatteryManager | null = null
    let cancelled = false
    const update = () => {
      if (manager) setBattery({ level: Math.round(manager.level * 100), charging: manager.charging })
    }
    getBattery
      .call(navigator)
      .then((result) => {
        if (cancelled) return
        manager = result
        update()
        manager.addEventListener('levelchange', update)
        manager.addEventListener('chargingchange', update)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      manager?.removeEventListener('levelchange', update)
      manager?.removeEventListener('chargingchange', update)
    }
  }, [enabled])

  if (!enabled) return null
  return { time, battery: battery?.level ?? null, charging: battery?.charging ?? false }
}

/** Garde l'écran allumé pendant la lecture (Screen Wake Lock), repris au retour sur l'onglet. */
export function useWakeLock(): void {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> }
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock
    if (!wakeLock) return
    let sentinel: Sentinel | null = null
    let disposed = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      wakeLock
        .request('screen')
        .then((lock) => {
          if (disposed) void lock.release()
          else sentinel = lock
        })
        .catch(() => {})
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', acquire)
      void sentinel?.release().catch(() => {})
    }
  }, [])
}

/**
 * Bouton / geste « retour » du téléphone : ferme le lecteur au lieu de quitter
 * l'application. Une entrée d'historique est ajoutée à l'ouverture ; la
 * fermeture par l'interface la consomme (`close` renvoyé).
 */
export function useBackToClose(onClose: () => void): () => void {
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    // Déjà au sommet (double montage du StrictMode en dev) : pas de seconde entrée.
    const current = window.history.state as { bookshelfReader?: number } | null
    if (!current?.bookshelfReader) window.history.pushState({ bookshelfReader: Date.now() }, '')
    const onPopState = () => latest.current()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return () => {
    const state = window.history.state as { bookshelfReader?: number } | null
    // Notre entrée est au sommet : on la consomme, `popstate` fermera le lecteur.
    if (state?.bookshelfReader) window.history.back()
    else latest.current()
  }
}

/** Couleur de la barre du système (Android, PWA) le temps de la lecture. */
export function useThemeColor(color: string): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const previous = meta?.getAttribute('content')
    meta?.setAttribute('content', color)
    return () => {
      if (previous) meta?.setAttribute('content', previous)
    }
  }, [color])
}

/** Plein écran natif (absent sur iPhone : le bouton est alors masqué). */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.fullscreenElement !== null)

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      // En quittant le lecteur, on rend l'écran à l'application.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }

  return { supported, active, toggle }
}
