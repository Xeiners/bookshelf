import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Download,
  Eye,
  Globe,
  Link2,
  HardDrive,
  KeyRound,
  LogOut,
  Minus,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { formatBytes } from '../../lib/format'
import { vibrate } from '../../lib/haptics'
import { clearLocalCache, deviceUsage } from '../../lib/localCache'
import { downloadsBytes, removeAllDownloads, removeDownload } from '../../lib/reader/downloads'
import { profileLink } from '../../lib/profileLink'
import { profileApi, type BooksStorage } from '../../services/profileApi'
import { useAmbientStore } from '../../store/useAmbientStore'
import { useAuthStore, usePendingSync } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useNovelStore } from '../../store/useNovelStore'
import { useDownloadStore, type DownloadedChapter } from '../../store/useDownloadStore'
import { useProfileStore } from '../../store/useProfileStore'
import { TEXT_LIMITS, useReaderStore } from '../../store/useReaderStore'
import { useUiStore } from '../../store/useUiStore'
import type { ReaderLayout, TextTheme } from '../../types/reader'
import { Pressable } from '../ui/Pressable'
import { Sheet } from '../ui/Sheet'
import { ResetConfirmDialog } from './ResetConfirmDialog'

/** Champ de saisie (mêmes classes que la feuille de connexion). */
const fieldClass =
  'glass w-full rounded-2xl px-4 py-3 text-sm text-cream placeholder:text-mist/60 focus:ring-2 focus:ring-glow/60 focus:outline-none' // i18n-ignore : classes CSS

function Section({ icon: Icon, title, children }: { icon: typeof UserRound; title: string; children: ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] text-mist uppercase">
        <Icon size={13} className="text-glow" />
        {title}
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

interface SegmentedProps<V extends string> {
  label: string
  value: V
  options: { value: V; label: string }[]
  onChange: (value: V) => void
}

/** Choix exclusif compact (thème, mode de lecture). */
function Segmented<V extends string>({ label, value, options, onChange }: SegmentedProps<V>) {
  return (
    <div>
      <p className="text-xs text-cream/85">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-2 flex gap-1 rounded-2xl bg-cream/5 p-1">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`min-w-0 flex-1 truncate rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                active ? 'bg-cream text-void' : 'text-cream/70'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Barre d'occupation (octets utilisés sur un quota). */
function UsageBar({ ratio }: { ratio: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream/10">
      <div
        className="h-full origin-left rounded-full bg-linear-to-r from-glow to-like transition-transform duration-700"
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, ratio))})` }}
      />
    </div>
  )
}

/* ---- Compte ------------------------------------------------------------------ */

function PasswordForm() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (next.length < 8) return setError(t.errors.passwordTooShort)
    if (next !== confirm) return setError(t.settings.account.mismatch)
    setBusy(true)
    setError(null)
    try {
      await profileApi.changePassword({ currentPassword: current, newPassword: next })
      vibrate(10)
      notify(t.settings.account.passwordChanged, 'like')
      reset()
    } catch (reason) {
      setError(apiErrorMessage(reason, t))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs text-cream/85"
      >
        <KeyRound size={14} />
        {t.settings.account.changePassword}
      </button>
    )
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2.5">
      <input
        type="password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        autoComplete="current-password"
        placeholder={t.settings.account.currentPassword}
        aria-label={t.settings.account.currentPassword}
        required
        className={fieldClass}
      />
      <input
        type="password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        autoComplete="new-password"
        placeholder={t.settings.account.newPassword}
        aria-label={t.settings.account.newPassword}
        minLength={8}
        required
        className={fieldClass}
      />
      <input
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        placeholder={t.settings.account.confirmPassword}
        aria-label={t.settings.account.confirmPassword}
        required
        className={fieldClass}
      />
      {error && (
        <p role="alert" className="text-center text-xs text-nope">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={reset} className="glass flex-1 rounded-full py-2.5 text-xs text-cream/70">
          {t.settings.account.cancel}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-[2] rounded-full bg-cream py-2.5 text-xs font-medium text-void disabled:opacity-50"
        >
          {busy ? t.settings.account.savingPassword : t.settings.account.submitPassword}
        </button>
      </div>
    </form>
  )
}

function AccountSection({ onConvert }: { onConvert: () => void }) {
  const t = useT()
  const user = useAuthStore((state) => state.user)

  return (
    <Section icon={UserRound} title={t.settings.account.title}>
      {user ? (
        <>
          <div>
            <p className="text-[11px] text-mist">{t.settings.account.email}</p>
            <p className="mt-0.5 truncate text-sm text-cream">{user.email}</p>
          </div>
          <PasswordForm />
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-mist">{t.settings.account.guestBody}</p>
          <Pressable
            onClick={() => {
              vibrate(8)
              onConvert()
            }}
            press={0.96}
            className="w-full rounded-full bg-cream py-3 text-xs font-medium text-void"
          >
            {t.settings.account.convert}
          </Pressable>
        </>
      )}
    </Section>
  )
}

/* ---- Lecture ------------------------------------------------------------------ */

const THEMES = ['dark', 'black', 'sepia', 'light'] as const satisfies readonly TextTheme[]

function ReadingSection() {
  const t = useT()
  const text = useReaderStore((state) => state.text)
  const setText = useReaderStore((state) => state.setText)
  const layout = useReaderStore((state) => state.defaultLayout)
  const setDefaultLayout = useReaderStore((state) => state.setDefaultLayout)
  const ambientAuto = useAmbientStore((state) => state.autoPlay)
  const setAmbientAuto = useAmbientStore((state) => state.setAutoPlay)
  const { min, max, step } = TEXT_LIMITS.fontSize
  const themes = t.settings.reading.themes

  return (
    <Section icon={BookOpen} title={t.settings.reading.title}>
      <Segmented<TextTheme>
        label={t.settings.reading.theme}
        value={text.theme}
        options={THEMES.map((theme) => ({ value: theme, label: themes[theme] }))}
        onChange={(theme) => setText({ theme })}
      />

      <div>
        <p className="text-xs text-cream/85">{t.settings.reading.fontSize}</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setText({ fontSize: text.fontSize - step })}
            disabled={text.fontSize <= min}
            aria-label={t.settings.reading.smaller}
            className="glass grid size-10 place-items-center rounded-full text-cream/80 disabled:opacity-30"
          >
            <Minus size={15} />
          </button>
          <span className="flex-1 text-center font-display text-2xl text-cream tabular-nums">{text.fontSize} %</span>
          <button
            type="button"
            onClick={() => setText({ fontSize: text.fontSize + step })}
            disabled={text.fontSize >= max}
            aria-label={t.settings.reading.larger}
            className="glass grid size-10 place-items-center rounded-full text-cream/80 disabled:opacity-30"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div>
        <Segmented<ReaderLayout | 'auto'>
          label={t.settings.reading.mangaLayout}
          value={layout ?? 'auto'}
          options={[
            { value: 'auto', label: t.settings.reading.layouts.auto },
            { value: 'paged', label: t.settings.reading.layouts.paged },
            { value: 'webtoon', label: t.settings.reading.layouts.webtoon },
          ]}
          onChange={(value) => setDefaultLayout(value === 'auto' ? null : value)}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-mist">{t.settings.reading.layoutHint}</p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-cream/85">
          {t.settings.reading.ambientAuto}
          <input
            type="checkbox"
            checked={ambientAuto}
            onChange={(event) => setAmbientAuto(event.target.checked)}
            className="size-4 shrink-0 accent-glow"
          />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-mist">{t.settings.reading.ambientAutoHint}</p>
      </div>
    </Section>
  )
}

/* ---- Profil public ------------------------------------------------------------- */

function PublicProfileSection({ userId }: { userId: string }) {
  const t = useT()
  const copy = t.settings.publicProfile
  const profile = useProfileStore((state) => state.data)
  const loadProfile = useProfileStore((state) => state.load)
  const updateProfile = useProfileStore((state) => state.update)
  const openPublicProfile = useUiStore((state) => state.openPublicProfile)
  const notify = useUiStore((state) => state.notify)
  const [saving, setSaving] = useState(false)
  // Profil d'un autre compte (changement de session en cours) : ignoré.
  const own = profile?.profile.id === userId ? profile.profile : null

  useEffect(() => {
    if (!own) void loadProfile()
  }, [own, loadProfile])

  const toggle = async (isProfilePublic: boolean) => {
    setSaving(true)
    try {
      await updateProfile({ isProfilePublic })
      vibrate(8)
    } catch {
      notify(copy.saveError, 'nope')
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileLink(userId, window.location.origin, window.location.pathname))
      vibrate(6)
      notify(t.publicProfile.linkCopied, 'like')
    } catch {
      // Presse-papiers refusé : le bouton « Voir » propose aussi le partage.
    }
  }

  return (
    <Section icon={Globe} title={copy.title}>
      <div>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-cream/85">
          {copy.isPublic}
          <input
            type="checkbox"
            checked={own?.isProfilePublic ?? true}
            disabled={!own || saving}
            onChange={(event) => void toggle(event.target.checked)}
            className="size-4 shrink-0 accent-glow disabled:opacity-50"
          />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-mist">{copy.isPublicHint}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => openPublicProfile(userId)}
          className="glass flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-xs text-cream/85"
        >
          <Eye size={14} className="shrink-0" />
          <span className="truncate">{copy.view}</span>
        </button>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="glass flex shrink-0 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs text-cream/85"
        >
          <Link2 size={14} />
          {copy.copyLink}
        </button>
      </div>
    </Section>
  )
}

/* ---- Mes téléchargements (chapitres hors-ligne) ------------------------------------ */

function DownloadsSection() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const chapters = useDownloadStore((state) => state.chapters)
  const [openManga, setOpenManga] = useState<string | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)

  useEffect(() => {
    if (!confirmingAll) return
    const timer = window.setTimeout(() => setConfirmingAll(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmingAll])

  // Par manga (les plus récents en tête), chapitres dans l'ordre.
  const groups = new Map<string, DownloadedChapter[]>()
  for (const entry of Object.values(chapters)) groups.set(entry.manga.id, [...(groups.get(entry.manga.id) ?? []), entry])
  const value = (entry: DownloadedChapter) => (entry.number === null ? -1 : Number.parseFloat(entry.number))
  const mangas = [...groups.values()]
    .map((list) => list.sort((a, b) => value(a) - value(b)))
    .sort((a, b) => Math.max(...b.map((entry) => entry.queuedAt)) - Math.max(...a.map((entry) => entry.queuedAt)))
  const label = (entry: DownloadedChapter) => (entry.number ? t.reader.chapter(entry.number) : (entry.title ?? t.reader.oneshot))

  return (
    <Section icon={Download} title={t.downloads.title}>
      {mangas.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-mist">{t.downloads.none}</p>
      ) : (
        <>
          <p className="text-xs text-cream/85 tabular-nums">{t.downloads.used(formatBytes(downloadsBytes(chapters), t.locale))}</p>
          <ul className="flex flex-col gap-1.5">
            {mangas.map((list) => {
              const manga = list[0]?.manga
              if (!manga) return null
              const expanded = openManga === manga.id
              const pending = list.some((entry) => entry.status === 'queued' || entry.status === 'downloading')
              return (
                <li key={manga.id} className="rounded-2xl bg-cream/[0.04]">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpenManga(expanded ? null : manga.id)}
                    className="flex w-full items-center gap-3 p-2.5 text-left"
                  >
                    {manga.cover ? (
                      <img src={manga.cover} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-md bg-ink object-cover" />
                    ) : (
                      <span className="h-12 w-8 shrink-0 rounded-md bg-ink" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-cream">{manga.title}</span>
                      <span className="block text-[11px] text-mist tabular-nums">
                        {t.downloads.chapters(list.length)} · {formatBytes(list.reduce((sum, entry) => sum + entry.bytes, 0), t.locale)}
                        {pending && ` · ${t.downloads.pending}`}
                      </span>
                    </span>
                    <ChevronDown size={16} aria-hidden className={`shrink-0 text-mist transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    <ul className="px-2.5 pb-2">
                      {list.map((entry) => (
                        <li key={entry.chapterId} className="flex items-center gap-2 py-1">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-cream/85">{label(entry)}</span>
                            <span className={`block text-[10px] tabular-nums ${entry.status === 'error' ? 'text-gold' : 'text-mist'}`}>
                              {entry.status === 'done'
                                ? formatBytes(entry.bytes, t.locale)
                                : entry.status === 'error'
                                  ? t.downloads.errors[entry.error ?? 'network']
                                  : entry.status === 'queued' || entry.pages.length === 0
                                    ? t.downloads.queued
                                    : t.downloads.progress(Math.round((entry.done / entry.pages.length) * 100))}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              vibrate(8)
                              void removeDownload(entry.chapterId)
                            }}
                            aria-label={t.downloads.remove(label(entry))}
                            className="grid size-8 shrink-0 place-items-center rounded-full text-cream/50 transition-colors hover:bg-nope/15 hover:text-nope"
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              if (!confirmingAll) {
                setConfirmingAll(true)
                return
              }
              setConfirmingAll(false)
              vibrate(12)
              void removeAllDownloads().then(() => notify(t.downloads.removedAll, 'neutral'))
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs ${confirmingAll ? 'bg-nope/15 text-nope' : 'glass text-cream/85'}`}
          >
            <Trash2 size={13} aria-hidden />
            {confirmingAll ? t.downloads.removeAllConfirm : t.downloads.removeAll}
          </button>
        </>
      )}
    </Section>
  )
}

/* ---- Stockage & synchronisation -------------------------------------------------- */

function StorageSection() {
  const t = useT()
  const user = useAuthStore((state) => state.user)
  const offline = useAuthStore((state) => state.offline)
  const pending = usePendingSync()
  const hasLibrary = useLibraryStore((state) => Object.keys(state.entries).length > 0)
  const resetAll = useLibraryStore((state) => state.resetAll)
  const notify = useUiStore((state) => state.notify)

  const [books, setBooks] = useState<BooksStorage | null>(null)
  const [device, setDevice] = useState<number | null | undefined>(undefined)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    profileApi
      .booksStorage(controller.signal)
      .then(setBooks)
      .catch(() => {})
    return () => controller.abort()
  }, [user])

  useEffect(() => {
    let active = true
    void deviceUsage().then((usage) => active && setDevice(usage))
    return () => {
      active = false
    }
  }, [])

  const clear = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setClearing(true)
    await clearLocalCache()
    // Les romans restent listés, mais plus téléchargés sur l'appareil.
    useNovelStore.setState((state) => ({ books: state.books?.map((entry) => ({ ...entry, downloaded: false })) ?? null }))
    setDevice(await deviceUsage())
    setClearing(false)
    setConfirmingClear(false)
    vibrate(10)
    notify(t.settings.storage.cleared, 'neutral')
  }

  const sync = offline
    ? { icon: CloudOff, label: t.account.offline, tone: 'text-gold' }
    : pending > 0
      ? { icon: CloudUpload, label: t.account.pending(pending), tone: 'text-gold' }
      : { icon: CloudCheck, label: t.account.synced, tone: 'text-like' }
  const SyncIcon = sync.icon

  return (
    <Section icon={HardDrive} title={t.settings.storage.title}>
      {user && (
        <p className={`flex items-center gap-1.5 text-[11px] ${sync.tone}`}>
          <SyncIcon size={14} className="shrink-0" />
          <span className="truncate">{sync.label}</span>
        </p>
      )}

      {user && books && (
        <div>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-cream/85">{t.settings.storage.novels}</span>
            <span className="shrink-0 text-mist">{t.settings.storage.novelsCount(books.count)}</span>
          </div>
          <UsageBar ratio={books.quotaBytes > 0 ? books.usedBytes / books.quotaBytes : 0} />
          <p className="mt-1.5 text-[10px] text-mist tabular-nums">
            {t.settings.storage.usage(formatBytes(books.usedBytes, t.locale), formatBytes(books.quotaBytes, t.locale))}
          </p>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-cream/85">{t.settings.storage.device}</span>
          <span className="shrink-0 text-mist tabular-nums">
            {device === undefined ? '…' : device === null ? t.settings.storage.deviceUnknown : formatBytes(device, t.locale)}
          </span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-mist">{t.settings.storage.clearHint}</p>
        <button
          type="button"
          onClick={() => void clear()}
          disabled={clearing}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs disabled:opacity-50 ${
            confirmingClear ? 'bg-nope/15 text-nope' : 'glass text-cream/85'
          }`}
        >
          <Trash2 size={13} />
          {clearing
            ? t.settings.storage.clearing
            : confirmingClear
              ? t.settings.storage.clearConfirm
              : t.settings.storage.clearCache}
        </button>
      </div>

      {hasLibrary && (
        <button
          type="button"
          onClick={() => setConfirmingReset(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-[11px] text-nope/80"
        >
          <Power size={12} />
          {t.profile.reset}
        </button>
      )}
      {confirmingReset && (
        <ResetConfirmDialog
          onClose={() => setConfirmingReset(false)}
          onConfirm={() => {
            setConfirmingReset(false)
            resetAll()
            notify(t.profile.resetDone, 'nope')
          }}
        />
      )}
    </Section>
  )
}

/* ---- Session -------------------------------------------------------------------- */

function SessionSection({ onDone }: { onDone: () => void }) {
  const t = useT()
  const logout = useAuthStore((state) => state.logout)
  const notify = useUiStore((state) => state.notify)
  const pending = usePendingSync()
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const onLogout = async () => {
    // Des actions non envoyées seraient perdues : on demande confirmation.
    if (pending > 0 && !confirming) {
      setConfirming(true)
      return
    }
    setLeaving(true)
    await logout()
    notify(t.account.loggedOut, 'neutral')
    onDone()
  }

  return (
    <Section icon={LogOut} title={t.settings.session.title}>
      <Pressable
        onClick={() => void onLogout()}
        disabled={leaving}
        press={0.96}
        className={`flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-medium disabled:opacity-50 ${
          confirming ? 'bg-nope text-void' : 'bg-nope/15 text-nope'
        }`}
      >
        <LogOut size={14} />
        {confirming ? t.account.logoutConfirm : t.account.logout}
      </Pressable>
    </Section>
  )
}

/**
 * Paramètres, ouverts depuis le bouton en haut à droite du Profil : compte
 * (e-mail, mot de passe, passage invité → compte), préférences de lecture,
 * stockage et synchronisation, session.
 */
/** Comptes de `ADMIN_EMAILS` seulement : l'entrée vers l'administration. */
function AdminSection() {
  const t = useT()
  const openAdmin = useUiStore((state) => state.openAdmin)
  return (
    <Section icon={ShieldCheck} title={t.settings.admin.title}>
      <button
        type="button"
        onClick={() => {
          vibrate(6)
          openAdmin()
        }}
        className="flex w-full items-center gap-3 rounded-2xl border border-gold/30 bg-gold/[0.07] p-3 text-left"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/40 text-gold">
          <ShieldCheck size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-cream">{t.settings.admin.open}</span>
          <span className="block text-xs text-mist">{t.settings.admin.hint}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-cream/40" aria-hidden />
      </button>
    </Section>
  )
}

export function SettingsSheet() {
  const t = useT()
  const close = useUiStore((state) => state.closeSettings)
  const openAuth = useUiStore((state) => state.openAuth)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const isAdmin = useAuthStore((state) => state.user?.isAdmin === true)
  const signedIn = userId !== null

  return (
    <Sheet label={t.settings.title} title={t.settings.title} subtitle={t.settings.subtitle} onClose={close}>
      {(dismiss) => (
        <div className="space-y-3 pt-1">
          <AccountSection
            onConvert={() => {
              // La feuille de connexion prend la place : pas de double modale.
              close()
              openAuth()
            }}
          />
          <ReadingSection />
          {userId && <PublicProfileSection userId={userId} />}
          <StorageSection />
          <DownloadsSection />
          {isAdmin && <AdminSection />}
          {signedIn && <SessionSection onDone={dismiss} />}
        </div>
      )}
    </Sheet>
  )
}
