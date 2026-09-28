import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, ChevronRight, Hexagon, Search, Upload, UserRound, X } from 'lucide-react'
import { useLanguage, useT } from '../../i18n'
import { avatarMaskStyle, avatarUrlWithCrop, DEFAULT_AVATAR_CROP, type AvatarCrop } from '../../lib/avatarCrop'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { browse, DEFAULT_FILTERS } from '../../services/browse'
import { profileApi, type AvatarOption } from '../../services/profileApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useNovelStore } from '../../store/useNovelStore'
import { Pressable } from '../ui/Pressable'

interface AvatarWork {
  key: string
  kind: 'library' | 'book' | 'catalog'
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
  const language = useLanguage()
  const user = useAuthStore((state) => state.user)
  const entries = useLibraryStore((state) => state.entries)
  const novels = useNovelStore((state) => state.books)
  const refreshNovels = useNovelStore((state) => state.refresh)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const randomPageRef = useRef<number | null>(null)
  const [query, setQuery] = useState('')
  const [work, setWork] = useState<AvatarWork | null>(null)
  const [options, setOptions] = useState<AvatarOption[] | null>(null)
  const [image, setImage] = useState<AvatarOption | null>(null)
  const [crop, setCrop] = useState<AvatarCrop>(DEFAULT_AVATAR_CROP)
  const [error, setError] = useState(false)
  const [catalogWorks, setCatalogWorks] = useState<AvatarWork[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)

  useEffect(() => {
    if (user && novels === null) void refreshNovels(user.id)
  }, [user, novels, refreshNovels])

  const libraryWorks = useMemo<AvatarWork[]>(() => {
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

  const filteredLibrary = useMemo(() => {
    const needle = normalize(query)
    return needle ? libraryWorks.filter((item) => normalize(`${item.title} ${item.subtitle}`).includes(needle)) : libraryWorks
  }, [query, libraryWorks])

  useEffect(() => {
    const controller = new AbortController()
    if (randomPageRef.current === null) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
      randomPageRef.current = 1 + (random % 100)
    }
    const timer = window.setTimeout(() => {
      setCatalogLoading(true)
      void browse(
        { ...DEFAULT_FILTERS, query, sort: 'relevance' },
        { language, page: query.trim() ? 1 : randomPageRef.current ?? 1, limit: 30, signal: controller.signal },
      ).then(({ books }) => {
        const ownedIds = new Set(libraryWorks.map((item) => item.id))
        setCatalogWorks(books
          .filter((book) => !ownedIds.has(book.id))
          .map((book) => ({
            key: `catalog:${book.id}`,
            kind: 'catalog' as const,
            id: book.id,
            title: book.title,
            subtitle: book.authors.join(', '),
            cover: book.cover,
          })))
        setCatalogLoading(false)
      }).catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setCatalogWorks([])
        setCatalogLoading(false)
      })
    }, query.trim() ? 300 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [language, libraryWorks, query])

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
    { dependencies: [work, image, filteredLibrary.length, catalogWorks.length], scope: rootRef },
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

  const chooseWork = useCallback(async (selected: AvatarWork) => {
    setWork(selected)
    setOptions(null)
    setError(false)
    try {
      const response = await profileApi.avatarOptions(selected.kind, selected.id)
      setOptions(response.options)
    } catch {
      setError(true)
      setOptions([])
    }
  }, [])

  const back = () => {
    if (image) {
      setImage(null)
      setCrop(DEFAULT_AVATAR_CROP)
      if (work?.key === 'upload') setWork(null)
    } else {
      setWork(null)
      setOptions(null)
    }
  }

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || uploading) return
    setUploadError(false)
    setUploading(true)
    try {
      const avatarUrl = await profileApi.uploadAvatar(file)
      setWork({ key: 'upload', kind: 'book', id: 'upload', title: t.profile.editor.avatarLibrary.uploadPhoto, subtitle: '', cover: null })
      setImage({ url: avatarUrl, label: file.name, source: 'upload' })
      setCrop(DEFAULT_AVATAR_CROP)
    } catch {
      setUploadError(true)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void uploadPhoto(event.target.files?.[0])}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-full bg-cream py-3 text-sm font-medium text-void disabled:opacity-60"
              >
                <Upload size={16} />
                {uploading ? t.profile.editor.avatarLibrary.uploading : t.profile.editor.avatarLibrary.uploadPhoto}
              </button>
              {uploadError && <p role="alert" className="mb-4 text-center text-xs text-nope">{t.profile.editor.avatarLibrary.uploadError}</p>}
              <label className="glass flex items-center gap-2 rounded-full px-4 py-2.5">
                <Search size={15} className="shrink-0 text-mist" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.profile.editor.avatarLibrary.search} autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-mist/60" />
              </label>
              {([
                { label: t.profile.editor.avatarLibrary.librarySection, items: filteredLibrary },
                { label: query.trim() ? t.profile.editor.avatarLibrary.resultsSection : t.profile.editor.avatarLibrary.discoverSection, items: catalogWorks },
              ] as const).map((section) => section.items.length > 0 && (
                <section key={section.label} className="mt-5">
                  <h3 className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">{section.label}</h3>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                    {section.items.map((item) => (
                      <button key={item.key} type="button" onClick={() => void chooseWork(item)} className="avatar-picker-item group min-w-0 text-left">
                        <span className="relative block aspect-2/3 overflow-hidden rounded-xl bg-cream/5 ring-1 ring-white/10">
                          {item.cover ? <img src={item.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" /> : <span className="grid h-full place-items-center text-mist"><BookOpen size={24} /></span>}
                          <span className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1 rounded-full bg-void/85 px-2.5 py-1.5 text-[9px] font-medium text-cream backdrop-blur-sm">
                            <span className="truncate">{t.profile.editor.avatarLibrary.openCharacters}</span>
                            <ChevronRight size={12} className="shrink-0" />
                          </span>
                        </span>
                        <span className="mt-2 block truncate text-xs font-medium text-cream/90">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-mist">{item.subtitle}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {catalogLoading && <div className="grid min-h-28 place-items-center"><div className="size-7 animate-spin rounded-full border-2 border-cream/15 border-t-glow" /></div>}
              {!catalogLoading && filteredLibrary.length === 0 && catalogWorks.length === 0 && (
                <div className="grid min-h-56 place-items-center text-center text-sm text-mist">{t.profile.editor.avatarLibrary.noMatch}</div>
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
                      <img src={option.url} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${option.source === 'character' || option.source === 'card' || option.source === 'upload' ? 'object-top' : ''}`} />
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
