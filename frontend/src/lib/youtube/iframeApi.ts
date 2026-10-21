/**
 * API IFrame de YouTube, partagée : la musique d'ambiance (`lib/audio/youtubePlayer.ts`) et le
 * fil « Edits » (`components/edits/`). Le script n'est chargé qu'une fois, au premier besoin.
 * Types minimaux écrits ici (pas de dépendance @types).
 */

export const YT_STATE = { Unstarted: -1, Ended: 0, Playing: 1, Paused: 2, Buffering: 3, Cued: 5 } as const

export interface YTPlayer {
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
  mute(): void
  unMute(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  /** Non documentée mais stable depuis des années ; absente, on se passe du titre (et du direct). */
  getVideoData?: () => { title?: string; isLive?: boolean } | undefined
  getIframe(): HTMLIFrameElement
  destroy(): void
}

export interface YTPlayerEvent<T = undefined> {
  target: YTPlayer
  data: T
}

export interface YTPlayerOptions {
  width: number | string
  height: number | string
  videoId?: string
  /** `https://www.youtube-nocookie.com` : sans cookie de suivi. */
  host?: string
  playerVars: Record<string, string | number>
  events: {
    onReady: (event: YTPlayerEvent) => void
    onStateChange: (event: YTPlayerEvent<number>) => void
    onError: (event: YTPlayerEvent<number>) => void
  }
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_URL = 'https://www.youtube.com/iframe_api'
let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
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
      // Hors-ligne ou bloqué : on retentera au prochain appel.
      apiPromise = null
      script.remove()
      reject(new Error('YouTube IFrame API injoignable'))
    }
    document.head.append(script)
  })
  return apiPromise
}
