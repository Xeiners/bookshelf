import { useRef } from 'react'
import { ArrowRight, PartyPopper } from 'lucide-react'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import type { ChapterStep } from './ReaderControls'
import { Pressable } from '../ui/Pressable'

interface ChapterEndProps {
  /** Libellé du chapitre qui se termine. */
  label: string | null
  next: ChapterStep | null
  /** Crédits (équipe de traduction, source). */
  credits?: string[]
  /** `floating` : pastille au-dessus de la page (mode paginé) ; sinon bloc en fin de défilement. */
  variant?: 'block' | 'floating'
}

/**
 * Fin de chapitre : bouton « Chapitre suivant → », ou « Tu es à jour ».
 * En mode paginé, c'est une pastille qui glisse depuis le bas de la dernière page.
 */
export function ChapterEnd({ label, next, credits = [], variant = 'block' }: ChapterEndProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.from(rootRef.current, { y: variant === 'floating' ? 48 : 24, autoAlpha: 0, duration: 0.6, ease: EASE.snap })
    },
    { scope: rootRef },
  )

  if (variant === 'floating') {
    if (!next) return null
    return (
      <div ref={rootRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-safe">
        <Pressable
          onClick={next.go}
          className="pointer-events-auto mb-4 flex items-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-medium text-void shadow-lift"
        >
          {t.reader.nextChapterCta}
        </Pressable>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-4 px-6 pt-14 pb-[40vh] text-center">
      <p className="text-[11px] tracking-[0.2em] text-mist uppercase">{t.reader.endOfChapter}</p>
      {label && <h2 className="font-display text-3xl text-cream">{label}</h2>}
      {next ? (
        <Pressable
          onClick={next.go}
          className="mt-2 flex items-center gap-2 rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-void shadow-lift"
        >
          {t.reader.nextChapter}
          <ArrowRight size={16} />
        </Pressable>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-2">
          <PartyPopper size={22} className="text-gold" />
          <p className="font-display text-2xl text-cream">{t.reader.caughtUp}</p>
          <p className="max-w-xs text-sm text-mist">{t.reader.caughtUpBody}</p>
        </div>
      )}
      {credits.length > 0 && (
        <div className="mt-6 space-y-1 text-[11px] text-mist/80">
          {credits.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
