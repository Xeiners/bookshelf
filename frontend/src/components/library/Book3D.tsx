import type { CSSProperties, Ref } from 'react'
import type { Book } from '../../types/book'
import { BookCover } from '../ui/BookCover'

interface Book3DProps {
  book: Book
  /** Largeur de la couverture en px ; hauteur = 1,5 × largeur. */
  width: number
  /** Teinte dominante de la couverture (tranche, reflets). */
  tone: string
  /** Signet doré qui dépasse du haut : lecture en cours. */
  bookmark?: boolean
  /** Reflet balayé par GSAP (`[data-glint]`), réservé au livre mis en avant. */
  glint?: boolean
  eager?: boolean
  ref?: Ref<HTMLDivElement>
  className?: string
  style?: CSSProperties
}

/**
 * Un livre en volume, en CSS 3D : six faces d'un pavé dont la face avant est
 * la vraie couverture. La tranche (à gauche) prend la teinte de la couverture,
 * le bloc de pages (à droite) est strié comme du papier.
 *
 * Le parent fournit la `perspective` ; ce composant ne fait que construire
 * l'objet. Son orientation (`rotationY`, `y`…) appartient aux animations GSAP
 * de l'appelant, qui visent l'élément racine (`ref`).
 */
export function Book3D({ book, width, tone, bookmark, glint, eager, ref, className = '', style }: Book3DProps) {
  const height = Math.round(width * 1.5)
  // Épaisseur plausible : ~13 % de la largeur, bornée pour les très petits formats.
  const depth = Math.max(8, Math.round(width * 0.13))
  const half = depth / 2

  const face = 'absolute [backface-visibility:hidden]'

  return (
    <div
      ref={ref}
      className={`relative [transform-style:preserve-3d] will-change-transform ${className}`}
      style={{ width, height, ...style }}
    >
      {/* Face avant : la couverture, avec un vernis et un pli de reliure */}
      <div
        className={`${face} inset-0 overflow-visible rounded-r-[5px] rounded-l-[2px]`}
        style={{ transform: `translateZ(${half}px)` }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-r-[5px] rounded-l-[2px] bg-carbon">
          <BookCover book={book} eager={eager} className="h-full w-full" />
          {/* Pli de la reliure, près du dos */}
          <span className="absolute inset-y-0 left-[5%] w-[3px] bg-linear-to-r from-black/35 via-white/15 to-transparent" />
          {/* Vernis : lumière rasante venue du haut à gauche */}
          <span className="absolute inset-0 bg-linear-to-br from-white/18 via-transparent to-black/35" />
          {glint && (
            <span
              data-glint
              aria-hidden
              className="absolute inset-y-0 -left-full w-2/3 -skew-x-12 bg-linear-to-r from-transparent via-white/35 to-transparent"
            />
          )}
          <span className="absolute inset-0 rounded-r-[5px] rounded-l-[2px] ring-1 ring-white/12 ring-inset" />
        </div>

        {bookmark && (
          <span
            aria-hidden
            className="absolute -top-2 right-[18%] w-[9%] min-w-2 bg-linear-to-b from-gold via-gold to-[#d9913a] shadow-[0_4px_8px_-2px_rgb(0_0_0/0.6)]"
            style={{
              height: Math.round(height * 0.2),
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)',
            }}
          />
        )}
      </div>

      {/* Dos du livre (face arrière) */}
      <div
        className={`${face} inset-0 rounded-l-[5px]`}
        style={{
          transform: `rotateY(180deg) translateZ(${half}px)`,
          background: `linear-gradient(135deg, color-mix(in oklab, ${tone} 38%, #0b0b12), #0b0b12)`,
        }}
      />

      {/* Tranche, à gauche : toile teintée, nerfs dorés */}
      <div
        className={`${face} top-0`}
        style={{
          width: depth,
          height,
          left: (width - depth) / 2,
          transform: `rotateY(-90deg) translateZ(${width / 2}px)`,
          background: `linear-gradient(90deg,
            color-mix(in oklab, ${tone} 45%, #06060a) 0%,
            color-mix(in oklab, ${tone} 70%, #06060a) 45%,
            color-mix(in oklab, ${tone} 40%, #06060a) 100%)`,
        }}
      >
        <span className="absolute inset-x-0 top-[9%] h-px bg-cream/35" />
        <span className="absolute inset-x-0 top-[11%] h-px bg-cream/20" />
        <span className="absolute inset-x-0 bottom-[11%] h-px bg-cream/20" />
        <span className="absolute inset-x-0 bottom-[9%] h-px bg-cream/35" />
      </div>

      {/* Bloc de pages, à droite */}
      <div
        className={`${face} top-[3px]`}
        style={{
          width: depth,
          height: height - 6,
          left: (width - depth) / 2,
          transform: `rotateY(90deg) translateZ(${width / 2 - 3}px)`,
          background:
            'repeating-linear-gradient(90deg, #efe9dc 0px, #efe9dc 1px, #d8d0bf 1.5px, #efe9dc 2px), linear-gradient(90deg, rgb(0 0 0 / 0.25), transparent)',
        }}
      />

      {/* Tranche supérieure des pages */}
      <div
        className={`${face} left-[3px]`}
        style={{
          width: width - 6,
          height: depth,
          top: (height - depth) / 2,
          transform: `rotateX(90deg) translateZ(${height / 2 - 2}px)`,
          background: 'repeating-linear-gradient(0deg, #efe9dc 0px, #efe9dc 1px, #d6ceb9 1.5px, #efe9dc 2px)',
        }}
      />
    </div>
  )
}
