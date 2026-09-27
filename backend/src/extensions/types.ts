import type { Language } from '../lib/language.js'

/**
 * Contrat des sources de chapitres (patron Strategy). Chaque fournisseur
 * traduit SON API vers ces types ; l'agrégateur ne connaît rien d'autre.
 * Module de types pur : aucun import d'exécution.
 */

/** Qualité d'image demandée ; une source qui n'en propose qu'une l'ignore. */
export type Quality = 'data' | 'data-saver'

export interface SourceRef {
  id: string
  name: string
}

/** Chapitre tel qu'un fournisseur le rend : identifiant BRUT, propre à sa source. */
export interface NormalizedChapter {
  id: string
  /** Numéro affiché (« 12 », « 12.5 »), `null` pour un one-shot. */
  number: string | null
  volume: string | null
  title: string | null
  language: Language
  /** Nombre de pages ; 0 = inconnu (certaines sources ne le disent qu'à l'ouverture). */
  pages: number
  /** Équipes de traduction, à créditer. */
  groups: { id: string; name: string }[]
  publishedAt: string
  /**
   * Sous-source d'un fournisseur qui en regroupe plusieurs (pont Tachiyomi :
   * une extension par site). L'agrégateur en fait la provenance du chapitre,
   * `<fournisseur>:<id>` : badge, fusion et sélecteur la traitent comme une
   * source à part entière. Absente : le fournisseur lui-même.
   */
  origin?: SourceRef
}

/** Chapitre après passage dans l'agrégateur : identifiant PUBLIC (cf. chapterKey.ts) et provenance. */
export interface SourcedChapter extends Omit<NormalizedChapter, 'origin'> {
  source: SourceRef
}

/** Chapitre fusionné : les versions des autres sources pour le même numéro et la même langue. */
export interface MergedChapter extends SourcedChapter {
  alternates: SourcedChapter[]
}

export interface NormalizedPage {
  index: number
  /** URL absolue chez la source — ou, pour une source `selfRelayed`, déjà un chemin de notre API. */
  url: string
  /** Même page en qualité réduite (sources `selfRelayed` seulement). */
  fallbackUrl?: string | null
  /** En-têtes de provenance exigés par le serveur d'images (Referer, User-Agent). */
  headers?: Record<string, string>
}

/** Image téléchargée par une source elle-même (cf. `SourceProvider.fetchImage`). */
export interface FetchedImage {
  body: Buffer
  contentType: string
}

export interface SourceProvider {
  /** Identifiant stable, `[a-z0-9]{2,24}` : il entre dans les identifiants de chapitre publics. */
  id: string
  name: string
  baseUrl: string
  supportedLanguages: readonly Language[]
  /**
   * Rang de confiance (qualité des traductions, complétude des métadonnées) :
   * à numéro de chapitre égal, la source la plus haute fournit la version principale.
   */
  priority: number
  /** Délai maximal d'une opération (ms) ; au-delà, la source est considérée en échec. */
  timeoutMs?: number
  /** Les URL de pages pointent déjà vers notre API (MangaDex) : pas de relais générique. */
  selfRelayed?: boolean
  /** Retrouve l'œuvre par ses titres : l'agrégateur ne résout les alias que si une source en a besoin. */
  usesAliases?: boolean

  fetchChapterList(mangaId: string, titleAliases: string[]): Promise<NormalizedChapter[]>
  fetchPageUrls(chapterId: string, options: { quality: Quality }): Promise<NormalizedPage[]>
  /**
   * Téléchargement des images par la source elle-même, au lieu du relais
   * générique : pour une bibliothèque personnelle (Komga, Kavita) sur une
   * adresse privée et derrière une authentification. La source ne doit
   * joindre QUE l'origine qu'on lui a configurée.
   */
  fetchImage?(page: NormalizedPage): Promise<{ image: FetchedImage | null; reason?: string }>
}
