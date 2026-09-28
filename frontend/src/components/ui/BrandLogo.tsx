import { useId } from 'react'
import { BRAND } from '../../lib/brand'

type BrandLogoSize = 'sm' | 'md' | 'lg'
type BrandLogoVariant = 'mark' | 'full'

interface BrandLogoProps {
  size?: BrandLogoSize
  variant?: BrandLogoVariant
  className?: string
  markClassName?: string
  textClassName?: string
}

const SIZE = {
  sm: { mark: 'size-7', text: 'text-xl' },
  md: { mark: 'size-10', text: 'text-[1.65rem]' },
  lg: { mark: 'size-16', text: 'text-[2.75rem]' },
} as const

/** Marque Bookshelf officielle, contrastée pour les surfaces sombres de l'app. */
export function BrandLogo({
  size = 'md',
  variant = 'full',
  className = '',
  markClassName = '',
  textClassName = '',
}: BrandLogoProps) {
  const titleId = useId()
  const dimensions = SIZE[size]
  const markOnly = variant === 'mark'

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2.5 text-cream ${className}`}
      aria-label={markOnly ? BRAND : undefined}
    >
      <svg
        viewBox="0 0 1095 1095"
        className={`${dimensions.mark} shrink-0 ${markClassName}`}
        role={markOnly ? 'img' : undefined}
        aria-hidden={markOnly ? undefined : true}
        aria-labelledby={markOnly ? titleId : undefined}
      >
        {markOnly && <title id={titleId}>{BRAND}</title>}
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M646.681 579.5C651.561 580.33 656.551 579.95 661.501 580.26C669.501 580.76 677.591 581.71 685.501 582.98C710.551 587 735.861 596.44 757.081 610.43C818.711 651.03 851.031 722.53 831.661 795.27C827.731 810.01 821.001 824.46 812.931 837.38C803.671 852.24 792.221 866.01 778.891 877.4C748.101 903.72 709.501 919.51 669.461 924.72C646.361 927.72 622.731 926.5 599.501 926.52C585.171 926.54 570.831 926.52 556.501 926.49C549.561 926.48 541.371 927.67 534.621 925.79C522.171 922.3 523.481 908.63 523.431 898.5C523.281 872.17 523.221 845.83 523.421 819.5C523.951 747.84 523.271 676.16 523.361 604.5C523.391 580.17 523.471 555.83 523.421 531.5C523.391 516.94 524.541 501.93 521.731 487.57C514.111 448.51 486.971 429.57 455.171 410.36C423.351 391.13 392.501 370.23 360.961 350.54C352.551 345.3 344.281 339.82 335.841 334.64C329.881 330.98 322.731 327.69 317.651 322.86C309.831 315.42 311.501 304.35 311.491 294.5C311.461 270.67 309.731 251.96 328.851 234.37C351.051 213.94 374.151 221.63 399.581 228.83C426.491 236.44 453.601 243.69 480.681 250.69C522.841 261.59 564.711 273.58 606.851 284.57C646.611 294.94 678.341 301.15 710.521 328.98C724.351 340.95 735.631 354.91 744.711 370.77C751.551 382.72 756.311 395.83 759.391 409.22C761.821 419.82 762.351 430.66 762.221 441.5C761.581 495.36 725.711 543.37 678.931 567.44C668.641 572.73 657.761 576.31 646.681 579.5Z"
        />
        <path
          fill="#7C46FC"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M242.671 326.41C255.811 325.37 265.121 333.5 275.671 339.84C298.431 353.53 320.501 368.39 343.021 382.47C374.341 402.03 405.771 421.64 436.631 441.93C452.031 452.05 468.541 459.75 478.421 476.09C486.171 488.89 486.061 502.99 486.031 517.5C485.991 530.83 486.051 544.17 486.001 557.5C485.781 617.5 486.031 677.5 486.031 737.5C486.031 785.5 486.121 833.5 486.001 881.5C485.951 900.2 490.261 923.71 468.501 932.03C454.901 937.22 443.381 928.9 432.151 922.37C407.671 908.16 383.181 893.9 358.541 879.97C330.721 864.25 303.371 847.69 275.561 831.95C257.461 821.71 236.801 812.48 224.841 794.68C212.171 775.83 212.961 760.29 212.951 738.5C212.951 726.17 212.931 713.83 212.961 701.5C213.111 635.17 212.891 568.83 212.931 502.5C212.961 458.17 212.901 413.83 212.931 369.5C212.941 364.34 212.441 358.87 213.411 353.78C216.091 339.62 228.001 327.58 242.671 326.41Z"
        />
      </svg>
      {!markOnly && (
        <span className={`font-display leading-none whitespace-nowrap ${dimensions.text} ${textClassName}`}>
          {BRAND}
        </span>
      )}
    </span>
  )
}
