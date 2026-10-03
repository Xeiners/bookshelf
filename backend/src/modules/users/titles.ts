import type { Rarity } from '../cards/boosters.logic.js'

/**
 * Titres affichables sous le pseudo. Chacun se débloque par les statistiques
 * du compte : le serveur refuse d'afficher un titre pas encore mérité. Le
 * libellé vit dans les dictionnaires du front (`t.profile.titles[id]`).
 */

export interface ProfileStats {
  collection: {
    /** Cartes du set (toutes séries). */
    total: number
    /** Cartes différentes possédées. */
    owned: number
    /** Exemplaires, doublons compris. */
    copies: number
    byRarity: Record<Rarity, { total: number; owned: number }>
  }
  reading: {
    wishlist: number
    reading: number
    read: number
    /** Chapitres lus dans le lecteur intégré. */
    chaptersRead: number
    /** Romans EPUB importés, et terminés. */
    novels: number
    novelsFinished: number
    /** Titres ouverts : mangas en cours ou lus, romans entamés. */
    consulted: number
    /** Part des titres ouverts qui sont terminés, de 0 à 1. */
    completion: number
  }
  gacha: {
    boostersOpened: number
  }
  /** BookshelfDLE : énigmes du jour résolues, parties à plusieurs gagnées. */
  dle: {
    dailySolved: number
    roomsWon: number
  }
  /** Higher or Lower : meilleure série de tous les temps et du jour. */
  higherLower: {
    best: number
    todayBest: number
  }
}

interface TitleRule {
  id: string
  unlocked: (stats: ProfileStats) => boolean
}

export const TITLES = [
  { id: 'newcomer', unlocked: () => true },
  { id: 'collector', unlocked: ({ collection }) => collection.owned >= 50 },
  { id: 'archivist', unlocked: ({ collection }) => collection.owned >= 200 },
  { id: 'completionist', unlocked: ({ collection }) => collection.total > 0 && collection.owned >= collection.total },
  { id: 'mythicHunter', unlocked: ({ collection }) => collection.byRarity.MYTHIC.owned >= 1 },
  { id: 'packOpener', unlocked: ({ gacha }) => gacha.boostersOpened >= 25 },
  { id: 'highRoller', unlocked: ({ gacha }) => gacha.boostersOpened >= 100 },
  { id: 'bookworm', unlocked: ({ reading }) => reading.read + reading.novelsFinished >= 10 },
  { id: 'sage', unlocked: ({ reading }) => reading.read + reading.novelsFinished >= 50 },
  { id: 'riddler', unlocked: ({ dle }) => dle.dailySolved >= 10 },
  { id: 'dleMaster', unlocked: ({ dle }) => dle.roomsWon >= 10 },
  { id: 'sharpEye', unlocked: ({ higherLower }) => higherLower.best >= 20 },
] as const satisfies readonly TitleRule[]

export type TitleId = (typeof TITLES)[number]['id']

export const TITLE_IDS = TITLES.map((title) => title.id) as [TitleId, ...TitleId[]]

export const titlesFor = (stats: ProfileStats) => TITLES.map((title) => ({ id: title.id, unlocked: title.unlocked(stats) }))

export const isUnlocked = (id: TitleId, stats: ProfileStats) => TITLES.find((title) => title.id === id)?.unlocked(stats) ?? false
