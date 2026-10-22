import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NEWS, NEWS_IDS, unseenCount } from '../src/lib/news'

describe('actus', () => {
  it('la plus récente d’abord, chaque actu une seule fois', () => {
    const dates = NEWS.map((entry) => entry.date)
    assert.deepEqual(dates, [...dates].sort().reverse())
    assert.equal(new Set(NEWS.map((entry) => entry.id)).size, NEWS.length)
    assert.ok(NEWS.every((entry) => (NEWS_IDS as readonly string[]).includes(entry.id)))
  })

  it('compte ce qui est plus récent que la dernière vue', () => {
    assert.equal(unseenCount(null), NEWS.length)
    assert.equal(unseenCount(NEWS[0]!.id), 0)
    assert.equal(unseenCount(NEWS[2]!.id), 2)
    assert.equal(unseenCount('inconnue'), NEWS.length)
  })
})
