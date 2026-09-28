import { useEffect, useRef, useState } from 'react'
import { BookOpen, Heart, X } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { requestTiltPermission } from '../../hooks/useHoloTilt'
import { useLanguage, useT } from '../../i18n'
import { RARITY_STYLE } from '../../lib/boosters'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { fetchBooks, fetchSynopsis } from '../../services/catalog'
import { useCollectionStore } from '../../store/useCollectionStore'
import { useUiStore } from '../../store/useUiStore'
import { CollectibleCard, type CardFace } from './CollectibleCard'

/** Carte à afficher : sa face, et ce que l'on sait déjà de l'exemplaire (album ou booster). */
export interface ZoomCard extends CardFace {
  id: string
  mangaId: string
  count?: number
}

interface CardZoomProps {
  card: ZoomCard
  onClose: () => void
}

type Synopsis = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error' }

/**
 * Une carte en grand, avec le résumé de son œuvre : inclinaison à la souris
 * ou au gyroscope, reflet holographique, favori, et accès à la fiche. Ouverte
 * depuis l'album ou juste après la révélation d'un booster (d'où un `z-index`
 * au-dessus de l'ouverture).
 */
export function CardZoom({ card, onClose }: CardZoomProps) {
  const t = useT()
  const language = useLanguage()
  const openDetail = useUiStore((state) => state.openDetail)
  const toggleFavorite = useCollectionStore((state) => state.toggleFavorite)
  // Album à jour (un booster vient peut-être d'y ajouter la carte) : favori, exemplaires, date.
  const { data, signedIn } = useCollection()
  const owned = data?.cards.find((entry) => entry.id === card.id && entry.owned)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [opening, setOpening] = useState(false)
  const [synopsis, setSynopsis] = useState<Synopsis>({ status: 'loading' })
  const width = Math.min(260, Math.round(window.innerWidth * 0.5))

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Résumé de l'œuvre (mis en cache par le service : rouvrir la carte est instantané).
  useEffect(() => {
    const controller = new AbortController()
    fetchSynopsis(card.mangaId, language, controller.signal)
      .then((text) => setSynopsis({ status: 'ready', text }))
      .catch(() => {
        if (!controller.signal.aborted) setSynopsis({ status: 'error' })
      })
    return () => controller.abort()
  }, [card.mangaId, language])

  useGSAP(
    () => {
      gsap.fromTo('[data-zoom-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 })
      gsap.fromTo('[data-zoom-card]', { y: 40, scale: 0.85, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.6, ease: EASE.spring })
      gsap.fromTo('[data-zoom-info]', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.1, ease: EASE.glide })
    },
    { scope: rootRef },
  )

  const viewWork = async () => {
    setOpening(true)
    try {
      const [book] = await fetchBooks([card.mangaId], language)
      if (book) {
        onClose()
        openDetail(book)
      }
    } finally {
      setOpening(false)
    }
  }

  const count = owned?.count ?? card.count ?? 1
  const date = owned?.obtainedAt ? new Intl.DateTimeFormat(t.locale, { dateStyle: 'long' }).format(new Date(owned.obtainedAt)) : null
  const color = RARITY_STYLE[card.rarity].color

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={card.title} className="fixed inset-0 z-[95] overflow-y-auto">
      <button type="button" data-zoom-backdrop aria-label={t.cards.close} tabIndex={-1} onClick={onClose} className="fixed inset-0 bg-void/95" />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t.cards.close}
        className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 grid size-11 place-items-center rounded-full bg-cream/10 text-cream/80"
      >
        <X size={18} />
      </button>

      {/* Un clic dans le vide autour de la carte et du texte ferme, comme sur le fond. */}
      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        className="relative flex min-h-full flex-col items-center justify-center gap-6 px-6 pt-16 pb-[max(2rem,env(safe-area-inset-bottom))] md:flex-row md:gap-10"
      >
        <div data-zoom-card className="shrink-0" onPointerDown={requestTiltPermission}>
          <CollectibleCard card={card} width={width} interactive gyro lazy={false} />
        </div>

        <div data-zoom-info className="flex w-full max-w-md flex-col gap-3">
          <p className="text-[11px] tracking-[0.22em] uppercase" style={{ color }}>
            {t.cards.rarity[card.rarity]} · {t.cards.copies(count)}
          </p>
          <h2 className="font-display text-3xl leading-tight text-cream">{card.title}</h2>
          {date && <p className="text-xs text-mist">{t.cards.obtained(date)}</p>}

          {/* Résumé de l'œuvre. */}
          <section aria-label={t.cards.synopsis} className="rounded-2xl border border-cream/10 bg-ink/90 p-4">
            <p className="text-[10px] tracking-[0.24em] text-mist uppercase">{t.cards.synopsis}</p>
            {synopsis.status === 'loading' ? (
              <div aria-hidden className="mt-3 flex flex-col gap-2">
                {[92, 100, 84, 60].map((line) => (
                  <span key={line} className="h-3 rounded-full bg-cream/10" style={{ width: `${line}%` }} />
                ))}
              </div>
            ) : (
              <p className="mt-2 max-h-[38vh] overflow-y-auto pr-1 text-sm leading-relaxed whitespace-pre-line text-cream/85">
                {synopsis.status === 'ready' && synopsis.text ? synopsis.text : t.cards.noSynopsis}
              </p>
            )}
          </section>

          <div className="flex gap-2 pt-1">
            {owned && signedIn && (
              <button
                type="button"
                onClick={() => {
                  vibrate(8)
                  void toggleFavorite(card.id)
                }}
                aria-pressed={owned.isFavorite}
                aria-label={owned.isFavorite ? t.cards.removeFavorite : t.cards.addFavorite}
                className={`grid size-11 shrink-0 place-items-center rounded-full ${owned.isFavorite ? 'bg-nope/20 text-nope' : 'bg-cream/10 text-cream/80'}`}
              >
                <Heart size={18} className={owned.isFavorite ? 'fill-nope' : ''} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void viewWork()}
              disabled={opening}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-cream/10 px-5 text-sm font-semibold text-cream disabled:opacity-50"
            >
              <BookOpen size={16} />
              {t.cards.viewWork}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
