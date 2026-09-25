import { useRef, useState } from 'react'
import { BookOpen, Check, Heart, RotateCcw, Share2, Star } from 'lucide-react'
import { useCoverTone } from '../../hooks/useCoverTone'
import { useT } from '../../i18n'
import { formatAuthors } from '../../lib/format'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { shareDraw } from '../../lib/oracleShare'
import { useLibraryStore } from '../../store/useLibraryStore'
import type { TodayDraw } from '../../store/useOracleStore'
import { useUiStore } from '../../store/useUiStore'
import { BookCover } from '../ui/BookCover'
import { PepiteFace } from './CardFaces'
import { Countdown } from './Countdown'
import { MOOD_SKINS, PACE_SKINS, type MoodId, type PaceId } from './decks'
import { TarotCard3D } from './TarotCard3D'

interface ResultPanelProps {
  draw: TodayDraw
  mood: MoodId
  pace: PaceId
  streak: number
  cardWidth: number
  /** Arrivée depuis le final (animation d'émergence) ou reprise (sobre). */
  emerging: boolean
  onNewDay: () => void
  /** Refaire un tirage aujourd'hui (provisoire). */
  onReroll: () => void
}

/** Pastille néo-brutaliste : icône, nom, bord et ombre dure à la couleur de la carte. */
function ComboChip({ icon: Icon, label, tone }: { icon: typeof Heart; label: string; tone: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg border-2 bg-[#0c0b11] px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-cream uppercase"
      style={{ borderColor: tone, boxShadow: `3px 3px 0 0 ${tone}` }}
    >
      <Icon size={12} strokeWidth={2.4} style={{ color: tone }} />
      {label}
    </span>
  )
}

/**
 * Séquence finale : la Pépite au centre, grande et illuminée, avec la
 * combinaison du jour, les actions (wishlist, lire), le partage et deux titres
 * « dans la même veine ».
 */
export function ResultPanel({ draw, mood, pace, streak, cardWidth, emerging, onNewDay, onReroll }: ResultPanelProps) {
  const t = useT()
  const { pepite, companions } = draw
  const tone = useCoverTone(pepite)
  const moodSkin = MOOD_SKINS[mood]
  const paceSkin = PACE_SKINS[pace]

  const entry = useLibraryStore((state) => state.entries[pepite.id])
  const save = useLibraryStore((state) => state.save)
  const notify = useUiStore((state) => state.notify)
  const openDetail = useUiStore((state) => state.openDetail)
  const [sharing, setSharing] = useState(false)
  /** Éclat de l'émergence : démonté dès qu'il s'est éteint (au repos, il élargirait la page). */
  const [burstLive, setBurstLive] = useState(emerging)

  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const timeline = gsap.timeline({ defaults: { ease: EASE.swift } })
      if (emerging) {
        timeline
          .from('[data-result-card]', { scale: 0.7, y: 40, autoAlpha: 0, duration: 0.9, ease: 'back.out(1.5)' })
          .fromTo('[data-result-burst]', { scale: 0.4, autoAlpha: 0.9 }, { scale: 1.25, autoAlpha: 0, duration: 1.1, ease: 'power2.out', onComplete: () => setBurstLive(false) }, 0.1)
      } else {
        timeline.from('[data-result-card]', { y: 24, autoAlpha: 0, duration: 0.6 })
      }
      timeline.from('[data-result-line]', { y: 20, autoAlpha: 0, duration: 0.6, stagger: 0.07 }, emerging ? 0.45 : 0.1)
    },
    { scope: rootRef },
  )

  const inWishlist = entry !== undefined

  const addToWishlist = () => {
    if (inWishlist) return
    vibrate([10, 30, 14])
    save(pepite, 'wishlist')
    notify(t.deck.addedToWishlist(pepite.title), 'like')
  }

  const readNow = () => {
    vibrate(12)
    save(pepite, 'reading')
    notify(t.oracle.readingNow(pepite.title), 'like')
    if (pepite.previewLink) window.open(pepite.previewLink, '_blank', 'noopener,noreferrer')
  }

  const share = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const outcome = await shareDraw({
        draw,
        moodName: t.oracle.moods[mood].name,
        paceName: t.oracle.paces[pace].name,
        moodTone: moodSkin.tone,
        paceTone: paceSkin.tone,
        pepiteTone: tone,
        streak,
        t,
      })
      if (outcome === 'shared') notify(t.oracle.shareReady, 'like')
      else if (outcome === 'saved') notify(t.oracle.shareSaved, 'like')
    } catch {
      notify(t.oracle.shareFailed, 'nope')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-8 pt-2 md:flex-row md:items-start md:justify-center md:gap-12 md:pt-6">
      {/* La Pépite */}
      <div data-result-card className="relative shrink-0">
        {burstLive && (
          <div
            data-result-burst
            aria-hidden
            className="pointer-events-none absolute -inset-1/2"
            style={{ background: `radial-gradient(closest-side, ${tone}, transparent)`, opacity: 0, visibility: 'hidden' }}
          />
        )}
        <TarotCard3D
          index={2}
          width={cardWidth}
          tone={tone}
          state="revealed"
          instant
          label={pepite.title}
          onOpen={() => openDetail(pepite)}
        >
          <PepiteFace index={2} cardName={t.oracle.cardNames.pepite} book={pepite} tone={tone} width={cardWidth} />
        </TarotCard3D>
      </div>

      {/* La combinaison */}
      <div className="w-full max-w-md text-center md:pt-4 md:text-left">
        <p data-result-line className="text-[10px] tracking-[0.3em] uppercase" style={{ color: tone }}>
          {t.oracle.resultEyebrow}
        </p>
        <h2 data-result-line className="mt-2 font-display text-[2rem] leading-[1.02] text-cream md:text-[2.6rem]">
          {pepite.title}
        </h2>
        <p data-result-line className="mt-2 text-[11px] tracking-[0.18em] text-mist uppercase">
          {formatAuthors(pepite.authors, t)}
          {pepite.rating !== null && (
            <span className="ml-3 inline-flex items-center gap-1 text-gold">
              <Star size={11} className="fill-gold" />
              {pepite.rating.toFixed(1)}
            </span>
          )}
        </p>

        <div data-result-line className="mt-4 flex flex-wrap justify-center gap-2.5 md:justify-start">
          <ComboChip icon={moodSkin.icon} label={t.oracle.moods[mood].name} tone={moodSkin.tone} />
          <span aria-hidden className="self-center font-display text-lg text-mist">
            ×
          </span>
          <ComboChip icon={paceSkin.icon} label={t.oracle.paces[pace].name} tone={paceSkin.tone} />
        </div>
        {draw.relaxed && !draw.offline && (
          <p data-result-line className="mt-2 text-[11px] text-mist italic">
            {t.oracle.relaxed}
          </p>
        )}

        {pepite.synopsis && (
          <p
            data-result-line
            lang={pepite.synopsisLanguage ?? undefined}
            className="mt-4 line-clamp-4 text-sm leading-relaxed text-cream/70"
          >
            {pepite.synopsis}
          </p>
        )}

        {/* Actions */}
        <div data-result-line className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
          <button
            type="button"
            onClick={addToWishlist}
            disabled={inWishlist}
            // Déjà ajouté : plus de fond ni d'ombre portée, un simple état en texte clair.
            className={`inline-flex items-center gap-2 rounded-xl border-2 px-5 py-3 text-xs font-bold tracking-[0.06em] uppercase transition-[transform,box-shadow] duration-150 ${
              inWishlist
                ? 'border-cream/25 bg-transparent text-cream'
                : 'border-void bg-cream text-void hover:-translate-y-0.5 active:translate-y-0.5'
            }`}
            style={inWishlist ? undefined : { boxShadow: `4px 4px 0 0 ${tone}` }}
          >
            {inWishlist ? <Check size={14} strokeWidth={3} style={{ color: tone }} /> : <Heart size={14} strokeWidth={2.6} />}
            {inWishlist ? t.oracle.inWishlist : t.oracle.addWishlist}
          </button>
          <button
            type="button"
            onClick={readNow}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-cream/80 bg-void px-5 py-3 text-xs font-bold tracking-[0.06em] text-cream uppercase transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0.5"
          >
            <BookOpen size={14} strokeWidth={2.6} />
            {t.oracle.readNow}
          </button>
        </div>

        <div data-result-line className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 md:justify-start">
          <button
            type="button"
            onClick={() => void share()}
            disabled={sharing}
            className="inline-flex items-center gap-2 text-xs font-semibold text-glow underline-offset-4 hover:underline disabled:opacity-60"
          >
            <Share2 size={14} />
            {t.oracle.share}
          </button>
          <button
            type="button"
            onClick={onReroll}
            className="inline-flex items-center gap-2 text-xs font-semibold text-cream/80 underline-offset-4 hover:text-cream hover:underline"
          >
            <RotateCcw size={14} />
            {t.oracle.reroll}
          </button>
          <Countdown onNewDay={onNewDay} />
        </div>

        {/* Dans la même veine */}
        {companions.length > 0 && (
          <div data-result-line className="mt-8 border-t-2 border-cream/10 pt-5">
            <p className="text-[10px] tracking-[0.28em] text-mist uppercase">{t.oracle.companions}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {companions.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => openDetail(book)}
                  className="flex items-center gap-3 rounded-xl border-2 border-cream/10 bg-void/60 p-2 text-left transition-colors hover:border-cream/30"
                >
                  <span className="w-10 shrink-0 overflow-hidden rounded-md">
                    <BookCover book={book} className="aspect-2/3 w-full" />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[12px] leading-snug font-medium text-cream">{book.title}</span>
                    {book.rating !== null && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gold">
                        <Star size={9} className="fill-gold" />
                        {book.rating.toFixed(1)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
