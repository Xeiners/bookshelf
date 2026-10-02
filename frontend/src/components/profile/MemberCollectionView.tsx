import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Lock } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { ApiError } from '../../services/api'
import { profileApi, type MemberCollection } from '../../services/profileApi'
import { CollectionAlbum } from '../cards/CollectionAlbum'
import { Pressable } from '../ui/Pressable'

type State = { status: 'loading' } | { status: 'ready'; data: MemberCollection } | { status: 'error'; private: boolean }

/**
 * L'album d'un autre membre, en plein écran par-dessus son profil : le même
 * album que « Ma collection », avec en plus les cartes qu'il a et qui me
 * manquent (badge et filtre) — de quoi lui proposer un échange au Marché.
 */
export function MemberCollectionView({ userId, name, isSelf, onClose }: { userId: string; name: string; isSelf: boolean; onClose: () => void }) {
  const t = useT()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  // Mon album (déjà en mémoire le plus souvent) : de quoi repérer ce qui me manque chez lui.
  const mine = useCollection({ enabled: !isSelf })
  const owned = useMemo(
    () => (isSelf || !mine.data ? null : new Set(mine.data.cards.filter((card) => card.owned).map((card) => card.id))),
    [isSelf, mine.data],
  )

  useEffect(() => {
    const controller = new AbortController()
    profileApi
      .memberCollection(userId, controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', private: error instanceof ApiError && error.code === 'profile_private' })
      })
    return () => controller.abort()
  }, [userId, attempt])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosing(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Arrive de la droite, repart vers la droite : on s'enfonce dans le profil, on en ressort.
  useGSAP(
    () => {
      gsap.fromTo(rootRef.current, { xPercent: 100 }, { xPercent: 0, duration: 0.45, ease: EASE.glide })
    },
    { scope: rootRef },
  )
  useGSAP(
    () => {
      if (!closing) return
      gsap.to(rootRef.current, { xPercent: 100, duration: 0.3, ease: EASE.exit, onComplete: onClose })
    },
    { scope: rootRef, dependencies: [closing] },
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.publicProfile.collectionTitle(name)}
      className="fixed inset-0 z-[77] flex flex-col bg-void text-cream will-change-transform"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <Pressable onClick={() => setClosing(true)} aria-label={t.publicProfile.collectionBack} className="grid size-10 shrink-0 place-items-center rounded-full text-cream/85 hover:bg-white/10">
          <ArrowLeft size={20} />
        </Pressable>
        <p className="min-w-0 flex-1 truncate font-display text-xl text-cream">{t.publicProfile.collectionTitle(name)}</p>
      </header>

      {state.status === 'error' ? (
        <div role="alert" className="mx-auto flex max-w-xs flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          {state.private && <Lock size={26} className="text-mist" aria-hidden />}
          <p className="text-sm text-cream/80">{state.private ? t.publicProfile.collectionPrivate : t.publicProfile.collectionError}</p>
          {!state.private && (
            <button
              type="button"
              onClick={() => {
                setState({ status: 'loading' })
                setAttempt((value) => value + 1)
              }}
              className="rounded-full bg-cream px-5 py-2.5 text-xs font-medium text-void"
            >
              {t.publicProfile.retry}
            </button>
          )}
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col pt-4">
          <CollectionAlbum
            data={state.status === 'ready' ? state.data : null}
            status={state.status === 'ready' ? 'ready' : 'loading'}
            retry={() => setAttempt((value) => value + 1)}
            mine={owned}
          />
        </div>
      )}
    </div>
  )
}
