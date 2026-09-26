import { useRef } from 'react'
import { ArrowLeft, LoaderCircle, RotateCw } from 'lucide-react'
import { useT } from '../../i18n'
import { gsap, useGSAP } from '../../lib/gsap'

interface ReaderMessageProps {
  message: string
  /** Chargement en cours : icône qui tourne, pas de bouton. */
  busy?: boolean
  onRetry?: () => void
  onClose?: () => void
}

/** Écran d'attente ou d'erreur du lecteur, centré sur fond noir. */
export function ReaderMessage({ message, busy = false, onRetry, onClose }: ReaderMessageProps) {
  const t = useT()
  const spinnerRef = useRef<SVGSVGElement>(null)

  useGSAP(
    () => {
      if (!busy) return
      gsap.to(spinnerRef.current, { rotation: 360, duration: 0.9, ease: 'none', repeat: -1, transformOrigin: '50% 50%' })
    },
    { dependencies: [busy], revertOnUpdate: true },
  )

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center" role={busy ? 'status' : 'alert'}>
      {busy && <LoaderCircle ref={spinnerRef} size={26} className="text-gold" />}
      <p className="max-w-sm text-sm text-cream/80">{message}</p>
      {!busy && (onRetry || onClose) && (
        <div className="flex gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-cream hover:bg-white/15"
            >
              <ArrowLeft size={14} />
              {t.reader.close}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-medium text-void"
            >
              <RotateCw size={14} />
              {t.common.retry}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
