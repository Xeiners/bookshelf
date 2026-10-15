import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cloud, Crosshair, Loader2, Flame, Magnet, Mountain, Pause, Play, Sparkles, X } from 'lucide-react'
import { useT } from '../../i18n'
import { vibrate } from '../../lib/haptics'
import { CLOUD_TIME, MAGNET_TIME, QUIZ_TIME, REALM_TIME, SHIELD_TIME, SHOT_COOLDOWN, comboTime, multiplierFor, reviveCost } from '../../lib/runner/constants'
import { act, createRun, goToLane, revive, scoreOf, shoot, shotReady, type ActiveQuiz, type Lane, type Realm, type RunAction, type RunState } from '../../lib/runner/engine'
import { makeQuiz, type QuizUniverse } from '../../lib/runner/quiz'
import { seededRandom } from '../../lib/runner/random'
import { playBossCast, playBossCounter, playBossDeath, playBossHit, playBossRoar, playBossVictory, playComboMiss, playComboStep, playChime, playRunnerClear, playRunnerHit, playRunnerJump, playRunnerAwaken, playRunnerLaunch, playRunnerPower, playRunnerShot, playRunnerSlide, playRunnerSmash, playRunnerStar, playRunnerStumble, playRunnerTunnel, playRunnerWrong } from '../../lib/sfx'
import type { RunnerAssets } from './assets'
import type { HeroLookId } from './looks'
import { IntroClock } from './intro'
import { QuizDeck } from './quizDeck'
import { useRunnerWardrobe } from '../../store/useRunnerWardrobeStore'
import { RunnerScene } from './RunnerScene'
import { ShotAim } from './shots'
import { BossHud, BossVictory, type BossView } from './BossHud'

export interface RunnerOutcome {
  distance: number
  stardust: number
  quiz: number
  score: number
}

interface RunnerGameProps {
  /** Graine de la piste (donnée par le serveur). */
  seed: number
  look: HeroLookId
  assets: RunnerAssets
  buttons: boolean
  lite: boolean
  universes: readonly QuizUniverse[]
  onOver: (outcome: RunnerOutcome) => void
  /** Résurrection possible (course enregistrée sur un compte) : le solde, et le paiement. `null` : jamais. */
  revival: { balance: number; pay: () => Promise<boolean> } | null
  /** Abandon (depuis la pause) : la distance parcourue compte comme une fin de course. */
  onQuit: (outcome: RunnerOutcome) => void
}

const KEYS: Record<string, RunAction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  q: 'left',
  a: 'left',
  d: 'right',
  z: 'up',
  w: 'up',
  ' ': 'up',
  s: 'down',
}
/** Touches de tir (sur le monstre le plus proche). */
const SHOOT_KEYS = new Set(['e', 'f', 'Enter'])

/** Durée de la cinématique de départ (s), et du raccord vers la caméra de jeu quand on la passe. */
const INTRO_TIME = 3.4
const INTRO_SKIP = 0.5

/** Temps pour décider de revivre (s). */
const REVIVE_SECONDS = 6

/** Distance d'un glissement de doigt qui compte comme un geste (px). */
const SWIPE = 26
/** Un toucher bref, sans glisser : un tir sur le monstre sous le doigt. */
const TAP_MOVE = 14
const TAP_TIME = 380
/** Minuteurs en haut de l'écran (nuage, Éveil, royaume) : l'alerte de fin, ces dernières secondes. */
type TimerName = 'cloud' | 'shield' | 'realm'
const TIMER_WARNING: Record<TimerName, number> = { cloud: 1.5, shield: 1.5, realm: 3 }
/** Annonce d'un tremplin ou d'un tunnel, à cette distance (m). */
const PORTAL_NOTICE = 90

/**
 * Une course : la scène 3D en plein écran et, par-dessus, le HUD. Les compteurs qui
 * changent à chaque image (distance, score, ✦, jauges) sont écrits directement dans le
 * DOM ; React ne se redessine que pour ce qui change rarement (vies, quiz, pause).
 */
export function RunnerGame({ seed, look, assets, buttons, lite, universes, onOver, revival, onQuit }: RunnerGameProps) {
  const t = useT()
  const outfit = useRunnerWardrobe((state) => state.outfit)
  const [initial] = useState(() => createRun(seed))
  const state = useRef<RunState>(initial)
  const paused = useRef(true)
  const [pausedView, setPausedView] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  /** Cinématique de départ : horloge partagée avec la caméra ; `introRunning` tant qu'elle dure. */
  const [introRunning, setIntroRunning] = useState(true)
  /** La cinématique a vraiment commencé (premières images affichées) : la carte de titre peut entrer. */
  const [introShown, setIntroShown] = useState(false)
  const introTimer = useRef(0)
  const finishIntroIn = useCallback((milliseconds: number) => {
    window.clearTimeout(introTimer.current)
    introTimer.current = window.setTimeout(() => {
      setIntroRunning(false)
      setCountdown(3)
    }, milliseconds)
  }, [])
  const [intro] = useState(() => new IntroClock(INTRO_TIME))
  /** Choc fatal : l'offre de résurrection (prix, secondes restantes), ou `null`. */
  const [offer, setOffer] = useState<{ cost: number; paying: boolean } | null>(null)
  const [offerLeft, setOfferLeft] = useState(0)
  const [quiz, setQuiz] = useState<ActiveQuiz | null>(null)
  const [verdict, setVerdict] = useState<'wrong' | null>(null)
  const [hitFlash, setHitFlash] = useState(0)
  const [awaken, setAwaken] = useState(0)
  const [cleared, setCleared] = useState(0)
  const awakeLinesRef = useRef<HTMLDivElement>(null)
  const [aim] = useState(() => new ShotAim())
  /** Minuteur du nuage (secondes restantes, alerte de descente) et bouton de tir (recharge). */
  const timers = useRef<Partial<Record<TimerName, HTMLDivElement | null>>>({})
  const registerTimer = useCallback((name: TimerName, node: HTMLDivElement | null) => {
    timers.current[name] = node
  }, [])
  const portalRef = useRef<HTMLDivElement>(null)
  /** Transition de monde (tremplin, tunnel, retour) et carte de titre du royaume. */
  const [passage, setPassage] = useState<{ kind: 'launch' | 'tunnel' | 'exit'; key: number } | null>(null)
  const [arrival, setArrival] = useState<{ realm: Exclude<Realm, 'earth'>; key: number } | null>(null)
  /** Combat de boss : ce que montre le HUD (relu à chaque changement), le minuteur du combo, la victoire. */
  const [bossView, setBossView] = useState<BossView | null>(null)
  const [victory, setVictory] = useState<{ index: number; key: number } | null>(null)
  const bossKey = useRef('')
  const bossMisses = useRef(0)
  const comboTimerRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLButtonElement>(null)
  const shotRingRef = useRef<SVGCircleElement>(null)
  const quizCardsRef = useRef<HTMLDivElement>(null)
  const quizSecondsRef = useRef<HTMLSpanElement>(null)

  const distanceRef = useRef<HTMLSpanElement>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const starsRef = useRef<HTMLSpanElement>(null)
  const multiplierRef = useRef<HTMLSpanElement>(null)
  const quizBarRef = useRef<HTMLDivElement>(null)
  const powerRefs = useRef<Record<'magnet' | 'cloud' | 'shield', HTMLDivElement | null>>({ magnet: null, cloud: null, shield: null })
  const registerGauge = useCallback((name: 'magnet' | 'cloud' | 'shield', node: HTMLDivElement | null) => {
    powerRefs.current[name] = node
  }, [])
  const shown = useRef({ distance: -1, score: -1, stars: -1, multiplier: -1 })
  const combo = useRef({ count: 0, at: 0 })
  const finished = useRef(false)
  const onOverRef = useRef(onOver)
  const revivalRef = useRef(revival)
  useEffect(() => {
    onOverRef.current = onOver
    revivalRef.current = revival
  }, [onOver, revival])

  /** Fin de la course : le bilan part au serveur. */
  const end = useCallback((run: RunState) => {
    if (finished.current) return
    finished.current = true
    setOffer(null)
    onOverRef.current({ distance: run.distance, stardust: run.stardust, quiz: run.quizRight, score: scoreOf(run) })
  }, [])

  // Offre de résurrection : un compte à rebours, puis la course se termine d'elle-même.
  const offering = offer !== null && !offer.paying
  useEffect(() => {
    if (!offering) return
    if (offerLeft <= 0) {
      end(state.current)
      return
    }
    const timer = window.setTimeout(() => setOfferLeft((left) => left - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [offering, offerLeft, end])

  const accept = async () => {
    const current = revivalRef.current
    if (!offer || offer.paying || !current) return
    setOffer({ ...offer, paying: true })
    const paid = await current.pay()
    if (!paid) {
      end(state.current)
      return
    }
    revive(state.current)
    setOffer(null)
    paused.current = false
  }

  // Questions de quiz : tirées des univers du BookshelfDLE, reproductibles avec la graine.
  const [quizRandom] = useState(() => seededRandom(seed ^ 0x9e3779b9))
  // Préparées une à l'avance, portraits préchargés : poser une question ne fait jamais attendre.
  const [deck] = useState(() => new QuizDeck())
  useEffect(() => deck.setMaker(() => makeQuiz(universes, t.runner.quiz, quizRandom)), [deck, universes, t, quizRandom])
  const ask = useCallback(() => deck.draw(), [deck])

  // Cinématique : la caméra lance son horloge ; à sa fin (ou passée d'un toucher), le décompte.
  useEffect(() => {
    intro.whenStarted(() => {
      setIntroShown(true)
      finishIntroIn(INTRO_TIME * 1000)
    })
    return () => window.clearTimeout(introTimer.current)
  }, [finishIntroIn, intro])
  const skipIntro = useCallback(() => {
    // La caméra file vers sa place de jeu en une demi-seconde.
    finishIntroIn(intro.skipTo(INTRO_SKIP) * 1000)
  }, [finishIntroIn, intro])

  // Compte à rebours, puis départ.
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      const timer = window.setTimeout(() => {
        setCountdown(null)
        paused.current = false
      }, 450)
      return () => window.clearTimeout(timer)
    }
    playChime(false)
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 600)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const pause = useCallback((value: boolean) => {
    // Course finie, ou en attente d'une résurrection : la pause n'a plus de sens.
    if (finished.current || state.current.over) return
    paused.current = value
    setPausedView(value)
  }, [])

  // Onglet caché : pause automatique.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && countdown === null && !introRunning) pause(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [countdown, introRunning, pause])

  // Développement : l'état de la course, lisible depuis la console (et les tests du navigateur).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, { __mangaRunner: state, __runnerIntro: intro, __runnerAim: aim })
    return () => {
      Reflect.deleteProperty(window, '__mangaRunner')
      Reflect.deleteProperty(window, '__runnerIntro')
      Reflect.deleteProperty(window, '__runnerAim')
    }
  }, [intro, aim])

  // Pas de défilement de la page pendant la course : les gestes sont pour le jeu.
  useEffect(() => {
    const { overflow, overscrollBehavior } = document.body.style
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = overflow
      document.body.style.overscrollBehavior = overscrollBehavior
    }
  }, [])

  const perform = useCallback((action: RunAction) => {
    if (paused.current) return
    act(state.current, action)
  }, [])

  /** Une réponse touchée au quiz : on court vers sa voie (la voie, à l'échéance, fait foi). */
  const answer = useCallback((choice: 0 | 1 | 2) => {
    if (paused.current) return
    goToLane(state.current, (choice - 1) as Lane)
  }, [])

  /** Un tir : sur le monstre touché, ou le plus proche (bouton, clavier). */
  const fire = useCallback(
    (id: number | null) => {
      if (paused.current) return
      const run = state.current
      if (!shotReady(run)) {
        // Pas encore rechargé : le bouton tremble.
        shotRef.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 220 })
        return
      }
      const target = id ?? aim.nearest(run.lane)
      if (target !== null) shoot(run, target)
    },
    [aim],
  )

  // Clavier : flèches, ZQSD / WASD, espace ; Échap met en pause.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (introRunning) {
        skipIntro()
        return
      }
      if (event.key === 'Escape' || event.key === 'p') {
        pause(!paused.current)
        return
      }
      if (SHOOT_KEYS.has(event.key) || SHOOT_KEYS.has(event.key.toLowerCase())) {
        event.preventDefault()
        if (!event.repeat) fire(null)
        return
      }
      const action = KEYS[event.key] ?? KEYS[event.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      if (!event.repeat) perform(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [introRunning, pause, perform, skipIntro, fire])

  // Glissements : le geste part dès que le doigt a assez bougé (pas besoin de le lever).
  // Un toucher bref sur un monstre : un tir.
  const swipe = useRef<{ id: number; x: number; y: number; at: number; used: boolean } | null>(null)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (introRunning) {
      skipIntro()
      return
    }
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), used: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = swipe.current
    if (!current || current.used || current.id !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return
    current.used = true
    perform(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down')
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = swipe.current
    swipe.current = null
    if (!current || current.used || current.id !== event.pointerId) return
    if (performance.now() - current.at > TAP_TIME || Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_MOVE) return
    const target = aim.pick(event.clientX, event.clientY)
    if (target !== null) fire(target)
  }
  const onPointerCancel = () => {
    swipe.current = null
  }

  const onTick = useCallback(
    (run: RunState) => {
      // Compteurs : écrits seulement quand ils changent.
      const distance = Math.floor(run.distance)
      const score = scoreOf(run)
      const multiplier = multiplierFor(run.stardust)
      const last = shown.current
      if (distance !== last.distance && distanceRef.current) distanceRef.current.textContent = `${distance.toLocaleString()} m`
      if (score !== last.score && scoreRef.current) scoreRef.current.textContent = score.toLocaleString()
      if (run.stardust !== last.stars && starsRef.current) starsRef.current.textContent = String(run.stardust)
      if (multiplier !== last.multiplier && multiplierRef.current) multiplierRef.current.textContent = `×${multiplier.toFixed(1)}`
      Object.assign(last, { distance, score, stars: run.stardust, multiplier })
      // Jauges des bonus et du quiz.
      const gauges: [keyof typeof powerRefs.current, number, number][] = [
        ['magnet', run.magnetUntil, MAGNET_TIME],
        ['cloud', run.cloudUntil, CLOUD_TIME],
        ['shield', run.shieldUntil, SHIELD_TIME],
      ]
      for (const [name, until, total] of gauges) {
        const node = powerRefs.current[name]
        if (!node) continue
        const left = Math.max(0, until - run.t) / total
        node.style.display = left > 0 ? 'flex' : 'none'
        const bar = node.lastElementChild as HTMLElement | null
        if (bar) bar.style.transform = `scaleX(${left})`
      }
      // Lignes de vitesse tant que dure l'Éveil.
      const awake = run.shieldUntil > run.t ? 'block' : 'none'
      if (awakeLinesRef.current && awakeLinesRef.current.style.display !== awake) awakeLinesRef.current.style.display = awake
      // Minuteurs : nuage (la descente), Éveil (sa fin), royaume (le retour sur terre).
      const realmLeft = run.realm === 'earth' ? 0 : Math.max(0, (run.realmUntil - run.distance) / Math.max(1, run.speed))
      const lefts: [TimerName, number, number][] = [
        ['cloud', Math.max(0, run.cloudUntil - run.t), CLOUD_TIME],
        ['shield', Math.max(0, run.shieldUntil - run.t), SHIELD_TIME],
        ['realm', realmLeft, REALM_TIME],
      ]
      for (const [name, left, total] of lefts) {
        const node = timers.current[name]
        if (!node) continue
        const show = left > 0 && !run.over ? 'flex' : 'none'
        if (node.style.display !== show) node.style.display = show
        if (left <= 0) continue
        const warning = left < TIMER_WARNING[name] ? 'true' : 'false'
        if (node.dataset.warning !== warning) node.dataset.warning = warning
        if (name === 'realm' && node.dataset.realm !== run.realm) node.dataset.realm = run.realm
        const seconds = node.querySelector<HTMLElement>('[data-seconds]')
        const text = name === 'realm' ? String(Math.ceil(left)) : left.toFixed(1)
        if (seconds && seconds.textContent !== text) seconds.textContent = text
        node.querySelector('[data-ring]')?.setAttribute('stroke-dashoffset', String(RING * (1 - Math.min(1, left / total))))
      }
      // Un tremplin ou un tunnel approche : on l'annonce, avec sa voie.
      const portal = portalRef.current
      if (portal) {
        let next: (typeof run.objects)[number] | null = null
        if (run.realm === 'earth' && !run.over) {
          for (const object of run.objects) {
            if ((object.kind !== 'pad' && object.kind !== 'tunnel') || object.done || object.cleared) continue
            const ahead = object.s - run.distance
            if (ahead > 2 && ahead < PORTAL_NOTICE && (!next || object.s < next.s)) next = object
          }
        }
        const kind = next?.kind ?? 'none'
        if (portal.dataset.kind !== kind) portal.dataset.kind = kind
        const lane = next ? String(next.lane) : ''
        if (portal.dataset.lane !== lane) portal.dataset.lane = lane
      }
      // Tir : l'anneau se remplit pendant la recharge ; prêt, le bouton s'allume.
      const shot = shotRef.current
      if (shot) {
        const charge = Math.min(1, 1 - Math.max(0, run.shotReadyAt - run.t) / SHOT_COOLDOWN)
        const ready = charge >= 1 ? 'true' : 'false'
        if (shot.dataset.ready !== ready) shot.dataset.ready = ready
        shotRingRef.current?.setAttribute('stroke-dashoffset', String(RING * (1 - charge)))
        const hidden = run.quiz !== null || run.boss !== null ? 'hidden' : 'visible'
        if (shot.style.visibility !== hidden) shot.style.visibility = hidden
      }
      // Boss : le HUD se relit quand le combat change ; le minuteur du combo file à chaque image.
      const boss = run.boss
      const key = boss ? `${boss.index}|${boss.phase}|${boss.round}|${boss.progress}|${boss.counters}|${boss.hp}|${bossMisses.current}` : ''
      if (key !== bossKey.current) {
        bossKey.current = key
        setBossView(boss ? { index: boss.index, phase: boss.phase, hp: boss.hp, round: boss.round, combo: [...boss.combo], progress: boss.progress, misses: bossMisses.current, counters: boss.counters } : null)
      }
      if (boss?.phase === 'combo' && comboTimerRef.current) comboTimerRef.current.style.transform = `scaleX(${Math.max(0, boss.deadline - run.t) / comboTime(boss.combo.length)})`
      if (run.quiz) {
        if (quizBarRef.current) quizBarRef.current.style.transform = `scaleX(${Math.max(0, run.quiz.deadline - run.t) / QUIZ_TIME})`
        if (quizSecondsRef.current) quizSecondsRef.current.textContent = String(Math.ceil(Math.max(0, run.quiz.deadline - run.t)))
        // La carte de la voie où l'on court est celle qui sera choisie.
        const cards = quizCardsRef.current?.children
        if (cards) for (let index = 0; index < cards.length; index += 1) (cards[index] as HTMLElement).dataset.active = index === run.lane + 1 ? 'true' : 'false'
      }

      if (run.events.length === 0) return
      for (const event of run.events) {
        switch (event) {
          case 'star': {
            const now = run.t
            combo.current.count = now - combo.current.at < 0.6 ? combo.current.count + 1 : 0
            combo.current.at = now
            playRunnerStar(combo.current.count)
            break
          }
          case 'jump':
            playRunnerJump()
            break
          case 'slide':
            playRunnerSlide()
            break
          case 'lane':
            vibrate(4)
            break
          case 'stumble':
            playRunnerStumble()
            vibrate([20, 25, 20])
            break
          case 'hit':
            playRunnerHit()
            vibrate([40, 30, 60])
            setHitFlash((value) => value + 1)
            break
          case 'magnet':
          case 'cloud':
            playRunnerPower()
            vibrate(15)
            break
          case 'quiz':
            playChime(true)
            setVerdict(null)
            setQuiz(run.quiz)
            break
          case 'quizRight':
            playRunnerAwaken()
            vibrate([30, 40, 60])
            setQuiz(null)
            setAwaken((value) => value + 1)
            break
          case 'smash':
            playRunnerSmash()
            vibrate(25)
            break
          case 'shot':
            playRunnerShot()
            vibrate([12, 20, 30])
            break
          case 'clear':
            playRunnerClear()
            setCleared((value) => value + 1)
            break
          case 'launch':
            playRunnerLaunch()
            vibrate([30, 30, 80])
            setPassage({ kind: 'launch', key: Date.now() })
            break
          case 'tunnel':
            playRunnerTunnel()
            vibrate([20, 60, 20])
            setPassage({ kind: 'tunnel', key: Date.now() })
            break
          case 'realm':
            if (run.realm !== 'earth') setArrival({ realm: run.realm, key: Date.now() })
            break
          case 'realmExit':
            playRunnerPower()
            setPassage({ kind: 'exit', key: Date.now() })
            break
          case 'quizWrong':
            playRunnerWrong()
            setQuiz(null)
            setVerdict('wrong')
            break
          case 'over': {
            setQuiz(null)
            // Résurrection possible : la course est figée le temps de choisir.
            const cost = revivalRef.current ? reviveCost(run.revives) : null
            if (cost !== null) {
              paused.current = true
              setOffer({ cost, paying: false })
              setOfferLeft(REVIVE_SECONDS)
            } else end(run)
            break
          }
          case 'boss':
            playBossRoar()
            vibrate([60, 40, 120])
            setVictory(null)
            break
          case 'comboStep':
            playComboStep(run.boss?.progress ?? 1)
            vibrate(8)
            break
          case 'comboMiss':
            bossMisses.current += 1
            playComboMiss()
            vibrate([30, 20, 30])
            break
          case 'bossCast':
            playBossCast(run.boss?.round ?? 0)
            vibrate([15, 30, 15])
            break
          case 'bossHit':
            playBossHit()
            vibrate([40, 30, 80])
            break
          case 'bossCounter':
            playBossCounter()
            vibrate([80, 40, 80])
            break
          case 'bossDown':
            playBossDeath()
            vibrate([30, 40, 30, 40, 200])
            break
          case 'bossDefeated':
            playBossVictory()
            setVictory({ index: run.bossesBeaten - 1, key: Date.now() })
            break
          case 'revive':
            playRunnerPower()
            vibrate([20, 40, 20])
            break
        }
      }
      run.events.length = 0
    },
    [end],
  )

  // Le verdict du quiz s'efface après un instant.
  useEffect(() => {
    if (!verdict) return
    const timer = window.setTimeout(() => setVerdict(null), 1600)
    return () => window.clearTimeout(timer)
  }, [verdict])

  return (
    <div
      className="fixed inset-0 z-[85] touch-none overflow-hidden bg-[#1d0f40] select-none [-webkit-touch-callout:none]"
      style={{ overscrollBehavior: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <RunnerScene state={state} paused={paused} ask={ask} onTick={onTick} lite={lite} look={look} assets={assets} intro={intro} outfit={outfit} aim={aim} />

      {/* Cinématique : bandes noires, carte de titre, « touche pour passer ». */}
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${introRunning ? 'translate-y-0' : '-translate-y-full'}`} />
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${introRunning ? 'translate-y-0' : 'translate-y-full'}`} />
      {/* Préparation de la scène (shaders, textures) : un sceau qui respire, des pétales qui tournent. */}
      <div
        aria-hidden={introShown}
        className={`pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_45%,#3a1f63_0%,#140a2e_70%)] transition-opacity duration-700 ${introShown ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="flex flex-col items-center gap-5">
          <div className="relative grid size-24 place-items-center">
            {[0, 1, 2, 3, 4].map((petal) => (
              <span
                key={petal}
                className="absolute inset-0 animate-[spin_3.2s_linear_infinite]"
                style={{ animationDelay: `${-petal * 0.64}s` }}
              >
                <span className="absolute top-0 left-1/2 block size-3 -translate-x-1/2 rounded-[60%_0_60%_0] bg-[#ffb7d0] opacity-80" />
              </span>
            ))}
            <span className="grid size-14 animate-pulse place-items-center rounded-xl border-2 border-[#e0b04a] bg-[#1d1719] font-display text-2xl text-[#f2cf6c] shadow-[0_0_30px_rgba(224,176,74,0.45)]">
              漫
            </span>
          </div>
          <p role="status" className="text-xs tracking-[0.3em] text-white/75 uppercase">
            {t.runner.intro.loading}
          </p>
        </div>
      </div>
      {introRunning && introShown && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[15vh] flex flex-col items-center gap-2 px-6 text-center">
            <span className="animate-[runner-title_3.1s_ease-out_0.5s_both] text-[11px] font-semibold tracking-[0.5em] text-white/85 uppercase drop-shadow">{t.runner.intro.kicker}</span>
            <span className="animate-[runner-title_3.1s_ease-out_0.75s_both] font-display text-5xl leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.45)]">
              {t.runner.title}
            </span>
            <span className="mt-1 h-0.5 w-24 origin-center animate-[runner-rule_3.1s_ease-out_0.9s_both] bg-gradient-to-r from-transparent via-[#ff6fb5] to-transparent" />
          </div>
          <span className="pointer-events-none absolute inset-x-0 bottom-[3.5vh] animate-pulse text-center text-xs tracking-widest text-white/70 uppercase">{t.runner.intro.skip}</span>
        </>
      )}

      {/* Éclair rouge au choc. */}
      {/* L'Éveil : lignes de vitesse dorées tant qu'il dure ; à l'activation, éclair et titre. */}
      <div ref={awakeLinesRef} aria-hidden className="runner-speedlines pointer-events-none absolute inset-0" style={{ display: 'none' }} />
      {awaken > 0 && (
        <div key={awaken} aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 animate-[runner-hit_0.7s_ease-out_forwards] bg-[radial-gradient(circle_at_50%_62%,#fffbe6_0%,#ffd23ae0_30%,#ff8a0060_65%,transparent_100%)]" />
          <div className="absolute inset-x-0 top-[20%] flex animate-[runner-awaken_1.7s_ease-out_forwards] flex-col items-center gap-1 opacity-0">
            <span className="font-black text-7xl leading-none text-[#ffe37a] [-webkit-text-stroke:2px_#4a1d00] [text-shadow:0_0_24px_#ffb300,0_4px_0_#4a1d00]">{t.runner.hud.awakenSeal}</span>
            <span className="rounded-full bg-black/45 px-4 py-1 text-sm font-bold tracking-[0.3em] text-white uppercase">{t.runner.hud.quizRight}</span>
          </div>
        </div>
      )}
      {hitFlash > 0 && <div key={hitFlash} aria-hidden className="pointer-events-none absolute inset-0 animate-[runner-hit_0.45s_ease-out_forwards] bg-nope/35" />}
      {/* Le quiz vide la route : une vague dorée balaie l'écran. */}
      {cleared > 0 && (
        <div key={cleared} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 animate-[runner-hit_0.9s_ease-out_forwards] bg-[radial-gradient(ellipse_at_50%_70%,#fff6d0b0_0%,#ffd35c50_40%,transparent_75%)]" />
          <div className="absolute inset-x-0 top-[44%] flex animate-[runner-awaken_1.6s_ease-out_forwards] justify-center opacity-0">
            <span className="rounded-full bg-black/45 px-4 py-1.5 text-xs font-bold tracking-[0.3em] text-gold uppercase">{t.runner.hud.cleared}</span>
          </div>
        </div>
      )}

      {/* Passage d'un monde à l'autre : éclair blanc (tremplin, retour), noir (tunnel). */}
      {passage && (
        <div
          key={passage.key}
          aria-hidden
          className={`pointer-events-none absolute inset-0 ${passage.kind === 'tunnel' ? 'animate-[runner-passage_1s_ease-in-out_forwards] bg-[#05020a]' : passage.kind === 'launch' ? 'animate-[runner-passage_1.3s_ease-in-out_forwards] bg-[radial-gradient(circle_at_50%_40%,#ffffff_0%,#e6f6ff_55%,#bfe6ff_100%)]' : 'animate-[runner-passage_0.9s_ease-out_forwards] bg-white'}`}
        />
      )}
      {/* Arrivée dans un royaume : son nom, en grand. */}
      {arrival && (
        <div key={arrival.key} aria-live="polite" className="pointer-events-none absolute inset-x-0 top-[24%] flex animate-[runner-awaken_2.6s_ease-out_forwards] flex-col items-center gap-1 opacity-0">
          <span className={`font-black text-6xl leading-none ${arrival.realm === 'sky' ? 'text-[#fff6d0] [-webkit-text-stroke:2px_#2a6fb0] [text-shadow:0_0_24px_#7fc8ff]' : 'text-[#e8c8ff] [-webkit-text-stroke:2px_#2a0f4a] [text-shadow:0_0_24px_#c77dff]'}`}>
            {arrival.realm === 'sky' ? t.runner.realm.skySeal : t.runner.realm.underSeal}
          </span>
          <span className="rounded-full bg-black/45 px-4 py-1 text-sm font-bold tracking-[0.25em] text-white uppercase">{arrival.realm === 'sky' ? t.runner.realm.sky : t.runner.realm.under}</span>
        </div>
      )}

      {/* Minuteurs : nuage (descente), Éveil (sa fin), royaume (retour sur terre). */}
      <div className="pointer-events-none absolute inset-x-0 top-[max(5.25rem,calc(env(safe-area-inset-top)+4.5rem))] flex justify-center gap-3">
        <PowerTimer name="cloud" register={registerTimer} icon={<Cloud size={15} aria-hidden />} label={t.runner.hud.cloudFlying} warning={t.runner.hud.cloudLanding} />
        <PowerTimer name="shield" register={registerTimer} icon={<Flame size={15} aria-hidden />} label={t.runner.hud.shield} warning={t.runner.hud.shieldEnding} />
        <PowerTimer name="realm" register={registerTimer} icon={<Mountain size={15} aria-hidden />} label={t.runner.realm.timer} warning={t.runner.realm.leaving} />
      </div>

      {/* Un tremplin ou un tunnel approche : l'annonce, et sa voie. */}
      <div ref={portalRef} data-kind="none" className="runner-portal pointer-events-none absolute inset-x-0 top-[max(10.75rem,calc(env(safe-area-inset-top)+10rem))] justify-center px-4">
        <span className="runner-portal-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black tracking-[0.18em] uppercase">
          <span className="runner-portal-pad">{t.runner.realm.padAhead}</span>
          <span className="runner-portal-tunnel">{t.runner.realm.tunnelAhead}</span>
          <span className="runner-portal-lane" data-lane="-1">
            ← {t.runner.hud.left}
          </span>
          <span className="runner-portal-lane" data-lane="0">
            ↑ {t.runner.hud.middle}
          </span>
          <span className="runner-portal-lane" data-lane="1">
            {t.runner.hud.right} →
          </span>
        </span>
      </div>

      {/* HUD du haut : distance, bonus actifs, score, ✦ et multiplicateur, pause. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] transition-opacity duration-500 ${introRunning ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="flex flex-col gap-1.5">
          <span ref={distanceRef} className="font-display text-3xl leading-none text-white tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            0 m
          </span>
          <div className="flex flex-col gap-1">
            <PowerGauge register={registerGauge} name="magnet" label={t.runner.hud.magnet} icon={<Magnet size={13} aria-hidden />} color="#ff4d5e" />
            <PowerGauge register={registerGauge} name="cloud" label={t.runner.hud.cloud} icon={<Cloud size={13} aria-hidden />} color="#bfe9ff" />
            <PowerGauge register={registerGauge} name="shield" label={t.runner.hud.shield} icon={<Flame size={13} aria-hidden />} color="#ffb21a" />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex flex-col items-end gap-1 rounded-2xl bg-black/35 px-3 py-2 backdrop-blur-sm">
            <span ref={scoreRef} className="text-lg leading-none font-bold text-white tabular-nums">
              0
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gold tabular-nums">
              ✦ <span ref={starsRef}>0</span>
              <span ref={multiplierRef} className="rounded-full bg-gold/20 px-1.5 text-[11px] text-gold">
                ×1.0
              </span>
            </span>
          </div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => pause(true)}
            aria-label={t.runner.hud.pause}
            className="pointer-events-auto grid size-11 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm"
          >
            <Pause size={18} />
          </button>
        </div>
      </div>

      {/* Quiz : la question en haut, les trois réponses à toucher, en bas. */}
      {quiz && (
        <div className="pointer-events-none absolute inset-x-0 top-[28%] flex flex-col items-center gap-3 px-4">
          <div className="flex max-w-md items-center gap-3 rounded-2xl border border-gold/40 bg-[#1d0f40]/85 px-4 py-3 shadow-[0_0_24px_rgba(255,196,107,0.35)] backdrop-blur">
            {quiz.question.image && <img src={quiz.question.image} alt="" className="size-12 shrink-0 rounded-xl object-cover object-top" />}
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-base leading-snug font-bold text-white">{quiz.question.prompt}</p>
              <p className="text-[11px] tracking-wide text-gold/90 uppercase">{t.runner.hud.quizHint}</p>
            </div>
            <span ref={quizSecondsRef} className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-gold/70 font-display text-xl text-gold tabular-nums">
              {QUIZ_TIME}
            </span>
          </div>
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/15">
            <div ref={quizBarRef} className="h-full origin-left rounded-full bg-gold" />
          </div>
        </div>
      )}
      {quiz && (
        <div
          ref={quizCardsRef}
          className="absolute inset-x-0 bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+6rem))] grid grid-cols-3 gap-2 px-3"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {quiz.question.options.map((option, index) => (
            <button
              key={index}
              type="button"
              data-active={index === 1 ? 'true' : 'false'}
              aria-label={`${[t.runner.hud.left, t.runner.hud.middle, t.runner.hud.right][index]} : ${option.label}`}
              onClick={() => answer(index as 0 | 1 | 2)}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-white/25 bg-black/50 px-2 py-2 text-center backdrop-blur-sm transition-all duration-150 active:scale-95 data-[active=true]:-translate-y-1.5 data-[active=true]:border-gold data-[active=true]:bg-gold/30 data-[active=true]:shadow-[0_0_22px_rgba(255,196,107,0.6)]"
            >
              {option.image && <img src={option.image} alt="" className="size-9 rounded-lg object-cover object-top" />}
              <span className="line-clamp-2 text-xs leading-tight font-bold text-white">{option.label}</span>
            </button>
          ))}
        </div>
      )}
      {verdict && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center px-4">
          <span
            className="rounded-full bg-nope/90 px-5 py-2.5 text-base font-bold text-white shadow-lg"
          >
            {t.runner.hud.quizWrong}
          </span>
        </div>
      )}

      {/* Tir : touche un monstre (viseur rose), ou ce bouton pour le plus proche. Recharge visible. */}
      <button
        ref={shotRef}
        type="button"
        data-ready="true"
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          fire(null)
        }}
        aria-label={t.runner.hud.shoot}
        className={`runner-shot absolute right-3 grid size-[4.25rem] place-items-center rounded-full transition-opacity duration-500 ${introRunning ? 'opacity-0' : 'opacity-100'} ${buttons ? 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]' : 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]'}`}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={RING_RADIUS} fill="rgba(13,8,40,0.6)" stroke="rgba(255,255,255,0.14)" strokeWidth="7" />
          <circle ref={shotRingRef} cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="#ff6fd1" strokeWidth="7" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={0} />
        </svg>
        <Crosshair size={26} className="runner-shot-icon relative" aria-hidden />
      </button>

      {/* Combat de boss. */}
      {bossView && <BossHud view={bossView} timerRef={comboTimerRef} />}
      {victory && <BossVictory key={victory.key} index={victory.index} />}

      {/* Boutons à l'écran (au choix, sur l'accueil du Runner). */}
      {buttons && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onPointerDown={(event) => event.stopPropagation()}>
          <TouchButton label={t.runner.hud.left} onPress={() => perform('left')} icon={<ArrowLeft size={26} />} />
          <div className="flex gap-2">
            <TouchButton label={t.runner.hud.slide} onPress={() => perform('down')} icon={<ArrowDown size={26} />} />
            <TouchButton label={t.runner.hud.jump} onPress={() => perform('up')} icon={<ArrowUp size={26} />} />
          </div>
          <TouchButton label={t.runner.hud.right} onPress={() => perform('right')} icon={<ArrowRight size={26} />} />
        </div>
      )}

      {offer && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 px-6 backdrop-blur-sm" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
            <div className="relative grid size-24 place-items-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="#ffd35c"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={276.5}
                  strokeDashoffset={276.5 * (1 - offerLeft / REVIVE_SECONDS)}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <span className="font-display text-4xl text-white tabular-nums">{offerLeft}</span>
            </div>
            <p className="font-display text-3xl text-white">{t.runner.revive.title}</p>
            <p className="text-sm text-cream/70">{t.runner.revive.body}</p>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={offer.paying || (revival?.balance ?? 0) < offer.cost}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold text-void shadow-[0_0_28px_rgba(255,211,92,0.5)] disabled:opacity-45"
              style={{ background: 'linear-gradient(135deg, #fff0b0, #ffd35c 45%, #ff9f43)' }}
            >
              {offer.paying ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <Sparkles size={19} aria-hidden />}
              {t.runner.revive.pay(offer.cost)}
            </button>
            <p className="text-xs text-cream/55">{(revival?.balance ?? 0) < offer.cost ? t.runner.revive.short(revival?.balance ?? 0) : t.runner.revive.balance(revival?.balance ?? 0)}</p>
            <button type="button" onClick={() => end(state.current)} disabled={offer.paying} className="h-11 w-full rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white disabled:opacity-45">
              {t.runner.revive.decline}
            </button>
          </div>
        </div>
      )}

      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span key={countdown} className="animate-[runner-count_0.6s_ease-out] font-display text-8xl text-white drop-shadow-[0_0_30px_rgba(255,111,181,0.9)]">
            {countdown > 0 ? countdown : t.runner.hud.go}
          </span>
        </div>
      )}

      {pausedView && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-sm" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex w-64 flex-col items-center gap-3">
            <p className="font-display text-4xl text-white">{t.runner.hud.paused}</p>
            <button type="button" onClick={() => pause(false)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cream text-sm font-semibold text-void">
              <Play size={17} />
              {t.runner.hud.resume}
            </button>
            <button
              type="button"
              onClick={() => {
                const run = state.current
                finished.current = true
                paused.current = true
                setPausedView(false)
                onQuit({ distance: run.distance, stardust: run.stardust, quiz: run.quizRight, score: scoreOf(run) })
              }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white"
            >
              <X size={17} />
              {t.runner.hud.quit}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Anneaux de minuterie (nuage, tir) : rayon et circonférence dans une boîte de 100. */
const RING_RADIUS = 43
const RING = 2 * Math.PI * RING_RADIUS

/** Un minuteur rond : les secondes qui restent ; à la fin, il passe à l'orange et prévient. */
function PowerTimer({ name, register, icon, label, warning }: { name: TimerName; register: (name: TimerName, node: HTMLDivElement | null) => void; icon: ReactNode; label: string; warning: string }) {
  return (
    <div ref={(node) => register(name, node)} data-timer={name} data-warning="false" className="runner-timer flex-col items-center gap-1" style={{ display: 'none' }}>
      <div className="relative grid size-[4.25rem] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={RING_RADIUS} fill="rgba(13,8,40,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth="7" />
          <circle data-ring className="runner-timer-ring" cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={RING} />
        </svg>
        <span className="relative flex flex-col items-center leading-none">
          <span className="runner-timer-icon">{icon}</span>
          <span data-seconds className="mt-0.5 font-display text-lg text-white tabular-nums">
            0
          </span>
        </span>
      </div>
      <span className="runner-timer-label rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] whitespace-nowrap uppercase">
        <span className="runner-timer-on">{label}</span>
        <span className="runner-timer-off">{warning}</span>
      </span>
    </div>
  )
}

function PowerGauge({
  register,
  name,
  label,
  icon,
  color,
}: {
  register: (name: 'magnet' | 'cloud' | 'shield', node: HTMLDivElement | null) => void
  name: 'magnet' | 'cloud' | 'shield'
  label: string
  icon: ReactNode
  color: string
}) {
  return (
    <div
      ref={(node) => register(name, node)}
      className="relative w-28 flex-col gap-1 overflow-hidden rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white"
      style={{ display: 'none' }}
    >
      <span className="flex items-center gap-1" style={{ color }}>
        {icon}
        {label}
      </span>
      <span className="absolute inset-x-0 bottom-0 h-1 origin-left" style={{ backgroundColor: color }} />
    </div>
  )
}

function TouchButton({ label, onPress, icon }: { label: string; onPress: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault()
        onPress()
      }}
      className="grid size-16 place-items-center rounded-2xl border border-white/20 bg-black/40 text-white backdrop-blur-sm active:scale-95 active:bg-white/20"
    >
      {icon}
    </button>
  )
}
