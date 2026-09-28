import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shelf } from '../services/catalog'
import type { DeckSource } from '../lib/deckSources'
import { fetchSynopsis, getCachedSynopsis, shelvesFor } from '../services/catalog'
import { fetchDeck, libraryHistory, type DeckPart } from '../services/discover'
import { useDeckStore } from '../store/useDeckStore'
import { getT, useLanguage, type Language } from '../i18n'
import { seedBooks } from '../services/seedBooks'
import { knownIds, useLibraryStore } from '../store/useLibraryStore'
import type { Book } from '../types/book'

/** Cartes demandées au moteur de recommandation par requête. */
const DECK_BATCH = 20
/**
 * Seuil de recharge en tâche de fond, volontairement large : si la file tombe à
 * zéro, le deck est démonté et rejoue toute son animation d'entrée au retour.
 */
const REFILL_THRESHOLD = 8
/** Nombre de cartes dont on préchauffe le synopsis. */
const HYDRATE_WINDOW = 3
/** Couvertures chargées en avance, au-delà des quatre cartes montées. */
const COVER_PRELOAD_WINDOW = 7
/** Un synopsis plus court que ça mérite d'être hydraté depuis /works. */
const SYNOPSIS_MIN_LENGTH = 140

export type QueuePhase = 'loading' | 'ready' | 'empty' | 'error'

export interface DiscoveryQueue {
  queue: Book[]
  cursor: number
  remaining: number
  shelf: Shelf
  /** Étagères proposées : celles du catalogue, ou celles des romans. */
  shelves: Shelf[]
  /** Types cochés : manga, manhwa, manhua, romans (plusieurs à la fois, gardés sur l'appareil). */
  sources: DeckSource[]
  phase: QueuePhase
  /** `true` = API injoignable, on tourne sur le jeu de secours local. */
  offline: boolean
  /** Un renfort est en route : ne jamais annoncer l'étagère épuisée. */
  refilling: boolean
  advance: () => void
  /** Recule d'une carte (annulation du dernier choix). */
  rewind: () => void
  selectShelf: (shelf: Shelf) => void
  toggleSource: (source: DeckSource) => void
  selectAllSources: () => void
  reload: () => void
}

/**
 * File d'attente du mode Découverte : charge une étagère, exclut les livres déjà
 * vus, se recharge avant la panne sèche, préchauffe les synopsis à venir et
 * bascule sur `seedBooks()` si le réseau tombe. Suit la langue : la changer
 * recharge la file, traduite.
 */
/**
 * Récolte réseau pure (aucun état React) : une page du moteur de
 * recommandation, qui écarte déjà côté serveur tout ce qui a été vu. Le filtre
 * local reste en garde-fou (swipe fait pendant la requête). Les mises à jour
 * d'état se font dans le `.then()` de l'appelant, jamais dans un effet.
 */
async function harvestDeck(
  target: Shelf,
  sources: readonly DeckSource[],
  lang: Language,
  signal: AbortSignal,
  seen: Set<string>,
  isKnown: (id: string) => boolean,
  round: number,
  exhausted: Set<DeckPart>,
): Promise<{ books: Book[]; hasMore: boolean }> {
  const { books, hasMore, parts } = await fetchDeck({
    shelf: target.id,
    sources,
    language: lang,
    round,
    exhausted,
    seen: [...seen],
    // Historique local : le profil de goûts d'un invité est calculé à partir de lui.
    history: libraryHistory(),
    limit: DECK_BATCH,
    signal,
  })
  // Une moitié épuisée (plus de romans « Horreur ») n'est plus interrogée ; l'autre continue.
  for (const [part, more] of Object.entries(parts) as [DeckPart, boolean][]) if (!more) exhausted.add(part)
  const fresh = books.filter((book) => !seen.has(book.id) && !isKnown(book.id))
  return { books: fresh, hasMore }
}

/** Jeu de secours hors-ligne, au même filtre d'origine que le deck. */
const matchesSources = (book: Book, sources: readonly DeckSource[]) =>
  book.kind === 'book' ? sources.includes('novel') : !!book.kind && sources.includes(book.kind)

export function useDiscoveryQueue(): DiscoveryQueue {
  const language = useLanguage()
  const entries = useLibraryStore((state) => state.entries)
  const skipped = useLibraryStore((state) => state.skipped)
  const known = useMemo(() => knownIds(entries, skipped), [entries, skipped])

  const [queue, setQueue] = useState<Book[]>([])
  const [cursor, setCursor] = useState(0)
  // Sélection et étagère gardées sur l'appareil. Une étagère absente des types
  // cochés (« Thriller » sans les romans) retombe sur la première : dérivé, pas d'effet.
  const sources = useDeckStore((state) => state.sources)
  const savedShelf = useDeckStore((state) => state.shelf)
  const shelves = useMemo(() => shelvesFor(sources), [sources])
  const shelf = shelves.find((item) => item.id === savedShelf) ?? shelves[0]!
  const sourcesKey = sources.join('+')
  const [phase, setPhase] = useState<QueuePhase>('loading')
  const [offline, setOffline] = useState(false)

  /*
   * États DÉRIVÉS plutôt que posés dans un effet (pas de rendu en cascade) :
   * - une requête = étagère + langue + relance ; tant que sa réponse n'est pas
   *   arrivée (`loadedKey`), la file est « en chargement » ;
   * - « renfort en cours » = la file s'épuise et rien n'indique encore que
   *   l'étagère est vide pour cette requête (`drainedKey`).
   */
  const [nonce, setNonce] = useState(0)
  const requestKey = `${shelf.id}|${sourcesKey}|${language}|${nonce}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [drainedKey, setDrainedKey] = useState<string | null>(null)
  const effectivePhase: QueuePhase = loadedKey === requestKey ? phase : 'loading'
  const remaining = queue.length - cursor
  const refilling =
    effectivePhase === 'ready' && !offline && drainedKey !== requestKey && remaining <= REFILL_THRESHOLD

  // Évitent de remettre `load` dans les dépendances des effets, ce qui
  // relancerait un fetch à chaque swipe.
  const knownRef = useRef(known)
  const queueRef = useRef(queue)
  useEffect(() => {
    knownRef.current = known
    queueRef.current = queue
  })

  const abortRef = useRef<AbortController | null>(null)
  const fetchingRef = useRef(false)
  const hydratedRef = useRef(new Set<string>())
  const hydratingRef = useRef(new Set<string>())
  const preloadedCoversRef = useRef(new Set<string>())
  /** Moitiés (catalogue, romans) épuisées pour la requête en cours. */
  const exhaustedRef = useRef(new Set<DeckPart>())

  const load = useCallback(
    (target: Shelf, targetSources: readonly DeckSource[], mode: 'replace' | 'append', lang: Language, key: string, round: number) => {
      if (mode === 'append' && fetchingRef.current) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      fetchingRef.current = true

      const seen = new Set(mode === 'append' ? queueRef.current.map((book) => book.id) : [])
      if (mode === 'replace') exhaustedRef.current = new Set()
      const isKnown = (id: string) => knownRef.current.has(id)

      void harvestDeck(target, targetSources, lang, controller.signal, seen, isKnown, round, exhaustedRef.current)
        .then(({ books: harvest, hasMore }) => {
          setOffline(false)
          if (mode === 'replace') {
            setQueue(harvest)
            setCursor(0)
            setPhase(harvest.length > 0 ? 'ready' : 'empty')
            setLoadedKey(key)
            if (!hasMore) setDrainedKey(key)
          } else {
            setQueue((previous) => [...previous, ...harvest])
            // Rien de neuf : l'étagère est épuisée pour cette requête.
            if (harvest.length === 0 || !hasMore) setDrainedKey(key)
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return
          if (mode !== 'replace') {
            // Renfort impossible (réseau) : on n'annonce plus de chargement.
            setDrainedKey(key)
            return
          }
          // Repli hors-ligne : l'app reste utilisable sans réseau.
          const fallback = seedBooks(lang).filter((book) => !isKnown(book.id) && matchesSources(book, targetSources))
          setQueue(fallback)
          setCursor(0)
          setOffline(true)
          setPhase(fallback.length > 0 ? 'ready' : 'error')
          setLoadedKey(key)
        })
        .finally(() => {
          // Une requête déjà remplacée ne doit pas libérer le verrou de la nouvelle.
          if (abortRef.current === controller) fetchingRef.current = false
        })
    },
    [],
  )

  useEffect(() => {
    load(shelf, sources, 'replace', language, requestKey, nonce)
  }, [requestKey, shelf, sources, language, load, nonce])

  // Recharge anticipée : l'utilisateur ne doit jamais voir le fond de la pile.
  useEffect(() => {
    if (effectivePhase !== 'ready' || offline || drainedKey === requestKey) return
    if (remaining > REFILL_THRESHOLD) return
    load(shelf, sources, 'append', language, requestKey, nonce)
  }, [effectivePhase, offline, drainedKey, requestKey, remaining, shelf, sources, language, load, nonce])

  // Préchauffage des synopsis : la carte du dessus a son texte avant d'arriver.
  const hydrationTargets = queue
    .slice(cursor, cursor + HYDRATE_WINDOW)
    .filter((book) => book.synopsis.length < SYNOPSIS_MIN_LENGTH)
    .map((book) => book.id)
    .join('|')

  useEffect(() => {
    if (!hydrationTargets || offline) return

    // Ces requêtes survivent au changement de curseur : les annuler à chaque
    // swipe laissait auparavant certains livres marqués comme hydratés sans texte.
    for (const id of hydrationTargets.split('|')) {
      // Clé par langue : le même titre se réhydrate dans l'autre langue.
      const key = `${language}:${id}`
      if (hydratingRef.current.has(key)) continue

      // Une réponse arrivée après un changement de langue ne doit toucher que
      // les cartes de SA langue, jamais la file déjà rechargée dans l'autre.
      const sameLanguage = (book: Book) => book.id === id && (book.lang ?? language) === language
      // Déjà hydraté, mais revenu SANS texte dans une nouvelle fournée (autre
      // étagère, autres types cochés) : on repasse — le cache répond sans réseau.
      // Sans ça, sa carte restait en squelette pour toujours.
      const needsText = queueRef.current.some((book) => sameLanguage(book) && !book.synopsis)
      if (hydratedRef.current.has(key) && !needsText) continue
      hydratingRef.current.add(key)

      // Un titre sans description doit sortir du squelette lui aussi.
      const placeholder = getT().book.noSynopsis
      /** Pose le texte sur les cartes de ce titre ; file inchangée si rien ne bouge (pas de rendu inutile). */
      const fill = (text: (book: Book) => string) =>
        setQueue((previous) => {
          let changed = false
          const next = previous.map((book) => {
            if (!sameLanguage(book)) return book
            const synopsis = text(book)
            if (synopsis === book.synopsis) return book
            changed = true
            return { ...book, synopsis }
          })
          return changed ? next : previous
        })

      void (async () => {
        try {
          const cached = getCachedSynopsis(id, language)
          const synopsis = cached ?? (await fetchSynopsis(id, language))
          fill((book) => synopsis || book.synopsis || placeholder)
        } catch {
          fill((book) => book.synopsis || placeholder)
        } finally {
          hydratingRef.current.delete(key)
          hydratedRef.current.add(key)
        }
      })()
    }
    // `loadedKey` : chaque nouvelle fournée est revérifiée, même si ses premiers titres sont les mêmes.
  }, [hydrationTargets, offline, language, loadedKey])

  // Le deck n'affiche que quatre cartes, mais un swipe rapide peut les parcourir
  // avant que le navigateur ait décidé de charger les images `lazy` suivantes.
  useEffect(() => {
    for (const book of queue.slice(cursor, cursor + COVER_PRELOAD_WINDOW)) {
      if (!book.cover || preloadedCoversRef.current.has(book.cover)) continue
      preloadedCoversRef.current.add(book.cover)
      const image = new Image()
      image.decoding = 'async'
      image.src = book.cover
    }
  }, [queue, cursor])

  useEffect(() => () => abortRef.current?.abort(), [])

  const advance = useCallback(() => setCursor((value) => value + 1), [])
  const rewind = useCallback(() => setCursor((value) => Math.max(0, value - 1)), [])

  const selectShelf = useCallback((next: Shelf) => useDeckStore.getState().setShelf(next.id), [])
  const toggleSource = useCallback((source: DeckSource) => useDeckStore.getState().toggleSource(source), [])
  const selectAllSources = useCallback(() => useDeckStore.getState().selectAllSources(), [])

  // Relancer = une nouvelle requête : l'effet de chargement repart avec la nouvelle clé.
  const reload = useCallback(() => {
    hydratedRef.current.clear()
    setNonce((value) => value + 1)
  }, [])

  return {
    queue,
    cursor,
    remaining,
    shelf,
    shelves,
    sources,
    phase: effectivePhase,
    offline,
    refilling,
    advance,
    rewind,
    selectShelf,
    toggleSource,
    selectAllSources,
    reload,
  }
}
