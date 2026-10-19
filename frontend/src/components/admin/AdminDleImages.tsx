import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, ImageOff, Loader2, Undo2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { verdictOf, stampOpacity, type Verdict } from '../../lib/dleReview'
import { gsap } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { adminApi, type DleReviewItem, type DleUniverse } from '../../services/adminApi'
import { useUiStore } from '../../store/useUiStore'

/** Images chargées d'avance derrière la carte du dessus. */
const PRELOAD = 3
/** Taille des lots demandés au serveur. */
const BATCH = 10

/**
 * Revue des images d'énigme du BookshelfDLE : on choisit un univers (Naruto, One Piece, JoJo…), puis
 * on passe ses images en revue comme dans le mode Découverte — l'image en grand, le personnage en
 * dessous ; à droite on garde, à gauche on bannit. Une image bannie n'est plus jamais tirée.
 */
export function AdminDleImages() {
  const t = useT()
  const [universes, setUniverses] = useState<DleUniverse[] | null>(null)
  const [open, setOpen] = useState<DleUniverse | null>(null)
  const notify = useUiStore((state) => state.notify)

  const load = useCallback(async () => {
    try {
      setUniverses((await adminApi.dleUniverses()).universes)
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    }
  }, [notify, t])
  useEffect(() => {
    // Chargement initial : la réponse arrive après le premier rendu.
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  if (open) {
    return (
      <ReviewDeck
        universe={open}
        onClose={() => {
          setOpen(null)
          void load()
        }}
      />
    )
  }
  return (
    // La liste défile (le paquet de cartes, lui, tient dans l'écran).
    <div className="no-scrollbar mx-auto flex h-full max-w-2xl flex-col gap-3 overflow-y-auto overscroll-contain pb-[max(2rem,env(safe-area-inset-bottom))]">
      <p className="text-sm text-mist">{t.admin.images.subtitle}</p>
      {universes === null ? (
        <div className="grid place-items-center py-10 text-mist">
          <Loader2 size={20} className="animate-spin" aria-hidden />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {universes.map((universe) => (
            <li key={universe.category}>
              <button type="button" onClick={() => setOpen(universe)} className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-left transition-colors hover:bg-white/[0.07]">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
                  <ImageOff size={19} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-cream">{universe.label}</span>
                  <span className="block text-xs text-mist">{universe.ready ? t.admin.images.loadedLeft(universe.remaining, universe.images) : t.admin.images.notLoaded}</span>
                  {(universe.approved > 0 || universe.banned > 0) && <span className="block text-[11px] text-mist/80">{t.admin.images.reviewed(universe.approved, universe.banned)}</span>}
                </span>
                <ChevronRight size={16} className="shrink-0 text-cream/40" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Une décision prise, pour pouvoir l'annuler. */
interface Decided {
  item: DleReviewItem
  verdict: Verdict
}

function ReviewDeck({ universe, onClose }: { universe: DleUniverse; onClose: () => void }) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const category = universe.category
  /** Images en attente, la première est celle du dessus. */
  const [queue, setQueue] = useState<DleReviewItem[]>([])
  const [remaining, setRemaining] = useState(universe.remaining)
  const [status, setStatus] = useState<'loading' | 'waiting' | 'ready' | 'done'>('loading')
  const [history, setHistory] = useState<Decided[]>([])
  /** Images déjà jugées ou passées pendant cette session : jamais redemandées ni remises dans la pile. */
  const seen = useRef(new Set<string>())
  const fetching = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  const idOf = (item: DleReviewItem) => `${item.characterId}|${item.key}`

  const fetchMore = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const result = await adminApi.dleQueue(category, BATCH)
      if (!result.ready) {
        setStatus('waiting')
        return
      }
      setRemaining(result.remaining)
      setQueue((current) => {
        const known = new Set(current.map(idOf))
        const fresh = result.items.filter((item) => !seen.current.has(idOf(item)) && !known.has(idOf(item)))
        const next = [...current, ...fresh]
        setStatus(next.length > 0 ? 'ready' : 'done')
        return next
      })
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      fetching.current = false
    }
  }, [category, notify, t])

  useEffect(() => {
    const timer = setTimeout(() => void fetchMore(), 0)
    return () => clearTimeout(timer)
  }, [fetchMore])

  // Les images se chargent côté serveur : on réessaie toutes les 6 s.
  useEffect(() => {
    if (status !== 'waiting') return
    const timer = window.setInterval(() => void fetchMore(), 6000)
    return () => window.clearInterval(timer)
  }, [status, fetchMore])

  // La pile se remplit avant d'être vide.
  useEffect(() => {
    if (status !== 'ready' || queue.length >= 4 || remaining <= queue.length) return
    const timer = setTimeout(() => void fetchMore(), 0)
    return () => clearTimeout(timer)
  }, [status, queue.length, remaining, fetchMore])

  // Les prochaines images sont chargées d'avance.
  useEffect(() => {
    for (const item of queue.slice(1, 1 + PRELOAD)) new Image().src = adminApi.dleImageUrl(category, item)
  }, [queue, category])

  const top = queue[0]

  /** Enregistre la décision (sans attendre) ; en cas d'échec, la carte revient. */
  const record = useCallback(
    async (item: DleReviewItem, verdict: Verdict) => {
      try {
        await adminApi.dleDecide(category, item, verdict)
      } catch (error) {
        notify(error instanceof Error ? error.message : t.admin.images.failed, 'nope')
        seen.current.delete(idOf(item))
        setQueue((current) => [item, ...current])
        setHistory((current) => current.filter((entry) => entry.item !== item))
        setRemaining((count) => count + 1)
        setStatus('ready')
      }
    },
    [category, notify, t],
  )

  /** La carte du dessus part du côté de la décision, puis la suivante prend sa place. */
  const commit = useCallback(
    (verdict: Verdict, fromX = 0) => {
      const node = cardRef.current
      const item = queue[0]
      if (!item || busy.current) return
      busy.current = true
      vibrate(verdict === 'ban' ? [8, 30, 8] : 8)
      const dir = verdict === 'approve' ? 1 : -1
      const finish = () => {
        seen.current.add(idOf(item))
        setQueue((current) => (current[0] === item ? current.slice(1) : current))
        setHistory((current) => [...current, { item, verdict }])
        setRemaining((count) => Math.max(0, count - 1))
        busy.current = false
        void record(item, verdict)
      }
      if (!node) return finish()
      gsap.to(node, { x: dir * Math.max(window.innerWidth, 500), y: fromX * 0.1, rotation: dir * 16, autoAlpha: 0, duration: 0.32, ease: 'power2.in', onComplete: finish })
    },
    [queue, record],
  )

  const undo = useCallback(async () => {
    const last = history.at(-1)
    if (!last || busy.current) return
    busy.current = true
    vibrate(6)
    try {
      await adminApi.dleDecide(category, last.item, 'clear')
      seen.current.delete(idOf(last.item))
      setHistory((current) => current.slice(0, -1))
      setQueue((current) => [last.item, ...current])
      setRemaining((count) => count + 1)
      setStatus('ready')
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      busy.current = false
    }
  }, [category, history, notify, t])

  // Clavier (ordinateur) : ← bannir, → garder, Retour arrière annuler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') commit('ban')
      else if (event.key === 'ArrowRight') commit('approve')
      else if (event.key === 'Backspace') void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, undo])

  // Une nouvelle carte du dessus arrive au centre.
  useEffect(() => {
    if (cardRef.current) gsap.set(cardRef.current, { x: 0, y: 0, rotation: 0, autoAlpha: 1 })
  }, [top])

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-cream">
          <ArrowLeft size={14} aria-hidden />
          {t.admin.images.back}
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-cream">{universe.label}</p>
        <span className="w-20 shrink-0 text-right text-xs text-mist tabular-nums">{status === 'ready' ? t.admin.images.left(remaining) : ''}</span>
      </div>

      {status === 'loading' || status === 'waiting' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-mist">
          <Loader2 size={24} className="animate-spin" aria-hidden />
          <p className="text-sm">{status === 'waiting' ? t.admin.images.loading : ''}</p>
        </div>
      ) : status === 'done' || !top ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Check size={34} className="text-like" aria-hidden />
          <p className="text-sm text-cream/80">{t.admin.images.empty}</p>
          {history.length > 0 && (
            <button type="button" onClick={() => void undo()} className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-xs font-semibold text-cream">
              <Undo2 size={14} aria-hidden />
              {t.admin.images.undo}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            {/* La carte suivante, légèrement en retrait. */}
            {queue[1] && <div aria-hidden className="absolute inset-x-3 top-2 bottom-0 rounded-3xl border border-white/10 bg-white/[0.04]" />}
            <Card key={idOf(top)} item={top} category={category} cardRef={cardRef} onCommit={commit} onBroken={() => {
              notify(t.admin.images.unavailable, 'nope')
              seen.current.add(idOf(top))
              setQueue((current) => (current[0] === top ? current.slice(1) : current))
              setRemaining((count) => Math.max(0, count - 1))
            }} />
          </div>
          <div className="flex shrink-0 items-center justify-center gap-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => commit('ban')} aria-label={t.admin.images.ban} className="grid size-14 place-items-center rounded-full border border-nope/50 bg-nope/15 text-nope transition-transform active:scale-90">
              <X size={26} aria-hidden />
            </button>
            <button type="button" onClick={() => void undo()} disabled={history.length === 0} aria-label={t.admin.images.undo} className="grid size-11 place-items-center rounded-full bg-white/[0.08] text-cream transition-transform active:scale-90 disabled:opacity-30">
              <Undo2 size={18} aria-hidden />
            </button>
            <button type="button" onClick={() => commit('approve')} aria-label={t.admin.images.keep} className="grid size-14 place-items-center rounded-full border border-like/50 bg-like/15 text-like transition-transform active:scale-90">
              <Check size={26} aria-hidden />
            </button>
          </div>
          <p className="hidden shrink-0 pb-2 text-center text-[11px] text-mist/70 md:block">{t.admin.images.hint}</p>
        </>
      )}
    </div>
  )
}

/** La carte du dessus : l'image en grand, le personnage en dessous ; glissable à droite (garder) ou à gauche (bannir). */
function Card({ item, category, cardRef, onCommit, onBroken }: { item: DleReviewItem; category: string; cardRef: React.RefObject<HTMLDivElement | null>; onCommit: (verdict: Verdict, fromX: number) => void; onBroken: () => void }) {
  const t = useT()
  const [loaded, setLoaded] = useState(false)
  const stampKeep = useRef<HTMLDivElement>(null)
  const stampBan = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startT: number; lastX: number; lastT: number; velocity: number } | null>(null)

  const paint = (dx: number) => {
    const node = cardRef.current
    if (node) gsap.set(node, { x: dx, rotation: dx * 0.06 })
    if (stampKeep.current) stampKeep.current.style.opacity = String(stampOpacity(dx, 'approve'))
    if (stampBan.current) stampBan.current.style.opacity = String(stampOpacity(dx, 'ban'))
  }

  const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startT: event.timeStamp, lastX: event.clientX, lastT: event.timeStamp, velocity: 0 }
  }
  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const dt = Math.max(1, event.timeStamp - state.lastT)
    state.velocity = state.velocity * 0.6 + ((event.clientX - state.lastX) / dt) * 0.4
    state.lastX = event.clientX
    state.lastT = event.timeStamp
    paint(event.clientX - state.startX)
  }
  const onUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null
    if (!state) return
    const dx = event.clientX - state.startX
    const verdict = verdictOf(dx, state.velocity, event.currentTarget.getBoundingClientRect().width)
    if (verdict) onCommit(verdict, dx)
    else {
      gsap.to(cardRef.current, { x: 0, rotation: 0, duration: 0.35, ease: 'back.out(1.6)' })
      for (const stamp of [stampKeep.current, stampBan.current]) if (stamp) gsap.to(stamp, { opacity: 0, duration: 0.2 })
    }
  }

  return (
    <div
      ref={cardRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0 flex touch-pan-y flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#12122a] shadow-2xl select-none will-change-transform"
    >
      <div className="relative min-h-0 flex-1 bg-black/40">
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center text-mist">
            <Loader2 size={22} className="animate-spin" aria-hidden />
          </div>
        )}
        <img
          src={adminApi.dleImageUrl(category, item)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={onBroken}
          className={`size-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
        <div ref={stampKeep} aria-hidden className="pointer-events-none absolute inset-0 border-4 border-like opacity-0">
          <span className="absolute top-6 left-5 -rotate-12 rounded-lg border-4 border-like px-3 py-1 text-2xl font-black tracking-widest text-like">{t.admin.images.stampKeep}</span>
        </div>
        <div ref={stampBan} aria-hidden className="pointer-events-none absolute inset-0 border-4 border-nope opacity-0">
          <span className="absolute top-6 right-5 rotate-12 rounded-lg border-4 border-nope px-3 py-1 text-2xl font-black tracking-widest text-nope">{t.admin.images.stampBan}</span>
        </div>
      </div>
      {/* Le personnage à deviner, comme sur l'écran de réponse du jeu. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-black/30 p-3">
        <img src={adminApi.dlePortraitUrl(category, item.characterId)} alt="" draggable={false} className="size-14 shrink-0 rounded-xl border-2 border-[#ff8a3d] bg-ink object-cover object-top" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-mist uppercase">{t.admin.images.isCharacter}</p>
          <p className="truncate text-lg font-semibold text-cream">{item.name}</p>
        </div>
      </div>
    </div>
  )
}
