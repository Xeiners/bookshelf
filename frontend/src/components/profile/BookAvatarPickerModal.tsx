import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, Hexagon, Search, UserRound, X } from 'lucide-react'
import { useT } from '../../i18n'
import { avatarMaskStyle, avatarUrlWithCrop, DEFAULT_AVATAR_CROP, type AvatarCrop } from '../../lib/avatarCrop'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { profileApi, type AvatarOption } from '../../services/profileApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useNovelStore } from '../../store/useNovelStore'
import { Pressable } from '../ui/Pressable'

interface AvatarWork {
  key: string
  kind: 'library' | 'book'
  id: string
  title: string
  subtitle: string
  cover: string | null
}

interface BookAvatarPickerModalProps {
  onClose: () => void
  onPick: (avatarUrl: string) => void
}

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Galerie bibliothèque → visuels de l'œuvre → cadrage persistant de l'avatar. */
export function BookAvatarPickerModal({ onClose, onPick }: BookAvatarPickerModalProps) {
  const t = useT()
  const user = useAuthStore((state) => state.user)
  const entries = useLibraryStore((state) => state.entries)
  const novels = useNovelStore((state) => state.books)
  const refreshNovels = useNovelStore((state) => state.refresh)
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [work, setWork] = useState<AvatarWork | null>(null)
  const [options, setOptions] = useState<AvatarOption[] | null>(null)
  const [image, setImage] = useState<AvatarOption | null>(null)
  const [crop, setCrop] = useState<AvatarCrop>(DEFAULT_AVATAR_CROP)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (user && novels === null) void refreshNovels(user.id)
  }, [user, novels, refreshNovels])

  const works = useMemo<AvatarWork[]>(() => {
    const library = Object.values(entries).map(({ book }) => ({
      key: `library:${book.id}`,
      kind: 'library' as const,
      id: book.id,
      title: book.title,
      subtitle: book.authors.join(', '),
      cover: book.cover,
    }))
    const imported = (novels ?? []).map(({ book }) => ({
      key: `book:${book.id}`,
      kind: 'book' as const,
      id: book.id,
      title: book.title,
      subtitle: book.author ?? t.book.unknownAuthor,
      cover: book.coverUrl,
    }))
    return [...library, ...imported].sort((a, b) => a.title.localeCompare(b.title, t.locale))
  }, [entries, novels, t])

  const filtered = useMemo(() => {
    const needle = normalize(query)
    return needle ? works.filter((item) => normalize(`${item.title} ${item.subtitle}`).includes(needle)) : works
  }, [query, works])

  useGSAP(
    () => {
      gsap.timeline({ defaults: { ease: EASE.glide } })
        .fromTo('[data-avatar-backdrop]', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0)
        .fromTo('[data-avatar-panel]', { yPercent: 8, scale: 0.97, autoAlpha: 0 }, { yPercent: 0, scale: 1, autoAlpha: 1, duration: 0.45 }, 0)
    },
    { scope: rootRef },
  )

  useGSAP(
    () => {
      gsap.fromTo('.avatar-picker-item', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.025, ease: EASE.swift })
    },
    { dependencies: [work, image, filtered.length], scope: rootRef },
  )

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (image) setImage(null)
      else if (work) setWork(null)
      else onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [image, work, onClose])

  const chooseWork = async (selected: AvatarWork) => {
    setWork(selected)
    setOptions(null)
    setError(false)
    try {
      const response = await profileApi.avatarOptions(selected.kind, selected.id)
      setOptions(response.options)
    } catch {
      setError(true)
      setOptions(selected.cover ? [{ url: selected.cover, label: t.profile.editor.avatarLibrary.mainCover, source: 'cover' }] : [])
    }
  }

  const back = () => {
    if (image) {
      setImage(null)
      setCrop(DEFAULT_AVATAR_CROP)
    } else {
      setWork(null)
      setOptions(null)
    }
  }

  const heading = image
    ? t.profile.editor.avatarLibrary.cropTitle
    : work
      ? work.title
      : t.profile.editor.avatarLibrary.title

  return (
    <div ref={rootRef} className="fixed inset-0 z-[110]" role="dialog" aria-modal aria-label={heading}>
      <button type="button" data-avatar-backdrop onClick={onClose} aria-label={t.common.close} className="absolute inset-0 bg-void/95" />
      <section data-avatar-panel className="glass-strong absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] bottom-2 mx-auto flex max-w-3xl flex-col overflow-hidden rounded-[2rem] md:inset-x-6 md:top-6 md:bottom-6">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4 py-4 md:px-6">
          {(work || image) && (
            <button type="button" onClick={back} aria-label={t.profile.editor.back} className="glass grid size-9 place-items-center rounded-full text-cream/70">
              <ArrowLeft size={17} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl text-cream">{heading}</h2>
            <p className="mt-0.5 truncate text-[11px] text-mist">
              {image ? t.profile.editor.avatarLibrary.cropHint : work ? t.profile.editor.avatarLibrary.imagesHint : t.profile.editor.avatarLibrary.libraryHint}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="glass grid size-9 place-items-center rounded-full text-cream/60">
            <X size={16} />
          </button>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
          {!work ? (
            <>
              <label className="glass flex items-center gap-2 rounded-full px-4 py-2.5">
                <Search size={15} className="shrink-0 text-mist" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.profile.editor.avatarLibrary.search} autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist/60" />
              </label>
              {filtered.length > 0 ? (
                <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {filtered.map((item) => (
                    <button key={item.key} type="button" onClick={() => void chooseWork(item)} className="avatar-picker-item group min-w-0 text-left">
                      <span className="relative block aspect-2/3 overflow-hidden rounded-xl bg-cream/5 ring-1 ring-white/10">
                        {item.cover ? <img src={item.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" /> : <span className="grid h-full place-items-center text-mist"><BookOpen size={24} /></span>}
                      </span>
                      <span className="mt-2 block truncate text-xs font-medium text-cream/90">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-mist">{item.subtitle}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-56 place-items-center text-center text-sm text-mist">{works.length ? t.profile.editor.avatarLibrary.noMatch : t.profile.editor.avatarLibrary.empty}</div>
              )}
            </>
          ) : image ? (
            <div className="avatar-picker-item mx-auto max-w-md">
              <div className="mx-auto aspect-square w-[min(72vw,20rem)] overflow-hidden bg-ink ring-1 ring-white/15" style={{ clipPath: avatarMaskStyle(crop.mask) }}>
                <img src={image.url.split('#')[0]} alt="" draggable={false} className="h-full w-full object-cover will-change-transform" style={{ objectPosition: `${crop.x}% ${crop.y}%`, transform: `scale(${crop.zoom})` }} />
              </div>
              <div className="glass mt-6 space-y-4 rounded-3xl p-4">
                {([
                  ['zoom', 1, 2, 0.05],
                  ['x', 0, 100, 1],
                  ['y', 0, 100, 1],
                ] as const).map(([field, min, max, step]) => (
                  <label key={field} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-xs text-mist">
                    <span>{t.profile.editor.avatarLibrary.cropFields[field]}</span>
                    <input type="range" min={min} max={max} step={step} value={crop[field]} onChange={(event) => setCrop((current) => ({ ...current, [field]: Number(event.target.value) }))} className="accent-glow" />
                  </label>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  {(['circle', 'hexagon'] as const).map((mask) => (
                    <button key={mask} type="button" onClick={() => setCrop((current) => ({ ...current, mask }))} aria-pressed={crop.mask === mask} className={`flex items-center justify-center gap-2 rounded-full py-2 text-xs ${crop.mask === mask ? 'bg-cream text-void' : 'bg-white/5 text-cream/70'}`}>
                      {mask === 'circle' ? <UserRound size={14} /> : <Hexagon size={14} />}
                      {t.profile.editor.avatarLibrary.masks[mask]}
                    </button>
                  ))}
                </div>
              </div>
              <Pressable onClick={() => onPick(avatarUrlWithCrop(image.url, crop))} press={0.96} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3 text-sm font-medium text-void">
                <Check size={16} />
                {t.profile.editor.avatarLibrary.useImage}
              </Pressable>
            </div>
          ) : options === null ? (
            <div className="grid min-h-64 place-items-center"><div className="size-8 animate-spin rounded-full border-2 border-cream/15 border-t-glow" /></div>
          ) : options.length > 0 ? (
            <>
              {error && <p className="mb-4 rounded-2xl bg-gold/10 px-4 py-3 text-xs text-gold">{t.profile.editor.avatarLibrary.partial}</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {options.map((option) => (
                  <button key={option.url} type="button" onClick={() => { setImage(option); setCrop(DEFAULT_AVATAR_CROP) }} className="avatar-picker-item group text-left">
                    <span className="block aspect-square overflow-hidden rounded-2xl bg-cream/5 ring-1 ring-white/10">
                      <img src={option.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    </span>
                    <span className="mt-2 block truncate text-xs text-cream/85">{option.label}</span>
                    <span className="mt-0.5 block text-[9px] tracking-wider text-mist uppercase">{t.profile.editor.avatarLibrary.sources[option.source]}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="grid min-h-64 place-items-center text-center text-sm text-mist">{t.profile.editor.avatarLibrary.noImages}</div>
          )}
        </div>
      </section>
    </div>
  )
}
