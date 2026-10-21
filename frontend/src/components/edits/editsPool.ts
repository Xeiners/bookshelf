import { YT_STATE, loadYouTubeApi, type YTPlayer } from '../../lib/youtube/iframeApi'

/*
 * Réserve de lecteurs du fil « Edits » : QUATRE lecteurs YouTube créés une seule fois, puis
 * réutilisés d'une vidéo à l'autre (`loadVideoById`), au lieu d'un lecteur neuf par vidéo.
 *
 * Pourquoi : les navigateurs (Safari iOS surtout) n'accordent le son qu'à un lecteur « autorisé »
 * par un geste de l'utilisateur. Un lecteur neuf repart muet — le son disparaissait après deux
 * ou trois vidéos. Ici, chaque geste (bouton du son, toucher pour la pause) autorise les quatre
 * lecteurs d'un coup, et ils le restent puisqu'ils ne sont jamais recréés.
 *
 * Les lecteurs couvrent la vidéo à l'écran, celle d'avant et les deux suivantes : les voisines sont
 * chargées sans le son puis arrêtées sur leur première image, prêtes à partir sans écran noir.
 * Chaque lecteur est posé sur sa diapositive (position absolue dans le contenu défilant) : en
 * changer ne recharge pas l'iframe, seule sa vidéo change.
 */

export const POOL_SIZE = 4
/** Hauteur rognée en haut et en bas du lecteur YouTube : ses bandeaux (titre, « Plus de vidéos »). */
const CHROME_PX = 72

interface Slot {
  /** Cadre de la taille d'une diapositive, qui rogne le lecteur. */
  frame: HTMLDivElement
  player: YTPlayer | null
  ready: boolean
  /** Position dans le fil (-1 : libre), et la vidéo chargée. */
  index: number
  id: string | null
  /** Vidéo réellement chargée dans le lecteur (il peut n'être prêt qu'après son affectation). */
  loaded: string | null
}

export interface PoolEvents {
  /** La vidéo à l'écran joue vraiment (l'affiche peut s'effacer). */
  onPlaying: (index: number) => void
  /** YouTube refuse cette vidéo (intégration interdite, supprimée). */
  onFailed: (id: string) => void
}

export class EditsPool {
  private slots: Slot[] = []
  private ids: readonly string[] = []
  private active = 0
  private height = 0
  private muted = true
  private paused = false
  private destroyed = false

  private readonly layer: HTMLElement
  private readonly events: PoolEvents

  constructor(layer: HTMLElement, events: PoolEvents) {
    this.layer = layer
    this.events = events
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const frame = document.createElement('div')
      Object.assign(frame.style, { position: 'absolute', left: '0', right: '0', top: '0', overflow: 'hidden', visibility: 'hidden' })
      const host = document.createElement('div')
      Object.assign(host.style, { position: 'absolute', left: '0', right: '0', top: `${-CHROME_PX}px`, bottom: `${-CHROME_PX}px` })
      const target = document.createElement('div')
      host.append(target)
      frame.append(host)
      layer.append(frame)
      this.slots.push({ frame, player: null, ready: false, index: -1, id: null, loaded: null })
    }
    void this.create()
  }

  private async create() {
    const YT = await loadYouTubeApi().catch(() => null)
    if (!YT || this.destroyed) return
    for (const slot of this.slots) {
      const target = slot.frame.firstElementChild?.firstElementChild as HTMLElement | null
      if (!target) continue
      new YT.Player(target, {
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: (event) => {
            if (this.destroyed) return
            slot.player = event.target
            slot.ready = true
            const iframe = event.target.getIframe()
            Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' })
            if (this.muted) event.target.mute()
            else event.target.unMute()
            this.sync()
          },
          onStateChange: (event) => this.onState(slot, event.data),
          onError: () => {
            if (slot.id) this.events.onFailed(slot.id)
          },
        },
      })
    }
  }

  private onState(slot: Slot, state: number) {
    const player = slot.player
    if (!player || this.destroyed) return
    const isActive = slot.index === this.active
    if (state === YT_STATE.Playing) {
      if (!isActive) {
        // Voisine préchargée : elle a assez tamponné, on l'arrête sur sa première image.
        player.pauseVideo()
        player.seekTo(0, true)
      } else if (this.paused) player.pauseVideo()
      else this.events.onPlaying(slot.index)
    } else if (state === YT_STATE.Ended && isActive) {
      // En boucle, comme sur TikTok.
      player.seekTo(0, true)
      player.playVideo()
    }
  }

  /** Le fil (identifiants dans l'ordre) et la vidéo à l'écran : chaque lecteur prend sa place. */
  update(ids: readonly string[], active: number) {
    const previous = this.active
    this.ids = ids
    this.active = active
    if (previous !== active) this.paused = false
    this.sync(previous)
  }

  /** Hauteur d'une diapositive (l'écran du fil). */
  layout(height: number) {
    this.height = height
    for (const slot of this.slots) this.place(slot)
  }

  private place(slot: Slot) {
    Object.assign(slot.frame.style, {
      height: `${this.height}px`,
      transform: `translateY(${Math.max(0, slot.index) * this.height}px)`,
      visibility: slot.index >= 0 ? 'visible' : 'hidden',
    })
  }

  private sync(previous = this.active) {
    if (this.destroyed) return
    const wanted: number[] = []
    for (let index = this.active - 1; index <= this.active + POOL_SIZE - 2; index += 1) if (index >= 0 && index < this.ids.length) wanted.push(index)
    // Les lecteurs déjà sur une vidéo voulue la gardent ; les autres sont réaffectés.
    const kept = new Set<number>()
    const free: Slot[] = []
    for (const slot of this.slots) {
      if (slot.index >= 0 && wanted.includes(slot.index) && slot.id === this.ids[slot.index]) kept.add(slot.index)
      else free.push(slot)
    }
    for (const index of wanted) {
      if (kept.has(index)) continue
      const slot = free.shift()
      if (!slot) break
      slot.index = index
      slot.id = this.ids[index] ?? null
      this.place(slot)
    }
    for (const slot of free) {
      if (wanted.includes(slot.index)) continue
      slot.index = -1
      slot.id = null
      this.place(slot)
      if (slot.ready) slot.player?.pauseVideo()
    }
    // Vidéo à charger (lecteur réaffecté, ou prêt seulement maintenant) : sans le son ; une voisine
    // s'arrêtera seule sur sa première image (cf. onState).
    for (const slot of this.slots) {
      if (!slot.ready || !slot.player || !slot.id || slot.loaded === slot.id) continue
      slot.player.mute()
      slot.player.loadVideoById(slot.id)
      slot.loaded = slot.id
    }
    // L'ancienne vidéo s'arrête et se rembobine ; la nouvelle part de zéro, au son choisi.
    for (const slot of this.slots) {
      if (!slot.ready || !slot.player) continue
      if (slot.index === previous && previous !== this.active) {
        slot.player.pauseVideo()
        slot.player.seekTo(0, true)
        slot.player.mute()
      }
      if (slot.index === this.active) {
        if (this.muted) slot.player.mute()
        else slot.player.unMute()
        if (previous !== this.active) slot.player.seekTo(0, true)
        if (this.paused) slot.player.pauseVideo()
        else slot.player.playVideo()
      }
    }
  }

  private activeSlot(): Slot | undefined {
    return this.slots.find((slot) => slot.index === this.active && slot.ready)
  }

  /**
   * Le son. À appeler DANS le geste de l'utilisateur (gestionnaire de clic) : c'est ce geste qui
   * autorise le son. Les quatre lecteurs le reçoivent ; seule la vidéo à l'écran le garde.
   */
  setMuted(muted: boolean) {
    this.muted = muted
    for (const slot of this.slots) {
      if (!slot.ready || !slot.player) continue
      slot.player.unMute()
      if (muted || slot.index !== this.active) slot.player.mute()
    }
  }

  /** Pause ou reprise (dans le geste, lui aussi : il renouvelle l'autorisation du son). */
  setPaused(paused: boolean) {
    this.paused = paused
    const slot = this.activeSlot()
    if (!slot?.player) return
    if (!this.muted) slot.player.unMute()
    if (paused) slot.player.pauseVideo()
    else slot.player.playVideo()
  }

  /** Position et durée de la vidéo à l'écran (secondes). */
  progress(): { current: number; duration: number } | null {
    const player = this.activeSlot()?.player
    if (!player) return null
    return { current: player.getCurrentTime(), duration: player.getDuration() }
  }

  seek(seconds: number) {
    this.activeSlot()?.player?.seekTo(seconds, true)
  }

  destroy() {
    this.destroyed = true
    for (const slot of this.slots) slot.player?.destroy()
    this.layer.replaceChildren()
  }
}
