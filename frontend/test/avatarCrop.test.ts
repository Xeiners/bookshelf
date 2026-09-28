import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { avatarUrlWithCrop, parseAvatarUrl } from '../src/lib/avatarCrop.js'

describe('avatar de bibliothèque — cadrage persistant', () => {
  it('conserve la source et restitue zoom, position et masque', () => {
    const value = avatarUrlWithCrop('https://images.example/cover.jpg?size=large', {
      zoom: 1.35,
      x: 42,
      y: 28,
      mask: 'hexagon',
    })
    assert.deepEqual(parseAvatarUrl(value), {
      src: 'https://images.example/cover.jpg?size=large',
      crop: { zoom: 1.35, x: 42, y: 28, mask: 'hexagon' },
    })
  })

  it('borne les valeurs et utilise un cadrage sûr pour une ancienne URL', () => {
    const value = avatarUrlWithCrop('/api/books/book-1/cover', { zoom: 9, x: -2, y: 180, mask: 'circle' })
    assert.deepEqual(parseAvatarUrl(value).crop, { zoom: 2, x: 0, y: 100, mask: 'circle' })
    assert.equal(parseAvatarUrl('/api/books/book-1/cover').crop.mask, 'circle')
  })
})
