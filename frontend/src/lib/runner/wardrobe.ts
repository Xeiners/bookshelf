/*
 * Garde-robe de l'aventurier du Manga Runner : cinquante pièces inspirées des grands
 * animes, dix par emplacement, gagnées dans des boîtes mystère. Les identifiants, les
 * emplacements et les raretés sont ceux du serveur (`backend/src/modules/runner/runner.wardrobe.ts`) ;
 * ici, l'œuvre d'origine et l'ordre d'affichage. La forme 3D de chaque pièce est dans
 * `components/runner/outfit.ts`, son nom dans les dictionnaires (`runner.wardrobe.items`).
 */

export const WARDROBE_SLOTS = ['hat', 'top', 'accessory', 'bottom', 'shoes'] as const
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number]

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const
export type Rarity = (typeof RARITIES)[number]

export const WARDROBE_ITEMS = [
  'top-tanjiro',
  'top-goku',
  'top-naruto',
  'top-survey',
  'top-luffy',
  'top-akatsuki',
  'top-gojo',
  'top-deku',
  'top-saitama',
  'top-zoro',
  'bottom-goku',
  'bottom-naruto',
  'bottom-hakama',
  'bottom-denim',
  'bottom-survey',
  'bottom-akatsuki',
  'bottom-gojo',
  'bottom-deku',
  'bottom-saitama',
  'bottom-zoro',
  'shoes-goku',
  'shoes-survey',
  'shoes-ninja',
  'shoes-waraji',
  'shoes-luffy',
  'shoes-deku',
  'shoes-saitama',
  'shoes-geta',
  'shoes-akatsuki',
  'shoes-gojo',
  'hat-straw',
  'hat-ace',
  'hat-law',
  'hat-urahara',
  'hat-jotaro',
  'hat-akatsuki',
  'hat-fox',
  'hat-chopper',
  'hat-ash',
  'hat-witch',
  'acc-zangetsu',
  'acc-zodiac',
  'acc-swords',
  'acc-leaf',
  'acc-scarf',
  'acc-dragonballs',
  'acc-nyoibo',
  'acc-deathnote',
  'acc-gojo',
  'acc-kakashi',
] as const
export type WardrobeItemId = (typeof WARDROBE_ITEMS)[number]

export interface WardrobeItemInfo {
  slot: WardrobeSlot
  rarity: Rarity
  /** L'œuvre dont la pièce s'inspire (nom propre, non traduit). */
  anime: string
}

export const ITEM_INFO: Record<WardrobeItemId, WardrobeItemInfo> = {
  'top-tanjiro': { slot: 'top', rarity: 'legendary', anime: 'Demon Slayer' }, // i18n-ignore (titre d’œuvre)
  'top-goku': { slot: 'top', rarity: 'epic', anime: 'Dragon Ball' }, // i18n-ignore (titre d’œuvre)
  'top-naruto': { slot: 'top', rarity: 'rare', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'top-survey': { slot: 'top', rarity: 'common', anime: 'Attack on Titan' }, // i18n-ignore (titre d’œuvre)
  'top-luffy': { slot: 'top', rarity: 'common', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'top-akatsuki': { slot: 'top', rarity: 'legendary', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'top-gojo': { slot: 'top', rarity: 'epic', anime: 'Jujutsu Kaisen' }, // i18n-ignore (titre d’œuvre)
  'top-deku': { slot: 'top', rarity: 'rare', anime: 'My Hero Academia' }, // i18n-ignore (titre d’œuvre)
  'top-saitama': { slot: 'top', rarity: 'common', anime: 'One-Punch Man' }, // i18n-ignore (titre d’œuvre)
  'top-zoro': { slot: 'top', rarity: 'common', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'bottom-goku': { slot: 'bottom', rarity: 'legendary', anime: 'Dragon Ball' }, // i18n-ignore (titre d’œuvre)
  'bottom-naruto': { slot: 'bottom', rarity: 'epic', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'bottom-hakama': { slot: 'bottom', rarity: 'rare', anime: 'Demon Slayer' }, // i18n-ignore (titre d’œuvre)
  'bottom-denim': { slot: 'bottom', rarity: 'common', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'bottom-survey': { slot: 'bottom', rarity: 'common', anime: 'Attack on Titan' }, // i18n-ignore (titre d’œuvre)
  'bottom-akatsuki': { slot: 'bottom', rarity: 'legendary', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'bottom-gojo': { slot: 'bottom', rarity: 'epic', anime: 'Jujutsu Kaisen' }, // i18n-ignore (titre d’œuvre)
  'bottom-deku': { slot: 'bottom', rarity: 'rare', anime: 'My Hero Academia' }, // i18n-ignore (titre d’œuvre)
  'bottom-saitama': { slot: 'bottom', rarity: 'common', anime: 'One-Punch Man' }, // i18n-ignore (titre d’œuvre)
  'bottom-zoro': { slot: 'bottom', rarity: 'common', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'shoes-goku': { slot: 'shoes', rarity: 'legendary', anime: 'Dragon Ball' }, // i18n-ignore (titre d’œuvre)
  'shoes-survey': { slot: 'shoes', rarity: 'epic', anime: 'Attack on Titan' }, // i18n-ignore (titre d’œuvre)
  'shoes-ninja': { slot: 'shoes', rarity: 'rare', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'shoes-waraji': { slot: 'shoes', rarity: 'common', anime: 'Demon Slayer' }, // i18n-ignore (titre d’œuvre)
  'shoes-luffy': { slot: 'shoes', rarity: 'common', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'shoes-deku': { slot: 'shoes', rarity: 'legendary', anime: 'My Hero Academia' }, // i18n-ignore (titre d’œuvre)
  'shoes-saitama': { slot: 'shoes', rarity: 'epic', anime: 'One-Punch Man' }, // i18n-ignore (titre d’œuvre)
  'shoes-geta': { slot: 'shoes', rarity: 'rare', anime: 'Bleach' }, // i18n-ignore (titre d’œuvre)
  'shoes-akatsuki': { slot: 'shoes', rarity: 'common', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'shoes-gojo': { slot: 'shoes', rarity: 'common', anime: 'Jujutsu Kaisen' }, // i18n-ignore (titre d’œuvre)
  'hat-straw': { slot: 'hat', rarity: 'legendary', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'hat-ace': { slot: 'hat', rarity: 'epic', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'hat-law': { slot: 'hat', rarity: 'rare', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'hat-urahara': { slot: 'hat', rarity: 'common', anime: 'Bleach' }, // i18n-ignore (titre d’œuvre)
  'hat-jotaro': { slot: 'hat', rarity: 'common', anime: "JoJo's Bizarre Adventure" }, // i18n-ignore (titre d’œuvre)
  'hat-akatsuki': { slot: 'hat', rarity: 'legendary', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'hat-fox': { slot: 'hat', rarity: 'epic', anime: 'Demon Slayer' }, // i18n-ignore (titre d’œuvre)
  'hat-chopper': { slot: 'hat', rarity: 'rare', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'hat-ash': { slot: 'hat', rarity: 'common', anime: 'Pokémon' }, // i18n-ignore (titre d’œuvre)
  'hat-witch': { slot: 'hat', rarity: 'common', anime: 'Little Witch Academia' }, // i18n-ignore (titre d’œuvre)
  'acc-zangetsu': { slot: 'accessory', rarity: 'legendary', anime: 'Bleach' }, // i18n-ignore (titre d’œuvre)
  'acc-zodiac': { slot: 'accessory', rarity: 'epic', anime: 'Fairy Tail' }, // i18n-ignore (titre d’œuvre)
  'acc-swords': { slot: 'accessory', rarity: 'rare', anime: 'One Piece' }, // i18n-ignore (titre d’œuvre)
  'acc-leaf': { slot: 'accessory', rarity: 'common', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
  'acc-scarf': { slot: 'accessory', rarity: 'common', anime: 'Attack on Titan' }, // i18n-ignore (titre d’œuvre)
  'acc-dragonballs': { slot: 'accessory', rarity: 'legendary', anime: 'Dragon Ball' }, // i18n-ignore (titre d’œuvre)
  'acc-nyoibo': { slot: 'accessory', rarity: 'epic', anime: 'Dragon Ball' }, // i18n-ignore (titre d’œuvre)
  'acc-deathnote': { slot: 'accessory', rarity: 'rare', anime: 'Death Note' }, // i18n-ignore (titre d’œuvre)
  'acc-gojo': { slot: 'accessory', rarity: 'common', anime: 'Jujutsu Kaisen' }, // i18n-ignore (titre d’œuvre)
  'acc-kakashi': { slot: 'accessory', rarity: 'common', anime: 'Naruto' }, // i18n-ignore (titre d’œuvre)
}

/** D'où vient une boîte ouverte : la gratuite du jour, une payée, ou une offerte par un membre. */
export type BoxKind = 'free' | 'paid' | 'gift'

export const isWardrobeItem = (id: string): id is WardrobeItemId => id in ITEM_INFO

/** Une tenue : une pièce (possédée) par emplacement, au plus. */
export type Outfit = Partial<Record<WardrobeSlot, WardrobeItemId>>

/** Couleurs des raretés : liseré, lueur, rayons de la boîte. */
export const RARITY_COLORS: Record<Rarity, { main: string; glow: string; deep: string }> = {
  common: { main: '#9fd8ff', glow: '#cdeaff', deep: '#24476b' },
  rare: { main: '#3f8cff', glow: '#8fc1ff', deep: '#132a6e' },
  epic: { main: '#b05cff', glow: '#dcb2ff', deep: '#3a0f6e' },
  legendary: { main: '#ffc23a', glow: '#fff0a8', deep: '#7a3a00' },
}

/** Lit une tenue venue d'ailleurs (stockage local, API) : seules les pièces connues, à leur emplacement. */
export function cleanOutfit(value: unknown): Outfit {
  if (!value || typeof value !== 'object') return {}
  const outfit: Outfit = {}
  for (const slot of WARDROBE_SLOTS) {
    const id = (value as Record<string, unknown>)[slot]
    if (typeof id === 'string' && isWardrobeItem(id) && ITEM_INFO[id].slot === slot) outfit[slot] = id
  }
  return outfit
}
