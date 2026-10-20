import { randomInt } from 'node:crypto'

/** Équivalent de `Math.random()` tiré du générateur cryptographique (codes de salon, tirages à enjeu). */
export const secureRandom = (): number => randomInt(0, 2 ** 32) / 2 ** 32
