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

describe('lecteur : durée et ajouts', () => {
  it('durée lisible', async () => {
    const { formatClock } = await import('../src/lib/audio/clock')
    assert.equal(formatClock(0), '0:00')
    assert.equal(formatClock(187.9), '3:07')
    assert.equal(formatClock(3765), '1:02:45')
    assert.equal(formatClock(Number.NaN), '0:00')
    assert.equal(formatClock(-5), '0:00')
  })

  it('ajout : doublon signalé, dernière playlist retenue', () => {
    const store = useAmbientStore.getState()
    const id = store.createPlaylist('Pluie') as string
    assert.equal(store.addTrack(id, { kind: 'video', ref: 'jfKfPfyJRdk', title: 'Lofi' }), 'added')
    assert.equal(store.addTrack(id, { kind: 'video', ref: 'jfKfPfyJRdk', title: 'Lofi' }), 'duplicate')
    assert.equal(store.addTrack('inconnue', { kind: 'video', ref: 'x', title: null }), 'missing')
    assert.equal(useAmbientStore.getState().lastPlaylistId, id)
  })

  it('import d’une playlist YouTube : une playlist garnie d’un coup, sans doublon', () => {
    const id = useAmbientStore.getState().importPlaylist('The Best of The Cure', [
      { kind: 'video', ref: 'scif2vfg1ug', title: 'In Between Days' },
      { kind: 'video', ref: 'n3nPiBai66M', title: 'Just Like Heaven' },
      { kind: 'video', ref: 'n3nPiBai66M', title: 'Just Like Heaven' },
    ])
    const playlist = useAmbientStore.getState().playlists.find((entry) => entry.id === id)
    assert.equal(playlist?.name, 'The Best of The Cure')
    assert.deepEqual(playlist?.tracks.map((track) => track.ref), ['scif2vfg1ug', 'n3nPiBai66M'])
    assert.equal(useAmbientStore.getState().lastPlaylistId, id)
  })
})

describe('playlist YouTube versée morceau par morceau', () => {
  const video = (ref: string) => ({ kind: 'video' as const, ref, title: ref })

  it('ajout groupé : sans doublon, dans la limite, avec son bilan', () => {
    const store = useAmbientStore.getState()
    const id = store.createPlaylist('Cure') as string
    store.addTrack(id, video('a1'))
    const report = store.addTracks(id, [video('a1'), video('b2'), video('c3'), video('c3')])
    assert.deepEqual(report, { added: 2, duplicates: 2, overflow: 0 })
    assert.deepEqual(useAmbientStore.getState().playlists.find((p) => p.id === id)?.tracks.map((t) => t.ref), ['a1', 'b2', 'c3'])
    assert.equal(store.addTracks('inconnue', [video('x')]), null)
  })

  it('une playlist gardée d’un bloc est remplacée par ses morceaux, à sa place', () => {
    const store = useAmbientStore.getState()
    const id = store.createPlaylist('Ancienne') as string
    store.addTrack(id, video('avant'))
    store.addTrack(id, { kind: 'playlist', ref: 'PLxA687tYuMWjwLHZv1RP_4uw7OFRk443S', title: 'Best of' })
    store.addTrack(id, video('apres'))
    const block = useAmbientStore.getState().playlists.find((p) => p.id === id)!.tracks[1]!
    const report = store.expandTrack(id, block.id, [video('m1'), video('avant'), video('m2')])
    assert.deepEqual(report, { added: 2, duplicates: 1, overflow: 0 })
    const tracks = useAmbientStore.getState().playlists.find((p) => p.id === id)!.tracks
    assert.deepEqual(tracks.map((t) => t.ref), ['avant', 'm1', 'm2', 'apres'])
    assert.ok(tracks.every((t) => t.kind === 'video'))
  })
})

describe('playlists synchronisées avec le compte', () => {
  const track = { id: 't1', kind: 'video' as const, ref: 'lTRiuFIWV54', title: 'Lofi' }
  const local = (id: string, name: string, updatedAt: number) => ({ id, name, tracks: [track], createdAt: 1, updatedAt })
  const remote = (id: string, name: string, updatedAt: number, deleted = false) => ({ id, name, tracks: deleted ? [] : [track], createdAt: 1, updatedAt, deleted })

  it('créée sur un autre appareil : elle arrive ; modifiée ici depuis : la nôtre reste', async () => {
    const { mergeRemote } = await import('../src/store/useAmbientStore')
    const merged = mergeRemote([local('a', 'Ici, plus récente', 50)], [], [remote('a', 'Compte', 40), remote('b', 'Du PC', 30)])
    assert.deepEqual(merged.playlists.map((p) => p.name), ['Ici, plus récente', 'Du PC'])
    const newer = mergeRemote([local('a', 'Ancienne', 10)], [], [remote('a', 'Renommée sur le PC', 40)])
    assert.equal(newer.playlists[0]?.name, 'Renommée sur le PC')
  })

  it('suppressions : dans les deux sens, confirmées puis oubliées', async () => {
    const { mergeRemote } = await import('../src/store/useAmbientStore')
    // Supprimée sur le PC après notre dernière modification : elle disparaît ici.
    assert.deepEqual(mergeRemote([local('a', 'A', 10)], [], [remote('a', 'A', 20, true)]).playlists, [])
    // Modifiée ici après la suppression sur le PC : elle reste (et repartira).
    assert.equal(mergeRemote([local('a', 'A', 30)], [], [remote('a', 'A', 20, true)]).playlists.length, 1)
    // Supprimée ici, pas encore envoyée : le compte la renvoie vivante, elle reste supprimée.
    const pending = mergeRemote([], [{ id: 'a', createdAt: 1, deletedAt: 25 }], [remote('a', 'A', 20)])
    assert.deepEqual(pending.playlists, [])
    assert.equal(pending.deletedPlaylists.length, 1)
    // Le compte a enregistré la suppression : plus rien en attente.
    assert.deepEqual(mergeRemote([], [{ id: 'a', createdAt: 1, deletedAt: 25 }], [remote('a', 'A', 25, true)]).deletedPlaylists, [])
  })

  it('chaque modification date la playlist ; une suppression part en attente d’envoi', () => {
    const store = useAmbientStore.getState()
    const id = store.createPlaylist('Datée') as string
    const before = useAmbientStore.getState().playlists.find((p) => p.id === id)!.updatedAt
    store.renamePlaylist(id, 'Datée 2')
    const after = useAmbientStore.getState().playlists.find((p) => p.id === id)!.updatedAt
    assert.ok(after > before)
    store.deletePlaylist(id)
    assert.ok(useAmbientStore.getState().deletedPlaylists.some((entry) => entry.id === id && entry.deletedAt > after - 1))
  })
})
