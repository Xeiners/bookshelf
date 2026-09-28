import type { CSSProperties } from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITY_STYLE, type Rarity } from '../../lib/boosters'
import { BRAND } from '../../lib/brand'
import { IRIDESCENT } from '../cards/cardFrames'

interface BoosterPackArtProps {
  width: number
  /** Halo selon le contenu : la meilleure carte du booster (Épique et au-delà), sinon neutre. */
  halo?: Rarity | null
  /** Bordures incandescentes : un booster est prêt. */
  lit?: boolean
  /** Verrouillé (invité, stock vide) : métal éteint. */
  dim?: boolean
}

/** Bande à déchirer : bord inférieur en dents de scie. */
const STRIP_CLIP =
  'polygon(0 0, 100% 0, 100% 80%, 95% 100%, 90% 80%, 85% 100%, 80% 80%, 75% 100%, 70% 80%, 65% 100%, 60% 80%, 55% 100%, 50% 80%, 45% 100%, 40% 80%, 35% 100%, 30% 80%, 25% 100%, 20% 80%, 15% 100%, 10% 80%, 5% 100%, 0 80%)'

/** Une pièce de la bande : dorure, bord en dents de scie, perforations. */
function StripFace() {
  return (
    <>
      <div className="absolute inset-0 rounded-t-[14px]" style={{ background: 'linear-gradient(180deg, #ffe39a, #e8a23c 60%, #c0368f)', clipPath: STRIP_CLIP }} />
      <div className="absolute inset-x-[3%] bottom-[26%] h-0 border-t-2 border-dotted" style={{ borderColor: '#fff4c8' }} />
    </>
  )
}

/**
 * Le booster, dessiné : feuille holographique, sceau en relief, dorures, et
 * une ligne de perforations dorée / néon sous la bande à déchirer. Purement
 * visuel : les animations (flottaison, déchirure) sont pilotées par le
 * parent via les attributs `data-pack-*`.
 */
export function BoosterPackArt({ width, halo = null, lit = false, dim = false }: BoosterPackArtProps) {
  const t = useT()
  const height = Math.round(width * 1.55)
  const haloDramatic = halo !== null && RARITY_STYLE[halo].holo
  const haloColor = halo ? RARITY_STYLE[halo].color : '#7c5cff'

  return (
    <div className="relative" style={{ width, height }}>
      {/* Halo : révèle le contenu (doré si une Légendaire est dedans, irisé pour une Mythique). */}
      <div
        data-pack-halo
        aria-hidden
        className="pointer-events-none absolute -inset-[45%] -z-10"
        style={{
          opacity: haloDramatic ? 1 : 0.55,
          background: `radial-gradient(closest-side, color-mix(in oklab, ${haloColor} ${haloDramatic ? 70 : 40}%, transparent), transparent 72%)`,
        }}
      />
      {halo === 'MYTHIC' && (
        <div
          aria-hidden
          data-card-fx
          className="pointer-events-none absolute -inset-[38%] -z-10 rounded-full"
          style={{
            background: IRIDESCENT,
            opacity: 0.55,
            maskImage: 'radial-gradient(closest-side, #000 30%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(closest-side, #000 30%, transparent 72%)',
            animation: 'card-iridescent 5s linear infinite',
          }}
        />
      )}

      {/* Corps : feuille d'aluminium holographique. */}
      <div
        className="absolute inset-0 overflow-hidden rounded-[14px]"
        style={{
          background: 'linear-gradient(160deg, #1d1440 0%, #5b3fd0 30%, #c0368f 62%, #e8a23c 100%)',
          boxShadow: lit
            ? '0 0 0 1px rgba(255,228,160,0.85), 0 0 22px rgba(255,196,107,0.55), 0 30px 60px -22px rgba(0,0,0,0.9)'
            : '0 0 0 1px rgba(255,255,255,0.18), 0 30px 60px -22px rgba(0,0,0,0.9)',
          filter: dim ? 'grayscale(0.85) brightness(0.55)' : undefined,
        } as CSSProperties}
      >
        {/* Nervures de la feuille. */}
        <div className="absolute inset-0 opacity-25" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 9px)' }} />
        {/* Irisation fixe. */}
        {/* Irisation fixe, en fondu normal (pas de mode de fusion : recalculé à chaque image dès que le paquet bouge). */}
        <div className="absolute inset-0 opacity-20" style={{ background: 'linear-gradient(120deg, transparent 20%, #8fe3ff 40%, #ffb3e6 55%, transparent 75%)' }} />
        {/* Reflet qui balaie la feuille. */}
        <div
          data-pack-shine
          className="absolute inset-y-0 left-0 w-1/2 -skew-x-12"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)', willChange: 'transform' }}
        />
        {/* Dorures : filet intérieur. */}
        <div className="absolute inset-[5%] top-[15%] rounded-[10px] border border-[#ffe39a]/55" />

        {/* Sceau en relief et marque. */}
        <div className="absolute inset-x-0 top-[27%] flex flex-col items-center gap-[0.35em] text-center" style={{ fontSize: width * 0.07 }}>
          <span
            className="grid place-items-center rounded-full border-2 border-[#ffe39a]/80"
            style={{
              width: width * 0.36,
              height: width * 0.36,
              background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(29,20,64,0.55) 70%)',
              boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.45), 0 0 18px rgba(255,196,107,0.35)',
            }}
          >
            <Sparkles size={Math.round(width * 0.17)} className="text-[#fff4c8]" />
          </span>
          <span className="mt-[0.4em] font-semibold tracking-[0.42em] text-[#fff4c8] uppercase" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}>{BRAND}</span>
          <span
            className="rounded-full px-[0.9em] py-[0.25em] font-semibold tracking-[0.28em] uppercase"
            style={{ fontSize: '0.62em', color: '#2a1a02', background: 'linear-gradient(135deg, #fff0b0, #c8901c)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }}
          >
            {t.boosters.packLabel}
          </span>
        </div>
      </div>

      {/*
        Bande à découper, avec sa ligne de perforations dorée. Deux pièces
        pilotées par la variable CSS \`--cut\` (0 → 1, posée par le parent au
        rythme du doigt) : la partie déjà découpée, à gauche, se soulève comme
        un rabat autour du point de coupe ; le reste tient encore au paquet.
      */}
      <div
        data-pack-strip
        className="absolute inset-x-0 top-0 h-[13%]"
        style={{ willChange: 'transform', filter: dim ? 'grayscale(0.85) brightness(0.55)' : undefined }}
      >
        <div
          className="absolute inset-0"
          style={{
            clipPath: 'inset(0 calc((1 - var(--cut, 0)) * 100%) 0 0)',
            transformOrigin: 'calc(var(--cut, 0) * 100%) 100%',
            transform: 'rotate(calc(var(--cut, 0) * 26deg)) translateY(calc(var(--cut, 0) * -3px))',
          }}
        >
          <StripFace />
        </div>
        <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 calc(var(--cut, 0) * 100%))' }}>
          <StripFace />
        </div>
        {/* Point de coupe : une étincelle suit le doigt le long des perforations. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[26%] size-4 -translate-x-1/2 translate-y-1/2 rounded-full"
          style={{
            left: 'calc(3% + var(--cut, 0) * 94%)',
            opacity: 'var(--cutting, 0)',
            background: 'radial-gradient(circle, #ffffff 0%, #fff4c8 30%, rgba(255,196,107,0.6) 55%, transparent 72%)',
          }}
        />
      </div>

      {/* Éclair qui jaillit de l'ouverture, à la déchirure. */}
      <div
        data-pack-flash
        aria-hidden
        // Carré, dégradé éteint avant les bords (`closest-side`) : aucune arête nette, même agrandi.
        className="pointer-events-none absolute top-[6%] left-1/2 aspect-square w-[150%] -translate-x-1/2 -translate-y-1/2 opacity-0"
        style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.95), rgba(255,196,107,0.55) 35%, rgba(255,196,107,0.15) 65%, transparent)' }}
      />
    </div>
  )
}
