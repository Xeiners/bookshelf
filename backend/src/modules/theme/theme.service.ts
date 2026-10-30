import { prisma } from '../../core/db.js'
import { record, type Admin } from '../admin/admin.service.js'

/*
 * Thème saisonnier : un administrateur habille l'app pour une fête (Halloween…), pour tout le
 * monde, et le retire quand il veut. Rangé dans `SiteSetting` (clé `theme`) ; lu par chaque
 * appareil au démarrage, d'où un petit cache mémoire.
 */

export const SITE_THEMES = ['none', 'halloween'] as const
export type SiteTheme = (typeof SITE_THEMES)[number]

const KEY = 'theme'
/** Relu au plus toutes les 30 s : chaque ouverture de l'app le demande. */
const CACHE_MS = 30_000

let cached: { theme: SiteTheme; at: number } | null = null

const isTheme = (value: string): value is SiteTheme => (SITE_THEMES as readonly string[]).includes(value)

/** Le thème en cours (`none` : l'app telle quelle). */
export async function currentTheme(now = Date.now()): Promise<SiteTheme> {
  if (cached && now - cached.at < CACHE_MS) return cached.theme
  const row = await prisma.siteSetting.findUnique({ where: { key: KEY } })
  const theme = row && isTheme(row.value) ? row.value : 'none'
  cached = { theme, at: now }
  return theme
}

/** Change le thème pour tout le monde, et l'inscrit au journal de l'administration. */
export async function setTheme(admin: Admin, theme: SiteTheme): Promise<SiteTheme> {
  const previous = await currentTheme(0)
  await prisma.$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: theme, updatedBy: admin.email }, update: { value: theme, updatedBy: admin.email } })
    await record(tx, admin, 'theme', null, { theme, previous })
  })
  cached = { theme, at: Date.now() }
  return theme
}

/** Pour les tests : relit la base au prochain appel. */
export function resetThemeCache(): void {
  cached = null
}
