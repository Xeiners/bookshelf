import { useEffect, useRef, useState } from 'react'
import { profileApi, type MemberSummary } from '../services/profileApi'

const keep = (members: MemberSummary[], withoutSelf: boolean) => (withoutSelf ? members.filter((member) => !member.isSelf) : members)

interface MembersState {
  /** `null` : chargement. */
  members: MemberSummary[] | null
  next: string | null
  error: boolean
}

/**
 * Membres pour une saisie, un peu différée : sans texte, tous les membres page après page
 * (`loadMore`), sinon ceux dont le pseudo contient la saisie. `withoutSelf` : sans le compte
 * connecté (on ne s'informe pas soi-même).
 */
export function useMembers(query: string, options: { debounceMs?: number; withoutSelf?: boolean } = {}) {
  const { debounceMs = 220, withoutSelf = false } = options
  const term = query.trim()
  const [state, setState] = useState<MembersState>({ members: null, next: null, error: false })
  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Saisie en cours : une page suivante arrivée après un changement de saisie est ignorée. */
  const current = useRef(term)

  useEffect(() => {
    current.current = term
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setState({ members: null, next: null, error: false })
        profileApi
          .searchMembers(term, controller.signal)
          .then(({ members, next }) => setState({ members: keep(members, withoutSelf), next, error: false }))
          .catch(() => {
            if (!controller.signal.aborted) setState({ members: [], next: null, error: true })
          })
      },
      term ? debounceMs : 0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [term, attempt, debounceMs, withoutSelf])

  const loadMore = async () => {
    if (!state.next || loadingMore) return
    const asked = term
    setLoadingMore(true)
    try {
      const page = await profileApi.searchMembers(asked, undefined, state.next)
      if (current.current !== asked) return
      setState((previous) => ({ ...previous, members: [...(previous.members ?? []), ...keep(page.members, withoutSelf)], next: page.next }))
    } catch {
      // Réseau coupé : le bouton reste là, on réessaiera.
    } finally {
      setLoadingMore(false)
    }
  }

  return { ...state, loadingMore, loadMore: () => void loadMore(), retry: () => setAttempt((value) => value + 1) }
}
