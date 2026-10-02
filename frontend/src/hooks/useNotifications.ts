import { useEffect } from 'react'
import { vibrate } from '../lib/haptics'
import { targetOf, unreadTrades } from '../lib/notifications'
import { playChime } from '../lib/sfx'
import type { AppNotification } from '../services/notificationsApi'
import { useAuthStore } from '../store/useAuthStore'
import { setArrivalHandler, useNotificationStore } from '../store/useNotificationStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useTradeStore } from '../store/useTradeStore'
import { useUiStore } from '../store/useUiStore'

/** Intervalle du sondage, page visible. Page cachée : rien ne part. */
export const POLL_INTERVAL_MS = 45_000

/**
 * Relève les notifications du compte : au démarrage, toutes les 45 s tant que
 * la page est visible, et aussitôt au retour au premier plan ou du réseau. Un
 * sondage ne rapporte que les nouvelles (`?since=`) : quelques octets.
 * À monter une fois, dans `App`.
 */
export function useNotificationPolling() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)

  useEffect(() => {
    // Arrivée : un carillon et une vibration, seulement si on regarde l'app (et pas en pleine lecture).
    setArrivalHandler((fresh) => {
      if (document.visibilityState !== 'visible' || useUiStore.getState().reader) return
      vibrate([10, 40, 10])
      // Échange conclu ou cadeau : un carillon plus clair qu'une simple alerte.
      if (useSettingsStore.getState().notificationSound) playChime(fresh.some((item) => item.type !== 'trade_match'))
    })
  }, [])

  useEffect(() => {
    if (!accountId) return
    const store = useNotificationStore.getState()
    void store.load()

    let timer = 0
    const schedule = () => {
      window.clearInterval(timer)
      if (document.visibilityState === 'visible') timer = window.setInterval(() => void useNotificationStore.getState().poll(), POLL_INTERVAL_MS)
    }
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      void useNotificationStore.getState().poll()
      schedule()
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? wake() : window.clearInterval(timer))

    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', wake)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', wake)
    }
  }, [accountId])
}

/**
 * Ouvre ce dont parle une notification (et la marque lue) : « Mes échanges »
 * pour un échange conclu, l'offre elle-même au marché — filtres remis à zéro
 * pour qu'elle y figure —, l'autel des boosters ou l'album pour un cadeau.
 */
export function openNotification(item: AppNotification) {
  const notifications = useNotificationStore.getState()
  notifications.markRead([item.id])
  notifications.dismissBanner(item.id)

  const ui = useUiStore.getState()
  ui.closeNotifications()
  ui.closeDetail()
  const target = targetOf(item)
  // Cadeaux : l'autel des boosters (le hub), ou l'album.
  if (target.kind === 'boosters' || target.kind === 'collection') {
    ui.openActivity(target.kind === 'boosters' ? 'hub' : 'collection')
    return
  }
  ui.openActivity('market')

  const trades = useTradeStore.getState()
  if (target.kind === 'my-trades') {
    trades.openSheet('mine')
    return
  }
  trades.openSheet(null)
  if (target.kind === 'offer') trades.focusOffer(target.offerId)
  const { query } = trades
  if (query.rarity !== 'all' || query.series !== 'all' || query.fillable) trades.setQuery({ rarity: 'all', series: 'all', fillable: false })
  else void trades.loadMarket()
}

/** Notifications du Marché non lues : pour les pastilles de la navigation et du hub. */
export function useUnreadTrades(): number {
  return useNotificationStore((state) => unreadTrades(state.items))
}
