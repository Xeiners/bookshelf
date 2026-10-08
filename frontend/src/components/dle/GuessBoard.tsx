import { useRef, type ReactNode } from 'react'
import { ArrowBigDown, ArrowBigUp, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { HEAD_REVEAL, POPULARITY_LABELS, TILE_FLIP, TILE_LAND, TILE_STAGGER, reducedMotion } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { playDleTile } from '../../lib/sfx'
import { CATEGORY_ATTRIBUTES, type Attribute, type AttributeFeedback, type AttributeValues, type DleCategory, type GuessResult, type Verdict } from '../../services/dleApi'
import { VERDICT_STYLE, verdictDot } from './dleStyle'
import { PortraitImage } from '../ui/PortraitImage'

// Largeur fixe, hauteur au moins carrée : une valeur longue s'étale sur plusieurs lignes
// et toute la ligne grandit avec elle (les tuiles d'une ligne s'étirent ensemble).
const TILE = 'w-[4.25rem] min-h-[4.25rem] sm:w-[4.75rem] sm:min-h-[4.75rem]'


/**
 * Plateau du mode classique : une ligne par essai (le plus récent en haut), une
 * tuile par attribut. À son apparition, l'en-tête (Œuvre, Origine, Genres…) se
 * révèle étiquette après étiquette ; puis chaque nouvel essai se retourne tuile
 * après tuile, et l'étiquette de la colonne s'allume de la couleur du verdict.
 */
interface BoardProps {
  guesses: GuessResult[]
  category: DleCategory
  /** COOP : qui a proposé chaque essai (avatar et pseudo), affiché devant la ligne. */
  renderAuthor?: (guess: GuessResult) => ReactNode
}

export function ClassicBoard({ guesses, category, renderAuthor }: BoardProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const seen = useRef(guesses.length)
  const shown = guesses.length > 0

  // Révélation de l'en-tête : à l'arrivée du plateau (premier essai, ou retour sur l'énigme).
  useGSAP(
    () => {
      if (!shown || reducedMotion()) return
      gsap.fromTo(
        '[data-head]',
        { rotationX: 90, y: -10, autoAlpha: 0, transformPerspective: 400 },
        { rotationX: 0, y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.07, ease: 'back.out(1.8)' },
      )
    },
    { scope: rootRef, dependencies: [shown] },
  )

  // Nouvel essai : chaque tuile se retourne, son étiquette s'allume du même verdict, et
  // son verdict sonne à l'instant où elle se pose (pas au départ de son retournement).
  useGSAP(
    () => {
      const fresh = guesses.length - seen.current
      seen.current = guesses.length
      if (fresh <= 0 || reducedMotion()) return
      const tiles = gsap.utils.toArray<HTMLElement>('[data-row="0"] [data-tile]', rootRef.current)
      const heads = gsap.utils.toArray<HTMLElement>('[data-head]', rootRef.current)
      // L'en-tête vient d'apparaître : les tuiles attendent la fin de sa révélation.
      const offset = guesses.length === 1 ? HEAD_REVEAL : 0
      const timeline = gsap.timeline({ delay: offset })
      tiles.forEach((tile, index) => {
        const at = index * TILE_STAGGER
        const verdict = (tile.dataset.verdict as Verdict | undefined) ?? 'wrong'
        timeline.fromTo(
          tile,
          { rotationX: -100, scale: 0.85, autoAlpha: 0, transformPerspective: 500 },
          { rotationX: 0, scale: 1, autoAlpha: 1, duration: TILE_FLIP, ease: 'back.out(1.6)' },
          at,
        )
        timeline.call(() => playDleTile(verdict, index), undefined, at + TILE_LAND)
        const head = heads[index]
        const color = tile.dataset.verdict ? VERDICT_STYLE[tile.dataset.verdict as Verdict].solid : '#f7f5f0'
        if (head) {
          timeline.fromTo(head, { scale: 1.25, color, borderBottomColor: color }, { scale: 1, color: '#d6d3e0', borderBottomColor: 'rgba(255,255,255,0.18)', duration: 0.9, ease: 'power2.out' }, at + 0.15)
        }
      })
    },
    { scope: rootRef, dependencies: [guesses.length] },
  )

  if (!shown) return null
  const attributes = CATEGORY_ATTRIBUTES[category]
  const labels: Record<string, string> = category === 'manga' ? t.dle.attributes : t.dle[category].attributes

  return (
    <div ref={rootRef} className="no-scrollbar -mx-5 overflow-x-auto px-5 pb-2">
      {/* Centré quand il tient dans l'écran ; défilable à l'horizontale sinon. */}
      <div className="mx-auto flex w-max flex-col gap-2">
        <div className="flex gap-2" aria-hidden>
          {renderAuthor && <span className="w-12 shrink-0" />}
          {['work', ...attributes].map((key) => (
            <span
              key={key}
              data-head
              className="w-[4.25rem] border-b-2 border-white/[0.18] pb-1.5 text-center text-[11px] font-semibold text-[#d6d3e0] will-change-transform sm:w-[4.75rem] sm:text-xs"
            >
              {labels[key]}
            </span>
          ))}
        </div>
        {[...guesses].reverse().map((guess, index) => (
          <div key={guess.work.id} data-row={index} className="flex gap-2" role="group" aria-label={guess.work.name}>
            {renderAuthor && <div className="flex w-12 shrink-0 items-center justify-center">{renderAuthor(guess)}</div>}
            <div
              data-tile
              data-verdict={guess.correct ? 'exact' : 'wrong'}
              title={guess.work.name}
              className={`${TILE} relative shrink-0 self-stretch overflow-hidden rounded-xl border-[3px] bg-ink`}
              style={{ borderColor: guess.correct ? VERDICT_STYLE.exact.solid : 'rgba(255,255,255,0.16)' }}
            >
              <PortraitImage src={guess.work.imageUrl} name={guess.work.name} initialClassName="text-2xl" className={`absolute inset-0 h-full w-full object-cover ${category !== 'manga' ? 'object-top' : ''}`} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-1 pt-3 pb-0.5 text-[9px] leading-tight font-semibold text-white">{guess.work.name}</span>
            </div>
            {guess.feedback && guess.values &&
              attributes.map((attribute) => {
                const feedback = guess.feedback?.[attribute]
                return feedback ? (
                  <AttributeTile key={attribute} label={labels[attribute] ?? attribute} feedback={feedback}>
                    {category !== 'manga' ? (
                      <CharacterValue category={category} attribute={attribute} value={guess.values?.[attribute]} />
                    ) : (
                      <AttributeValue attribute={attribute as Attribute} values={guess.values as unknown as AttributeValues} />
                    )}
                  </AttributeTile>
                ) : null
              })}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Une tuile en relief et translucide (vert, orange, rouge) : le fond transparaît
 * à travers la couleur, sans flou ; texte blanc et gras, flèche nette sous la valeur.
 */
function AttributeTile({ label, feedback, children }: { label: string; feedback: AttributeFeedback; children: ReactNode }) {
  const t = useT()
  const style = VERDICT_STYLE[feedback.verdict]
  const Arrow = feedback.direction === 'higher' ? ArrowBigUp : feedback.direction === 'lower' ? ArrowBigDown : null
  const verdict = `${t.dle.verdict[feedback.verdict]}${feedback.direction ? `, ${t.dle.verdict[feedback.direction]}` : ''}`
  return (
    <div
      data-tile
      data-verdict={feedback.verdict}
      className={`${TILE} flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center will-change-transform`}
      style={{
        background: style.glass,
        color: style.color,
        // Relief tout en intérieur (aucune ombre ne déborde de la tuile) : liseré, arête en bas, reflet en haut.
        boxShadow: `inset 0 0 0 1.5px ${style.edge}, inset 0 -3px 0 ${style.edge}, inset 0 1px 0 rgba(255,255,255,0.3)`,
        textShadow: '0 1px 2px rgba(0,0,0,0.45)',
      }}
    >
      <span className="sr-only">{`${label} : `}</span>
      {children}
      {Arrow && <Arrow aria-hidden size={18} strokeWidth={2.5} className="fill-white/90" />}
      <span className="sr-only">{` (${verdict})`}</span>
    </div>
  )
}

/** Une valeur longue revient à la ligne (césure, sinon coupure) plutôt que d'être tronquée. */
const WRAP = 'block max-w-full hyphens-auto [overflow-wrap:anywhere]' // i18n-ignore

function AttributeValue({ attribute, values }: { attribute: Attribute; values: AttributeValues }) {
  const t = useT()
  const text = `text-xs leading-tight font-bold sm:text-[13px] ${WRAP}`
  switch (attribute) {
    case 'origin':
      return <span className={text}>{t.dle.origins[values.origin] ?? values.origin}</span>
    case 'demographic':
      return <span className={text}>{values.demographic ? (t.dle.demographics[values.demographic] ?? values.demographic) : t.dle.unknown}</span>
    case 'genres':
      return <ValueList values={values.genres} label={(genre) => t.dle.genres[genre] ?? genre} empty={t.dle.unknown} />
    case 'themes':
      return <ValueList values={values.themes ?? []} label={(theme) => t.dle.themes[theme] ?? theme} empty={t.dle.none} />
    case 'status':
      return <span className={text}>{values.status && values.status in t.publication ? t.publication[values.status as keyof typeof t.publication] : t.dle.unknown}</span>
    case 'year':
      return <span className="text-sm font-bold tabular-nums sm:text-base">{values.year ?? t.dle.unknown}</span>
    case 'rarity':
      return <span className={text}>{t.cards.rarity[values.rarity]}</span>
    case 'popularity':
      return <span className={`${text} tabular-nums`}>{POPULARITY_LABELS[values.popularity] ?? t.dle.unknown}</span>
  }
}

/** Une liste de valeurs dans une tuile : trois au plus, et « +n » pour le reste. */
function ValueList({ values, label, empty }: { values: string[]; label: (value: string) => string; empty: string }) {
  if (values.length === 0) return <span className="text-xs font-bold">{empty}</span>
  const shown = values.slice(0, 3)
  return (
    <span className="flex flex-col text-[10px] leading-[1.15] font-bold sm:text-[11px]">
      {shown.map((value) => (
        <span key={value} className={WRAP}>
          {label(value)}
        </span>
      ))}
      {values.length > 3 && <span className="opacity-70">+{values.length - 3}</span>}
    </span>
  )
}

/** Valeur d'un personnage (Naruto, One Piece, JoJo, JJK, Dragon Ball, My Hero Academia) : listes, mots traduits, prime en format compact. */
function CharacterValue({ category, attribute, value }: { category: DleCategory; attribute: string; value: unknown }) {
  const t = useT()
  const language = useLanguage()
  const text = `text-xs leading-tight font-bold sm:text-[13px] ${WRAP}`
  const naruto = t.dle.naruto
  const jojo = t.dle.jojo
  const universe = category === 'manga' ? naruto : t.dle[category]
  // Chaque univers traduit ses valeurs (affiliations, grades, arcs…) ; la première apparition passe par `arc`.
  const translated = universe as unknown as Record<string, Record<string, string> | undefined>
  const dictionaries: Record<string, Record<string, string>> = { ...(translated as Record<string, Record<string, string>>), debut: translated.arc ?? {} }
  const empty = universe.none
  // JoJo : la partie de la première apparition.
  if (category === 'jojo' && attribute === 'debut' && typeof value === 'number') return <span className={text}>{jojo.part(value)}</span>
  if (attribute === 'bounty') {
    const bounty = typeof value === 'number' ? new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value) : naruto.none
    return <span className="text-sm font-bold tabular-nums">{bounty}</span>
  }
  const names = dictionaries[attribute] ?? {}
  if (Array.isArray(value)) return <ValueList values={value.filter((entry): entry is string => typeof entry === 'string')} label={(entry) => names[entry] ?? entry} empty={empty} />
  const single = typeof value === 'string' ? value : ''
  return <span className={text}>{names[single] ?? (single || empty)}</span>
}

/** Légende des couleurs, sous le plateau : trois pastilles, trois mots. */
export function VerdictLegend() {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-mist">
      {(['exact', 'partial', 'wrong'] as const).map((verdict) => (
        <span key={verdict} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-[4px]" style={verdictDot(verdict)} />
          {t.dle.legend[verdict]}
        </span>
      ))}
    </div>
  )
}

/** Mode couverture : les œuvres déjà proposées, la dernière en tête (en COOP, avec leur auteur). */
export function WrongGuesses({ guesses, renderAuthor }: { guesses: GuessResult[]; renderAuthor?: (guess: GuessResult) => ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrong = guesses.filter((guess) => !guess.correct)

  useGSAP(
    () => {
      if (wrong.length === 0) return
      gsap.fromTo('[data-wrong="0"]', { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.4, ease: EASE.swift })
      gsap.fromTo('[data-wrong="0"] [data-cross]', { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.45, ease: EASE.snap, delay: 0.1 })
    },
    { scope: rootRef, dependencies: [wrong.length] },
  )

  if (wrong.length === 0) return null
  return (
    <div ref={rootRef}>
      <ul className="flex flex-col gap-1.5">
        {[...wrong].reverse().map((guess, index) => (
          <li
            key={guess.work.id}
            data-wrong={index}
            className="flex items-center gap-3 rounded-xl border px-2 py-1.5"
            style={{ background: 'rgba(207,59,74,0.12)', borderColor: 'rgba(207,59,74,0.45)' }}
          >
            <PortraitImage src={guess.work.imageUrl} name={guess.work.name} className="h-10 w-7 shrink-0 rounded bg-ink object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm text-cream">{guess.work.name}</span>
            {renderAuthor?.(guess)}
            <span data-cross aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-white" style={{ background: VERDICT_STYLE.wrong.solid }}>
              <X size={14} strokeWidth={3} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
