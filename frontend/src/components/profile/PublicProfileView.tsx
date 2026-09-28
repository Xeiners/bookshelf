import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, BookOpen, Check, Eye, Loader2, Lock, Plus, Share2 } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { profileLink } from '../../lib/profileLink'
import { ApiError } from '../../services/api'
import { profileApi, type ProfileCard, type PublicProfileData, type PublicWork } from '../../services/profileApi'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useUiStore } from '../../store/useUiStore'
import { CardZoom } from '../cards/CardZoom'
import { BookCover } from '../ui/BookCover'
import { Pressable } from '../ui/Pressable'
import { ProfileHeader } from './ProfileHeader'
import { ProfileShowcase } from './ProfileShowcase'
import { ProfileStats } from './ProfileStats'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicProfileData }
  | { status: 'error'; notFound: boolean }

/**
 * Profil public d'un compte, en plein écran par-dessus l'application : même
 * carte d'identité et même vitrine que le profil perso (en lecture seule),
 * activité de lecture (en cours, terminés) si le compte la partage, puis
 * collection et boosters. Une œuvre s'ouvre (fiche) ou s'ajoute à sa propre
 * liste d'envies en un geste.
 *
 * Monté avec `key={userId}` : changer de profil repart d'un état vierge.
 */
export function PublicProfileView({ userId }: { userId: string }) {
  const t = useT()
  const language = useLanguage()
  const close = useUiStore((state) => state.closePublicProfile)
  const notify = useUiStore((state) => state.notify)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [zoomed, setZoomed] = useState<ProfileCard | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const zoomedRef = useRef(zoomed)

  useEffect(() => {
    zoomedRef.current = zoomed
  })

  useEffect(() => {
    const controller = new AbortController()
    profileApi
      .publicProfile(userId, language, controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', notFound: reason instanceof ApiError && reason.status === 404 })
        }
      })
    return () => controller.abort()
  }, [userId, language, attempt])

  // Échap : ferme le profil, sauf si une fiche ou une carte en grand est ouverte par-dessus (elles ont leur propre Échap).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || useUiStore.getState().detail || zoomedRef.current) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useGSAP(
    () => {
      if (state.status !== 'ready') return
      gsap.from('[data-anim]', { y: 22, autoAlpha: 0, duration: 0.55, stagger: 0.05, ease: EASE.swift, clearProps: 'opacity,visibility,transform' })
    },
    { scope: rootRef, dependencies: [state.status] },
  )

  const share = async () => {
    vibrate(6)
    const url = profileLink(userId, window.location.origin, window.location.pathname)
    const title = state.status === 'ready' ? (state.data.profile.displayName ?? t.publicProfile.anonymous) : t.publicProfile.dialog
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      notify(t.publicProfile.linkCopied, 'like')
    } catch {
      // Partage annulé par l'utilisateur, ou presse-papiers refusé : rien à signaler.
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t.publicProfile.dialog} className="fixed inset-0 z-[75] flex flex-col bg-void text-cream">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5">
        <Pressable
          onClick={close}
          aria-label={t.publicProfile.close}
          className="grid size-10 shrink-0 place-items-center rounded-full text-cream/85 hover:bg-white/10"
        >
          <ArrowLeft size={20} />
        </Pressable>
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.22em] text-mist uppercase">{t.publicProfile.dialog}</p>
        {state.status !== 'error' && (
          <Pressable
            onClick={() => void share()}
            aria-label={t.publicProfile.share}
            className="grid size-10 shrink-0 place-items-center rounded-full text-cream/80 hover:bg-white/10"
          >
            <Share2 size={18} />
          </Pressable>
        )}
      </header>

      <div ref={rootRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {state.status === 'loading' ? (
          <p className="flex items-center justify-center gap-2 py-24 text-xs text-mist" aria-live="polite">
            <Loader2 size={15} className="animate-spin" />
            {t.publicProfile.loading}
          </p>
        ) : state.status === 'error' ? (
          <div role="alert" className="mx-auto flex max-w-xs flex-col items-center gap-4 py-24 text-center">
            <p className="text-sm text-cream/85">{state.notFound ? t.publicProfile.notFound : t.publicProfile.error}</p>
            <div className="flex gap-2">
              {!state.notFound && (
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
              <button type="button" onClick={close} className="rounded-full border border-cream/20 px-5 py-2.5 text-xs text-cream/85">
                {t.publicProfile.close}
              </button>
            </div>
          </div>
        ) : (
          <ProfileBody data={state.data} onZoom={setZoomed} />
        )}
      </div>

      {zoomed && createPortal(<CardZoom card={zoomed} onClose={() => setZoomed(null)} />, document.body)}
    </div>
  )
}

function ProfileBody({ data, onZoom }: { data: PublicProfileData; onZoom: (card: ProfileCard) => void }) {
  const t = useT()
  const { profile, stats, library, isSelf } = data
  // Vitrine vide sur un profil public : pas de grand cadre d'emplacements vides.
  // Sur un profil privé, la vitrine est tout ce qui se montre : toujours affichée.
  const hasShowcase = profile.featured.length > 0 || !profile.isProfilePublic
  const name = profile.displayName ?? t.publicProfile.anonymous
  const memberSince =
    profile.createdAt === null
      ? null
      : new Intl.DateTimeFormat(t.locale, { month: 'long', year: 'numeric' }).format(new Date(profile.createdAt))
  const reading = stats
    ? {
        consulted: stats.reading.consulted,
        finished: stats.reading.read + stats.reading.novelsFinished,
        chaptersRead: stats.reading.chaptersRead,
        novels: stats.reading.novels,
        completion: stats.reading.completion,
      }
    : null

  return (
    <div className="mx-auto w-full max-w-md space-y-3 md:grid md:max-w-3xl md:grid-cols-5 md:items-start md:gap-4 md:space-y-0 xl:max-w-5xl">
      {isSelf && (
        <p data-anim className="flex items-center gap-2 rounded-2xl border border-glow/30 bg-glow/10 px-4 py-2.5 text-[11px] text-cream/85 md:col-span-5">
          <Eye size={14} className="shrink-0 text-glow" />
          {t.publicProfile.selfPreview}
        </p>
      )}

      <div className={hasShowcase ? 'md:col-span-2' : 'md:col-span-5'}>
        <ProfileHeader
          name={name}
          avatar={profile.avatar}
          avatarUrl={profile.avatarUrl}
          title={profile.activeTitle}
          bio={profile.bio}
          memberSince={memberSince}
          signedIn
        />
        {!profile.isProfilePublic && <PrivateNotice isSelf={isSelf} />}
      </div>

      {hasShowcase && (
        <div className="md:col-span-3">
          <ProfileShowcase
            cards={profile.featured}
            recentWorks={[]}
            signedIn
            onOpenCard={onZoom}
            subtitle={t.publicProfile.showcaseSubtitle}
          />
        </div>
      )}

      {library && (
        <div className="md:col-span-5">
          <ReadingActivity library={library} />
        </div>
      )}

      {stats && (
        <div className="md:col-span-5">
          <ProfileStats collection={stats.collection} reading={reading} boostersOpened={stats.gacha.boostersOpened} />
        </div>
      )}
    </div>
  )
}

/** Profil privé : une ligne sobre sous l'identité, rien de plus. */
function PrivateNotice({ isSelf }: { isSelf: boolean }) {
  const t = useT()
  const copy = t.publicProfile
  return (
    <section data-anim className="glass mt-3 flex items-center gap-3.5 rounded-4xl px-5 py-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cream/[0.06] text-mist">
        <Lock size={17} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-cream">{copy.privateTitle}</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-mist">{isSelf ? copy.privateSelf : copy.privateBody}</p>
      </div>
    </section>
  )
}

/* ---- Activité de lecture ------------------------------------------------------ */

type Tab = 'reading' | 'read'

function ReadingActivity({ library }: { library: NonNullable<PublicProfileData['library']> }) {
  const t = useT()
  const copy = t.publicProfile
  const [tab, setTab] = useState<Tab>(() => (library.reading.length === 0 && library.read.length > 0 ? 'read' : 'reading'))

  const works = tab === 'reading' ? library.reading : library.read
  const total = tab === 'reading' ? library.readingTotal : library.readTotal
  const hidden = Math.max(0, total - works.length)

  return (
    <section data-anim className="glass rounded-4xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-cream">{copy.activity}</h2>
        <div role="tablist" aria-label={copy.activity} className="flex gap-1 rounded-2xl bg-cream/5 p-1">
          {(['reading', 'read'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-medium transition-colors ${
                tab === id ? 'bg-cream text-void' : 'text-cream/70'
              }`}
            >
              {copy.tabs[id]}
              <span className={`tabular-nums ${tab === id ? 'text-void/60' : 'text-mist'}`}>
                {id === 'reading' ? library.readingTotal : library.readTotal}
              </span>
            </button>
          ))}
        </div>
      </div>

      {works.length === 0 ? (
        <p className="mt-6 mb-2 text-center text-xs text-mist">{tab === 'reading' ? copy.emptyReading : copy.emptyRead}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-6">
          {works.map((work) => (
            <WorkTile key={`${work.kind}-${work.id}`} work={work} finished={tab === 'read'} />
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="mt-4 text-center text-[11px] text-mist">{copy.more(hidden)}</p>}
    </section>
  )
}

function WorkTile({ work, finished }: { work: PublicWork; finished: boolean }) {
  const t = useT()
  const copy = t.publicProfile
  const openDetail = useUiStore((state) => state.openDetail)
  const notify = useUiStore((state) => state.notify)
  const inLibrary = useLibraryStore((state) => state.entries[work.id] !== undefined)
  const save = useLibraryStore((state) => state.save)
  const { book } = work
  const percent = Math.round(work.progress * 100)
  const meta =
    work.kind === 'novel'
      ? `${copy.novel} · ${copy.percent(percent)}`
      : !finished && work.chaptersRead > 0
        ? copy.chapters(work.chaptersRead)
        : finished
          ? (work.author ?? '')
          : copy.percent(percent)

  const cover = (
    <div className="relative aspect-2/3 overflow-hidden rounded-2xl bg-cream/[0.04] ring-1 ring-white/10">
      {book ? (
        <BookCover book={book} className="h-full w-full" />
      ) : work.cover ? (
        <img src={work.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full place-items-center text-mist">
          <BookOpen size={22} />
        </span>
      )}
      {!finished && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
          <span className="block h-full origin-left bg-linear-to-r from-glow to-like" style={{ transform: `scaleX(${work.progress})` }} />
        </span>
      )}
    </div>
  )

  return (
    <li className="relative min-w-0">
      {book ? (
        <button type="button" onClick={() => openDetail(book)} aria-label={copy.open(work.title)} className="block w-full text-left">
          {cover}
        </button>
      ) : (
        cover
      )}
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-cream">{work.title}</p>
      {meta && <p className="truncate text-[10px] text-mist">{meta}</p>}

      {book &&
        (inLibrary ? (
          <span
            role="img"
            aria-label={copy.inLibrary(work.title)}
            className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-like text-void"
          >
            <Check size={14} />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              vibrate(8)
              save(book, 'wishlist')
              notify(copy.added(work.title), 'like')
            }}
            aria-label={copy.add(work.title)}
            className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-cream text-void shadow-lg"
          >
            <Plus size={14} />
          </button>
        ))}
    </li>
  )
}
