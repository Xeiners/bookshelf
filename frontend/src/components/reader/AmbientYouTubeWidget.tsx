import { useRef } from 'react'
import { Music } from 'lucide-react'
import { useAmbientPlayer } from '../../hooks/useAmbientMusic'
import { useReaderChrome } from '../../hooks/reader/useReaderUi'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { AmbientPanel } from '../ambient/AmbientPanel'
import { Pressable } from '../ui/Pressable'

/** Bouton 🎵 de la barre du lecteur : ouvre le popover, pastille quand la musique joue. */
export function AmbientYouTubeButton() {
  const t = useT()
  const ui = useReaderChrome()
  const { state } = useAmbientPlayer()
  const open = ui.panel === 'ambient'
  return (
    <Pressable
      onClick={() => ui.setPanel(open ? null : 'ambient')}
      aria-label={t.ambient.open}
      aria-expanded={open}
      className={`relative grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/10 ${
        open ? 'bg-white/10 text-cream' : 'text-cream/75'
      }`}
    >
      <Music size={18} />
      {state === 'playing' && <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-glow" />}
    </Pressable>
  )
}

/**
 * Popover de musique d'ambiance sous la barre du lecteur : mêmes commandes que
 * la feuille « Musique » de l'application (ambiances, playlists, lien libre).
 */
export function AmbientYouTubeWidget() {
  const ui = useReaderChrome()
  if (ui.panel !== 'ambient') return null
  return (
    <>
      {/* Tap hors du popover : il se ferme, sans tourner la page. */}
      <div aria-hidden className="pointer-events-auto absolute inset-0 z-30" onClick={() => ui.setPanel(null)} />
      <AmbientPopover />
    </>
  )
}

function AmbientPopover() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: -8, scale: 0.97, duration: 0.22, ease: EASE.swift, transformOrigin: 'top right' })
  })

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.ambient.open}
      className="pointer-events-auto absolute right-3 z-40 w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-3xl border border-glow/30 bg-[#09090b]/95 p-4 text-cream shadow-[0_0_0_1px_rgb(124_92_255/0.08),0_18px_48px_-16px_rgb(124_92_255/0.55)]"
      style={{
        top: 'calc(env(safe-area-inset-top) + 4.25rem)',
        maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 5.5rem)',
      }}
    >
      <AmbientPanel />
    </div>
  )
}
