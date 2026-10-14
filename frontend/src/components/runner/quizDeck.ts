import type { QuizQuestion } from '../../lib/runner/engine'

/*
 * Les questions du quiz, préparées une à l'avance : dès qu'une question est posée, la
 * suivante est tirée et ses portraits se chargent en arrière-plan. Au moment de la poser,
 * si un seul portrait n'est pas prêt (réseau lent, hors-ligne, personnage sans image),
 * la question part avec les noms seuls : jamais d'attente, jamais de cases vides, et
 * toujours la même présentation pour les trois réponses.
 */

interface Prepared {
  question: QuizQuestion
  ready: boolean
}

const images = (question: QuizQuestion): string[] => [question.image, ...question.options.map((option) => option.image)].filter((url): url is string => Boolean(url))

/** Les noms seuls (portraits retirés partout). */
const namesOnly = (question: QuizQuestion): QuizQuestion => {
  const [a, b, c] = question.options
  return { ...question, image: null, options: [{ label: a.label }, { label: b.label }, { label: c.label }] }
}

export class QuizDeck {
  private next: Prepared | null = null
  private make: () => QuizQuestion | null = () => null

  /** Comment tirer une question (les univers arrivent après le départ ; la langue peut changer). */
  setMaker(make: () => QuizQuestion | null): void {
    this.make = make
    if (!this.next) this.prepare()
  }

  /** Tire la prochaine question et précharge ses portraits. */
  prepare(): void {
    const question = this.make()
    if (!question) {
      this.next = null
      return
    }
    // Réponses en images : toutes, ou aucune.
    const pictured = question.options.filter((option) => option.image).length
    const uniform = pictured === 0 || pictured === question.options.length ? question : namesOnly(question)
    const urls = images(uniform)
    const prepared: Prepared = { question: uniform, ready: urls.length === 0 }
    let left = urls.length
    for (const url of urls) {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        left -= 1
        if (left === 0) prepared.ready = true
      }
      image.src = url
    }
    this.next = prepared
  }

  /** La question à poser maintenant (et la suivante se prépare). */
  draw(): QuizQuestion | null {
    if (!this.next) this.prepare()
    const current = this.next
    this.prepare()
    if (!current) return null
    return current.ready ? current.question : namesOnly(current.question)
  }
}
