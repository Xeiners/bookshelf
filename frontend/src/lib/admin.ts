/**
 * Administration côté front — fonctions pures, testées (`frontend/test/admin.test.ts`) :
 * la phrase d'une action du journal, lue dans des détails venus du serveur (donc
 * relus avec méfiance : un champ manquant ne casse jamais l'affichage).
 */
import type { Dictionary } from '../i18n/fr'
import type { AdminAuditEntry } from '../services/adminApi'

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 1)

const MODERATED_FIELDS = ['displayName', 'bio', 'avatar', 'makePrivate', 'cancelOffers'] as const

/** « a offert 3 boosters « Merci ! » », « a modéré : pseudo, avatar »… */
export function describeAction(entry: AdminAuditEntry, t: Dictionary): string {
  const copy = t.admin.audit
  const { details } = entry
  const message = text(details.message)
  const withMessage = (line: string) => (message ? `${line} ${copy.message(message)}` : line)
  switch (entry.action) {
    case 'gift_boosters':
      return withMessage(copy.giftBoosters(count(details.count)))
    case 'gift_card':
      return withMessage(copy.giftCard(text(details.cardName) ?? '?', count(details.count)))
    case 'suspend':
      return copy.suspend(text(details.reason))
    case 'unsuspend':
      return copy.unsuspend
    case 'moderate': {
      const fields = Array.isArray(details.fields) ? details.fields : []
      const labels = MODERATED_FIELDS.filter((field) => fields.includes(field)).map((field) => copy.fields[field])
      return copy.moderate(labels.join(', ') || '—')
    }
  }
}

/** Nom affiché d'un compte : son pseudo, sinon le libellé « sans pseudo ». */
export const accountName = (user: { displayName: string | null }, anonymous: string) => user.displayName?.trim() || anonymous
