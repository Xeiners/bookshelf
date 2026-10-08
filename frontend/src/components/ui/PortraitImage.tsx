import { useState } from 'react'

interface PortraitImageProps {
  src: string
  /** Nom du personnage (ou de l'œuvre) : son initiale remplace une image qui ne charge pas. */
  name: string
  alt?: string
  className?: string
  loading?: 'lazy' | 'eager'
  /** Taille de l'initiale de secours (classe Tailwind), selon la taille de la vignette. */
  initialClassName?: string
}

/**
 * Une vignette qui ne casse jamais : si l'image ne vient pas (source en panne, portrait
 * pas encore trouvé), l'initiale du nom prend sa place, sur le même cadre.
 */
export function PortraitImage({ src, name, alt = '', className = '', loading = 'lazy', initialClassName = 'text-sm' }: PortraitImageProps) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) {
    return (
      <span role={alt ? 'img' : undefined} aria-label={alt || undefined} className={`grid place-items-center bg-gradient-to-br from-[#2a2440] to-[#14111f] font-display font-semibold text-cream/70 ${className}`}>
        <span className={initialClassName}>{name.trim().charAt(0).toUpperCase() || '?'}</span>
      </span>
    )
  }
  return <img src={src} alt={alt} loading={loading} decoding="async" onError={() => setFailed(src)} className={className} />
}
