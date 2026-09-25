import { useCallback, useEffect, useState } from 'react'

/** L'événement n'est pas encore dans les types DOM standard. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

export type InstallSupport =
  | 'installed' // déjà lancée en mode application
  | 'ready' // le navigateur nous a donné la main : bouton actif
  | 'ios' // iOS/iPadOS : pas d'API, il faut passer par le menu Partager
  | 'unsupported' // navigateur sans installation (Firefox desktop, etc.)

export interface PwaInstall {
  support: InstallSupport
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // Safari iOS n'implémente pas `display-mode`, mais expose ce booléen.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  // Sur iOS, tous les navigateurs utilisent WebKit ; seul Safari peut installer.
  return isIos && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
}

/**
 * Chrome/Edge déclenchent `beforeinstallprompt` quand les critères sont réunis
 * (HTTPS, manifeste valide, service worker avec gestionnaire `fetch`). On
 * l'intercepte pour proposer l'installation au moment choisi par l'utilisateur.
 */
export function usePwaInstall(): PwaInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Sans `preventDefault`, Chrome affiche sa propre mini-barre.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }

    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    // Le passage en mode application peut survenir sans rechargement.
    const standalone = window.matchMedia('(display-mode: standalone)')
    const onDisplayChange = (event: MediaQueryListEvent) => setInstalled(event.matches)
    standalone.addEventListener('change', onDisplayChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      standalone.removeEventListener('change', onDisplayChange)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const

    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    // L'événement n'est utilisable qu'une fois.
    setDeferred(null)
    return outcome
  }, [deferred])

  const support: InstallSupport = installed
    ? 'installed'
    : deferred
      ? 'ready'
      : isIosSafari()
        ? 'ios'
        : 'unsupported'

  return { support, install }
}
