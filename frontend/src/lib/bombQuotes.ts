/*
 * Anime Bomb Party : une réplique d'anime pour se relever après une défaite (fin de partie
 * solo, ou salon perdu). Les textes vivent dans le dictionnaire (`bomb.quotes`) ; ici, la
 * couleur de chacun. Le portrait vient du serveur (cf. `backend/src/modules/bomb/bomb.portraits.ts`).
 */

export const BOMB_QUOTES = [
  { id: 'naruto', tint: '#ff8a3d' },
  { id: 'rockLee', tint: '#3fe0a0' },
  { id: 'jiraiya', tint: '#ff5e7e' },
  { id: 'luffy', tint: '#ff4d4d' },
  { id: 'zoro', tint: '#4cd964' },
  { id: 'giorno', tint: '#ffd23f' },
  { id: 'allMight', tint: '#3a86ff' },
  { id: 'rengoku', tint: '#ff7a1a' },
  { id: 'edward', tint: '#e0a82e' },
  { id: 'eren', tint: '#8bc34a' },
  { id: 'saitama', tint: '#ffd23f' },
  { id: 'kakashi', tint: '#9fb4c7' },
  { id: 'whitebeard', tint: '#f5f5f5' },
  { id: 'jotaro', tint: '#7c5cff' },
  { id: 'gojo', tint: '#6fd6ff' },
  { id: 'todo', tint: '#ff8a3d' },
  { id: 'kamina', tint: '#ff3b6b' },
  { id: 'kageyama', tint: '#ff9f1a' },
  { id: 'escanor', tint: '#ffb347' },
  { id: 'asta', tint: '#5ef2c2' },
  { id: 'erwin', tint: '#c9a86a' },
  { id: 'jinwoo', tint: '#8a6cff' },
] as const

export type BombQuoteId = (typeof BOMB_QUOTES)[number]['id']
export type BombQuote = (typeof BOMB_QUOTES)[number]

let last = -1

/** Une réplique au hasard, jamais deux fois la même d'affilée. */
export function pickQuote(random: () => number = Math.random): BombQuote {
  let index = Math.floor(random() * BOMB_QUOTES.length)
  if (index === last) index = (index + 1) % BOMB_QUOTES.length
  last = index
  return BOMB_QUOTES[index] as BombQuote
}

/** Portrait de l'auteur, relayé par le serveur (BookshelfDLE ou MyAnimeList). */
export const quotePortrait = (quote: BombQuote): string => `/api/bomb/quotes/${quote.id}/portrait`
