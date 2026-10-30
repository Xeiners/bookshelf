import type { ReactNode } from 'react'
import { ArrowLeftRight, BookOpen, Gift, Play, Sparkles, Zap } from 'lucide-react'
import moonUrl from '../../assets/moon-soul-eater.svg'
import type { NewsId } from '../../lib/news'
import { BoosterPackArt } from '../boosters/BoosterPackArt'
import { CardBack } from '../cards/CardBack'
import { STARDUST_GRADIENT } from '../dle/dleStyle'
import { StackEmblem } from '../stack/StackEmblem'

/*
 * L'illustration d'une actu : une petite scène dessinée (CSS, SVG, éléments de l'app), sans image
 * à télécharger. Chaque scène remplit son cadre (le parent fixe la taille et l'arrondi) ; les
 * mouvements se coupent quand l'appareil demande moins d'animations.
 */

export function NewsVisual({ id }: { id: NewsId }) {
  switch (id) {
    case 'legendaryShop':
      return <LegendaryShopScene />
    case 'halloween':
      return <HalloweenScene />
    case 'reveal':
      return <RevealScene />
    case 'smoother':
      return <SmootherScene />
    case 'series3':
      return <Series3Scene />
    case 'edits':
      return <EditsScene />
    case 'activities':
      return <ActivitiesScene />
    case 'stack':
      return (
        <Stage background="radial-gradient(90% 80% at 50% 100%, #ff9a5c55, transparent 70%), linear-gradient(160deg, #2a1240, #120a24)">
          <span className="block size-[46%] max-w-40 overflow-hidden rounded-[22%] shadow-[0_0_60px_-10px_#ff9a5c] motion-safe:animate-[news-float_4s_ease-in-out_infinite]">
            <StackEmblem />
          </span>
        </Stage>
      )
    case 'daily':
      return <DailyScene />
    case 'dust':
      return (
        <Stage background="radial-gradient(80% 70% at 70% 50%, #ff5ec455, transparent 70%), linear-gradient(160deg, #1d0f33, #0c0716)">
          <div className="flex items-center gap-[6%]">
            <span className="-rotate-6">
              <CardBack width={84} animated={false} />
            </span>
            <span className="text-3xl text-cream/60">→</span>
            <span className="grid size-24 place-items-center rounded-full motion-safe:animate-[news-float_3s_ease-in-out_infinite]" style={{ background: STARDUST_GRADIENT, boxShadow: '0 0 50px -6px #ff5ec4' }}>
              <Sparkles size={44} className="text-white" aria-hidden />
            </span>
          </div>
        </Stage>
      )
    case 'market':
      return (
        <Stage background="radial-gradient(80% 70% at 50% 50%, #3fe0a044, transparent 70%), linear-gradient(160deg, #0d2420, #08120f)">
          <div className="relative flex items-center gap-[10%]">
            <span className="-rotate-12">
              <CardBack width={80} animated={false} />
            </span>
            <span className="absolute left-1/2 grid size-12 -translate-x-1/2 place-items-center rounded-full bg-[#3fe0a0] text-[#06231a] shadow-[0_0_30px_#3fe0a0]">
              <ArrowLeftRight size={22} aria-hidden />
            </span>
            <span className="rotate-12">
              <CardBack width={80} animated={false} />
            </span>
          </div>
        </Stage>
      )
    case 'library':
      return <LibraryScene />
    case 'canvas':
      return <CanvasScene />
  }
}

function Stage({ background, children }: { background: string; children: ReactNode }) {
  return (
    <div aria-hidden className="relative grid h-full w-full place-items-center overflow-hidden" style={{ background }}>
      {children}
    </div>
  )
}

/* ---- Booster Légendaire : le paquet doré et son prix -------------------------------------------- */

function LegendaryShopScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 45%, #ffc46b55, transparent 70%), linear-gradient(160deg, #2a1806, #0d0805)">
      <div className="flex flex-col items-center gap-3">
        <span className="motion-safe:animate-[news-float_3.5s_ease-in-out_infinite]">
          <BoosterPackArt width={96} series={3} lit halo="LEGENDARY" />
        </span>
        <span className="rounded-full px-4 py-1.5 text-sm font-black text-[#2a1404] tabular-nums" style={{ background: 'linear-gradient(135deg, #fff0a8, #ffc23a 55%, #ff9a3d)' }}>
          4 200 ✦
        </span>
      </div>
    </Stage>
  )
}

/* ---- Halloween : la lune qui ricane, un cadeau ---------------------------------------------------- */

function HalloweenScene() {
  return (
    <Stage background="radial-gradient(60% 60% at 70% 35%, #ff7a1a40, transparent 70%), linear-gradient(160deg, #1a0b26, #07040c)">
      <div className="relative flex items-center gap-[8%]">
        <img src={moonUrl} alt="" draggable={false} className="w-[min(40vw,170px)] motion-safe:animate-[news-float_4s_ease-in-out_infinite]" />
        <span className="grid size-16 place-items-center rounded-2xl text-[#1c0a2b]" style={{ background: 'linear-gradient(150deg, #ffd27a, #ff7a1a 60%, #c2410c)', boxShadow: '0 0 40px -6px #ff7a1a' }}>
          <Gift size={30} />
        </span>
      </div>
    </Stage>
  )
}

/* ---- Nouvelle ouverture : un paquet Mythique dans ses rayons ---------------------------------------- */

function RevealScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 50%, #ff5ec455, transparent 70%), linear-gradient(160deg, #1d0f33, #0a0716)">
      <span
        className="absolute size-[150%] rounded-full motion-safe:animate-[spin_24s_linear_infinite]"
        style={{ background: 'repeating-conic-gradient(from 0deg, rgba(255,94,196,0.18) 0deg 7deg, transparent 7deg 20deg)', maskImage: 'radial-gradient(circle, black 20%, transparent 60%)' }}
      />
      <span className="relative motion-safe:animate-[news-float_3.5s_ease-in-out_infinite]">
        <BoosterPackArt width={100} series={3} lit halo="MYTHIC" />
      </span>
    </Stage>
  )
}

/* ---- Plus fluide : la vitrine des Activités, un éclair ----------------------------------------------- */

const TILES = ['#ffc46b', '#7c5cff', '#3fe0a0', '#ff5ec4']

function SmootherScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 40%, #7c5cff33, transparent 70%), linear-gradient(160deg, #13131b, #08080c)">
      <div className="relative grid w-[64%] max-w-60 grid-cols-2 gap-2">
        {TILES.map((tint) => (
          <span key={tint} className="relative h-16 overflow-hidden rounded-2xl border border-white/10" style={{ background: `radial-gradient(80% 90% at 50% 30%, ${tint}40, transparent 75%), #101017` }}>
            <span className="absolute inset-x-4 top-0 h-px" style={{ background: tint }} />
          </span>
        ))}
        <span className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-cream text-void shadow-[0_0_40px_-4px_#f7f5f0]">
          <Zap size={26} className="fill-current" />
        </span>
      </div>
    </Stage>
  )
}

/* ---- Edits : un téléphone dont le fil défile tout seul ------------------------------------------ */

const CLIPS = [
  { from: '#ff5ec4', to: '#7c5cff', caption: 'Gojo · edit 4K' }, // i18n-ignore
  { from: '#2bc3ff', to: '#1b2a6b', caption: 'Itachi · AMV' }, // i18n-ignore
  { from: '#ffb347', to: '#d6264b', caption: 'Luffy Gear 5 · edit' }, // i18n-ignore
]

function EditsScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 40%, #ff5ec440, transparent 70%), radial-gradient(60% 60% at 90% 90%, #2bc3ff33, transparent 70%), linear-gradient(160deg, #1a0b2e, #0b0716)">
      {/* Étiquettes qui flottent autour du téléphone. */}
      {['#edit', 'AMV', '4K', 'MMV'].map((label, index) => (
        <span
          key={label}
          className="absolute rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90 motion-safe:animate-[news-float_3.5s_ease-in-out_infinite]"
          style={{ ...TAG_SPOTS[index], animationDelay: `${index * 0.6}s` }}
        >
          {label}
        </span>
      ))}
      <div className="relative h-[86%] overflow-hidden rounded-[1.4rem] border-[5px] border-[#0b0b10] bg-black shadow-[0_20px_60px_-10px_rgba(0,0,0,0.9),0_0_40px_-8px_#ff5ec4]" style={{ aspectRatio: '9 / 17' }}>
        <div className="absolute inset-0 motion-safe:animate-[news-reel_9s_cubic-bezier(0.7,0,0.3,1)_infinite]">
          {[...CLIPS, CLIPS[0]!].map((clip, index) => (
            <div
              key={index}
              className="relative flex h-full w-full flex-col justify-end p-2"
              style={{ background: `radial-gradient(70% 50% at 50% 35%, ${clip.from}, transparent 70%), linear-gradient(180deg, ${clip.to}, #050507)` }}
            >
              <span className="absolute top-[38%] left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/35">
                <Play size={16} className="ml-0.5 fill-white text-white" />
              </span>
              <span className="truncate text-[9px] font-semibold text-white">{clip.caption}</span>
              <span className="mt-1 block h-[2px] w-full rounded-full bg-white/25">
                <span className="block h-full w-2/5 rounded-full bg-white" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  )
}

const TAG_SPOTS = [
  { top: '14%', left: '10%' },
  { top: '24%', right: '9%' },
  { bottom: '22%', left: '13%' },
  { bottom: '12%', right: '12%' },
]

/* ---- Série 3 : les anciennes cartes s'évaporent, le paquet des Personnages s'avance ---------------- */

function Series3Scene() {
  return (
    <Stage background="radial-gradient(70% 60% at 60% 45%, #ff5ec455, transparent 70%), radial-gradient(50% 50% at 15% 80%, #ffc46b33, transparent 70%), linear-gradient(160deg, #1d0f33, #0a0716)">
      <div className="relative flex items-center gap-[8%]">
        <div className="relative h-28 w-24">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="absolute inset-0 motion-safe:animate-[news-float_3s_ease-in-out_infinite]"
              style={{ transform: `rotate(${(index - 1) * 12}deg) translateY(${index * 4}px)`, opacity: 0.35 + index * 0.15, filter: 'grayscale(0.6)', animationDelay: `${index * 0.4}s` }}
            >
              <CardBack width={80} animated={false} />
            </span>
          ))}
          <Sparkles size={28} className="absolute -top-3 -right-3 text-[#ffc46b]" />
        </div>
        <span className="text-3xl text-cream/60">→</span>
        <span className="motion-safe:animate-[news-float_3.5s_ease-in-out_infinite]">
          <BoosterPackArt width={92} series={3} lit halo="MYTHIC" />
        </span>
      </div>
    </Stage>
  )
}

/* ---- Activités : le paquet en vedette au-dessus des trois rubriques ------------------------------ */

function ActivitiesScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 30%, #ffc46b40, transparent 70%), linear-gradient(160deg, #22142e, #0b0816)">
      <div className="flex w-[78%] max-w-72 flex-col items-center gap-3">
        <div className="flex items-end gap-1 motion-safe:animate-[news-float_3.5s_ease-in-out_infinite]">
          <span className="-rotate-12 opacity-80">
            <BoosterPackArt width={48} series={1} lit />
          </span>
          <BoosterPackArt width={62} series={3} lit halo="LEGENDARY" />
          <span className="rotate-12 opacity-80">
            <BoosterPackArt width={48} series={2} lit />
          </span>
        </div>
        <span className="h-8 w-full rounded-full text-center text-xs leading-8 font-bold text-[#2a1a02]" style={{ background: 'linear-gradient(180deg, #ffdf8a, #f2b83a)' }}>
          ⚡
        </span>
        <div className="grid w-full grid-cols-3 gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          <span className="h-5 rounded-full bg-cream" />
          <span className="h-5 rounded-full" />
          <span className="h-5 rounded-full" />
        </div>
      </div>
    </Stage>
  )
}

/* ---- Récompense du jour : le calendrier, le 30ᵉ en or ---------------------------------------------- */

function DailyScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 50%, #ffc23a33, transparent 70%), linear-gradient(160deg, #24140a, #0d0805)">
      <div className="grid w-[70%] max-w-64 grid-cols-6 gap-1.5">
        {Array.from({ length: 30 }, (_, index) => {
          const day = index + 1
          const done = day <= 7
          if (day === 30)
            return (
              <span key={day} className="col-span-1 grid aspect-square place-items-center rounded-md shadow-[0_0_20px_#ffc23a]" style={{ background: 'linear-gradient(150deg, #fff6c8, #ffc23a 55%, #ff8a3d)' }}>
                <Gift size={14} className="text-[#3a2200]" />
              </span>
            )
          return <span key={day} className={`aspect-square rounded-md ${done ? 'bg-[#ffc46b]' : day === 8 ? 'animate-pulse bg-[#ffc46b]/60' : 'bg-white/10'}`} />
        })}
      </div>
    </Stage>
  )
}

/* ---- Bibliothèque : une étagère de tomes ------------------------------------------------------------ */

const SPINES = ['#7c5cff', '#ff5ec4', '#3fe0a0', '#ffc46b', '#2bc3ff', '#ff6b6b', '#c58bff']

function LibraryScene() {
  return (
    <Stage background="radial-gradient(70% 60% at 50% 40%, #7c5cff40, transparent 70%), linear-gradient(160deg, #15122a, #09080f)">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-end gap-1">
          {SPINES.map((color, index) => (
            <span key={color} className="w-5 rounded-t-sm" style={{ height: 70 + ((index * 23) % 40), background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
          ))}
          <span className="ml-2 grid size-14 place-items-center rounded-2xl bg-white/10 text-cream">
            <BookOpen size={26} />
          </span>
        </div>
        <span className="h-1.5 w-64 max-w-full rounded-full bg-white/20" />
      </div>
    </Stage>
  )
}

/* ---- La Toile : un trait qui se dessine, des curseurs ------------------------------------------------ */

function CanvasScene() {
  return (
    <Stage background="linear-gradient(160deg, #1b1450, #0c2a52)">
      <svg viewBox="0 0 200 120" className="h-full w-full">
        <defs>
          <pattern id="news-dots" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="#9db4ff" fillOpacity="0.35" />
          </pattern>
        </defs>
        <rect width="200" height="120" fill="url(#news-dots)" />
        <path d="M20 85 C 50 30, 80 110, 110 60 S 160 30, 185 50" fill="none" stroke="#ffc46b" strokeWidth="5" strokeLinecap="round" strokeDasharray="260" className="motion-safe:animate-[news-draw_4s_ease-in-out_infinite]" />
        <rect x="120" y="78" width="40" height="24" rx="4" fill="#ff5cb4" fillOpacity="0.85" />
        <circle cx="55" cy="35" r="12" fill="none" stroke="#2bc3ff" strokeWidth="3" />
        <path d="M150 20 L150 40 L156 35 L160 44 L164 42 L160 33 L168 33 Z" fill="#2fd1a0" stroke="#fff" strokeWidth="1.2" />
        <path d="M80 70 L80 90 L86 85 L90 94 L94 92 L90 83 L98 83 Z" fill="#9a6bff" stroke="#fff" strokeWidth="1.2" />
      </svg>
    </Stage>
  )
}
