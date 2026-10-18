import { Sparkle } from 'lucide-react'
import type { DailyBundle } from '../../services/dailyApi'

/*
 * Pictogrammes des récompenses quotidiennes : légers (CSS seulement), car trente cases les
 * affichent d'un coup. Même langage que le reste de l'app : Poussières dorées, paquet de
 * cartes, boîte mystère violette cerclée d'or.
 */

export function DustGlyph({ size }: { size: number }) {
  return <Sparkle size={size} strokeWidth={2.2} className="fill-[#ffd36a] text-[#ffb300] drop-shadow-[0_0_6px_rgba(255,196,107,0.8)]" aria-hidden />
}

export function BoosterGlyph({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-grid -rotate-6 place-items-center rounded-[22%] text-[#3a2200]"
      style={{ width: size * 0.78, height: size, background: 'linear-gradient(160deg, #ffe29a, #ff9b3d 60%, #ff5ec4)', boxShadow: '0 0 12px -2px rgba(255,160,70,0.7), inset 0 0 0 1.5px rgba(255,255,255,0.45)' }}
    >
      <Sparkle size={size * 0.42} strokeWidth={2.4} className="fill-white/80 text-white" />
    </span>
  )
}

export function BoxGlyph({ size }: { size: number }) {
  return (
    <span aria-hidden className="relative inline-grid rotate-6 place-items-center" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-[24%]" style={{ background: 'linear-gradient(160deg, #5a24a8, #2a1150)', boxShadow: '0 0 12px -2px #b05cff, inset 0 0 0 1.5px #ffc93c' }} />
      <span className="absolute inset-y-0 left-1/2 w-[16%] -translate-x-1/2 bg-[#ffc93c]" />
      <span className="absolute inset-x-0 top-[38%] h-[16%] bg-[#ffc93c]" />
      <span className="relative font-display text-[#ffe9a8]" style={{ fontSize: size * 0.5 }}>?</span>
    </span>
  )
}

/** Le pack du 30e jour : trois cartes en éventail, la Légendaire au centre. */
export function PackGlyph({ size }: { size: number }) {
  const card = { width: size * 0.62, height: size, borderRadius: size * 0.1 }
  return (
    <span aria-hidden className="relative inline-block" style={{ width: size * 1.1, height: size }}>
      <span className="absolute left-0 bottom-0 -rotate-12 origin-bottom-right" style={{ ...card, background: 'linear-gradient(160deg, #4cc9f0, #6a5cff)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' }} />
      <span className="absolute right-0 bottom-0 rotate-12 origin-bottom-left" style={{ ...card, background: 'linear-gradient(160deg, #ff5ec4, #b46cff)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' }} />
      <span
        className="absolute left-1/2 bottom-0 grid -translate-x-1/2 place-items-center"
        style={{ ...card, background: 'linear-gradient(160deg, #fff4c8, #ffc23a 45%, #ff8a3d)', boxShadow: '0 0 18px -1px #ffc23a, inset 0 0 0 1.5px #fff' }}
      >
        <Sparkle size={size * 0.4} strokeWidth={2.4} className="fill-[#7a4300] text-[#7a4300]" />
      </span>
    </span>
  )
}

/** Tout ce qu'une case contient, avec les quantités quand `labels` ; `compact` : plusieurs récompenses dans une petite case. */
export function BundleGlyphs({ reward, size, labels = false, compact = false }: { reward: DailyBundle; size: number; labels?: boolean; compact?: boolean }) {
  const items: { key: string; glyph: React.ReactNode; label: string }[] = []
  if (reward.pack) items.push({ key: 'pack', glyph: <PackGlyph size={size} />, label: '' })
  if (reward.boosters > 0) items.push({ key: 'boosters', glyph: <BoosterGlyph size={size} />, label: `×${reward.boosters}` })
  if (reward.boxes > 0) items.push({ key: 'boxes', glyph: <BoxGlyph size={size} />, label: `×${reward.boxes}` })
  if (reward.stardust > 0) items.push({ key: 'stardust', glyph: <DustGlyph size={size} />, label: `+${reward.stardust}` })
  return (
    <span className={`inline-flex items-center justify-center ${compact ? 'gap-0.5' : 'gap-[0.35em]'}`}>
      {items.map((item) => (
        <span key={item.key} className="inline-flex flex-col items-center gap-0.5">
          {item.glyph}
          {labels && item.label && <span className={`${compact ? 'text-[8px]' : 'text-[9px]'} leading-none font-bold text-cream/90 tabular-nums`}>{item.label}</span>}
        </span>
      ))}
    </span>
  )
}
