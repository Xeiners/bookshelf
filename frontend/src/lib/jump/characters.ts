/**
 * Page Jump : les personnages jouables (catalogue repris du serveur, qui fait foi pour les prix :
 * `backend/src/modules/jump/jump.characters.ts`). La Lune est offerte ; les autres s'achètent en ✦.
 * Leurs dessins : `components/jump/characters.ts` ; leurs noms : `t.jump.characters`.
 */
export const JUMP_CHARACTERS = [
  { id: 'moon', price: 0, tint: '#ffd35c' },
  { id: 'pakkun', price: 400, tint: '#c9a66b' },
  { id: 'saitama', price: 400, tint: '#ffd23f' },
  { id: 'pikachu', price: 600, tint: '#ffd23f' },
  { id: 'chopper', price: 600, tint: '#ff7aa8' },
  { id: 'anya', price: 800, tint: '#ffa6c9' },
  { id: 'nezuko', price: 800, tint: '#ff9ec7' },
  { id: 'naruto', price: 1200, tint: '#ff8a1f' },
  { id: 'luffy', price: 1200, tint: '#e63946' },
  { id: 'goku', price: 1800, tint: '#ff8a1f' },
  { id: 'pochita', price: 600, tint: '#ff8a3d' },
  { id: 'deku', price: 800, tint: '#2f8f6a' },
  { id: 'killua', price: 800, tint: '#9bb7ff' },
  { id: 'zenitsu', price: 800, tint: '#ffd23f' },
  { id: 'tanjiro', price: 1000, tint: '#2e8b57' },
  { id: 'itadori', price: 1200, tint: '#ff8fb0' },
  { id: 'kakashi', price: 1500, tint: '#c9ced6' },
  { id: 'zoro', price: 1500, tint: '#4caf50' },
  { id: 'gojo', price: 2500, tint: '#7fb8ff' },
] as const

export type JumpCharacterId = (typeof JUMP_CHARACTERS)[number]['id']
export const DEFAULT_CHARACTER: JumpCharacterId = 'moon'

export const isJumpCharacter = (value: unknown): value is JumpCharacterId => JUMP_CHARACTERS.some((character) => character.id === value)
