import { TtlCache } from '../../lib/cache.js'
import type { Language } from '../../lib/language.js'
import { mangadexGet, type MdCollection, type MdTag } from './mangadex.client.js'

/**
 * Traduction française des tags MangaDex (genres et thèmes). Liste blanche :
 * un tag absent n'est jamais affiché, ce qui écarte aussi les tags de format
 * (« Long Strip ») et les tags sensibles.
 */
export const TAG_FR: Record<string, string> = {
  Action: 'Action',
  Adventure: 'Aventure',
  Comedy: 'Comédie',
  Crime: 'Policier',
  Drama: 'Drame',
  Fantasy: 'Fantasy',
  Historical: 'Historique',
  Horror: 'Horreur',
  Isekai: 'Isekai',
  'Magical Girls': 'Magical girl',
  Mecha: 'Mecha',
  Medical: 'Médical',
  Mystery: 'Mystère',
  Philosophical: 'Philosophique',
  Psychological: 'Psychologique',
  Romance: 'Romance',
  'Sci-Fi': 'Science-fiction',
  'Slice of Life': 'Tranche de vie',
  Sports: 'Sport',
  Superhero: 'Super-héros',
  Thriller: 'Thriller',
  Tragedy: 'Tragédie',
  Wuxia: 'Wuxia',
  "Boys' Love": "Boys' love",
  "Girls' Love": "Girls' love",
  Aliens: 'Extraterrestres',
  Animals: 'Animaux',
  Cooking: 'Cuisine',
  Delinquents: 'Délinquants',
  Demons: 'Démons',
  Ghosts: 'Fantômes',
  Harem: 'Harem',
  Magic: 'Magie',
  'Martial Arts': 'Arts martiaux',
  Military: 'Militaire',
  Monsters: 'Monstres',
  Music: 'Musique',
  'Office Workers': 'Vie de bureau',
  Police: 'Police',
  'Post-Apocalyptic': 'Post-apocalyptique',
  Reincarnation: 'Réincarnation',
  'Reverse Harem': 'Harem inversé',
  Samurai: 'Samouraïs',
  'School Life': 'Vie scolaire',
  Supernatural: 'Surnaturel',
  Survival: 'Survie',
  'Time Travel': 'Voyage temporel',
  Vampires: 'Vampires',
  'Video Games': 'Jeux vidéo',
  Villainess: 'Villainess',
  'Virtual Reality': 'Réalité virtuelle',
  Zombies: 'Zombies',
}

/**
 * Libellé d'un tag dans la langue demandée, ou `undefined` s'il n'est pas dans
 * la liste blanche. En anglais, le nom MangaDex est déjà le bon libellé.
 */
export function tagLabel(englishName: string, language: Language): string | undefined {
  const french = TAG_FR[englishName]
  if (!french) return undefined
  return language === 'fr' ? french : englishName
}

const TAG_TTL_MS = 24 * 60 * 60 * 1000
const tagCache = new TtlCache<Map<string, string>>({ maxEntries: 1, ttlMs: TAG_TTL_MS })

/** Nom anglais → UUID, d'après `/manga/tag` (mis en cache 24 h). */
async function tagIndex(): Promise<Map<string, string>> {
  return tagCache.getOrLoad('all', async () => {
    const payload = await mangadexGet<MdCollection<MdTag>>('/manga/tag')
    const index = new Map<string, string>()
    for (const tag of payload.data) {
      const name = tag.attributes.name.en
      if (name) index.set(name, tag.id)
    }
    return index
  })
}

export async function resolveTagIds(names: string[]): Promise<string[]> {
  if (names.length === 0) return []
  const index = await tagIndex()
  return names.map((name) => index.get(name)).filter((id): id is string => id !== undefined)
}
