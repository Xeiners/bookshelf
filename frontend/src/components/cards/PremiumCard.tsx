import { useId, type CSSProperties, type ReactNode } from 'react'
import type { CardFace } from './CollectibleCard'
import { IRIDESCENT } from './cardFrames'

/*
 * Les deux plus hautes raretés ont leur propre carte, quelle que soit la série :
 * - Légendaire, « relique dorée » : cadre d'or ciselé, filigranes aux angles, blason-joyau,
 *   soleil de rayons derrière le personnage, cartouche en bannière laquée, reflet qui balaie
 *   la carte ;
 * - Mythique, « prisme céleste » : cadre prismatique qui tourne, double liseré blanc, ciel
 *   étoilé et nébuleuse sur l'illustration, foil arc-en-ciel sous le doigt, cristaux-étoiles aux
 *   angles, gemme taillée en couronne, plaque à bordure irisée, éclat prismatique.
 *
 * Aucune particule ni étincelle animée (elles faisaient ramer les téléphones), aucun flou : des
 * dégradés et des tracés peints une fois. Seuls `transform` et `opacity`
 * s'animent (attribut `data-card-fx` : coupés si l'utilisateur réduit les animations, ou quand
 * l'écran est recouvert). Sous `DETAILED_FROM` px, la carte reste sobre (vignettes).
 */

const DETAILED_FROM = 96

const BEVEL = 'inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.25)'
const DROP = '0 14px 30px -14px rgba(0,0,0,0.9)'

const GOLD_METAL =
  'linear-gradient(135deg, #fff6cf 0%, #e0a82e 14%, #fff0b0 28%, #a5700f 44%, #f7d47c 58%, #8a5a0a 74%, #ffe39a 88%, #c8901c 100%)'
const GOLD_INK = 'linear-gradient(180deg, #fff8dc 0%, #ffd36b 48%, #c8901c 100%)'
const PRISM_EDGE = 'linear-gradient(100deg, #ff5ec4, #ffc46b 25%, #3fe0a0 50%, #4cc9f0 75%, #b46cff)'

/** Texte en dégradé (cartes seulement : la couleur reste lisible sur leur fond sombre). */
const gradientText = (gradient: string): CSSProperties => ({ background: gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' })

interface PremiumProps {
  card: CardFace
  width: number
  /** Bordure du cadre (px). */
  border: number
  /** Taille de texte de base (px). */
  font: number
  /** Effets en boucle (reflet qui balaie la carte, cadre qui tourne). */
  fx: boolean
  lazy: boolean
  pill: ReactNode
  numberLabel: string
}

/** L'illustration : personnage cadré par le haut, couverture par le centre. */
function Art({ card, lazy }: { card: CardFace; lazy: boolean }) {
  return (
    <img
      src={card.imageUrl}
      alt=""
      draggable={false}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${card.characterName ? 'object-top' : 'object-center'}`}
    />
  )
}

/** Nom en vedette (personnage, sinon l'œuvre), et l'œuvre dessous pour un personnage. */
const namesOf = (card: CardFace) => ({ name: card.characterName ?? card.title, work: card.characterName ? card.mangaTitle : undefined })

/* ---- Légendaire ---------------------------------------------------------------------------- */

/** Filigrane d'angle : double équerre arrondie, volute, losange et perles. Orienté pour l'angle haut-gauche. */
function Filigree({ gold, style }: { gold: string; style: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="pointer-events-none absolute" style={style}>
      <path d="M3 38 V12 Q3 3 12 3 H38" fill="none" stroke={`url(#${gold})`} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 38 V15 Q8 8 15 8 H38" fill="none" stroke={`url(#${gold})`} strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
      <path d="M13 22 Q13 13 22 13" fill="none" stroke={`url(#${gold})`} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 6.5 L15 9.5 L12 12.5 L9 9.5 Z" fill={`url(#${gold})`} stroke="#5a3a06" strokeWidth="0.4" />
      <circle cx="24" cy="3" r="1.3" fill="#fff4c8" />
      <circle cx="3" cy="24" r="1.3" fill="#fff4c8" />
    </svg>
  )
}

/** Blason-joyau au sommet : écu d'or, rubis taillé, étoile. */
function GoldCrest({ gold, size }: { gold: string; size: number }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ width: size, height: size, top: -size * 0.18 }}>
      <path d="M20 2 L34 9 V20 Q34 31 20 38 Q6 31 6 20 V9 Z" fill={`url(#${gold})`} stroke="#5a3a06" strokeWidth="1" />
      <path d="M20 7 L29.5 12 V20 Q29.5 27.5 20 33 Q10.5 27.5 10.5 20 V12 Z" fill="#2a1406" />
      <path d="M20 11 L26 19 L20 29 L14 19 Z" fill="#e2384d" />
      <path d="M20 11 L26 19 L20 19 Z" fill="#ff8a96" />
      <path d="M14 19 L20 29 L20 19 Z" fill="#9a1028" />
      <path d="M20 13.5 L21 17 L24.5 18 L21 19 L20 22.5 L19 19 L15.5 18 L19 17 Z" fill="#fff6dc" opacity="0.9" />
    </svg>
  )
}

const STAR_CLIP = 'polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%)'

export function LegendaryCard({ card, width, border, font, fx, lazy, pill, numberLabel }: PremiumProps) {
  const gold = `gold-${useId().replace(/:/g, '')}`
  const detailed = width >= DETAILED_FROM
  const { name, work } = namesOf(card)
  const ornament = Math.round(width * 0.24)
  const inset = border + Math.max(1, width * 0.012)

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[9%/6.5%]" style={{ background: GOLD_METAL, boxShadow: `${BEVEL}, ${DROP}` }}>
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6cf" />
            <stop offset="0.35" stopColor="#ffd36b" />
            <stop offset="0.6" stopColor="#c8901c" />
            <stop offset="1" stopColor="#fff0b0" />
          </linearGradient>
        </defs>
      </svg>
      {/* Gravure fine du métal. */}
      <div className="absolute inset-0 opacity-50 mix-blend-overlay" style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 4px)' }} />

      {/* Fenêtre de l'illustration, sertie d'un filet sombre puis clair. */}
      <div className="absolute overflow-hidden rounded-[7%/5%] bg-[#1a0f04]" style={{ inset, boxShadow: '0 0 0 1px rgba(70,40,0,0.9), 0 0 0 2px rgba(255,240,190,0.55)' }}>
        <Art card={card} lazy={lazy} />
        {/* Soleil : rayons dorés depuis le haut, derrière le personnage. */}
        <div
          className="absolute inset-0 mix-blend-overlay"
          style={{
            background: 'repeating-conic-gradient(from 0deg at 50% -8%, rgba(255,222,150,0.55) 0deg 3deg, transparent 3deg 11deg)',
            maskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.6) 45%, transparent 75%)',
            WebkitMaskImage: 'linear-gradient(180deg, #000 0%, rgba(0,0,0,0.6) 45%, transparent 75%)',
          }}
        />
        {/* Lumière chaude : l'illustration baigne dans l'or. */}
        <div className="absolute inset-0 mix-blend-soft-light" style={{ background: 'linear-gradient(160deg, rgba(255,214,120,0.55), transparent 45%, rgba(255,170,60,0.4))' }} />
        {/* Reflet d'or qui suit le doigt. */}
        <div className="absolute inset-0 mix-blend-overlay" style={{ background: 'radial-gradient(circle at var(--mx, 50%) var(--my, 30%), rgba(255,240,200,0.7), transparent 50%)', opacity: 'calc(0.25 + var(--holo, 0) * 0.6)' }} />
        {/* Pied assombri : le cartouche se détache. */}
        <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: 'linear-gradient(180deg, transparent, rgba(20,10,2,0.55) 45%, rgba(14,7,1,0.92))' }} />
      </div>

      {detailed && (
        <>
          <Filigree gold={gold} style={{ width: ornament, height: ornament, left: inset * 0.45, top: inset * 0.45 }} />
          <Filigree gold={gold} style={{ width: ornament, height: ornament, right: inset * 0.45, top: inset * 0.45, transform: 'scaleX(-1)' }} />
          <Filigree gold={gold} style={{ width: ornament, height: ornament, left: inset * 0.45, bottom: inset * 0.45, transform: 'scaleY(-1)' }} />
          <Filigree gold={gold} style={{ width: ornament, height: ornament, right: inset * 0.45, bottom: inset * 0.45, transform: 'scale(-1, -1)' }} />
          <GoldCrest gold={gold} size={Math.round(width * 0.16)} />
        </>
      )}

      {/* Cartouche : bannière d'or aux bouts taillés, laque sombre, nom en lettres d'or. */}
      <div className="absolute inset-x-[7%] bottom-[5%]" style={{ fontSize: font, lineHeight: 1.1 }}>
        <div className="p-[1.5px]" style={{ background: GOLD_METAL, clipPath: 'polygon(5% 0, 95% 0, 100% 50%, 95% 100%, 5% 100%, 0 50%)' }}>
          <div className="flex flex-col items-center px-[9%] pt-[5%] pb-[6%] text-center" style={{ background: 'linear-gradient(180deg, #3a2208, #160b02 60%, #241304)', clipPath: 'polygon(5% 0, 95% 0, 100% 50%, 95% 100%, 5% 100%, 0 50%)' }}>
            <p className="line-clamp-2 font-display tracking-[0.02em]" style={{ fontSize: font * 1.32, ...gradientText(GOLD_INK) }}>
              {name}
            </p>
            {work && detailed && (
              <p className="mt-[2%] w-full truncate text-[#ffe3a8]/70" style={{ fontSize: Math.max(7, font * 0.66) }}>
                {work}
              </p>
            )}
          </div>
        </div>
        <div className="mt-[4%] flex items-center justify-between gap-1 px-[2%]">
          {pill}
          <span className="shrink-0 font-semibold text-[#fff0b0] tabular-nums" style={{ fontSize: Math.max(7, font * 0.66), textShadow: '0 1px 0 #3a2208' }}>
            {numberLabel}
          </span>
        </div>
      </div>

      {fx && detailed && (
        // Reflet de lumière qui balaie toute la carte, de temps en temps.
        <div
          data-card-fx
          className="pointer-events-none absolute inset-y-[-10%] left-[-40%] w-[40%]"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,246,214,0.55) 50%, transparent)', animation: 'card-sweep 5s ease-in-out infinite', opacity: 0 }}
        />
      )}
    </div>
  )
}

/* ---- Mythique ------------------------------------------------------------------------------ */

/** Gemme taillée en couronne : facettes rose, cyan, violet, or. */
function PrismGem({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ width: size, height: size, top: -size * 0.12 }}>
      <path d="M20 3 L35 15 L20 37 L5 15 Z" fill="#14082a" stroke="#ffffff" strokeWidth="1.2" />
      <path d="M20 3 L27 15 L20 15 Z" fill="#ff8ad8" />
      <path d="M20 3 L13 15 L20 15 Z" fill="#9be8ff" />
      <path d="M5 15 L13 15 L20 37 Z" fill="#b46cff" />
      <path d="M35 15 L27 15 L20 37 Z" fill="#4cc9f0" />
      <path d="M13 15 L27 15 L20 37 Z" fill="#ffc46b" />
      <path d="M20 3 L35 15 L27 15 Z" fill="#ff5ec4" opacity="0.85" />
      <path d="M20 3 L5 15 L13 15 Z" fill="#3fe0a0" opacity="0.85" />
      <path d="M15 9 L18 7" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Cristaux-étoiles aux angles : ornements fixes (position en %, taille relative). */
const CRYSTALS = [
  { left: 6, top: 4.5, size: 0.11 },
  { left: 94, top: 4.5, size: 0.11 },
  { left: 6, top: 95.5, size: 0.09 },
  { left: 94, top: 95.5, size: 0.09 },
]

export function MythicCard({ card, width, border, font, fx, lazy, pill, numberLabel }: PremiumProps) {
  const detailed = width >= DETAILED_FROM
  const { name, work } = namesOf(card)
  const inset = border + Math.max(1, width * 0.01)

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[9%/6.5%] bg-[#0b0716]" style={{ boxShadow: `${BEVEL}, ${DROP}` }}>
      {/* Cadre prismatique : l'irisation tourne derrière la fenêtre. */}
      <div
        data-card-fx
        className="absolute top-1/2 left-1/2 aspect-square w-[190%] -translate-x-1/2 -translate-y-1/2"
        style={{ background: IRIDESCENT, animation: fx ? 'card-iridescent 7s linear infinite' : undefined }}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.45), transparent 35%, transparent 65%, rgba(255,255,255,0.25))' }} />

      <div className="absolute overflow-hidden rounded-[7%/5%] bg-[#0b0716]" style={{ inset, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9), 0 0 0 3px rgba(20,8,42,0.8)' }}>
        <Art card={card} lazy={lazy} />
        {/* Nébuleuse rose et cyan dans les coins. */}
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{ background: 'radial-gradient(70% 45% at 0% 0%, rgba(255,94,196,0.45), transparent 70%), radial-gradient(70% 45% at 100% 8%, rgba(76,201,240,0.4), transparent 70%), radial-gradient(80% 40% at 50% 100%, rgba(180,108,255,0.5), transparent 70%)' }}
        />
        {/* Ciel étoilé, plus dense en haut. */}
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 0.8px, transparent 1.3px), radial-gradient(rgba(190,230,255,0.7) 0.6px, transparent 1.1px)',
            backgroundSize: '23px 29px, 37px 31px',
            backgroundPosition: '0 0, 11px 7px',
            maskImage: 'linear-gradient(180deg, #000, rgba(0,0,0,0.4) 55%, transparent 80%)',
            WebkitMaskImage: 'linear-gradient(180deg, #000, rgba(0,0,0,0.4) 55%, transparent 80%)',
          }}
        />
        {/* Foil arc-en-ciel : toute l'illustration chatoie, plus fort sous le doigt. */}
        <div
          className="absolute inset-0 mix-blend-color"
          style={{
            background: 'linear-gradient(125deg, rgba(255,94,196,0.55), rgba(255,196,107,0.5) 20%, rgba(63,224,160,0.5) 40%, rgba(76,201,240,0.55) 60%, rgba(180,108,255,0.55) 80%, rgba(255,94,196,0.55))',
            backgroundSize: '300% 300%',
            backgroundPosition: 'var(--mx, 50%) var(--my, 50%)',
            opacity: 'calc(0.3 + var(--holo, 0) * 0.4)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: 'linear-gradient(180deg, transparent, rgba(11,7,22,0.6) 45%, rgba(8,5,18,0.94))' }} />
      </div>
      {/* Second liseré, fin et blanc, juste à l'intérieur de la fenêtre. */}
      <div className="pointer-events-none absolute rounded-[6%/4.3%]" style={{ inset: inset + width * 0.022, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)' }} />

      {detailed && <PrismGem size={Math.round(width * 0.15)} />}

      {/* Plaque : verre sombre cerclé d'irisation, nom en blanc souligné d'arc-en-ciel. */}
      <div className="absolute inset-x-[7%] bottom-[5%]" style={{ fontSize: font, lineHeight: 1.1 }}>
        <div className="rounded-[0.9em] p-[1.5px]" style={{ background: PRISM_EDGE }}>
          <div className="flex flex-col items-center rounded-[calc(0.9em-1.5px)] px-[8%] pt-[5%] pb-[6%] text-center" style={{ background: 'linear-gradient(180deg, rgba(24,12,48,0.92), rgba(8,5,18,0.96))' }}>
            <p className="line-clamp-2 font-display tracking-[0.02em] text-white" style={{ fontSize: font * 1.32, textShadow: '0 1px 0 rgba(255,94,196,0.6), 0 -1px 0 rgba(76,201,240,0.6)' }}>
              {name}
            </p>
            <span aria-hidden className="mt-[4%] block h-[2px] w-2/5 rounded-full" style={{ background: PRISM_EDGE }} />
            {work && detailed && (
              <p className="mt-[4%] w-full truncate text-cream/70" style={{ fontSize: Math.max(7, font * 0.66) }}>
                {work}
              </p>
            )}
          </div>
        </div>
        <div className="mt-[4%] flex items-center justify-between gap-1 px-[2%]">
          {pill}
          <span className="shrink-0 font-semibold text-white/85 tabular-nums" style={{ fontSize: Math.max(7, font * 0.66), textShadow: '0 1px 0 rgba(0,0,0,0.8)' }}>
            {numberLabel}
          </span>
        </div>
      </div>

      {detailed && (
        <>
          {CRYSTALS.map((crystal) => (
            <span
              key={`${crystal.left}-${crystal.top}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${crystal.left}%`,
                top: `${crystal.top}%`,
                width: width * crystal.size,
                height: width * crystal.size,
                background: 'conic-gradient(from 45deg, #ffffff, #9be8ff, #ff8ad8, #ffe39a, #ffffff)',
                clipPath: STAR_CLIP,
              }}
            />
          ))}
          {fx && (
            // Éclat prismatique qui traverse la carte.
            <div
              data-card-fx
              className="pointer-events-none absolute inset-y-[-10%] left-[-40%] w-[40%]"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,94,196,0.35) 30%, rgba(255,255,255,0.6) 50%, rgba(76,201,240,0.35) 70%, transparent)',
                animation: 'card-sweep 4.2s ease-in-out 1s infinite',
                opacity: 0,
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
