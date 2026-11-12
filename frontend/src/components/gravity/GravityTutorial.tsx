import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpDown,
  Asterisk,
  BrickWall,
  ChevronsUp,
  CircleDashed,
  Cloud,
  Flame,
  Ghost,
  GraduationCap,
  Hourglass,
  KeyRound,
  Layers,
  Minimize2,
  Moon,
  MoveVertical,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Shield,
  Sword,
  Triangle,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useT } from '../../i18n'
import { writeTutorial, type ChapterId } from '../../lib/gravity/tutorial'
import { TUTORIAL } from '../../lib/gravity/tutorial.data'
import { playChime } from '../../lib/sfx'
import { GravityGame, type GameChapter } from './GravityGame'
import { enterLandscape, leaveLandscape } from './landscape'

/** L'icône de chaque chapitre, sur sa carte. */
const ICONS: Record<ChapterId, LucideIcon> = {
  flip: ArrowUpDown,
  edges: BrickWall,
  spikes: Triangle,
  islands: Layers,
  seal: RefreshCw,
  crumble: Hourglass,
  mover: MoveVertical,
  shuriken: Asterisk,
  moon: Moon,
  mini: Minimize2,
  log: Shield,
  scrolls: ScrollText,
  warp: Zap,
  flames: Flame,
  ghost: Ghost,
  orbit: CircleDashed,
  spring: ChevronsUp,
  cloud: Cloud,
  kekkai: KeyRound,
  kunai: Sword,
}

/**
 * Le tutoriel de Gravity Ninja : un seul parcours, d'une traite. On court, et chaque mécanisme
 * s'annonce à son tour (sa carte en haut de l'écran, un instant de ralenti pour la lire), avec
 * l'invite « Touche ! » au bon moment ; une chute fait reprendre au début du mécanisme en cours. À
 * l'arrivée, le bilan. Relançable à tout moment depuis l'accueil du mode ; rien n'est enregistré sur
 * le serveur. À ouvrir dans le geste du joueur, après `enterLandscape()`.
 */
export function GravityTutorial({ onClose, onPlayLevels }: { onClose: () => void; onPlayLevels: () => void }) {
  const t = useT()
  const tt = t.gravity.tutorial
  const [run, setRun] = useState(1)
  const [finished, setFinished] = useState(false)
  const level = useMemo(() => ({ ...TUTORIAL.level, name: tt.title }), [tt])
  const chapters = useMemo<GameChapter[]>(() => TUTORIAL.chapters.map((chapter) => ({ ...chapter, ...tt.chapters[chapter.id], icon: ICONS[chapter.id] })), [tt])

  if (!finished) {
    return (
      <GravityGame
        key={run}
        level={level}
        coach={TUTORIAL.cues}
        chapters={chapters}
        onFinish={() => {
          writeTutorial({ offered: true, done: true })
          leaveLandscape()
          playChime()
          setFinished(true)
        }}
        onQuit={onClose}
        onRestart={() => setRun((value) => value + 1)}
      />
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tt.completeTitle} className="fixed inset-0 z-[96] grid place-items-center overflow-y-auto bg-[#0d0818] px-6 py-10 text-center text-cream">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <span className="grid size-20 place-items-center rounded-full bg-[#ffb84d] text-void shadow-[0_0_50px_-8px_#ffb84d]">
          <GraduationCap size={40} aria-hidden />
        </span>
        <h2 className="font-display text-3xl leading-none">{tt.completeTitle}</h2>
        <p className="text-sm leading-relaxed text-cream/70">{tt.completeText}</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <button type="button" onClick={onPlayLevels} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ffb84d] text-sm font-bold text-void">
            <Play size={16} className="fill-void" aria-hidden />
            {tt.play}
          </button>
          <button
            type="button"
            onClick={() => {
              enterLandscape()
              setFinished(false)
              setRun((value) => value + 1)
            }}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold"
          >
            <RotateCcw size={16} aria-hidden />
            {tt.replay}
          </button>
          <button type="button" onClick={onClose} className="h-11 rounded-full text-sm font-semibold text-cream/70">
            {tt.back}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
