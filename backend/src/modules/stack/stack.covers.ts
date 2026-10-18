import { dleWorks } from '../dle/dle.works.js'

/*
 * Couvertures de tomes de Page Stack : celles des mangas du set de cartes (les plus connus,
 * cf. `dle.works.ts`), déjà relayées par `/api/covers/` — des couvertures de volumes, pas des
 * affiches. Les cartes de personnages (série 3) n'en sont pas : on ne garde que les œuvres.
 * Sans collection prête, la liste est vide et le jeu dessine des tomes à la place.
 */

/** Tomes proposés au plus ; un salon en tire une douzaine. */
const MAX_COVERS = 60

export interface StackCover {
  id: string
  title: string
  /** Couverture relayée, relative à l'API (`/api/covers/…`). */
  url: string
}

interface Candidate {
  id: string
  name: string
  imageUrl: string
  series: number
  popularity: number
}

/** Les mangas les plus suivis, une couverture par œuvre. */
export function pickCovers(works: readonly Candidate[]): StackCover[] {
  const seen = new Set<string>()
  const covers: StackCover[] = []
  for (const work of [...works].sort((a, b) => b.popularity - a.popularity)) {
    if (work.series === 3 || !work.imageUrl) continue
    const key = work.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    covers.push({ id: work.id, title: work.name, url: work.imageUrl })
    if (covers.length >= MAX_COVERS) break
  }
  return covers
}

export async function stackCovers(): Promise<StackCover[]> {
  try {
    return pickCovers((await dleWorks()).list)
  } catch {
    // Collection pas encore prête : le jeu dessine ses propres tomes.
    return []
  }
}
