import { MANGADEX_SOURCE_ID, SOURCE_ID } from './chapterKey.js'
import type { SourceProvider } from './types.js'

/**
 * Registre des sources actives. Ajouter une source = écrire un fichier dans
 * `providers/` qui implémente `SourceProvider`, puis l'enregistrer dans
 * `extensions/index.ts` : ni les routes ni le lecteur ne changent.
 */
export class SourceRegistry {
  private readonly providers = new Map<string, SourceProvider>()

  register(provider: SourceProvider): this {
    if (!SOURCE_ID.test(provider.id)) throw new Error(`Identifiant de source invalide : « ${provider.id} »`)
    if (this.providers.has(provider.id)) throw new Error(`Source déjà enregistrée : « ${provider.id} »`)
    // L'UUID nu est réservé à MangaDex (cf. chapterKey.ts) : une autre source ne peut pas s'en réclamer.
    if (provider.id === MANGADEX_SOURCE_ID && !provider.selfRelayed) {
      throw new Error('La source « mangadex » doit relayer ses propres pages.')
    }
    this.providers.set(provider.id, provider)
    return this
  }

  get(id: string): SourceProvider | undefined {
    return this.providers.get(id)
  }

  /** Par priorité décroissante, puis identifiant : ordre stable pour les statuts et les erreurs. */
  list(): SourceProvider[] {
    return [...this.providers.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  }
}
