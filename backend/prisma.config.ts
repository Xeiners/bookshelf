import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 ne charge plus `.env` tout seul.
try {
  process.loadEnvFile()
} catch {
  // Pas de `.env` : valeurs par défaut ci-dessous.
}

const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'

/**
 * `DATABASE_URL` choisit la base, donc le schéma et ses migrations :
 * - `postgres://…` / `postgresql://…` → PostgreSQL (Docker, production) ;
 * - `file:…` → SQLite (développement local, tests).
 * Le schéma PostgreSQL est généré depuis le schéma SQLite (`npm run db:schema:pg`).
 */
const postgres = /^postgres(ql)?:\/\//i.test(url)
const folder = postgres ? path.join('prisma', 'postgres') : 'prisma'

export default defineConfig({
  schema: path.join(folder, 'schema.prisma'),
  migrations: { path: path.join(folder, 'migrations') },
  datasource: { url },
})
