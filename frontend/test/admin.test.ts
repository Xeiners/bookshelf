import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { en } from '../src/i18n/en'
import { fr } from '../src/i18n/fr'
import { accountName, describeAction } from '../src/lib/admin'
import type { AdminAuditEntry } from '../src/services/adminApi'

const entry = (action: AdminAuditEntry['action'], details: Record<string, unknown>): AdminAuditEntry => ({
  id: 'a1',
  adminEmail: 'chef@example.com',
  targetUserId: 'u1',
  targetLabel: 'Alice',
  action,
  details,
  createdAt: '2026-10-02T10:00:00.000Z',
})

describe('administration — journal', () => {
  it('une phrase par action, dans la langue de l’app, avec le petit mot s’il y en a un', () => {
    assert.equal(describeAction(entry('gift_boosters', { count: 3, message: 'Merci !' }), fr), 'a offert 3 boosters « Merci ! »')
    assert.equal(describeAction(entry('gift_boosters', { count: 1 }), en), 'gifted 1 booster')
    assert.equal(describeAction(entry('gift_card', { cardName: 'Berserk', count: 2 }), fr), 'a offert Berserk ×2')
    assert.equal(describeAction(entry('suspend', { reason: 'Spam' }), fr), 'a suspendu le compte (Spam)')
    assert.equal(describeAction(entry('suspend', {}), en), 'suspended the account')
    assert.equal(describeAction(entry('unsuspend', {}), fr), 'a réactivé le compte')
    assert.equal(describeAction(entry('moderate', { fields: ['bio', 'displayName', 'inconnu'] }), fr), 'a modéré : pseudo, présentation')
  })

  it('des détails abîmés ne cassent jamais l’affichage', () => {
    assert.equal(describeAction(entry('gift_card', { count: 'beaucoup' }), fr), 'a offert ?')
    assert.equal(describeAction(entry('moderate', { fields: 'bio' }), fr), 'a modéré : —')
  })

  it('nom d’un compte : son pseudo, sinon le libellé « sans pseudo »', () => {
    assert.equal(accountName({ displayName: '  Mika ' }, fr.admin.anonymous), 'Mika')
    assert.equal(accountName({ displayName: null }, fr.admin.anonymous), 'Sans pseudo')
  })
})
