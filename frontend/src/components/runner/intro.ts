/**
 * Horloge de la cinématique de départ. Elle part quand la caméra a affiché ses premières
 * images (la toute première porte la préparation des shaders) ; on peut l'avancer
 * jusqu'au raccord final pour passer la cinématique.
 */
export class IntroClock {
  private start = 0
  private onStart: () => void = () => undefined
  readonly length: number

  constructor(length: number) {
    this.length = length
  }

  /** Ce qu'il faut faire quand l'horloge part (programmer la fin de la cinématique). */
  whenStarted(callback: () => void): void {
    this.onStart = callback
  }

  begin(): void {
    if (this.start !== 0) return
    this.start = performance.now()
    this.onStart()
  }

  /** Avancement, de 0 à 1 (et au-delà une fois finie). */
  progress(): number {
    return this.start > 0 ? (performance.now() - this.start) / 1000 / this.length : 0
  }

  /** Saute à `seconds` de la fin ; renvoie le temps restant réel (s). */
  skipTo(seconds: number): number {
    const now = performance.now()
    // Passée avant même d'avoir commencé : elle « commence » ici (l'écran de chargement s'efface).
    if (this.start === 0) {
      this.start = now
      this.onStart()
    }
    const left = this.length - (now - this.start) / 1000
    if (left <= seconds) return left
    this.start = now - (this.length - seconds) * 1000
    return seconds
  }
}
