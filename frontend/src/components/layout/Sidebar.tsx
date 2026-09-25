import { useMemo, useRef } from 'react'
import { CloudCheck, CloudOff, CloudUpload, Library, PanelLeftClose, PanelLeftOpen, UserRound, Zap } from 'lucide-react'
import { useOracleStatus } from '../../hooks/useOracleStatus'
import { useLanguage, useT } from '../../i18n'
import { BRAND } from '../../lib/brand'
import { gsap, useGSAP } from '../../lib/gsap'
import { vibrate } from '../../lib/haptics'
import { commandKey } from '../../lib/platform'
import { useAuthStore, usePendingSync } from '../../store/useAuthStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUiStore, type ViewId } from '../../store/useUiStore'
import type { LibraryEntry, LibraryTab } from '../../types/book'
import { FAVORITE_TOKEN, STATUS_TOKEN } from '../../types/book'
import { BookCover } from '../ui/BookCover'
import { LanguageToggle } from '../ui/LanguageToggle'
import { NAV_ITEMS } from './navItems'

const EXPANDED_WIDTH = 264
const COLLAPSED_WIDTH = 80
/** Hauteur d'une entrée de navigation + espacement : pilote la capsule active. */
const ITEM_HEIGHT = 44
const ITEM_GAP = 4

/** Ordre des raccourcis de la bibliothèque dans la barre : du souhait à la fin. */
const LIBRARY_LINKS: LibraryTab[] = ['wishlist', 'reading', 'read', 'favorites']

const lastTouched = (entry: LibraryEntry) => entry.updatedAt ?? entry.addedAt

interface SidebarProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

/**
 * Barre latérale d'ordinateur (≥ lg). Navigation, accès direct aux onglets de
 * la bibliothèque, lecture en cours, langue et compte — tout ce qui sert
 * souvent, à portée de clic. Repliable en rail d'icônes (Ctrl/⌘ B), et le choix
 * est mémorisé.
 *
 * Le téléphone garde sa barre basse et la tablette son rail : ce composant
 * n'est rendu qu'à partir de \`lg\`.
 */
export function Sidebar({ view, onChange }: SidebarProps) {
  const t = useT()
  const language = useLanguage()
  const collapsed = useSettingsStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar)
  const setLanguage = useSettingsStore((state) => state.setLanguage)

  const libraryTab = useUiStore((state) => state.libraryTab)
  const openLibrary = useUiStore((state) => state.openLibrary)
  const openDetail = useUiStore((state) => state.openDetail)
  const openAuth = useUiStore((state) => state.openAuth)
  const focusSearch = useUiStore((state) => state.focusSearch)

  const user = useAuthStore((state) => state.user)
  const offline = useAuthStore((state) => state.offline)
  const pending = usePendingSync()
  const oracle = useOracleStatus()

  const entries = useLibraryStore((state) => state.entries)
  const { counts, total, current } = useMemo(() => {
    const list = Object.values(entries)
    const tally: Record<LibraryTab, number> = { read: 0, reading: 0, wishlist: 0, favorites: 0 }
    let latest: LibraryEntry | null = null
    for (const entry of list) {
      tally[entry.status] += 1
      if (entry.favorite) tally.favorites += 1
      if (entry.status === 'reading' && (!latest || lastTouched(entry) > lastTouched(latest))) latest = entry
    }
    return { counts: tally, total: list.length, current: latest }
  }, [entries])

  const panelRef = useRef<HTMLDivElement>(null)
  const firstRun = useRef(true)

  // Capsule de l'entrée active.
  useGSAP(
    () => {
      const index = NAV_ITEMS.findIndex((item) => item.id === view)
      gsap.to('[data-sidebar-indicator]', {
        y: index * (ITEM_HEIGHT + ITEM_GAP),
        duration: firstRun.current ? 0 : 0.45,
        ease: 'power3.out',
        overwrite: 'auto',
      })
      gsap.fromTo(`[data-sidebar-icon="${view}"]`, { scale: 0.84 }, { scale: 1, duration: 0.45, ease: 'back.out(2)' })
    },
    { dependencies: [view], scope: panelRef },
  )

  // Repli / dépli : largeur du panneau, fondu des libellés. Premier rendu instantané.
  useGSAP(
    () => {
      const duration = firstRun.current ? 0 : 0.45
      firstRun.current = false
      gsap.to(panelRef.current, {
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        duration,
        ease: 'power3.inOut',
      })
      gsap.to('[data-sidebar-fade]', {
        autoAlpha: collapsed ? 0 : 1,
        duration: duration && 0.2,
        delay: collapsed || !duration ? 0 : 0.22,
      })
      gsap.to('[data-sidebar-compact]', {
        autoAlpha: collapsed ? 1 : 0,
        duration: duration && 0.2,
        delay: collapsed && duration ? 0.22 : 0,
      })
    },
    { dependencies: [collapsed], scope: panelRef },
  )

  const go = (target: ViewId) => {
    if (target === view) return
    vibrate(6)
    onChange(target)
  }

  const SyncIcon = offline ? CloudOff : pending > 0 ? CloudUpload : CloudCheck
  const syncLabel = offline ? t.account.offline : pending > 0 ? t.account.pending(pending) : t.account.synced
  const name = user ? (user.displayName ?? user.email.split('@')[0]) : t.account.guestTitle

  return (
    <aside className="hidden h-full shrink-0 py-4 pl-4 lg:flex">
      <div
        ref={panelRef}
        className="glass-strong relative flex h-full flex-col rounded-[1.75rem] shadow-lift"
        style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      >
        {/* Repli : pastille accrochée au bord du panneau */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? t.sidebar.expand : t.sidebar.collapse}
          title={`${collapsed ? t.sidebar.expand : t.sidebar.collapse} · ${commandKey('B')}`}
          aria-expanded={!collapsed}
          className="glass absolute top-7 -right-3.5 z-20 grid size-7 place-items-center rounded-full text-cream/70 shadow-lift transition-colors hover:text-cream"
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-5 pb-3">
          {/* Marque */}
          <div className="flex h-11 shrink-0 items-center gap-3 px-1.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-glow to-[#b59cff] text-void shadow-glow">
              <Library size={17} strokeWidth={2.2} />
            </span>
            <span data-sidebar-fade className="font-display text-[1.45rem] leading-none whitespace-nowrap text-cream">
              {BRAND}
            </span>
          </div>

          {/* Navigation principale */}
          <nav aria-label={t.nav.label} className="relative mt-7 flex shrink-0 flex-col" style={{ gap: ITEM_GAP }}>
            <span
              data-sidebar-indicator
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 rounded-2xl bg-cream will-change-transform"
              style={{ height: ITEM_HEIGHT }}
            />
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon
              const active = item.id === view
              const shortcut = item.id === 'search' ? commandKey('K') : String(index + 1)
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  title={`${t.nav[item.id]} · ${t.sidebar.shortcut(shortcut)}`}
                  onClick={() => (item.id === 'search' && !active ? focusSearch() : go(item.id))}
                  className={`group relative z-10 flex items-center gap-3 rounded-2xl px-3 transition-colors duration-300 ${
                    active ? 'text-void' : 'text-mist hover:bg-cream/[0.05] hover:text-cream'
                  }`}
                  style={{ height: ITEM_HEIGHT }}
                >
                  <span data-sidebar-icon={item.id} className="relative grid w-5 shrink-0 place-items-center">
                    <Icon size={19} strokeWidth={2} />
                    {item.id === 'oracle' && oracle.available && (
                      <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-gold shadow-[0_0_8px_var(--color-gold)]" />
                    )}
                  </span>
                  <span data-sidebar-fade className="flex-1 truncate text-left text-[13px] font-medium">
                    {t.nav[item.id]}
                  </span>
                  <span data-sidebar-fade className="flex items-center gap-1.5">
                    {item.id === 'oracle' && oracle.streak > 0 && (
                      <span
                        title={t.oracle.streak(oracle.streak)}
                        className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          active ? 'bg-void/10 text-void' : 'bg-gold/12 text-gold'
                        }`}
                      >
                        <Zap size={10} className={active ? 'fill-void' : 'fill-gold'} />
                        {oracle.streak}
                      </span>
                    )}
                    {item.id === 'library' && total > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                          active ? 'bg-void/10 text-void' : 'bg-cream/[0.07] text-cream/70'
                        }`}
                      >
                        {total}
                      </span>
                    )}
                    <kbd
                      className={`rounded-md border px-1.5 py-px font-sans text-[10px] opacity-0 transition-opacity group-hover:opacity-100 ${
                        active ? 'border-void/15 text-void/60' : 'border-white/10 text-mist'
                      }`}
                    >
                      {shortcut}
                    </kbd>
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Accès direct aux onglets de la bibliothèque */}
          <p data-sidebar-fade className="mt-7 mb-2 px-3 text-[10px] tracking-[0.22em] whitespace-nowrap text-mist/70 uppercase">
            {t.sidebar.library}
          </p>
          <div className="flex shrink-0 flex-col gap-0.5">
            {LIBRARY_LINKS.map((status) => {
              const active = view === 'library' && libraryTab === status
              const token = status === 'favorites' ? FAVORITE_TOKEN : STATUS_TOKEN[status]
              const label = status === 'favorites' ? t.library.favorites : t.status[status]
              return (
                <button
                  key={status}
                  type="button"
                  title={label}
                  onClick={() => {
                    vibrate(6)
                    openLibrary(status)
                  }}
                  className={`flex h-9 items-center gap-3 rounded-xl px-3 text-[12.5px] transition-colors ${
                    active ? 'bg-cream/[0.07] text-cream' : 'text-mist hover:bg-cream/[0.04] hover:text-cream'
                  }`}
                >
                  <span className="grid w-5 shrink-0 place-items-center">
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: token,
                        boxShadow: active ? `0 0 10px ${token}` : undefined,
                      }}
                    />
                  </span>
                  <span data-sidebar-fade className="flex-1 truncate text-left">
                    {label}
                  </span>
                  <span data-sidebar-fade className="text-[11px] text-mist/70 tabular-nums">
                    {counts[status]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Lecture en cours : on y retourne en un clic */}
          {current && (
            <>
              <p data-sidebar-fade className="mt-7 mb-2 px-3 text-[10px] tracking-[0.22em] whitespace-nowrap text-mist/70 uppercase">
                {t.sidebar.continueReading}
              </p>
              <button
                type="button"
                title={current.book.title}
                onClick={() => openDetail(current.book)}
                className="flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl p-2 text-left transition-colors hover:bg-cream/[0.05]"
              >
                <span className="relative w-10 shrink-0 overflow-hidden rounded-md shadow-lift ring-1 ring-white/10">
                  <BookCover book={current.book} className="aspect-2/3 w-full" />
                </span>
                <span data-sidebar-fade className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] leading-snug font-medium text-cream">{current.book.title}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-cream/12">
                      <span
                        className="block h-full rounded-full bg-gold"
                        style={{ width: `${Math.max(Math.round(current.progress * 100), 3)}%` }}
                      />
                    </span>
                    <span className="text-[10px] text-gold tabular-nums">
                      {t.library.percent(Math.round(current.progress * 100))}
                    </span>
                  </span>
                </span>
              </button>
            </>
          )}

          <div className="min-h-4 flex-1" />

          {/* Langue : sélecteur complet, ou pastille compacte quand la barre est repliée */}
          <div className="relative mb-3 h-9 shrink-0 px-1.5">
            <div data-sidebar-fade>
              <LanguageToggle />
            </div>
            <button
              data-sidebar-compact
              type="button"
              onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
              title={t.language.label}
              aria-label={t.language.label}
              className="glass invisible absolute top-0 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full text-[11px] font-semibold tracking-[0.1em] text-cream uppercase opacity-0"
            >
              {language}
            </button>
          </div>

          {/* Compte */}
          <button
            type="button"
            title={user ? `${name} · ${syncLabel}` : t.account.cta}
            onClick={() => (user ? go('profile') : openAuth())}
            className="flex h-14 shrink-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/8 px-2 text-left transition-colors hover:bg-cream/[0.05]"
          >
            {user ? (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-glow to-like font-display text-lg text-void">
                {name.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-glow/15 text-glow">
                <UserRound size={16} />
              </span>
            )}
            <span data-sidebar-fade className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-cream">{name}</span>
              {user ? (
                <span className={`flex items-center gap-1 text-[10.5px] ${offline || pending > 0 ? 'text-gold' : 'text-like'}`}>
                  <SyncIcon size={11} className="shrink-0" />
                  <span className="truncate">{syncLabel}</span>
                </span>
              ) : (
                <span className="block truncate text-[10.5px] text-glow">{t.auth.login}</span>
              )}
            </span>
          </button>
        </div>
      </div>
    </aside>
  )
}
