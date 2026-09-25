import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { WifiOff } from 'lucide-react'
import { SymbolFace, PepiteFace } from '../components/tarot/CardFaces'
import { MOOD_SKINS, PACE_SKINS, isMoodId, isPaceId, type MoodId, type PaceId } from '../components/tarot/decks'
import { IntroDeck } from '../components/tarot/IntroDeck'
import { OracleParticles } from '../components/tarot/OracleParticles'
import { ResultPanel } from '../components/tarot/ResultPanel'
import { StreakBadge } from '../components/tarot/StreakBadge'
import { TarotCard3D, type CardState } from '../components/tarot/TarotCard3D'
import { useLanguage, useT } from '../i18n'
import { cachedTone, coverTone, fallbackTone } from '../lib/coverTone'
import { EASE, gsap, useGSAP } from '../lib/gsap'
import { vibrate } from '../lib/haptics'
import { liveStreak, localDay } from '../lib/oracle'
import { performDraw } from '../lib/oracleDraw'
import { fetchBooks, isMangadexId } from '../services/catalog'
import { seedBooks } from '../services/seedBooks'
import { useOracleStore } from '../store/useOracleStore'
import { useUiStore } from '../store/useUiStore'

/** Couleur de marque, avant qu'une carte ne soit révélée. */
const BRAND_TONE = '#7c5cff'
/** Durée du retournement (TarotCard3D) avant de lancer le final. */
const FLIP_SETTLE_MS = 1350

/** Marges latérales de la page (px-5) et place de l'anneau « à toi » autour d'une carte. */
const PAGE_GUTTER = 40
const RING_ROOM = 12

/** Largeur des cartes selon la place : trois de front sur téléphone, de grandes lames sur ordinateur. */
function cardWidthFor(width: number): number {
  if (width >= 1000) return 210
  if (width >= 640) return 172
  // Trois cartes + deux espaces de 12 px + l'anneau qui déborde de chaque côté.
  return Math.max(88, Math.min(118, Math.floor((width - PAGE_GUTTER - 24 - RING_ROOM) / 3)))
}

function resultWidthFor(width: number): number {
  if (width >= 768) return 270
  return Math.min(230, Math.floor(width * 0.62))
}

/**
 * « Le Tirage de l'Ombre » — rituel quotidien en trois cartes.
 *
 * Parcours : paquet → mélange (appel API) → distribution → révélation dans
 * l'ordre (Ambiance, Rythme, Pépite) → final (la Pépite émerge) → résultat,
 * puis compte à rebours jusqu'au tirage du lendemain. Un tirage commencé se
 * reprend là où on l'a laissé ; un tirage terminé reste affiché jusqu'à minuit.
 */
export function TarotPage() {
  const t = useT()
  const language = useLanguage()
  const notify = useUiStore((state) => state.notify)

  const today = useOracleStore((state) => state.today)
  const lastDay = useOracleStore((state) => state.lastDay)
  const streak = useOracleStore((state) => state.streak)
  const best = useOracleStore((state) => state.best)
  const revealNext = useOracleStore((state) => state.revealNext)
  const reroll = useOracleStore((state) => state.reroll)
  const refreshBooks = useOracleStore((state) => state.refreshBooks)

  const [day, setDay] = useState(localDay)
  const draw = today && today.day === day ? today : null
  const [shuffling, setShuffling] = useState(false)
  /** Vrai juste après la distribution : les cartes arrivent en glissant. */
  const [freshDeal, setFreshDeal] = useState(false)
  /** Vrai pendant le final (après la 3ᵉ carte), avant l'affichage du résultat. */
  const [finale, setFinale] = useState(false)
  const [emerging, setEmerging] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [width, setWidth] = useState(360)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 360))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const mood: MoodId = draw && isMoodId(draw.mood) ? draw.mood : 'action'
  const pace: PaceId = draw && isPaceId(draw.pace) ? draw.pace : 'completed'
  const phase = !draw ? 'intro' : draw.revealed < 3 || finale ? 'table' : 'result'

  /* ---- Teinte du fond : suit la dernière carte révélée ------------------ */
  // Teinte calculée de façon asynchrone, rattachée à son œuvre : tant qu'elle
  // n'est pas prête, on dérive la teinte en cache (ou de secours) au rendu.
  const pepite = draw?.pepite ?? null
  const [computedTone, setComputedTone] = useState<{ id: string; tone: string } | null>(null)
  useEffect(() => {
    if (!pepite) return
    let active = true
    void coverTone(pepite).then((tone) => {
      if (active) setComputedTone({ id: pepite.id, tone })
    })
    return () => {
      active = false
    }
  }, [pepite])
  const pepiteTone = !pepite
    ? BRAND_TONE
    : computedTone?.id === pepite.id
      ? computedTone.tone
      : (cachedTone(pepite) ?? fallbackTone(pepite.id))

  const revealed = draw?.revealed ?? 0
  const activeTone =
    revealed >= 3 ? pepiteTone : revealed === 2 ? PACE_SKINS[pace].tone : revealed === 1 ? MOOD_SKINS[mood].tone : BRAND_TONE

  useGSAP(
    () => {
      gsap.to(rootRef.current, { '--oracle-tone': activeTone, duration: 1.4, ease: 'power2.out' })
    },
    { dependencies: [activeTone] },
  )

  /* ---- Langue : mêmes œuvres, textes retraduits ------------------------- */
  useEffect(() => {
    if (!draw || draw.pepite.lang === language) return
    const books = [draw.pepite, ...draw.companions]
    if (draw.offline || !books.every((book) => isMangadexId(book.id))) {
      refreshBooks(seedBooks(language))
      return
    }
    const controller = new AbortController()
    fetchBooks(books.map((book) => book.id), language, controller.signal)
      .then(refreshBooks)
      .catch(() => undefined)
    return () => controller.abort()
  }, [draw, language, refreshBooks])

  /* ---- Tirage ---------------------------------------------------------- */
  const startDraw = async () => {
    if (shuffling) return
    vibrate(12)
    setShuffling(true)
    try {
      await performDraw(language)
      setFreshDeal(true)
    } catch {
      notify(t.search.unreachableBody, 'nope')
    } finally {
      setShuffling(false)
    }
  }

  // Distribution : les trois cartes glissent depuis le paquet, avec un léger dépassement.
  useGSAP(
    () => {
      if (phase !== 'table') return
      const cards = cardRefs.current.filter((card): card is HTMLDivElement => card !== null)
      if (freshDeal) {
        gsap
          .timeline({ onComplete: () => setFreshDeal(false) })
          .from(cards, {
            y: -window.innerHeight * 0.35,
            x: (index) => (1 - index) * width * 0.22,
            rotation: (index) => [-16, 4, 18][index] ?? 0,
            scale: 0.62,
            autoAlpha: 0,
            duration: 0.95,
            stagger: 0.17,
            ease: 'back.out(1.45)',
          })
          .from('[data-table-line]', { y: 14, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: EASE.swift }, 0.5)
      } else if (!finale) {
        gsap.from([...cards, ...gsap.utils.toArray('[data-table-line]')], { y: 16, autoAlpha: 0, duration: 0.6, stagger: 0.06, ease: EASE.swift })
      }
    },
    { dependencies: [phase], scope: tableRef },
  )

  const { contextSafe } = useGSAP({ scope: tableRef })

  // Final : l'Ambiance et le Rythme s'effacent vers la Pépite, qui grandit puis cède la place au résultat.
  const playFinale = () =>
    contextSafe(() => {
      const [first, second, third] = cardRefs.current
      gsap
        .timeline({
          delay: FLIP_SETTLE_MS / 1000,
          onComplete: () => {
            setEmerging(true)
            setFinale(false)
          },
        })
        .to([first, second], {
          x: (index) => (index === 0 ? 1 : 0.5) * width * 0.28,
          y: 30,
          scale: 0.72,
          autoAlpha: 0,
          duration: 0.75,
          stagger: 0.08,
          ease: 'power3.in',
        })
        .to('[data-table-line]', { autoAlpha: 0, duration: 0.3 }, 0)
        .to(third ?? {}, { x: -width * 0.12, scale: 1.14, duration: 0.8, ease: 'back.out(1.4)' }, 0.25)
    })()

  const reveal = (index: number) => {
    if (!draw || index !== draw.revealed) return
    revealNext()
    if (index === 2) {
      setFinale(true)
      playFinale()
    }
  }

  const onNewDay = useCallback(() => setDay(localDay()), [])

  // Relance : retour au paquet, et le mélange repart aussitôt.
  const onReroll = () => {
    setEmerging(false)
    setFinale(false)
    reroll()
    void startDraw()
  }

  const current = liveStreak({ lastDay, streak, best }, day)
  const cardWidth = cardWidthFor(width)
  const hint = revealed === 0 ? t.oracle.hints.mood : revealed === 1 ? t.oracle.hints.pace : revealed === 2 ? t.oracle.hints.pepite : t.oracle.hints.done
  const stateOf = (index: number): CardState => (index < revealed ? 'revealed' : index === revealed ? 'next' : 'sealed')
  const names = [t.oracle.cardNames.mood, t.oracle.cardNames.pace, t.oracle.cardNames.pepite]

  return (
    <div
      ref={rootRef}
      className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ '--oracle-tone': BRAND_TONE } as CSSProperties}
    >
      {/* Fond : halo néon de la carte révélée + poussière d'étoiles */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(closest-side at 50% 38%, color-mix(in oklab, var(--oracle-tone) 34%, transparent), transparent), radial-gradient(closest-side at 50% 100%, color-mix(in oklab, var(--oracle-tone) 14%, transparent), transparent)',
        }}
      />
      <OracleParticles />

      {/*
        Bord haut en fondu : les halos des cartes débordent volontairement de
        leur boîte ; sans ce masque, la zone de défilement les coupait net sous
        l'en-tête (une ligne horizontale visible). `pt-7` = hauteur du fondu,
        pour que le contenu, lui, reste net.
      */}
      <div className="no-scrollbar relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-7 pb-8 [mask-image:linear-gradient(to_bottom,transparent,#000_28px)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <StreakBadge streak={current} best={best} />
          {draw?.offline && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gold" title={t.oracle.offline}>
              <WifiOff size={13} />
            </span>
          )}
        </div>

        {phase === 'intro' && (
          <IntroDeck width={Math.min(150, cardWidth + 30)} shuffling={shuffling} onDraw={() => void startDraw()} />
        )}

        {phase === 'table' && draw && (
          // Table centrée dans la hauteur disponible : pas de grand vide sous les cartes.
          <div ref={tableRef} className="flex flex-1 flex-col items-center justify-center pt-6 pb-10">
            <p data-table-line className="min-h-5 text-center text-[12px] tracking-[0.08em] text-cream/75 md:text-sm">
              {hint}
            </p>

            <div className="mt-8 flex items-start justify-center gap-3 md:gap-10">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex flex-col items-center gap-3">
                  <TarotCard3D
                    ref={(node) => {
                      cardRefs.current[index] = node
                    }}
                    index={index}
                    width={cardWidth}
                    tone={index === 0 ? MOOD_SKINS[mood].tone : index === 1 ? PACE_SKINS[pace].tone : pepiteTone}
                    state={stateOf(index)}
                    label={stateOf(index) === 'sealed' ? t.oracle.sealed(names[index]) : t.oracle.cardAria(String(index + 1), names[index])}
                    onReveal={() => reveal(index)}
                  >
                    {index === 0 ? (
                      <SymbolFace
                        index={0}
                        cardName={names[0]}
                        icon={MOOD_SKINS[mood].icon}
                        tone={MOOD_SKINS[mood].tone}
                        title={t.oracle.moods[mood].name}
                        line={t.oracle.moods[mood].line}
                        width={cardWidth}
                      />
                    ) : index === 1 ? (
                      <SymbolFace
                        index={1}
                        cardName={names[1]}
                        icon={PACE_SKINS[pace].icon}
                        tone={PACE_SKINS[pace].tone}
                        title={t.oracle.paces[pace].name}
                        line={t.oracle.paces[pace].line}
                        width={cardWidth}
                      />
                    ) : (
                      <PepiteFace index={2} cardName={names[2]} book={draw.pepite} tone={pepiteTone} width={cardWidth} />
                    )}
                  </TarotCard3D>
                  <span
                    data-table-line
                    className={`text-center text-[9px] font-semibold tracking-[0.22em] uppercase md:text-[11px] ${
                      index < revealed ? 'text-cream/80' : index === revealed ? 'text-gold' : 'text-mist/60'
                    }`}
                  >
                    {names[index]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'result' && draw && (
          <ResultPanel
            draw={draw}
            mood={mood}
            pace={pace}
            streak={current}
            cardWidth={resultWidthFor(width)}
            emerging={emerging}
            onNewDay={onNewDay}
            onReroll={onReroll}
          />
        )}
      </div>
    </div>
  )
}
