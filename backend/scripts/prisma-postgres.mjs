/**
 * Génère `prisma/postgres/schema.prisma` depuis `prisma/schema.prisma`.
 *
 * Une seule source de vérité pour les modèles : le schéma SQLite (développement
 * local, tests). Prisma n'accepte qu'un fournisseur par schéma ; la variante
 * PostgreSQL (Docker, production) n'en diffère que par le fournisseur et le
 * dossier du client généré.
 *
 *   node scripts/prisma-postgres.mjs          écrit le schéma PostgreSQL
 *   node scripts/prisma-postgres.mjs --check  échoue s'il n'est pas à jour
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'prisma', 'schema.prisma')
const TARGET = path.join(ROOT, 'prisma', 'postgres', 'schema.prisma')

const HEADER = [
  '// ⚠️ FICHIER GÉNÉRÉ par `npm run db:schema:pg` depuis prisma/schema.prisma.',
  '// Ne pas modifier à la main : changer le schéma SQLite, puis relancer le script.',
  '',
].join('\n')

export function toPostgres(source) {
  const replacements = [
    [/provider\s*=\s*"sqlite"/, 'provider = "postgresql"'],
    [/output(\s*)=\s*"\.\.\/src\/generated\/prisma"/, 'output$1= "../../src/generated/prisma-pg"'],
  ]
  let schema = source.replace(/\r\n/g, '\n')
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(schema)) throw new Error(`Schéma SQLite inattendu : ${pattern} introuvable.`)
    schema = schema.replace(pattern, replacement)
  }
  return HEADER + schema
}

const expected = toPostgres(readFileSync(SOURCE, 'utf8'))

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    // Absent : forcément pas à jour.
  }
  if (current !== expected) {
    console.error('prisma/postgres/schema.prisma n’est pas à jour : lancer `npm run db:schema:pg -w backend`.')
    process.exit(1)
  }
  console.log('Schéma PostgreSQL à jour. ✔')
} else {
  mkdirSync(path.dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, expected)
  console.log(`Écrit : ${path.relative(ROOT, TARGET)}`)
}
