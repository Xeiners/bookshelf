export type BreakerState = 'closed' | 'open' | 'half-open'

export interface BreakerOptions {
  /** Échecs consécutifs avant d'ouvrir le circuit. */
  failureThreshold?: number
  /** Durée pendant laquelle la source est laissée tranquille (ms). */
  cooldownMs?: number
  now?: () => number
}

/**
 * Disjoncteur par source. Une source qui échoue en boucle (panne, API
 * modifiée) n'est plus interrogée pendant `cooldownMs` : chaque requête de
 * nos lecteurs ne paie plus son délai d'expiration. Passé ce délai, UNE
 * requête d'essai (demi-ouvert) décide : succès → refermé, échec → rouvert.
 */
export class CircuitBreaker {
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly now: () => number
  private failures = 0
  private openedAt: number | null = null
  private trialInFlight = false

  constructor(options: BreakerOptions = {}) {
    this.threshold = options.failureThreshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed'
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open'
  }

  /** Autorise-t-on un appel ? En demi-ouvert, un seul à la fois. */
  tryAcquire(): boolean {
    const state = this.state
    if (state === 'closed') return true
    if (state === 'open' || this.trialInFlight) return false
    this.trialInFlight = true
    return true
  }

  recordSuccess(): void {
    this.failures = 0
    this.openedAt = null
    this.trialInFlight = false
  }

  recordFailure(): void {
    this.trialInFlight = false
    this.failures += 1
    if (this.openedAt !== null || this.failures >= this.threshold) this.openedAt = this.now()
  }
}
