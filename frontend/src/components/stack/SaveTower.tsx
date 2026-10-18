import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import { useT } from '../../i18n'
import { TOWER_SIZE, saveCanvas, towerSource } from '../../lib/stack/tower'

/** « Enregistrer ma tour » : l'image de la pile telle qu'elle est à la fin de la partie. */
export function SaveTower() {
  const t = useT()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = () => {
    const draw = towerSource.current
    if (!draw || state === 'busy') return
    setState('busy')
    // Un tour de boucle pour laisser afficher l'attente avant de dessiner une grande image.
    window.setTimeout(() => {
      const canvas = draw({ ...TOWER_SIZE, title: t.stack.title, subtitle: t.stack.tower.subtitle, footer: new Date().toLocaleDateString() })
      void saveCanvas(canvas, t.stack.tower.file).then((outcome) => {
        setState(outcome === 'failed' ? 'failed' : outcome === 'cancelled' ? 'idle' : 'done')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState('idle'), 2500)
      })
    }, 30)
  }

  return (
    <button type="button" onClick={save} disabled={state === 'busy'} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#ff9a5c]/40 bg-[#ff9a5c]/10 text-sm font-semibold text-cream disabled:opacity-60">
      {state === 'busy' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : state === 'done' ? <Check size={17} aria-hidden /> : <Download size={17} aria-hidden />}
      {state === 'done' ? t.stack.tower.saved : state === 'failed' ? t.stack.tower.failed : t.stack.tower.save}
    </button>
  )
}
