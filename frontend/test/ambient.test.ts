import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AMBIENT_PRESETS, resolveAmbientSource, suggestAmbientPreset } from '../src/lib/audio/ambientPresets'
import { isCustomKey, playlistIdOf, playlistKey } from '../src/lib/audio/ambientPlayback'
import { parseYouTubeSource } from '../src/lib/audio/youtubePlayer'
import { sanitizePlaylists, useAmbientStore } from '../src/store/useAmbientStore'

describe('parseYouTubeSource', () => {
  it('reconnaît les identifiants nus', () => {
    assert.deepEqual(parseYouTubeSource(' jfKfPfyJRdk '), { kind: 'video', id: 'jfKfPfyJRdk' })
    assert.deepEqual(parseYouTubeSource('PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo'), {
      kind: 'playlist',
      id: 'PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo',
    })
  })

  it('lit les différentes formes de liens vidéo', () => {
    const video = { kind: 'video', id: 'jfKfPfyJRdk' }
    assert.deepEqual(parseYouTubeSource('https://www.youtube.com/watch?v=jfKfPfyJRdk&t=42'), video)
    assert.deepEqual(parseYouTubeSource('youtube.com/watch?v=jfKfPfyJRdk'), video)
    assert.deepEqual(parseYouTubeSource('https://youtu.be/jfKfPfyJRdk?si=abc'), video)
    assert.deepEqual(parseYouTubeSource('https://m.youtube.com/shorts/jfKfPfyJRdk'), video)
    assert.deepEqual(parseYouTubeSource('https://www.youtube.com/live/jfKfPfyJRdk'), video)
    assert.deepEqual(parseYouTubeSource('https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'), video)
  })

  it('préfère la playlist, sauf pour un mix automatique', () => {
    assert.deepEqual(parseYouTubeSource('https://www.youtube.com/watch?v=jfKfPfyJRdk&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), {
      kind: 'playlist',
      id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    })
    assert.deepEqual(parseYouTubeSource('https://music.youtube.com/playlist?list=OLAK5uy_kXYZ123456789'), {
      kind: 'playlist',
      id: 'OLAK5uy_kXYZ123456789',
    })
    assert.deepEqual(parseYouTubeSource('https://www.youtube.com/watch?v=jfKfPfyJRdk&list=RDjfKfPfyJRdk'), {
      kind: 'video',
      id: 'jfKfPfyJRdk',
    })
  })

  it('refuse le reste', () => {
    assert.equal(parseYouTubeSource(''), null)
    assert.equal(parseYouTubeSource('lofi chill'), null)
    assert.equal(parseYouTubeSource('https://vimeo.com/123456'), null)
    assert.equal(parseYouTubeSource('https://www.youtube.com/watch?v=trop-court'), null)
    assert.equal(parseYouTubeSource('https://www.youtube.com/@LofiGirl'), null)
  })
})

describe('suggestAmbientPreset', () => {
  it('suit le premier genre reconnu', () => {
    assert.equal(suggestAmbientPreset(['Romance', 'Fantasy'], 'rain'), 'lofi')
    assert.equal(suggestAmbientPreset(['Isekai', 'Comédie'], 'rain'), 'dark')
    assert.equal(suggestAmbientPreset(['Science-Fiction'], 'lofi'), 'synth')
    assert.equal(suggestAmbientPreset(['Tranche de vie'], 'rain'), 'lofi')
    assert.equal(suggestAmbientPreset(['Drame'], 'lofi'), 'rain')
  })

  it('revient au défaut sans genre reconnu', () => {
    assert.equal(suggestAmbientPreset([], 'rain'), 'rain')
    assert.equal(suggestAmbientPreset(['Cuisine'], 'lofi'), 'lofi')
  })
})

describe('resolveAmbientSource', () => {
  it('traduit un préréglage en vidéo et laisse passer un lien', () => {
    assert.equal(resolveAmbientSource('lofi'), AMBIENT_PRESETS.lofi.videoId)
    assert.equal(resolveAmbientSource('https://youtu.be/abc'), 'https://youtu.be/abc')
  })
})

describe('clés d’écoute', () => {
  it('distingue ambiance, playlist enregistrée et lien collé', () => {
    assert.equal(playlistIdOf(playlistKey('abc')), 'abc')
    assert.equal(playlistIdOf('lofi'), null)
    assert.equal(isCustomKey('lofi'), false)
    assert.equal(isCustomKey(playlistKey('abc')), false)
    assert.equal(isCustomKey('https://youtu.be/jfKfPfyJRdk'), true)
    assert.equal(isCustomKey(null), false)
  })
})

describe('playlists enregistrées', () => {
  it('écarte les entrées mal formées du stockage', () => {
    const playlists = sanitizePlaylists([
      { id: 'a', name: '  Nuit  ', createdAt: 1, tracks: [
        { id: 't1', kind: 'video', ref: 'jfKfPfyJRdk', title: 'Lofi' },
        { id: 't2', kind: 'audio', ref: 'x' },
        { id: 't3', kind: 'playlist', ref: '', title: null },
        { id: 't4', kind: 'playlist', ref: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', title: '' },
      ] },
      { id: 42, name: 'invalide' },
      'n’importe quoi',
    ])
    assert.equal(playlists.length, 1)
    assert.equal(playlists[0]?.name, 'Nuit')
    assert.deepEqual(playlists[0]?.tracks.map((track) => [track.id, track.title]), [['t1', 'Lofi'], ['t4', null]])
    assert.deepEqual(sanitizePlaylists(null), [])
  })

  it('crée, remplit, réordonne et supprime', () => {
    const store = useAmbientStore.getState()
    const id = store.createPlaylist('  Lecture   du soir ')
    assert.ok(id)
    const playlistId = id as string
    assert.ok(store.addTrack(playlistId, { kind: 'video', ref: 'jfKfPfyJRdk', title: 'A' }))
    assert.ok(store.addTrack(playlistId, { kind: 'video', ref: '4xDzrJKXOOY', title: 'B' }))
    const find = () => useAmbientStore.getState().playlists.find((entry) => entry.id === playlistId)
    assert.equal(find()?.name, 'Lecture du soir')

    const second = find()?.tracks[1]
    assert.ok(second)
    store.moveTrack(playlistId, second.id, -1)
    assert.deepEqual(find()?.tracks.map((track) => track.title), ['B', 'A'])
    store.moveTrack(playlistId, second.id, -1)
    assert.deepEqual(find()?.tracks.map((track) => track.title), ['B', 'A'])

    store.setLastSource(playlistKey(playlistId))
    store.deletePlaylist(playlistId)
    assert.equal(find(), undefined)
    assert.equal(useAmbientStore.getState().lastSource, null)
  })
})
