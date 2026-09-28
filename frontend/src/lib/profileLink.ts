/**
 * Lien de partage d'un profil public : `https://…/?u=<id du compte>`.
 * L'app n'a pas de routeur : le paramètre est lu une fois au démarrage, puis
 * retiré de l'adresse (un rechargement ne rouvre pas le profil).
 */
const PARAM = 'u'
const USER_ID = /^[a-z0-9]{8,40}$/i

export const profileLink = (userId: string, origin: string, pathname = '/') =>
  `${origin}${pathname}?${PARAM}=${encodeURIComponent(userId)}`

/** Id de compte porté par une adresse (`?u=`), s'il est bien formé. */
export function profileIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(PARAM)
  return id && USER_ID.test(id) ? id : null
}

/** Adresse sans le paramètre de profil (les autres paramètres sont gardés). */
export function withoutProfileParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
