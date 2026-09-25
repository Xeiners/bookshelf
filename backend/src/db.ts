import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
// Type seulement : les deux clients générés (SQLite, PostgreSQL) exposent la même API.
import type { PrismaClient } from './generated/prisma/client.js'

/** Racine du package backend (valable depuis `src/` comme depuis `dist/`). */
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** `postgres://…` → PostgreSQL (Docker, production) ; `file:…` → SQLite (dev, tests). */
export const isPostgres = /^postgres(ql)?:\/\//i.test(config.databaseUrl)

/**
 * Le chemin de `DATABASE_URL` est relatif au dossier backend, comme pour la CLI
 * Prisma : on le rend absolu pour ne pas dépendre du répertoire courant.
 */
function sqlitePath(url: string): string {
  const file = url.replace(/^file:/, '')
  return path.isAbsolute(file) ? file : path.resolve(BACKEND_ROOT, file)
}

/** Fabrique d'adaptateur Prisma : typée au minimum, chargée à la demande. */
type AdapterFactory = new (options: Record<string, unknown>) => unknown

/*
 * Imports dynamiques à chemin CALCULÉ : ni TypeScript ni Node ne chargent la
 * base inutilisée. L'image Docker (PostgreSQL) n'embarque pas le pilote SQLite,
 * natif ; le développement local n'a pas besoin du client PostgreSQL généré.
 */
const modules = isPostgres
  ? { client: './generated/prisma-pg/client.js', adapter: '@prisma/adapter-pg', factory: 'PrismaPg' }
  : { client: './generated/prisma/client.js', adapter: '@prisma/adapter-better-sqlite3', factory: 'PrismaBetterSqlite3' }

const [clientModule, adapterModule] = (await Promise.all([import(modules.client), import(modules.adapter)])) as [
  { PrismaClient: new (options: { adapter: unknown }) => PrismaClient },
  Record<string, AdapterFactory>,
]

const Adapter = adapterModule[modules.factory]!
const adapter = isPostgres
  ? new Adapter({ connectionString: config.databaseUrl })
  : new Adapter({ url: sqlitePath(config.databaseUrl) })

export const prisma: PrismaClient = new clientModule.PrismaClient({ adapter })
