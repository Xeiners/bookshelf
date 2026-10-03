import { Volume2, VolumeX } from 'lucide-react'
import { useT } from '../../i18n'
import { useHigherLowerStore } from '../../store/useHigherLowerStore'

/** Haut-parleur : coupe ou remet les bruitages du Higher or Lower. */
export function SoundToggle() {
  const t = useT()
  const muted = useHigherLowerStore((state) => state.muted)
  const toggle = useHigherLowerStore((state) => state.toggleMuted)
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? t.hl.unmute : t.hl.mute}
      title={muted ? t.hl.unmute : t.hl.mute}
      aria-pressed={muted}
      className="grid size-8 shrink-0 place-items-center rounded-full text-cream/50 transition-colors hover:text-cream"
    >
      {muted ? <VolumeX size={17} aria-hidden /> : <Volume2 size={17} aria-hidden />}
    </button>
  )
}
