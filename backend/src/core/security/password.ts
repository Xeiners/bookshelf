import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Hachage scrypt natif (node:crypto) : pas de dépendance native à compiler.
 * Format stocké : `scrypt$N$r$p$sel$hash`, auto-descriptif pour faire évoluer
 * les paramètres sans invalider les comptes existants.
 */
const PARAMS = { N: 65536, r: 8, p: 1 } as const
/** scrypt exige ~128·N·r octets (64 Mo ici) : la limite par défaut de Node (32 Mo) est relevée. */
const MAX_MEMORY = 128 * 1024 * 1024
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { maxmem: MAX_MEMORY, ...options }, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false

  const expected = Buffer.from(hashB64, 'base64')
  const key = await derive(password, Buffer.from(saltB64, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Hash factice : `login` prend le même temps, que l'e-mail existe ou non. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'))
