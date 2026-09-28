import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { EASE, gsap, useGSAP } from '../../lib/gsap'
import { computeStats } from '../../lib/stats'
import type { ProfileCard } from '../../services/profileApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useGuestCardsStore } from '../../store/useGuestCardsStore'
import { useLibraryStore } from '../../store/useLibraryStore'
import { useProfileStore } from '../../store/useProfileStore'
import { useUiStore } from '../../store/useUiStore'
import { CardZoom } from '../cards/CardZoom'
import { InstallCard } from './InstallCard'
import { ProfileHeader } from './ProfileHeader'
import { ProfileShowcase } from './ProfileShowcase'
import { ProfileStats, type CollectionSummary, type ReadingSummary } from './ProfileStats'
import { ReadingInsights } from './ReadingInsights'

/**
 * Profil : carte d'identité (avatar, pseudo, titre, bio), vitrine 3D de trois
 * cartes, statistiques de collection, de lecture et de boosters. Les
 * paramètres s'ouvrent depuis l'en-tête de l'app (bouton en haut à droite).
 *
 * Compte connecté : le profil vient du serveur, rechargé à chaque visite.
 * Invité (ou profil pas encore chargé) : tout est calculé sur l'appareil.
 */
export function ProfileView() {
  const t = useT()
  const user = useAuthStore((state) => state.user)
  const profile = useProfileStore((state) => state.data)
  const loadProfile = useProfileStore((state) => state.load)
  const entries = useLibraryStore((state) => state.entries)
  const guestPacks = useGuestCardsStore((state) => state.receipts.length)
  const { data: album } = useCollection()
  const openProfileEditor = useUiStore((state) => state.openProfileEditor)
  const openAuth = useUiStore((state) => state.openAuth)
  const openActivity = useUiStore((state) => state.openActivity)
  const [zoomed, setZoomed] = useState<ProfileCard | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const signedIn = user !== null
  // Profil d'un autre compte (changement en cours) : ignoré.
  const own = user && profile?.profile.id === user.id ? profile : null

  useEffect(() => {
    if (signedIn) void loadProfile()
  }, [signedIn, loadProfile])

  const local = useMemo(() => computeStats(entries), [entries])

  const memberSince = useMemo(() => {
    const since = user
      ? (own?.profile.createdAt ?? user.createdAt)
      : Math.min(...Object.values(entries).map((entry) => entry.addedAt))
    if (!Number.isFinite(since)) return null
    return new Intl.DateTimeFormat(t.locale, { month: 'long', year: 'numeric' }).format(new Date(since))
  }, [user, own?.profile.createdAt, entries, t.locale])

  const name = own?.profile.displayName ?? user?.displayName ?? user?.email.split('@')[0] ?? t.profile.guestName

  const collection: CollectionSummary | null = own
    ? own.stats.collection
    : album
      ? {
          owned: album.owned,
          total: album.total,
          copies: album.cards.reduce((sum, card) => sum + card.count, 0),
          byRarity: album.byRarity,
        }
      : null

  const reading: ReadingSummary = own
    ? {
        consulted: own.stats.reading.consulted,
        finished: own.stats.reading.read + own.stats.reading.novelsFinished,
        chaptersRead: own.stats.reading.chaptersRead,
        novels: own.stats.reading.novels,
        completion: own.stats.reading.completion,
      }
    : {
        consulted: local.byStatus.reading + local.byStatus.read,
        finished: local.byStatus.read,
        chaptersRead: null,
        novels: null,
        completion:
          local.byStatus.reading + local.byStatus.read > 0
            ? local.byStatus.read / (local.byStatus.reading + local.byStatus.read)
            : 0,
      }

  const boostersOpened = own ? own.stats.gacha.boostersOpened : signedIn ? null : guestPacks

  useGSAP(
    () => {
      gsap.from('[data-anim]', {
        y: 26,
        autoAlpha: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: EASE.swift,
        clearProps: 'opacity,visibility,transform',
      })
    },
    { scope: rootRef },
  )

  return (
    <div ref={rootRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
      <div className="space-y-3 md:grid md:grid-cols-5 md:items-start md:gap-4 md:space-y-0">
        <div className="md:col-span-2">
          <ProfileHeader
            name={name}
            avatar={own?.profile.avatar ?? null}
            avatarUrl={own?.profile.avatarUrl ?? null}
            title={own?.profile.activeTitle ?? null}
            bio={own?.profile.bio ?? null}
            memberSince={memberSince}
            signedIn={signedIn}
            onEdit={openProfileEditor}
            onSignIn={openAuth}
          />
        </div>

        <div className="md:col-span-3">
          <ProfileShowcase
            cards={own?.profile.featured ?? []}
            signedIn={signedIn}
            onAddCard={signedIn ? openProfileEditor : openAuth}
            onOpenCard={setZoomed}
          />
        </div>

        <div className="md:col-span-5">
          <ProfileStats
            collection={collection}
            reading={reading}
            boostersOpened={boostersOpened}
            onOpenCollection={() => openActivity('collection')}
          />
        </div>

        <div className="md:col-span-5">
          <ReadingInsights stats={local} />
        </div>

        <div className="md:col-span-5">
          <InstallCard />
        </div>
      </div>

      {zoomed && createPortal(<CardZoom card={zoomed} onClose={() => setZoomed(null)} />, document.body)}
    </div>
  )
}
