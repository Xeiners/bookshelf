/**
 * Bruitages des boosters (et carillon des notifications), synthétisés (WebAudio) : aucun fichier à charger.
 *
 * Une chaîne commune donne de l'espace et de la cohésion : chaque son part
 * « sec » vers un compresseur, et une partie passe par une réverbération
 * (réponse impulsionnelle générée : bruit stéréo à décroissance
 * exponentielle). Les timbres :
 * - papier (découpe, déchirure, retournement) : bruit filtré, modulé en
 *   amplitude pour le grain, balayé en fréquence pour le mouvement ;
 * - cloches (révélations) : partiels inharmoniques qui s'éteignent de plus
 *   en plus vite vers l'aigu — le timbre d'un verre ou d'un carillon ;
 * - nappe (Mythique) : dents de scie désaccordées, filtrées, attaque lente.
 *
 * Le contexte audio naît au premier son, donc après un geste de
 * l'utilisateur (exigence des navigateurs). Silencieux si WebAudio manque.
 */
import type { Rarity } from './boosters'

interface Engine {
  ctx: AudioContext
  /** Entrée sèche (vers le compresseur). */
  dry: GainNode
  /** Envoi vers la réverbération. */
  wet: GainNode
  noise: AudioBuffer
}

let engine: Engine | null = null

/** Réponse impulsionnelle : bruit stéréo qui décroît en `seconds`, un peu plus sombre à la fin. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    let smooth = 0
    for (let index = 0; index < length; index += 1) {
      const t = index / length
      // Léger filtrage passe-bas qui s'accentue : la queue s'assombrit, comme une vraie salle.
      smooth += (Math.random() * 2 - 1 - smooth) * (0.9 - t * 0.6)
      data[index] = smooth * Math.pow(1 - t, decay)
    }
  }
  return buffer
}

function start(): Engine | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  try {
    if (!engine) {
      const ctx = new AudioContext()
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.ratio.value = 3
      const master = ctx.createGain()
      master.gain.value = 0.8
      compressor.connect(master).connect(ctx.destination)

      const dry = ctx.createGain()
      dry.connect(compressor)
      const reverb = ctx.createConvolver()
      reverb.buffer = impulse(ctx, 2.6, 3.2)
      const wet = ctx.createGain()
      wet.gain.value = 0.55
      wet.connect(reverb).connect(compressor)

      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1
      engine = { ctx, dry, wet, noise }
    }
    if (engine.ctx.state === 'suspended') void engine.ctx.resume()
    return engine
  } catch {
    return null
  }
}

/** Branche un nœud sur la sortie : sec, et une part vers la réverbération. */
function route(e: Engine, node: AudioNode, send: number, pan = 0): void {
  let out: AudioNode = node
  if (pan !== 0) {
    const panner = e.ctx.createStereoPanner()
    panner.pan.value = pan
    node.connect(panner)
    out = panner
  }
  out.connect(e.dry)
  if (send > 0) {
    const gain = e.ctx.createGain()
    gain.gain.value = send
    out.connect(gain).connect(e.wet)
  }
}

/** Enveloppe : montée en `attack`, puis décroissance exponentielle jusqu'à `end`. */
function envelope(param: AudioParam, at: number, peak: number, attack: number, end: number): void {
  param.setValueAtTime(0.0001, at)
  param.linearRampToValueAtTime(peak, at + attack)
  param.exponentialRampToValueAtTime(0.0001, end)
}

/** Bruit filtré, avec balayage de fréquence et grain (modulation d'amplitude rapide). */
function noiseBurst(
  e: Engine,
  options: { at: number; duration: number; from: number; to: number; q: number; gain: number; grain?: number; send?: number; pan?: number; type?: BiquadFilterType },
): void {
  const { ctx } = e
  const source = ctx.createBufferSource()
  source.buffer = e.noise
  const filter = ctx.createBiquadFilter()
  filter.type = options.type ?? 'bandpass'
  filter.Q.value = options.q
  filter.frequency.setValueAtTime(options.from, options.at)
  filter.frequency.exponentialRampToValueAtTime(options.to, options.at + options.duration)
  const amp = ctx.createGain()
  envelope(amp.gain, options.at, options.gain, Math.min(0.02, options.duration / 4), options.at + options.duration)
  source.connect(filter).connect(amp)
  let out: AudioNode = amp
  if (options.grain) {
    // Grain de papier : l'amplitude tremble vite et irrégulièrement.
    const tremolo = ctx.createGain()
    const lfo = ctx.createOscillator()
    lfo.type = 'square'
    lfo.frequency.setValueAtTime(options.grain, options.at)
    lfo.frequency.linearRampToValueAtTime(options.grain * 1.8, options.at + options.duration)
    const depth = ctx.createGain()
    depth.gain.value = 0.45
    tremolo.gain.value = 0.55
    lfo.connect(depth).connect(tremolo.gain)
    amp.connect(tremolo)
    out = tremolo
    lfo.start(options.at)
    lfo.stop(options.at + options.duration + 0.05)
  }
  route(e, out, options.send ?? 0.15, options.pan)
  source.start(options.at, Math.random() * 1.5)
  source.stop(options.at + options.duration + 0.05)
}

/** Partiels d'une cloche de verre (rapports inharmoniques) et leur poids. */
const BELL = [
  [1, 1],
  [2.01, 0.45],
  [2.76, 0.35],
  [5.4, 0.18],
  [8.93, 0.08],
] as const

function bell(e: Engine, frequency: number, at: number, duration: number, gain: number, pan = 0): void {
  for (const [ratio, weight] of BELL) {
    const oscillator = e.ctx.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency * ratio
    const amp = e.ctx.createGain()
    // Les partiels aigus s'éteignent plus vite : le son se « pose ».
    envelope(amp.gain, at, gain * weight, 0.004, at + duration / Math.sqrt(ratio))
    oscillator.connect(amp)
    route(e, amp, 0.6, pan)
    oscillator.start(at)
    oscillator.stop(at + duration + 0.05)
  }
}

/** Grave rond : un sinus qui glisse vers le bas (impact, souffle). */
function boom(e: Engine, at: number, from: number, to: number, duration: number, gain: number): void {
  const oscillator = e.ctx.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(from, at)
  oscillator.frequency.exponentialRampToValueAtTime(to, at + duration)
  const amp = e.ctx.createGain()
  envelope(amp.gain, at, gain, 0.01, at + duration)
  oscillator.connect(amp)
  route(e, amp, 0.25)
  oscillator.start(at)
  oscillator.stop(at + duration + 0.05)
}

/** Nappe chorale : dents de scie désaccordées, filtrées, attaque lente (Mythique). */
function pad(e: Engine, frequencies: number[], at: number, duration: number, gain: number): void {
  const filter = e.ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(600, at)
  filter.frequency.linearRampToValueAtTime(2600, at + duration * 0.4)
  filter.Q.value = 0.7
  const amp = e.ctx.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.linearRampToValueAtTime(gain, at + 0.35)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  filter.connect(amp)
  route(e, amp, 0.8)
  for (const frequency of frequencies) {
    for (const detune of [-9, 0, 9]) {
      const oscillator = e.ctx.createOscillator()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = frequency
      oscillator.detune.value = detune
      oscillator.connect(filter)
      oscillator.start(at)
      oscillator.stop(at + duration + 0.05)
    }
  }
}

/** Poussière d'étoiles : petites cloches aiguës éparpillées, de gauche à droite. */
function sparkle(e: Engine, at: number, count: number, root: number, gain: number): void {
  const scale = [1, 1.125, 1.25, 1.5, 1.667, 2, 2.25, 2.5, 3]
  for (let index = 0; index < count; index += 1) {
    const frequency = root * scale[Math.floor(Math.random() * scale.length)]!
    bell(e, frequency, at + index * 0.045 + Math.random() * 0.03, 0.9, gain * (1 - index / (count * 1.4)), (index / count) * 1.4 - 0.7)
  }
}

/* ---- Sons publics ------------------------------------------------------------------ */

/** Découpe en cours : un petit crépitement de papier, plus aigu à mesure que la coupe avance. */
export function playCutTick(progress: number): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  const base = 2200 + progress * 2600
  noiseBurst(e, { at, duration: 0.07, from: base * 1.3, to: base, q: 2.2, gain: 0.16, grain: 90, send: 0.05, pan: progress * 1.2 - 0.6 })
}

/** Arrachement : déchirure de papier riche (deux couches), souffle grave et éclat d'air. */
export function playTear(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  noiseBurst(e, { at, duration: 0.34, from: 4800, to: 1400, q: 1.4, gain: 0.34, grain: 70, send: 0.12, pan: 0.3 })
  noiseBurst(e, { at: at + 0.03, duration: 0.26, from: 1800, to: 600, q: 0.9, gain: 0.22, grain: 45, send: 0.1, pan: -0.2 })
  noiseBurst(e, { at: at + 0.12, duration: 0.7, from: 9000, to: 3000, q: 0.6, gain: 0.06, type: 'highpass', send: 0.5 })
  boom(e, at, 180, 55, 0.5, 0.35)
}

/** Retournement : un souffle d'air qui balaie, puis la carte qui se pose. */
export function playFlip(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  noiseBurst(e, { at, duration: 0.22, from: 900, to: 3200, q: 1.1, gain: 0.12, send: 0.1 })
  noiseBurst(e, { at: at + 0.2, duration: 0.05, from: 1400, to: 700, q: 1.6, gain: 0.14, send: 0.05, type: 'lowpass' })
}

/** Suspense (Épique et au-delà) : une montée — souffle qui s'ouvre, et un sinus qui grimpe. */
export function playRiser(seconds: number): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  noiseBurst(e, { at, duration: seconds + 0.15, from: 400, to: 5200, q: 2, gain: 0.12, send: 0.4 })
  const oscillator = e.ctx.createOscillator()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(220, at)
  oscillator.frequency.exponentialRampToValueAtTime(880, at + seconds + 0.1)
  const amp = e.ctx.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(0.06, at + seconds)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.2)
  oscillator.connect(amp)
  route(e, amp, 0.5)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.25)
}

/** Révélation d'une carte, selon sa rareté : de la note de verre au carillon céleste. */
export function playReveal(rarity: Rarity): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  switch (rarity) {
    case 'COMMON':
      bell(e, 1318.5, at, 0.7, 0.05)
      break
    case 'RARE':
      bell(e, 1318.5, at, 0.9, 0.06, -0.2)
      bell(e, 1975.5, at + 0.07, 1.1, 0.05, 0.2)
      break
    case 'EPIC':
      // Arpège montant (mi mineur, couleur « magie »).
      ;[659.25, 783.99, 987.77, 1318.5].forEach((frequency, index) => bell(e, frequency, at + index * 0.075, 1.6, 0.07, index * 0.3 - 0.45))
      sparkle(e, at + 0.3, 6, 2637, 0.025)
      break
    case 'LEGENDARY':
      // Accord majeur éclatant, impact grave, pluie d'étincelles.
      boom(e, at, 140, 45, 0.9, 0.4)
      ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => bell(e, frequency, at + index * 0.02, 2.6, 0.08, index * 0.25 - 0.4))
      ;[1568, 2093].forEach((frequency, index) => bell(e, frequency, at + 0.25 + index * 0.12, 2, 0.05))
      sparkle(e, at + 0.35, 12, 2093, 0.03)
      break
    case 'MYTHIC':
      // Nappe chorale, carillon en cascade, impact et poussière d'étoiles.
      boom(e, at, 120, 38, 1.2, 0.45)
      pad(e, [261.63, 329.63, 392, 523.25], at, 3.4, 0.05)
      ;[1046.5, 1318.5, 1568, 2093, 2637].forEach((frequency, index) => bell(e, frequency, at + 0.1 + index * 0.09, 2.8, 0.07, index * 0.35 - 0.7))
      sparkle(e, at + 0.5, 18, 2637, 0.03)
      break
  }
}

/**
 * Notification : deux notes de verre, douces et brèves (quinte montante) —
 * reconnaissable sans couvrir la musique d'ambiance. Une offre conclue sonne
 * un peu plus clair qu'une simple alerte.
 */
export function playChime(bright = false): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  bell(e, bright ? 1046.5 : 880, at, 0.9, 0.035, -0.15)
  bell(e, bright ? 1568 : 1318.5, at + 0.11, 1.2, 0.03, 0.15)
}

/* ---- Higher or Lower ----------------------------------------------------------------- */

/** Blip bref : un sinus (ou triangle) qui pique puis s'éteint aussitôt. */
function blip(e: Engine, frequency: number, at: number, duration: number, gain: number, type: OscillatorType = 'sine', pan = 0, send = 0.1): void {
  const oscillator = e.ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  const amp = e.ctx.createGain()
  envelope(amp.gain, at, gain, 0.003, at + duration)
  oscillator.connect(amp)
  route(e, amp, send, pan)
  oscillator.start(at)
  oscillator.stop(at + duration + 0.03)
}

/** Choix d'un terrain : un petit « tic » de verre. */
export function playHlSelect(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  blip(e, 1760, at, 0.08, 0.05)
  noiseBurst(e, { at, duration: 0.04, from: 5000, to: 3000, q: 2, gain: 0.05, send: 0 })
}

/** Lancer une partie : arpège montant rapide, comme un compteur qui s'allume. */
export function playHlStart(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => blip(e, frequency, at + index * 0.055, 0.18, 0.06, 'triangle', index * 0.2 - 0.3, 0.25))
  noiseBurst(e, { at, duration: 0.3, from: 600, to: 4000, q: 1.2, gain: 0.06, send: 0.2 })
}

/** Réponse donnée : un souffle qui monte (plus haut) ou qui descend (plus bas), et un déclic. */
export function playHlPress(choice: 'higher' | 'lower'): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  const up = choice === 'higher'
  noiseBurst(e, { at, duration: 0.2, from: up ? 700 : 2600, to: up ? 2600 : 700, q: 1.3, gain: 0.12, send: 0.1 })
  blip(e, up ? 880 : 660, at, 0.06, 0.06, 'square', 0, 0)
}

/** Le compteur défile : tic dont la hauteur monte avec l'avancement (0 → 1). */
export function playHlTick(progress: number): void {
  const e = start()
  if (!e) return
  blip(e, 900 + progress * 1100, e.ctx.currentTime, 0.03, 0.035, 'square', 0, 0)
}

/** Bonne réponse : deux notes claires et des étincelles ; la mélodie monte d'un demi-ton par point de série (une octave au plus). */
export function playHlRight(streak: number): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  const shift = Math.pow(2, Math.min(12, Math.max(0, streak - 1)) / 12)
  bell(e, 783.99 * shift, at, 0.9, 0.07, -0.2)
  bell(e, 1174.66 * shift, at + 0.08, 1.2, 0.07, 0.2)
  sparkle(e, at + 0.12, 5, 2093 * shift, 0.02)
}

/** Mauvaise réponse : un « bwoum » qui s'affaisse, deux triangles désaccordés et un grave. */
export function playHlWrong(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  for (const detune of [-14, 14]) {
    const oscillator = e.ctx.createOscillator()
    oscillator.type = 'triangle'
    oscillator.detune.value = detune
    oscillator.frequency.setValueAtTime(330, at)
    oscillator.frequency.exponentialRampToValueAtTime(110, at + 0.55)
    const amp = e.ctx.createGain()
    envelope(amp.gain, at, 0.09, 0.01, at + 0.6)
    oscillator.connect(amp)
    route(e, amp, 0.2)
    oscillator.start(at)
    oscillator.stop(at + 0.65)
  }
  boom(e, at, 120, 40, 0.6, 0.3)
}

/** Les cartes glissent : un souffle d'air qui passe de droite à gauche. */
export function playHlSlide(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  noiseBurst(e, { at, duration: 0.45, from: 500, to: 2200, q: 0.9, gain: 0.08, send: 0.25, pan: 0.4 })
  noiseBurst(e, { at: at + 0.15, duration: 0.35, from: 2200, to: 900, q: 0.9, gain: 0.06, send: 0.25, pan: -0.4 })
}

/** Palier de récompense atteint en pleine série : arpège lumineux et pluie d'étoiles. */
export function playHlTier(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  ;[1046.5, 1318.5, 1568, 2093].forEach((frequency, index) => bell(e, frequency, at + index * 0.06, 1.4, 0.06, index * 0.3 - 0.45))
  sparkle(e, at + 0.25, 10, 2637, 0.025)
}

/** Fin de série sans record : accord mineur doux qui retombe. */
export function playHlOver(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  ;[440, 523.25, 659.25].forEach((frequency, index) => bell(e, frequency, at + index * 0.09, 1.6, 0.05, index * 0.3 - 0.3))
  bell(e, 329.63, at + 0.35, 2, 0.05)
}

/* ---- BookshelfDLE ------------------------------------------------------------------- */

/**
 * Une tuile du mode classique se pose : un claquement de carte, et une note qui dit le
 * verdict (claire si identique, médiane si proche, sourde si faux). La note monte d'une
 * tuile à l'autre : la ligne se lit comme un petit arpège.
 */
export function playDleTile(verdict: 'exact' | 'partial' | 'wrong', index: number): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  const step = Math.pow(2, Math.min(index, 8) / 24)
  const pan = Math.max(-0.5, Math.min(0.5, (index - 3.5) * 0.12))
  noiseBurst(e, { at, duration: 0.05, from: 2200, to: 900, q: 1.4, gain: 0.1, send: 0.04, type: 'lowpass', pan })
  if (verdict === 'exact') {
    blip(e, 1046.5 * step, at, 0.16, 0.055, 'triangle', pan, 0.2)
    blip(e, 1568 * step, at + 0.03, 0.12, 0.025, 'sine', pan, 0.25)
  } else if (verdict === 'partial') blip(e, 698.46 * step, at, 0.14, 0.05, 'triangle', pan, 0.15)
  else blip(e, 220 * step, at, 0.1, 0.06, 'sine', pan, 0.05)
}

/** Essai raté en zoom ou en pixels : deux notes sourdes qui descendent. */
export function playDleMiss(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  blip(e, 330, at, 0.09, 0.06, 'triangle', 0, 0.05)
  blip(e, 247, at + 0.09, 0.14, 0.06, 'triangle', 0, 0.05)
}

/** Décompte d'une manche : un bip par seconde (3, 2, 1), puis le « GO » éclatant. */
export function playCountdown(go: boolean): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  if (!go) {
    blip(e, 659.25, at, 0.14, 0.07, 'square', 0, 0.1)
    return
  }
  boom(e, at, 160, 50, 0.6, 0.35)
  ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => blip(e, frequency, at + index * 0.03, 0.5, 0.05, 'triangle', index * 0.25 - 0.4, 0.3))
  blip(e, 1318.5, at, 0.3, 0.06, 'square', 0, 0.15)
  sparkle(e, at + 0.15, 8, 2093, 0.025)
}

/** Un joueur entre dans le salon : petit « pop » qui monte. */
export function playJoin(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  blip(e, 880, at, 0.07, 0.05, 'sine', 0, 0.15)
  blip(e, 1318.5, at + 0.06, 0.12, 0.05, 'sine', 0, 0.2)
}

/** Un joueur quitte le salon : le même « pop », qui descend. */
export function playLeave(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  blip(e, 880, at, 0.07, 0.04, 'sine', 0, 0.1)
  blip(e, 587.33, at + 0.06, 0.12, 0.04, 'sine', 0, 0.1)
}

/** Dernières secondes du chrono : un tic sec, plus aigu à la toute fin. */
export function playClockTick(urgent: boolean): void {
  const e = start()
  if (!e) return
  blip(e, urgent ? 1760 : 1320, e.ctx.currentTime, 0.04, urgent ? 0.05 : 0.035, 'square', 0, 0)
}

/** Temps écoulé : une sirène grave qui retombe. */
export function playTimeUp(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  for (const detune of [-10, 10]) {
    const oscillator = e.ctx.createOscillator()
    oscillator.type = 'sawtooth'
    oscillator.detune.value = detune
    oscillator.frequency.setValueAtTime(392, at)
    oscillator.frequency.exponentialRampToValueAtTime(130, at + 0.7)
    const amp = e.ctx.createGain()
    envelope(amp.gain, at, 0.035, 0.01, at + 0.75)
    oscillator.connect(amp)
    route(e, amp, 0.15)
    oscillator.start(at)
    oscillator.stop(at + 0.8)
  }
}

/* ---- Chiffon ------------------------------------------------------------------------ */

/**
 * Le chiffon frotte : un souffle de tissu, filtré autour du médium, dont la force et la
 * hauteur suivent la vitesse du geste (0 → 1). Appelé à petits intervalles pendant qu'on frotte.
 */
export function playRub(speed: number): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  const force = Math.max(0.15, Math.min(1, speed))
  noiseBurst(e, { at, duration: 0.09, from: 900 + force * 900, to: 1600 + force * 1600, q: 0.9, gain: 0.025 + force * 0.05, grain: 38, send: 0.04, pan: (Math.random() - 0.5) * 0.4 })
}

/** Une zone se dégage : un petit éclat de verre, aigu et bref. */
export function playGlint(): void {
  const e = start()
  if (!e) return
  const at = e.ctx.currentTime
  blip(e, 2093 + Math.random() * 600, at, 0.12, 0.018, 'sine', (Math.random() - 0.5) * 0.6, 0.35)
}
