import { useRef } from 'react'
import { ChevronRight, Lock, Swords, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { displayRoomCode } from '../../lib/dle'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { DLE_MODES, type DleCategory, type DleOverview } from '../../services/dleApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { pendingGuestStardust, useGuestStardustStore } from '../../store/useGuestStardustStore'
import { useUiStore } from '../../store/useUiStore'
import { CATEGORY_STYLE, modeLabel } from './dleStyle'
import { ModeIcon } from './ModeIcon'
import { DailyStatus, MenuEntry } from './MenuEntry'
import { StardustBadge } from './StardustBadge'
import { inkText } from '../../lib/ink'

/**
 * Menu d'une catégorie, façon Loldle : son nom, puis les deux énigmes du jour
 * (Classique, Couverture ou Portrait) et le multijoueur. Coche verte quand c'est
 * trouvé, point rose quand ça attend.
 */
export function CategoryMenu({ overview, category }: { overview: DleOverview; category: DleCategory }) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const openDaily = useDleStore((state) => state.openDaily)
  const openMulti = useDleStore((state) => state.openMulti)
  const resumeRoom = useDleStore((state) => state.resumeRoom)
  const notify = useUiStore((state) => state.notify)
  const openAuth = useUiStore((state) => state.openAuth)
  const signedIn = useAuthStore((state) => state.user !== null)
  const guestReceipts = useGuestStardustStore((state) => state.receipts)
  const style = CATEGORY_STYLE[category]

  useGSAP(
    () => {
      gsap.fromTo('[data-logo]', { y: -16, autoAlpha: 0, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: EASE.snap })
    },
    { scope: rootRef, dependencies: [category] },
  )

  return (
    <div ref={rootRef} className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-2">
        <header data-logo className="flex flex-col items-center gap-3">
          <h2 className="font-display text-[2.75rem] leading-none sm:text-5xl" style={inkText(style.gradient)}>
            {t.dle.categories[category].title}
          </h2>
          <StardustBadge balance={signedIn ? overview.stardust : pendingGuestStardust(guestReceipts)} />
        </header>

        <nav className="flex w-full flex-col divide-y divide-white/[0.07]">
          {overview.currentRoom && (
            <MenuEntry
              accent="room"
              icon={<Users size={22} aria-hidden />}
              label={t.dle.home.room(displayRoomCode(overview.currentRoom))}
              trailing={<ChevronRight size={20} aria-hidden />}
              onClick={() => {
                const code = overview.currentRoom
                if (code) resumeRoom(code).catch((error: unknown) => notify(apiErrorMessage(error, t), 'nope'))
              }}
            />
          )}
          {DLE_MODES.map((mode) => {
            return (
              <MenuEntry
                key={mode}
                accent={mode}
                icon={<ModeIcon category={category} mode={mode} size={22} />}
                label={modeLabel(t, category, mode)}
                trailing={
                  signedIn ? (
                    <DailyStatus progress={overview.daily[category][mode]} />
                  ) : (
                    // Sans compte : les énigmes du jour attendent un compte (essais, série, Poussières).
                    <span className="inline-flex items-center gap-1 text-xs text-mist">
                      <Lock size={13} aria-hidden />
                      {t.dle.guest.dailyLocked}
                    </span>
                  )
                }
                onClick={() => (signedIn ? openDaily(mode) : openAuth())}
              />
            )
          })}
          <MenuEntry accent="multi" icon={<Swords size={22} aria-hidden />} label={t.dle.home.multiHeading} trailing={<ChevronRight size={20} aria-hidden />} onClick={openMulti} />
        </nav>
      </div>
    </div>
  )
}
