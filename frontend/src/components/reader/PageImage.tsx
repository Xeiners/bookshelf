import { useState } from 'react'
import { ImageOff, RotateCw } from 'lucide-react'
import { useT } from '../../i18n'
import type { ReaderPage } from '../../types/reader'

interface PageImageProps {
  page: ReaderPage
  /** Hors de la fenêtre de lecture : chargement différé par le navigateur. */
  lazy?: boolean
  className?: string
  /** Dimensions naturelles, une fois l'image chargée (réserve la place au bon ratio). */
  onSize?: (width: number, height: number) => void
}

/** URL avec un paramètre de relance : contourne une erreur gardée par un cache. */
const withRetry = (url: string, attempt: number) =>
  url.startsWith('blob:') ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`

/**
 * Une page de scan. En cas d'échec : d'abord la version « Data Saver » (sans
 * rien demander), puis un bouton discret « Recharger l'image » — le reste du
 * chapitre continue de s'afficher normalement.
 *
 * Remontée par une `key` (l'URL) quand la page change : pas d'état résiduel.
 */
export function PageImage({ page, lazy = false, className = '', onSize }: PageImageProps) {
  const t = useT()
  // 0 : originale ; 1 : repli ; 2+ : relances manuelles de l'originale.
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  const src =
    attempt === 0 ? page.url : attempt === 1 && page.fallbackUrl ? page.fallbackUrl : withRetry(page.url, attempt)

  const onError = () => {
    if (attempt === 0 && page.fallbackUrl) {
      setAttempt(1)
      return
    }
    setStatus('error')
  }

  const retry = () => {
    setStatus('loading')
    setAttempt((current) => Math.max(2, current + 1))
  }

  if (status === 'error') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 bg-white/[0.03] p-6 text-center ${className}`}>
        <ImageOff size={22} className="text-mist" />
        <p className="text-xs text-mist">
          {t.reader.imageFailed} · {t.reader.pageAlt(page.index + 1)}
        </p>
        <button
          type="button"
          // Le tap ne doit ni tourner la page ni afficher les commandes.
          onClick={(event) => {
            event.stopPropagation()
            retry()
          }}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-cream hover:bg-white/15"
        >
          <RotateCw size={13} />
          {t.reader.retryImage}
        </button>
      </div>
    )
  }

  return (
    <img
      key={src}
      src={src}
      alt={t.reader.pageAlt(page.index + 1)}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      onLoad={(event) => {
        setStatus('loaded')
        onSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
      }}
      onError={onError}
      className={`select-none ${status === 'loading' ? 'bg-white/[0.03]' : ''} ${className}`}
    />
  )
}
