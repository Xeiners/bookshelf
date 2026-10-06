/*
 * Anime Bomb Party : une réplique d'anime pour se relever après une défaite (fin de partie
 * solo, ou salon perdu). Les textes vivent dans le dictionnaire (`bomb.quotes`) ; ici, qui
 * les dit et son portrait (celui du BookshelfDLE quand il y en a un), sinon un médaillon.
 */

export const BOMB_QUOTES = [
  { id: 'naruto', portrait: { category: 'naruto', id: 'naruto' }, tint: '#ff8a3d' },
  { id: 'rockLee', portrait: { category: 'naruto', id: 'rock-lee' }, tint: '#3fe0a0' },
  { id: 'jiraiya', portrait: { category: 'naruto', id: 'jiraiya' }, tint: '#ff5e7e' },
  { id: 'luffy', portrait: { category: 'onepiece', id: 'luffy' }, tint: '#ff4d4d' },
  { id: 'zoro', portrait: { category: 'onepiece', id: 'zoro' }, tint: '#4cd964' },
  { id: 'giorno', portrait: { category: 'jojo', id: 'giorno' }, tint: '#ffd23f' },
  { id: 'allMight', portrait: null, tint: '#3a86ff' },
  { id: 'rengoku', portrait: null, tint: '#ff7a1a' },
  { id: 'edward', portrait: null, tint: '#e0a82e' },
  { id: 'eren', portrait: null, tint: '#8bc34a' },
  { id: 'saitama', portrait: null, tint: '#ffd23f' },
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

/** Portrait relayé par l'API du BookshelfDLE (cf. `backend/src/modules/dle/dle.games.ts`). */
export const quotePortrait = (quote: BombQuote): string | null =>
  quote.portrait ? `/api/dle/characters/${quote.portrait.category}/${encodeURIComponent(quote.portrait.id)}/image` : null
