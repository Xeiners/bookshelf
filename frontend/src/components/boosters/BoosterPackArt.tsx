import { useEffect, type CSSProperties } from 'react'
import { Sparkles, Star } from 'lucide-react'
import { useT } from '../../i18n'
import { RARITIES, RARITY_STYLE, type Rarity } from '../../lib/boosters'
import { BRAND } from '../../lib/brand'
import type { CardSeries } from '../../services/cardsApi'
import { useBoosterStore } from '../../store/useBoosterStore'
import { IRIDESCENT } from '../cards/cardFrames'

interface BoosterPackArtProps {
  width: number
  /** Halo selon le contenu : la meilleure carte du booster (Épique et au-delà), sinon neutre. */
  halo?: Rarity | null
  /** Bordures incandescentes : un booster est prêt. */
  lit?: boolean
  /** Verrouillé (invité, stock vide) : métal éteint. */
  dim?: boolean
  /** Série du paquet : ses couleurs, ses couvertures. Sans série : le paquet générique. */
  series?: CardSeries | null
}

/** Couleurs de chaque série : feuille, dorures, nom. */
const SERIES_STYLE: Record<CardSeries, { foil: string; ink: string; gild: string; glow: string; title: string }> = {
  1: {
    foil: 'linear-gradient(160deg, #140c33 0%, #4a2fb8 32%, #b0307f 64%, #e8a23c 100%)',
    ink: '#120a26',
    gild: '#ffe39a',
    glow: 'rgba(255,196,107,0.55)',
    title: 'linear-gradient(180deg, #fff8dc, #ffd36b 45%, #e0902e)',
  },
  2: {
    foil: 'linear-gradient(160deg, #04121f 0%, #0b5c8a 30%, #2b7bff 58%, #ff5ec4 100%)',
    ink: '#040d18',
    gild: '#9be8ff',
    glow: 'rgba(76,201,240,0.55)',
    title: 'linear-gradient(180deg, #f2fdff, #8fe3ff 45%, #ff8ad8)',
  },
}

const GENERIC_FOIL = 'linear-gradient(160deg, #1d1440 0%, #5b3fd0 30%, #c0368f 62%, #e8a23c 100%)'

/** Bande à déchirer : bord inférieur en dents de scie. */
const STRIP_CLIP =
  'polygon(0 0, 100% 0, 100% 80%, 95% 100%, 90% 80%, 85% 100%, 80% 80%, 75% 100%, 70% 80%, 65% 100%, 60% 80%, 55% 100%, 50% 80%, 45% 100%, 40% 80%, 35% 100%, 30% 80%, 25% 100%, 20% 80%, 15% 100%, 10% 80%, 5% 100%, 0 80%)'

/** En dessous de cette largeur, le paquet reste sobre (icône, vignette) : pas de collage illisible. */
const DETAILED_FROM = 96

/** Une pièce de la bande : dorure, bord en dents de scie, perforations. */
function StripFace({ gild }: { gild: string }) {
  return (
    <>
      <div className="absolute inset-0 rounded-t-[14px]" style={{ background: `linear-gradient(180deg, ${gild}, #e8a23c 60%, #c0368f)`, clipPath: STRIP_CLIP }} />
      <div className="absolute inset-x-[3%] bottom-[26%] h-0 border-t-2 border-dotted" style={{ borderColor: '#fff4c8' }} />
    </>
  )
}

/** Couvertures de la série (chargées une fois pour toute l'app). */
function useSeriesCovers(series: CardSeries | null, wanted: boolean): string[] {
  const showcase = useBoosterStore((state) => state.showcase)
  const load = useBoosterStore((state) => state.loadShowcase)
  useEffect(() => {
    if (wanted && series !== null && showcase === null) void load()
  }, [wanted, series, showcase, load])
  return series === null ? [] : (showcase?.find((entry) => entry.series === series)?.covers ?? [])
}

/**
 * Le booster, dessiné comme un paquet de cartes à collectionner : feuille
 * holographique aux couleurs de la série, mosaïque inclinée des couvertures de ses
 * œuvres, carte vedette (la plus rare) sertie d'irisations, bandeau « SÉRIE n »
 * doré, pierres de rareté. Purement visuel : les animations (flottaison,
 * déchirure) sont pilotées par le parent via les attributs `data-pack-*`.
 */
export function BoosterPackArt({ width, halo = null, lit = false, dim = false, series = null }: BoosterPackArtProps) {
  const t = useT()
  const height = Math.round(width * 1.55)
  const haloDramatic = halo !== null && RARITY_STYLE[halo].holo
  const haloColor = halo ? RARITY_STYLE[halo].color : series ? SERIES_STYLE[series].glow : '#7c5cff'
  const detailed = series !== null && width >= DETAILED_FROM
  const covers = useSeriesCovers(series, detailed)
  const style = series ? SERIES_STYLE[series] : null
  const gild = style?.gild ?? '#ffe39a'
  const [hero, ...mosaic] = covers
  // Douze tuiles pour la mosaïque : les couvertures, répétées s'il en manque.
  const tiles = mosaic.length > 0 ? Array.from({ length: 12 }, (_, index) => mosaic[index % mosaic.length] as string) : []

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
          background: style?.foil ?? GENERIC_FOIL,
          boxShadow: lit
            ? `0 0 0 1px ${gild}d9, 0 0 22px ${style?.glow ?? 'rgba(255,196,107,0.55)'}, 0 30px 60px -22px rgba(0,0,0,0.9)`
            : '0 0 0 1px rgba(255,255,255,0.18), 0 30px 60px -22px rgba(0,0,0,0.9)',
          filter: dim ? 'grayscale(0.85) brightness(0.55)' : undefined,
        } as CSSProperties}
      >
        {detailed && tiles.length > 0 && (
          // Mosaïque inclinée des couvertures, fondue en haut et en bas dans la feuille.
          <div
            aria-hidden
            className="absolute inset-x-0 top-[9%] bottom-[24%] overflow-hidden"
            style={{
              maskImage: 'linear-gradient(180deg, transparent, #000 18%, #000 78%, transparent)',
              WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 18%, #000 78%, transparent)',
            }}
          >
            <div className="absolute top-1/2 left-1/2 grid w-[150%] -translate-x-1/2 -translate-y-1/2 -rotate-12 grid-cols-4 gap-[3%] opacity-80">
              {tiles.map((src, index) => (
                <img
                  key={index}
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="aspect-[3/4] w-full rounded-[6%] object-cover"
                  style={{ boxShadow: `0 0 0 1px ${gild}66`, transform: index % 2 === 0 ? 'translateY(14%)' : undefined }}
                />
              ))}
            </div>
            {/* Voile coloré, trame de points et irisation : la mosaïque devient décor. */}
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${style?.ink}cc, transparent 30%, transparent 60%, ${style?.ink}ee)` }} />
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1.4px)', backgroundSize: '6px 6px' }} />
            <div className="absolute inset-0 opacity-25" style={{ background: 'linear-gradient(120deg, transparent 20%, #8fe3ff 40%, #ffb3e6 55%, transparent 75%)' }} />
          </div>
        )}

        {/* Nervures de la feuille. */}
        <div className="absolute inset-0 opacity-20" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 9px)' }} />
        {!detailed && (
          // Irisation fixe, en fondu normal (pas de mode de fusion : recalculé à chaque image dès que le paquet bouge).
          <div className="absolute inset-0 opacity-20" style={{ background: 'linear-gradient(120deg, transparent 20%, #8fe3ff 40%, #ffb3e6 55%, transparent 75%)' }} />
        )}

        {detailed ? (
          <>
            {/* Marque, sous la bande à déchirer. */}
            <div className="absolute inset-x-0 top-[14.5%] flex flex-col items-center" style={{ fontSize: width * 0.05 }}>
              <span className="font-semibold tracking-[0.5em] text-[#fff4c8] uppercase" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
                {BRAND}
              </span>
              <span className="mt-[0.2em] tracking-[0.36em] uppercase opacity-80" style={{ fontSize: '0.62em', color: gild }}>
                {t.boosters.tcg}
              </span>
            </div>

            {/* Carte vedette : la plus rare de la série, sertie d'irisations. */}
            {hero && (
              <div className="absolute top-[26%] left-1/2 w-[50%] -translate-x-1/2 rotate-[4deg]">
                <div className="rounded-[9%] p-[3.5%]" style={{ background: IRIDESCENT, boxShadow: `0 10px 30px -6px rgba(0,0,0,0.8), 0 0 24px ${style?.glow}` }}>
                  <img src={hero} alt="" draggable={false} decoding="async" className="aspect-[3/4] w-full rounded-[7%] object-cover" />
                </div>
                <Sparkles aria-hidden size={Math.round(width * 0.11)} className="absolute -top-[9%] -right-[14%] text-[#fff4c8]" />
                <Star aria-hidden size={Math.round(width * 0.07)} className="absolute bottom-[8%] -left-[14%] fill-[#fff4c8] text-[#fff4c8]" />
              </div>
            )}

            {/* Bandeau du bas : « SÉRIE n », son nom, le contenu, les pierres de rareté. */}
            <div
              className="absolute inset-x-0 bottom-0 flex h-[25%] flex-col items-center justify-center gap-[0.3em] border-t text-center"
              style={{ fontSize: width * 0.06, borderColor: `${gild}88`, background: `linear-gradient(180deg, ${style?.ink}e6, ${style?.ink})` }}
            >
              <span className="font-display leading-none font-bold tracking-[0.06em] uppercase" style={{ fontSize: '1.9em', backgroundImage: style?.title, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                {t.boosters.seriesName(series ?? 1)}
              </span>
              <span className="tracking-[0.3em] uppercase" style={{ fontSize: '0.62em', color: gild }}>
                {t.boosters.seriesTagline[series ?? 1]}
              </span>
              <span className="mt-[0.15em] flex items-center gap-[0.4em]" aria-hidden>
                {RARITIES.map((rarity) => (
                  <span key={rarity} className="rotate-45 rounded-[2px]" style={{ width: '0.45em', height: '0.45em', background: RARITY_STYLE[rarity].color, boxShadow: `0 0 6px ${RARITY_STYLE[rarity].color}` }} />
                ))}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Dorures : filet intérieur. */}
            <div className="absolute inset-[5%] top-[15%] rounded-[10px] border" style={{ borderColor: `${gild}8c` }} />
            {/* Sceau en relief et marque. */}
            <div className="absolute inset-x-0 top-[27%] flex flex-col items-center gap-[0.35em] text-center" style={{ fontSize: width * 0.07 }}>
              <span
                className="grid place-items-center rounded-full border-2"
                style={{
                  width: width * 0.36,
                  height: width * 0.36,
                  borderColor: `${gild}cc`,
                  background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(29,20,64,0.55) 70%)',
                  boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.45), 0 0 18px rgba(255,196,107,0.35)',
                }}
              >
                {series ? (
                  <span className="font-display leading-none font-bold text-[#fff4c8]" style={{ fontSize: width * 0.18 }}>
                    {series}
                  </span>
                ) : (
                  <Sparkles size={Math.round(width * 0.17)} className="text-[#fff4c8]" />
                )}
              </span>
              <span className="mt-[0.4em] font-semibold tracking-[0.42em] text-[#fff4c8] uppercase" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}>
                {BRAND}
              </span>
              <span
                className="rounded-full px-[0.9em] py-[0.25em] font-semibold tracking-[0.28em] uppercase"
                style={{ fontSize: '0.62em', color: '#2a1a02', background: 'linear-gradient(135deg, #fff0b0, #c8901c)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }}
              >
                {series ? t.boosters.seriesName(series) : t.boosters.packLabel}
              </span>
            </div>
          </>
        )}

        {/* Reflet qui balaie la feuille. */}
        <div
          data-pack-shine
          className="absolute inset-y-0 left-0 w-1/2 -skew-x-12"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)', willChange: 'transform' }}
        />
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
          <StripFace gild={gild} />
        </div>
        <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 calc(var(--cut, 0) * 100%))' }}>
          <StripFace gild={gild} />
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
