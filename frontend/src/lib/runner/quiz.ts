import type { QuizOption, QuizQuestion } from './engine'

/** Un univers du BookshelfDLE et quelques-uns de ses personnages (nom, portrait). */
export interface QuizUniverse {
  title: string
  characters: readonly { name: string; image: string | null }[]
}

export interface QuizText {
  /** « Qui vient de One Piece ? » */
  whoIsFrom: (universe: string) => string
  /** « D'où vient Luffy ? » */
  whereFrom: (character: string) => string
}

/**
 * Tire une question rapide sur les univers du BookshelfDLE : quel personnage vient de tel
 * univers, ou de quel univers vient tel personnage. Trois réponses, une par voie, la bonne
 * à une place tirée au hasard. `null` s'il n'y a pas trois univers garnis.
 */
export function makeQuiz(universes: readonly QuizUniverse[], text: QuizText, random: () => number): QuizQuestion | null {
  const usable = universes.filter((universe) => universe.characters.length > 0)
  if (usable.length < 3) return null
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const shuffled = [...usable].sort(() => random() - 0.5)
  const [right, ...others] = shuffled as [QuizUniverse, ...QuizUniverse[]]
  const wrong = others.slice(0, 2)
  const answer = Math.floor(random() * 3) as 0 | 1 | 2
  const place = (correct: QuizOption, decoys: QuizOption[]): [QuizOption, QuizOption, QuizOption] => {
    const options = [...decoys]
    options.splice(answer, 0, correct)
    return options as [QuizOption, QuizOption, QuizOption]
  }
  if (random() < 0.5) {
    const option = (universe: QuizUniverse): QuizOption => {
      const character = pick(universe.characters)
      return { label: character.name, image: character.image }
    }
    return { prompt: text.whoIsFrom(right.title), options: place(option(right), wrong.map(option)), answer }
  }
  const character = pick(right.characters)
  return {
    prompt: text.whereFrom(character.name),
    image: character.image,
    options: place({ label: right.title }, wrong.map((universe) => ({ label: universe.title }))),
    answer,
  }
}
