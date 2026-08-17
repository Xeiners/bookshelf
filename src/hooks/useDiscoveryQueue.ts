import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shelf } from '../services/openLibrary'
import { SHELVES, fetchShelf, fetchSynopsis, getCachedSynopsis, randomPage } from '../services/openLibrary'
import { SEED_BOOKS } from '../services/seedBooks'
import { knownIds, useLibraryStore } from '../store/useLibraryStore'
import type { Book } from '../types/book'

/** Cible de cartes « fraîches » par requête réseau. */
const MIN_BATCH = 12
/**
 * Seuil de recharge en tâche de fond, volontairement large : si la file tombe à
 * zéro, le deck est démonté et rejoue toute son animation d'entrée au retour.
 */
const REFILL_THRESHOLD = 8
/** Nombre de cartes dont on préchauffe le synopsis. */
const HYDRATE_WINDOW = 3
/** Un synopsis plus court que ça mérite d'être hydraté depuis /works. */
const SYNOPSIS_MIN_LENGTH = 140

export type QueuePhase = 'loading' | 'ready' | 'empty' | 'error'

export interface DiscoveryQueue {
  queue: Book[]
  cursor: number
  remaining: number
  shelf: Shelf
  phase: QueuePhase
  /** `true` = API injoignable, on tourne sur le jeu de secours local. */
  offline: boolean
  /** Un renfort est en route : ne jamais annoncer l'étagère épuisée. */
  refilling: boolean
  advance: () => void
  selectShelf: (shelf: Shelf) => void
  reload: () => void
}

/**
 * File d'attente du mode Découverte : charge une étagère, exclut les livres déjà
 * vus, se recharge avant la panne sèche, préchauffe les synopsis à venir et
 * bascule sur `SEED_BOOKS` si le réseau tombe.
 */
export function useDiscoveryQueue(): DiscoveryQueue {
  const entries = useLibraryStore((state) => state.entries)
  const skipped = useLibraryStore((state) => state.skipped)
  const known = useMemo(() => knownIds(entries, skipped), [entries, skipped])

  const [queue, setQueue] = useState<Book[]>([])
  const [cursor, setCursor] = useState(0)
  const [shelf, setShelf] = useState<Shelf>(SHELVES[0])
  const [phase, setPhase] = useState<QueuePhase>('loading')
  const [offline, setOffline] = useState(false)
  const [refilling, setRefilling] = useState(false)

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
  const usedPagesRef = useRef(new Set<string>())
  const hydratedRef = useRef(new Set<string>())

  /** Page non encore visitée pour cette étagère → variété entre les recharges. */
  const nextPage = useCallback((shelfId: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const page = randomPage()
      const key = `${shelfId}:${page}`
      if (!usedPagesRef.current.has(key)) {
        usedPagesRef.current.add(key)
        return page
      }
    }
    return randomPage()
  }, [])

  const load = useCallback(
    async (target: Shelf, mode: 'replace' | 'append') => {
      if (mode === 'append' && fetchingRef.current) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      fetchingRef.current = true

      if (mode === 'replace') setPhase('loading')
      else setRefilling(true)

      try {
        const seen = new Set(mode === 'append' ? queueRef.current.map((book) => book.id) : [])
        const harvest: Book[] = []

        // Plusieurs pages si nécessaire : les livres déjà vus sont filtrés.
        for (let attempt = 0; attempt < 3 && harvest.length < MIN_BATCH; attempt += 1) {
          const batch = await fetchShelf(target, {
            page: nextPage(target.id),
            signal: controller.signal,
          })
          for (const book of batch) {
            if (seen.has(book.id) || knownRef.current.has(book.id)) continue
            seen.add(book.id)
            harvest.push(book)
          }
        }

        setOffline(false)
        if (mode === 'replace') {
          setQueue(harvest)
          setCursor(0)
          setPhase(harvest.length > 0 ? 'ready' : 'empty')
        } else {
          setQueue((previous) => [...previous, ...harvest])
          setPhase('ready')
        }
      } catch {
        if (controller.signal.aborted) return
        if (mode !== 'replace') return

        // Repli hors-ligne : l'app reste utilisable sans réseau.
        const fallback = SEED_BOOKS.filter((book) => !knownRef.current.has(book.id))
        setQueue(fallback)
        setCursor(0)
        setOffline(true)
        setPhase(fallback.length > 0 ? 'ready' : 'error')
      } finally {
        // Une requête déjà remplacée ne doit pas libérer le verrou de la nouvelle.
        if (abortRef.current === controller) {
          fetchingRef.current = false
          setRefilling(false)
        }
      }
    },
    [nextPage],
  )

  useEffect(() => {
    void load(shelf, 'replace')
  }, [shelf, load])

  // Recharge anticipée : l'utilisateur ne doit jamais voir le fond de la pile.
  useEffect(() => {
    if (phase !== 'ready' || offline) return
    if (queue.length - cursor > REFILL_THRESHOLD) return
    void load(shelf, 'append')
  }, [phase, offline, queue.length, cursor, shelf, load])

  // Préchauffage des synopsis : la carte du dessus a son texte avant d'arriver.
  const hydrationTargets = queue
    .slice(cursor, cursor + HYDRATE_WINDOW)
    .filter((book) => book.synopsis.length < SYNOPSIS_MIN_LENGTH)
    .map((book) => book.id)
    .join('|')

  useEffect(() => {
    if (!hydrationTargets || offline) return
    const controller = new AbortController()

    void (async () => {
      for (const id of hydrationTargets.split('|')) {
        if (hydratedRef.current.has(id)) continue
        hydratedRef.current.add(id)

        try {
          const cached = getCachedSynopsis(id)
          const synopsis = cached ?? (await fetchSynopsis(id, controller.signal))
          if (controller.signal.aborted || !synopsis) continue
          setQueue((previous) =>
            previous.map((book) => (book.id === id ? { ...book, synopsis } : book)),
          )
        } catch {
          // Pas de résumé disponible : la première phrase fait office de teaser.
        }
      }
    })()

    return () => controller.abort()
  }, [hydrationTargets, offline])

  useEffect(() => () => abortRef.current?.abort(), [])

  const advance = useCallback(() => setCursor((value) => value + 1), [])

  const selectShelf = useCallback((next: Shelf) => {
    setShelf((current) => (current.id === next.id ? current : next))
  }, [])

  const reload = useCallback(() => {
    hydratedRef.current.clear()
    void load(shelf, 'replace')
  }, [load, shelf])

  return {
    queue,
    cursor,
    remaining: queue.length - cursor,
    shelf,
    phase,
    offline,
    refilling,
    advance,
    selectShelf,
    reload,
  }
}
