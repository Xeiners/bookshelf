import { z } from 'zod'

try {
  process.loadEnvFile()
} catch {
  // Pas de `.env` : défauts de développement.
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  JWT_SECRET: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_API_BASE: z.string().default('/api'),
  MANGADEX_USER_AGENT: z.string().default('Bookshelf/0.1 (projet perso)'),
  /** Alimentation du catalogue AniList + MangaDex en tâche de fond (désactivée en test). */
  CATALOG_SYNC: z.enum(['on', 'off']).optional(),
  /**
   * Proxys de confiance devant l'API (Express `trust proxy`) : `loopback` en
   * local ; `1` derrière le Nginx du conteneur front. Sans ça, tout le trafic
   * semble venir du proxy et le limiteur de connexion bloque tout le monde.
   */
  TRUST_PROXY: z.string().default('loopback'),
  /** Cookie de session `Secure` (HTTPS obligatoire). Par défaut : en production. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  /*
   * E-mails (code de vérification à l'inscription). SMTP dès que SMTP_HOST est
   * renseigné. Sinon : la console en développement (le code s'affiche dans le
   * terminal de l'API), une boîte en mémoire en test, et RIEN en production —
   * les inscriptions sont alors refusées plutôt que de créer des comptes
   * qu'aucun code ne pourrait valider.
   */
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'memory']).optional(),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** `true` : TLS dès la connexion (port 465). Par défaut : selon le port. */
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Expéditeur affiché, ex. « Bookshelf <no-reply@exemple.fr> ». */
  MAIL_FROM: z.string().default('Bookshelf <no-reply@bookshelf.local>'),
})

/*
 * Une variable VIDE vaut absente, donc prend sa valeur par défaut. Docker
 * Compose transmet `VAR=` (ou `${VAR:-}`) comme une chaîne vide : sans ce
 * filtre, `SMTP_SECURE=` ou `COOKIE_SECURE=` feraient échouer le démarrage.
 */
const env = EnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')))
const isProduction = env.NODE_ENV === 'production'

/**
 * `TRUST_PROXY` au format d'Express : `true` / `false`, un nombre de sauts
 * (`2` = Caddy sur l'hôte + Nginx du conteneur front), ou des sous-réseaux
 * (`loopback`, `10.0.0.0/8`…). Le texte « true » passé tel quel serait lu
 * comme une adresse IP invalide et ferait planter le démarrage.
 */
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true
  if (value === 'false') return false
  return /^\d+$/.test(value) ? Number(value) : value
}

/** `none` : aucun moyen d'envoyer un e-mail (production sans SMTP) → inscriptions refusées. */
function resolveMailTransport(): 'smtp' | 'console' | 'memory' | 'none' {
  if (env.MAIL_TRANSPORT) return env.MAIL_TRANSPORT
  if (env.SMTP_HOST) return 'smtp'
  if (env.NODE_ENV === 'test') return 'memory'
  if (isProduction) {
    console.warn('[config] SMTP_HOST absent : envoi d’e-mails impossible, les inscriptions seront refusées.')
    return 'none'
  }
  return 'console'
}

function resolveJwtSecret(): string {
  const secret = env.JWT_SECRET?.trim()
  if (secret && secret.length >= 32) return secret
  if (isProduction) {
    throw new Error('JWT_SECRET manquant ou trop court (32 caractères minimum) en production.')
  }
  // Secret fixe en dev : `tsx watch` redémarre souvent, les sessions doivent survivre.
  console.warn('[config] JWT_SECRET absent : secret de développement (jamais en production).')
  return DEV_JWT_SECRET
}

/** Public par nature : ne protège que des sessions de développement local. */
const DEV_JWT_SECRET = 'bookshelf-dev-secret-not-for-production-use-0000'

export const config = {
  env: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: resolveJwtSecret(),
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  publicApiBase: env.PUBLIC_API_BASE.replace(/\/$/, ''),
  mangadexUserAgent: env.MANGADEX_USER_AGENT,
  catalogSync: (env.CATALOG_SYNC ?? (env.NODE_ENV === 'test' ? 'off' : 'on')) === 'on',
  /** Nombre de sauts (`1`) ou liste de sous-réseaux, tel qu'Express l'attend. */
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
  mail: {
    transport: resolveMailTransport(),
    from: env.MAIL_FROM,
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  },
} as const
