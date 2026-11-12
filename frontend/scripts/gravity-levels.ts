/**
 * Bâtit les niveaux intégrés de Gravity Ninja (`src/lib/gravity/campaign.ts`) et les écrit pour le
 * serveur (`backend/src/modules/gravity/gravity.levels.ts`), qui les sème au démarrage.
 *
 *   npm run gravity:levels -w frontend
 *
 * Chaque niveau doit être prouvé faisable par le solveur, sinon le script échoue.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAMPAIGN } from '../src/lib/gravity/campaign'
import { buildLevel } from '../src/lib/gravity/generator'
import { LESSON_IDS, buildLesson } from '../src/lib/gravity/tutorial'

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET = join(HERE, '..', '..', 'backend', 'src', 'modules', 'gravity', 'gravity.levels.ts')
const LESSONS_TARGET = join(HERE, '..', 'src', 'lib', 'gravity', 'tutorial.lessons.ts')

const levels = CAMPAIGN.map(({ id, seed, plan }) => {
  const { level, report, softened, sections } = buildLevel(plan, seed, id)
  if (!report.ok) throw new Error(`${id} : infaisable (bloque à x = ${report.reached.toFixed(1)})`)
  const seconds = Math.round(level.length / level.speed)
  console.log(`${id} : ${level.elements.length} éléments, ${sections} sections (${softened} adoucie(s)), ~${seconds} s, vitesse ${level.speed}`)
  return level
})

writeFileSync(
  TARGET,
  `/*
 * Niveaux intégrés de Gravity Ninja — FICHIER GÉNÉRÉ par \`npm run gravity:levels -w frontend\`
 * depuis \`frontend/src/lib/gravity/campaign.ts\`. Ne pas modifier à la main.
 */
export const BUILTIN_LEVELS: readonly unknown[] = ${JSON.stringify(levels)}
`,
)
console.log(`Écrit : ${TARGET}`)

// Le tutoriel : chaque leçon, ses invites (fenêtres où toucher) et sa démonstration, calculées d'avance.
const lessons = LESSON_IDS.map((id) => {
  const lesson = buildLesson(id)
  if (!lesson) throw new Error(`leçon ${id} : impossible à guider jusqu'au bout`)
  console.log(`leçon ${id} : ${lesson.cues.length} invite(s), ~${Math.round(lesson.level.length / lesson.level.speed)} s`)
  return lesson
})
writeFileSync(
  LESSONS_TARGET,
  `// i18n-ignore-file : données générées.
/*
 * Leçons du tutoriel de Gravity Ninja — FICHIER GÉNÉRÉ par \`npm run gravity:levels -w frontend\`
 * depuis \`tutorial.ts\`. Ne pas modifier à la main.
 */
import type { Lesson } from './tutorial'

export const LESSONS: readonly Lesson[] = ${JSON.stringify(lessons)}
`,
)
console.log(`Écrit : ${LESSONS_TARGET}`)
