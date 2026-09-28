// i18n-ignore-file : mots-clés de genres (fr + en) comparés aux catégories du catalogue, jamais affichés.

/**
 * Ambiances proposées dans le lecteur, choisies selon les genres de l'œuvre.
 * Libellés dans les dictionnaires (`t.reader.ambient.presets`). Identifiants
 * vérifiés intégrables (oEmbed) : une vidéo retirée tombe en erreur, et
 * l'utilisateur peut toujours coller son propre lien.
 */
export const AMBIENT_PRESET_IDS = ['lofi', 'dark', 'synth', 'rain'] as const

export type AmbientPresetId = (typeof AMBIENT_PRESET_IDS)[number]

export const AMBIENT_PRESETS: Record<AmbientPresetId, { videoId: string; keywords: readonly string[] }> = {
  /** Lofi Girl, « lofi hip hop radio » (direct). */
  lofi: {
    videoId: 'jfKfPfyJRdk',
    keywords: ['romance', 'slice of life', 'tranche de vie', 'comedy', 'comedie', 'school', 'scolaire', 'shoujo', 'josei'],
  },
  /** Ambiances Elden Ring, 3 h. */
  dark: {
    videoId: 'zNaGofYkN0w',
    keywords: ['isekai', 'fantasy', 'fantastique', 'dark', 'horror', 'horreur', 'magic', 'magie', 'adventure', 'aventure', 'martial', 'supernatural', 'surnaturel'],
  },
  /** Lofi Girl, « synthwave radio » (direct). */
  synth: {
    videoId: '4xDzrJKXOOY',
    keywords: ['sci-fi', 'science fiction', 'science-fiction', 'cyberpunk', 'mecha', 'action', 'thriller', 'sport', 'game', 'jeu'],
  },
  /** Pluie et piano doux, sans publicité intégrée. */
  rain: {
    videoId: 'N2m4RFhCqKg',
    keywords: ['drama', 'drame', 'tragedy', 'tragedie', 'psychological', 'psychologique', 'mystery', 'mystere', 'historical', 'historique'],
  },
}

export const isAmbientPresetId = (value: unknown): value is AmbientPresetId =>
  typeof value === 'string' && (AMBIENT_PRESET_IDS as readonly string[]).includes(value)

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/**
 * Ambiance suggérée : le premier genre de l'œuvre (le plus représentatif) qui
 * correspond à une ambiance l'emporte, sinon `fallback`.
 */
export function suggestAmbientPreset(categories: readonly string[], fallback: AmbientPresetId): AmbientPresetId {
  for (const category of categories) {
    const genre = normalize(category)
    const match = AMBIENT_PRESET_IDS.find((id) => AMBIENT_PRESETS[id].keywords.some((keyword) => genre.includes(keyword)))
    if (match) return match
  }
  return fallback
}

/** Préférence enregistrée (ambiance ou lien collé) → entrée pour `ambientPlayer.play`. */
export const resolveAmbientSource = (saved: string): string =>
  isAmbientPresetId(saved) ? AMBIENT_PRESETS[saved].videoId : saved
