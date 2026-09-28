import { useT } from '../../i18n'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'
import { AmbientPanel } from './AmbientPanel'

/** Feuille « Musique d'ambiance », accessible depuis toute l'application. */
export function MusicSheet() {
  const t = useT()
  const close = useUiStore((state) => state.closeMusic)
  return (
    <Sheet label={t.ambient.open} title={t.ambient.open} subtitle={t.ambient.sheetSubtitle} onClose={close}>
      <div className="pb-2 pt-1">
        <AmbientPanel />
      </div>
    </Sheet>
  )
}
