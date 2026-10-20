/**
 * Hasard déterministe : une même graine donne toujours la même suite. Sert au
 * tirage de l'Oracle — un utilisateur retrouve SON tirage du jour, quel que soit
 * l'appareil, et ne peut pas « relancer » en rechargeant.
 */

/** FNV-1a 32 bits : chaîne → entier, bien réparti. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32 : générateur rapide, période 2³², largement suffisant ici. */
export function seededRandom(seed: string): () => number {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T
}

/** Mélange de Fisher-Yates piloté par le générateur (copie, l'entrée est intacte). */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T]
  }
  return copy
}
