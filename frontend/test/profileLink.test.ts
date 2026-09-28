import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { profileIdFromSearch, profileLink, withoutProfileParam } from '../src/lib/profileLink'

describe('lien de profil public', () => {
  it('construit et relit le lien', () => {
    const link = profileLink('cmg1abc2def3ghi4', 'https://bookshelf.findi.cc', '/')
    assert.equal(link, 'https://bookshelf.findi.cc/?u=cmg1abc2def3ghi4')
    assert.equal(profileIdFromSearch(new URL(link).search), 'cmg1abc2def3ghi4')
  })

  it('ignore un identifiant absent ou mal formé', () => {
    assert.equal(profileIdFromSearch(''), null)
    assert.equal(profileIdFromSearch('?u='), null)
    assert.equal(profileIdFromSearch('?u=../profile'), null)
    assert.equal(profileIdFromSearch('?u=court'), null)
  })

  it('retire le paramètre sans toucher aux autres', () => {
    assert.equal(withoutProfileParam('https://x.fr/?u=cmg1abc2def3ghi4&ref=mail#top'), '/?ref=mail#top')
    assert.equal(withoutProfileParam('https://x.fr/app?u=cmg1abc2def3ghi4'), '/app')
  })
})
