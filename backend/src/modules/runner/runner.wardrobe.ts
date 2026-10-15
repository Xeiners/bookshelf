/**
 * Garde-robe de l'aventurier du Manga Runner — règles pures (testées, `backend/test/runner.test.ts`).
 * Cinquante pièces inspirées des grands animes (dix par emplacement), gagnées dans des
 * boîtes mystère : une gratuite toutes les 24 h, les autres contre des Poussières. Le tirage :
 * une rareté (55 / 28 / 13 / 4 %), puis une pièce de cette rareté — de préférence une pièce
 * qu'on n'a pas encore. Un doublon rend des Poussières ; au bout de `BOX_PITY` boîtes sans
 * légendaire, la suivante en contient une. Le front décrit chaque pièce (forme, couleurs,
 * nom) sous le même identifiant (`frontend/src/lib/runner/wardrobe.ts`).
 */

export const WARDROBE_SLOTS = ['top', 'bottom', 'shoes', 'hat', 'accessory'] as const
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number]

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const
export type Rarity = (typeof RARITIES)[number]

export interface WardrobeItem {
  id: string
  slot: WardrobeSlot
  rarity: Rarity
}

/** Par emplacement : deux légendaires, deux épiques, deux rares, quatre communes. */
export const WARDROBE: readonly WardrobeItem[] = [
  { id: 'top-tanjiro', slot: 'top', rarity: 'legendary' },
  { id: 'top-goku', slot: 'top', rarity: 'epic' },
  { id: 'top-naruto', slot: 'top', rarity: 'rare' },
  { id: 'top-survey', slot: 'top', rarity: 'common' },
  { id: 'top-luffy', slot: 'top', rarity: 'common' },
  { id: 'top-akatsuki', slot: 'top', rarity: 'legendary' },
  { id: 'top-gojo', slot: 'top', rarity: 'epic' },
  { id: 'top-deku', slot: 'top', rarity: 'rare' },
  { id: 'top-saitama', slot: 'top', rarity: 'common' },
  { id: 'top-zoro', slot: 'top', rarity: 'common' },

  { id: 'bottom-goku', slot: 'bottom', rarity: 'legendary' },
  { id: 'bottom-naruto', slot: 'bottom', rarity: 'epic' },
  { id: 'bottom-hakama', slot: 'bottom', rarity: 'rare' },
  { id: 'bottom-denim', slot: 'bottom', rarity: 'common' },
  { id: 'bottom-survey', slot: 'bottom', rarity: 'common' },
  { id: 'bottom-akatsuki', slot: 'bottom', rarity: 'legendary' },
  { id: 'bottom-gojo', slot: 'bottom', rarity: 'epic' },
  { id: 'bottom-deku', slot: 'bottom', rarity: 'rare' },
  { id: 'bottom-saitama', slot: 'bottom', rarity: 'common' },
  { id: 'bottom-zoro', slot: 'bottom', rarity: 'common' },

  { id: 'shoes-goku', slot: 'shoes', rarity: 'legendary' },
  { id: 'shoes-survey', slot: 'shoes', rarity: 'epic' },
  { id: 'shoes-ninja', slot: 'shoes', rarity: 'rare' },
  { id: 'shoes-waraji', slot: 'shoes', rarity: 'common' },
  { id: 'shoes-luffy', slot: 'shoes', rarity: 'common' },
  { id: 'shoes-deku', slot: 'shoes', rarity: 'legendary' },
  { id: 'shoes-saitama', slot: 'shoes', rarity: 'epic' },
  { id: 'shoes-geta', slot: 'shoes', rarity: 'rare' },
  { id: 'shoes-akatsuki', slot: 'shoes', rarity: 'common' },
  { id: 'shoes-gojo', slot: 'shoes', rarity: 'common' },

  { id: 'hat-straw', slot: 'hat', rarity: 'legendary' },
  { id: 'hat-ace', slot: 'hat', rarity: 'epic' },
  { id: 'hat-law', slot: 'hat', rarity: 'rare' },
  { id: 'hat-urahara', slot: 'hat', rarity: 'common' },
  { id: 'hat-jotaro', slot: 'hat', rarity: 'common' },
  { id: 'hat-akatsuki', slot: 'hat', rarity: 'legendary' },
  { id: 'hat-fox', slot: 'hat', rarity: 'epic' },
  { id: 'hat-chopper', slot: 'hat', rarity: 'rare' },
  { id: 'hat-ash', slot: 'hat', rarity: 'common' },
  { id: 'hat-witch', slot: 'hat', rarity: 'common' },

  { id: 'acc-zangetsu', slot: 'accessory', rarity: 'legendary' },
  { id: 'acc-zodiac', slot: 'accessory', rarity: 'epic' },
  { id: 'acc-swords', slot: 'accessory', rarity: 'rare' },
  { id: 'acc-leaf', slot: 'accessory', rarity: 'common' },
  { id: 'acc-scarf', slot: 'accessory', rarity: 'common' },
  { id: 'acc-dragonballs', slot: 'accessory', rarity: 'legendary' },
  { id: 'acc-nyoibo', slot: 'accessory', rarity: 'epic' },
  { id: 'acc-deathnote', slot: 'accessory', rarity: 'rare' },
  { id: 'acc-gojo', slot: 'accessory', rarity: 'common' },
  { id: 'acc-kakashi', slot: 'accessory', rarity: 'common' },
]

const BY_ID = new Map(WARDROBE.map((item) => [item.id, item]))
export const wardrobeItem = (id: string): WardrobeItem | undefined => BY_ID.get(id)

/** Prix d'une boîte (repères : le Runner rapporte 150 ✦ par jour au plus, un booster en coûte 340). */
export const BOX_PRICE = 450
/** Délai entre deux boîtes gratuites. */
export const FREE_BOX_MS = 24 * 60 * 60 * 1000
/** Boîtes sans légendaire avant la garantie. */
export const BOX_PITY = 20
/** Chances de chaque rareté (sur 100). */
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 55, rare: 28, epic: 13, legendary: 4 }
/** Poussières rendues pour un doublon. */
export const DUPLICATE_REFUND: Record<Rarity, number> = { common: 60, rare: 120, epic: 220, legendary: 400 }

export interface BoxRoll {
  item: WardrobeItem
  duplicate: boolean
  refund: number
  /** La garantie a joué (légendaire forcée). */
  guaranteed: boolean
}

/**
 * Tire le contenu d'une boîte. `random` : un nombre uniforme dans [0, 1) ; `owned` : les
 * pièces déjà possédées ; `pity` : boîtes d'affilée sans légendaire.
 */
export function rollBox(random: () => number, owned: ReadonlySet<string>, pity: number): BoxRoll {
  const guaranteed = pity + 1 >= BOX_PITY
  let rarity: Rarity = 'common'
  if (guaranteed) rarity = 'legendary'
  else {
    let ticket = random() * 100
    for (const candidate of [...RARITIES].reverse()) {
      ticket -= RARITY_WEIGHTS[candidate]
      if (ticket < 0) {
        rarity = candidate
        break
      }
    }
  }
  const pool = WARDROBE.filter((item) => item.rarity === rarity)
  const fresh = pool.filter((item) => !owned.has(item.id))
  const choices = fresh.length > 0 ? fresh : pool
  const item = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!
  const duplicate = owned.has(item.id)
  return { item, duplicate, refund: duplicate ? DUPLICATE_REFUND[rarity] : 0, guaranteed }
}

export type Outfit = Partial<Record<WardrobeSlot, string>>

/** Lit une tenue enregistrée : seuls les emplacements connus, des pièces du bon emplacement et possédées. */
export function readOutfit(json: string, owned: ReadonlySet<string>): Outfit {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object') return {}
  const outfit: Outfit = {}
  for (const slot of WARDROBE_SLOTS) {
    const id = (value as Record<string, unknown>)[slot]
    if (typeof id === 'string' && wardrobeItem(id)?.slot === slot && owned.has(id)) outfit[slot] = id
  }
  return outfit
}
