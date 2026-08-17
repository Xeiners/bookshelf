import { useRef } from 'react'
import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react'
import { usePwaInstall } from '../../hooks/usePwaInstall'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'

/**
 * Installation de l'app. Sur Android, Chrome empaquette la PWA en WebAPK signé :
 * elle apparaît dans le tiroir d'applications, sans passer par le Play Store.
 */
export function InstallCard() {
  const { support, install } = usePwaInstall()
  const notify = useUiStore((state) => state.notify)
  const rootRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      if (support !== 'ready') return
      gsap.to('[data-install-glow]', {
        opacity: 0.75,
        scale: 1.12,
        duration: 2.4,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    },
    { dependencies: [support], revertOnUpdate: true, scope: rootRef },
  )

  const onInstall = async () => {
    vibrate(12)
    const outcome = await install()
    if (outcome === 'accepted') notify('Installation lancée', 'like')
    else if (outcome === 'dismissed') notify('Installation annulée', 'nope')
  }

  if (support === 'installed') {
    return (
      <section ref={rootRef} data-anim className="glass rounded-4xl p-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={18} className="shrink-0 text-like" />
          <div>
            <h2 className="font-display text-xl leading-tight">Application installée</h2>
            <p className="mt-1 text-[11px] text-mist">
              Bookshelf tourne en mode app, hors-ligne compris.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section ref={rootRef} data-anim className="glass relative overflow-hidden rounded-4xl p-5">
      <div
        data-install-glow
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-glow/25 opacity-40 blur-[50px]"
      />

      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="glass grid size-11 shrink-0 place-items-center rounded-full">
            <Smartphone size={18} className="text-glow" />
          </span>
          <div>
            <h2 className="font-display text-2xl leading-tight">Installer l'app</h2>
            <p className="mt-0.5 text-[11px] text-mist">
              Sur l'écran d'accueil, plein écran, sans barre d'adresse.
            </p>
          </div>
        </div>

        {support === 'ready' && (
          <Pressable
            onClick={onInstall}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3.5 text-sm font-medium text-void"
          >
            <Download size={16} />
            Installer Bookshelf
          </Pressable>
        )}

        {support === 'ios' && (
          <ol className="mt-4 space-y-2 text-[12px] leading-relaxed text-cream/75">
            <li className="flex gap-2.5">
              <span className="text-mist tabular-nums">1.</span>
              <span className="flex items-center gap-1.5">
                Touche <Share size={13} className="inline text-glow" /> Partager, en bas de Safari.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-mist tabular-nums">2.</span>
              <span>Choisis « Sur l'écran d'accueil ».</span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-mist tabular-nums">3.</span>
              <span>Valide avec « Ajouter ».</span>
            </li>
          </ol>
        )}

        {support === 'unsupported' && (
          <p className="mt-4 rounded-2xl bg-cream/[0.04] p-3.5 text-[11px] leading-relaxed text-mist">
            Ce navigateur ne propose pas l'installation. Ouvre Bookshelf dans Chrome ou Edge
            (Android, Windows, macOS) — et vérifie que le site est servi en HTTPS, condition
            obligatoire côté navigateur.
          </p>
        )}
      </div>
    </section>
  )
}
