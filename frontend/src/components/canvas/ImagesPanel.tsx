import { BringToFront, Eye, EyeOff, ImagePlus, Lock, LockOpen, LocateFixed, SendToBack, Trash2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { MAX_REFERENCES } from '../../lib/canvas/references'
import { useCanvasStore, type RefView } from '../../store/useCanvasStore'

/** Bouton « ajouter une image » : un sélecteur de fichier (sur téléphone : galerie ou appareil photo). */
export function AddImageButton({ className, onAdded }: { className: string; onAdded?: () => void }) {
  const t = useT()
  return (
    <label className={`${className} cursor-pointer`}>
      <ImagePlus size={16} aria-hidden />
      {t.canvas.images.add}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void getEngine()
            ?.addImage(file)
            .then(onAdded)
        }}
      />
    </label>
  )
}

const round = 'grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-cream/85 transition-colors active:scale-95' // i18n-ignore : classes CSS

/** Les réglages d'une image : opacité, dessus / dessous, afficher, verrouiller, voir, retirer. */
export function ImageControls({ item }: { item: RefView }) {
  const t = useT()
  const engine = getEngine()
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
          {t.canvas.images.opacity}
          <span className="font-mono text-[11px] tracking-normal text-cream normal-case">{Math.round(item.opacity * 100)} %</span>
        </span>
        <input type="range" min={0.05} max={1} step={0.05} value={item.opacity} aria-label={t.canvas.images.opacity} onChange={(event) => engine?.updateReference(item.id, { opacity: Number(event.target.value) })} className="canvas-range h-3 w-full bg-white/15" />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={item.above} title={item.above ? t.canvas.images.aboveHint : t.canvas.images.belowHint} onClick={() => engine?.updateReference(item.id, { above: !item.above })} className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-semibold text-cream/90 active:scale-95">
          {item.above ? <BringToFront size={14} aria-hidden /> : <SendToBack size={14} aria-hidden />}
          {item.above ? t.canvas.images.above : t.canvas.images.below}
        </button>
        <button type="button" aria-label={item.visible ? t.canvas.images.hide : t.canvas.images.show} title={item.visible ? t.canvas.images.hide : t.canvas.images.show} aria-pressed={!item.visible} onClick={() => engine?.updateReference(item.id, { visible: !item.visible })} className={round}>
          {item.visible ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
        </button>
        <button type="button" aria-label={item.locked ? t.canvas.images.unlock : t.canvas.images.lock} title={item.locked ? t.canvas.images.unlock : t.canvas.images.lock} aria-pressed={item.locked} onClick={() => engine?.updateReference(item.id, { locked: !item.locked })} className={`${round} ${item.locked ? '!bg-gold !text-void' : ''}`}>
          {item.locked ? <Lock size={15} aria-hidden /> : <LockOpen size={15} aria-hidden />}
        </button>
        <button type="button" aria-label={t.canvas.images.locate} title={t.canvas.images.locate} onClick={() => engine?.locateReference(item.id)} className={round}>
          <LocateFixed size={15} aria-hidden />
        </button>
        <button type="button" aria-label={t.canvas.images.remove} title={t.canvas.images.remove} onClick={() => engine?.removeReference(item.id)} className={`${round} !text-nope`}>
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** La liste des images de référence, avec leurs réglages ; la sélectionnée est mise en avant. */
export function ImagesPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const refs = useCanvasStore((state) => state.refs)
  const selected = useCanvasStore((state) => state.refSelected)
  return (
    <aside className="glass pointer-events-auto flex max-h-[62vh] w-[21rem] flex-col rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-md:w-full" aria-label={t.canvas.images.title}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2">
        <div>
          <h2 className="font-display text-lg text-cream">{t.canvas.images.title}</h2>
          <p className="text-[11px] leading-snug text-mist">{t.canvas.images.subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-cream/70">
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <AddImageButton className="flex h-10 items-center gap-2 rounded-full bg-glow px-4 text-sm font-semibold text-white active:scale-95" />
          <span className="text-[11px] text-mist tabular-nums">{t.canvas.images.count(refs.length, MAX_REFERENCES)}</span>
        </div>
        {refs.length === 0 && <p className="px-1 py-2 text-xs text-mist">{t.canvas.images.empty}</p>}
        {[...refs].reverse().map((item) => (
          <div key={item.id} className={`flex flex-col gap-2.5 rounded-2xl p-2.5 ${selected === item.id ? 'bg-glow/15 ring-1 ring-glow/60' : 'bg-white/[0.04]'}`}>
            <button type="button" aria-label={t.canvas.images.pick} onClick={() => getEngine()?.selectReference(item.id)} className="flex items-center gap-3 text-left">
              <img src={item.thumb} alt="" className="size-14 shrink-0 rounded-xl border border-white/10 bg-white object-cover" style={{ opacity: item.visible ? 1 : 0.35 }} />
              <span className="min-w-0 flex-1 text-xs text-cream/80">{item.locked ? t.canvas.images.locked : t.canvas.images.move}</span>
            </button>
            <ImageControls item={item} />
          </div>
        ))}
        <p className="px-1 text-[10px] leading-snug text-mist">{t.canvas.images.pasteHint}</p>
      </div>
    </aside>
  )
}
