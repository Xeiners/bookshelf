/**
 * Lecteur de musique d'ambiance, partagé par toute l'application : un
 * `YT.Player` invisible (1 px, hors du flux, sans pointeur) dont on ne garde
 * que le son. L'API IFrame n'est chargée qu'au premier `play()`, et `stop()`
 * détruit l'iframe : rien ne tourne tant qu'aucune musique n'est lancée.
 *
 * Il lit une file de morceaux (vidéos ou playlists YouTube) : une seule entrée
 * boucle sur elle-même, plusieurs s'enchaînent puis reprennent au début.
 *
 *   ambientPlayer.play('https://youtu.be/jfKfPfyJRdk')
 *   ambientPlayer.playQueue(['jfKfPfyJRdk', 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'], { key: 'playlist:abc' })
 *   ambientPlayer.setVolume(40)
 *   ambientPlayer.next()
 */

export type AmbientSource = { kind: 'video'; id: string } | { kind: 'playlist'; id: string }

export type AmbientPlayingState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface AmbientSnapshot {
  state: AmbientPlayingState
  /** Morceau en cours. */
  source: AmbientSource | null
  /** Titre annoncé par YouTube, une fois la lecture partie. */
  title: string | null
  /** Ce qui a été lancé (ambiance, playlist enregistrée, lien collé), tel que fourni à `playQueue`. */
  key: string | null
  /** Position dans la file (0 → `length - 1`). */
  index: number
  length: number
}

const VIDEO_ID = /^[\w-]{11}$/
/** Playlists (PL), mix (RD), albums (OLAK5uy_), uploads d'une chaîne (UU)… */
const PLAYLIST_ID = /^(PL|OL|UU|LL|FL|RD|UL|PU)[\w-]{10,}$/

/**
 * Lien ou identifiant YouTube → vidéo ou playlist. Accepte `watch?v=`,
 * `youtu.be/`, `shorts/`, `live/`, `embed/`, `playlist?list=` et les
 * identifiants nus. Un lien vers une vidéo dans un mix automatique (`RD…`)
 * joue la vidéo : ces mix ne se chargent pas comme des playlists.
 */
export function parseYouTubeSource(input: string): AmbientSource | null {
  const value = input.trim()
  if (!value) return null
  if (VIDEO_ID.test(value)) return { kind: 'video', id: value }
  if (PLAYLIST_ID.test(value)) return { kind: 'playlist', id: value }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let videoId: string | null = null
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null
  } else {
    return null
  }
  if (videoId !== null && !VIDEO_ID.test(videoId)) videoId = null

  const list = url.searchParams.get('list')
  if (list && PLAYLIST_ID.test(list) && !(videoId && list.startsWith('RD'))) return { kind: 'playlist', id: list }
  return videoId ? { kind: 'video', id: videoId } : null
}

/** Page publique du morceau (oEmbed, partage). */
export const youTubeUrl = (source: AmbientSource) =>
  source.kind === 'video'
    ? `https://www.youtube.com/watch?v=${source.id}`
    : `https://www.youtube.com/playlist?list=${source.id}`

/* ---- Types minimaux de l'API IFrame (pas de dépendance @types) -------------- */

const YT_STATE = { Unstarted: -1, Ended: 0, Playing: 1, Paused: 2 } as const

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  loadVideoById(videoId: string): void
  loadPlaylist(options: { list: string; listType: 'playlist' }): void
  nextVideo(): void
  previousVideo(): void
  playVideoAt(index: number): void
  getPlaylist(): string[] | null
  getPlaylistIndex(): number
  setLoop(loop: boolean): void
  setVolume(volume: number): void
  unMute(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  /** Non documentée mais stable depuis des années ; absente, on se passe du titre. */
  getVideoData?: () => { title?: string } | undefined
  destroy(): void
}

interface YTPlayerEvent<T = undefined> {
  target: YTPlayer
  data: T
}

interface YTPlayerOptions {
  width: number
  height: number
  playerVars: Record<string, string | number>
  events: {
    onReady: (event: YTPlayerEvent) => void
    onStateChange: (event: YTPlayerEvent<number>) => void
    onError: (event: YTPlayerEvent<number>) => void
  }
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

/* ---- Chargement de l'API ------------------------------------------------------ */

const API_URL = 'https://www.youtube.com/iframe_api'
let apiPromise: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    // L'API appelle ce global une fois prête : on chaîne un éventuel appelant précédent.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube IFrame API sans Player'))
    }
    const script = document.createElement('script')
    script.src = API_URL
    script.async = true
    script.onerror = () => {
      // Hors-ligne ou bloqué : on retentera au prochain `play()`.
      apiPromise = null
      script.remove()
      reject(new Error('YouTube IFrame API injoignable'))
    }
    document.head.append(script)
  })
  return apiPromise
}

/* ---- Lecteur ------------------------------------------------------------------ */

/** Sans `PLAYING` passé ce délai, le navigateur a bloqué la lecture automatique. */
const AUTOPLAY_TIMEOUT_MS = 6000

let player: YTPlayer | null = null
let ready = false
let container: HTMLDivElement | null = null
/** Incrémenté à chaque changement de morceau et à `stop()` : un chargement dépassé s'abandonne. */
let generation = 0
let volume = 50
let queue: AmbientSource[] = []
let index = 0
/** Morceaux en erreur d'affilée : au-delà de la taille de la file, on abandonne. */
let failures = 0
let autoplayTimer: ReturnType<typeof setTimeout> | undefined

const IDLE: AmbientSnapshot = { state: 'idle', source: null, title: null, key: null, index: 0, length: 0 }
let snapshot = IDLE
const listeners = new Set<() => void>()

function emit(change: Partial<AmbientSnapshot>) {
  snapshot = { ...snapshot, ...change }
  for (const listener of listeners) listener()
}

const currentSource = (): AmbientSource | null => queue[index] ?? null

function watchAutoplay() {
  clearTimeout(autoplayTimer)
  autoplayTimer = setTimeout(() => {
    // Bloquée (aucun geste utilisateur transmis à l'iframe) : le bouton Lecture relancera.
    if (snapshot.state === 'loading') emit({ state: 'paused' })
  }, AUTOPLAY_TIMEOUT_MS)
}

function clearAutoplayTimer() {
  clearTimeout(autoplayTimer)
  autoplayTimer = undefined
}

function load(target: YTPlayer, source: AmbientSource) {
  if (source.kind === 'video') target.loadVideoById(source.id)
  else target.loadPlaylist({ list: source.id, listType: 'playlist' })
  watchAutoplay()
}

/** Dernière vidéo d'une playlist YouTube (ou vidéo seule) ? */
function atLastVideo(target: YTPlayer): boolean {
  const list = target.getPlaylist()
  return !list || target.getPlaylistIndex() >= list.length - 1
}

/** Fin du morceau en cours : le suivant de la file, ou le même en boucle. */
function advance(target: YTPlayer) {
  if (queue.length > 1) {
    go(index + 1)
    return
  }
  if (currentSource()?.kind === 'playlist') target.playVideoAt(0)
  else {
    target.seekTo(0, true)
    target.playVideo()
  }
}

function create(YT: YTNamespace) {
  container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
  })
  const target = document.createElement('div')
  container.append(target)
  document.body.append(container)

  player = new YT.Player(target, {
    width: 1,
    height: 1,
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      loop: 1,
      playsinline: 1,
      iv_load_policy: 3,
      origin: window.location.origin,
    },
    events: {
      onReady: (event) => {
        if (event.target !== player) return
        ready = true
        event.target.setVolume(volume)
        if (volume > 0) event.target.unMute()
        const source = currentSource()
        if (source) load(event.target, source)
      },
      onStateChange: (event) => {
        if (event.target !== player) return
        switch (event.data) {
          case YT_STATE.Playing:
            clearAutoplayTimer()
            failures = 0
            // Une playlist seule boucle d'elle-même ; dans une file, sa fin passe au morceau suivant.
            if (currentSource()?.kind === 'playlist') event.target.setLoop(queue.length === 1)
            // Relu à chaque vidéo : une playlist change de titre en cours de route.
            emit({ state: 'playing', title: event.target.getVideoData?.()?.title || null })
            break
          case YT_STATE.Paused:
            emit({ state: 'paused' })
            break
          case YT_STATE.Ended:
            // Au sein d'une playlist YouTube, la vidéo suivante se charge d'elle-même.
            if (atLastVideo(event.target)) advance(event.target)
            break
          case YT_STATE.Unstarted:
          default:
            break
        }
      },
      onError: (event) => {
        // 2 : identifiant invalide, 100 : introuvable, 101/150 : intégration refusée.
        if (event.target !== player) return
        clearAutoplayTimer()
        failures++
        if (queue.length > 1 && failures < queue.length) go(index + 1)
        else emit({ state: 'error', title: null })
      },
    },
  })
}

/** Joue `queue[index]` : réutilise l'iframe, ou la crée au premier morceau. */
function start() {
  const source = currentSource()
  if (!source) return
  const run = ++generation
  emit({ state: 'loading', source, title: null, index, length: queue.length })
  if (player) {
    // En cours de création : `onReady` chargera le morceau courant.
    if (ready) load(player, source)
    return
  }
  loadApi()
    .then((YT) => {
      if (run !== generation || player) return
      create(YT)
    })
    .catch(() => {
      if (run === generation) emit({ state: 'error' })
    })
}

function go(to: number) {
  if (queue.length === 0) return
  index = ((to % queue.length) + queue.length) % queue.length
  start()
}

/**
 * Lance une file de morceaux (liens ou identifiants). Les entrées non
 * reconnues sont ignorées ; `false` si aucune ne l'est.
 */
function playQueue(inputs: readonly string[], options: { key?: string; index?: number } = {}): boolean {
  const sources = inputs.map(parseYouTubeSource).filter((source): source is AmbientSource => source !== null)
  if (sources.length === 0) return false
  queue = sources
  index = Math.min(Math.max(0, options.index ?? 0), sources.length - 1)
  failures = 0
  emit({ key: options.key ?? inputs[0] ?? null })
  start()
  return true
}

function play(input: string, key?: string): boolean {
  return playQueue([input], { key: key ?? input })
}

/** Vidéo suivante de la playlist YouTube en cours, sinon morceau suivant de la file. */
function next() {
  if (player && ready && currentSource()?.kind === 'playlist' && !atLastVideo(player)) {
    player.nextVideo()
    return
  }
  if (queue.length > 1) go(index + 1)
  else if (player && ready) advance(player)
}

function previous() {
  if (player && ready && currentSource()?.kind === 'playlist' && player.getPlaylistIndex() > 0) {
    player.previousVideo()
    return
  }
  if (queue.length > 1) go(index - 1)
  else if (player && ready) {
    player.seekTo(0, true)
    player.playVideo()
  }
}

function pause() {
  clearAutoplayTimer()
  if (player && ready) player.pauseVideo()
  if (snapshot.state !== 'idle') emit({ state: 'paused' })
}

/** Reprend le morceau en cours (après une pause ou un blocage de lecture automatique). */
function resume() {
  if (!currentSource()) return
  if (!player) {
    start()
    return
  }
  if (!ready) return
  emit({ state: 'loading' })
  player.playVideo()
  watchAutoplay()
}

/** Coupe le son, vide la file et libère l'iframe. */
function stop() {
  generation++
  clearAutoplayTimer()
  player?.destroy()
  player = null
  ready = false
  container?.remove()
  container = null
  queue = []
  index = 0
  failures = 0
  snapshot = IDLE
  for (const listener of listeners) listener()
}

function setVolume(value: number) {
  volume = Math.round(Math.min(100, Math.max(0, value)))
  if (!player || !ready) return
  player.setVolume(volume)
  if (volume > 0) player.unMute()
}

export const ambientPlayer = {
  /** Lance une vidéo ou une playlist YouTube (lien ou identifiant). `false` si l'entrée n'est pas reconnue. */
  play,
  playQueue,
  next,
  previous,
  pause,
  resume,
  stop,
  setVolume,
  getPlayingState: (): AmbientPlayingState => snapshot.state,
  getSnapshot: (): AmbientSnapshot => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
