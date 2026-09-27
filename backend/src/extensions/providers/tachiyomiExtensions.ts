/**
 * Installation des extensions Tachiyomi dans le pont Suwayomi.
 *
 * Volontairement SANS route HTTP : Bookshelf n'a pas de rôle administrateur,
 * et installer un APK exécute du code tiers dans le pont. On déclare les
 * extensions voulues dans `TACHIYOMI_EXTENSIONS` (installées au démarrage,
 * en tâche de fond), ou on les gère à la main avec la CLI (`tachiyomi.cli.ts`).
 */
import type { Language } from '../../lib/language.js'
import type { ProviderLog } from './http.js'
import type { BridgeExtension, SuwayomiClient } from './suwayomi.client.js'

const EXTENSION_PREFIX = 'eu.kanade.tachiyomi.extension.'

/**
 * `en.asurascans` ou le nom complet `eu.kanade.tachiyomi.extension.en.asurascans` :
 * la forme courte suffit (c'est celle des dépôts Keiyoushi).
 */
export function matchesPackage(pkgName: string, entry: string): boolean {
  const wanted = entry.trim().toLowerCase()
  return pkgName === wanted || pkgName === `${EXTENSION_PREFIX}${wanted}`
}

/** Extensions du catalogue dans ces langues (`all` = multilingue, ex. MangaDex, Comick). */
export function extensionsForLanguages(catalog: readonly BridgeExtension[], languages: readonly Language[]): BridgeExtension[] {
  const wanted = new Set<string>([...languages, 'all'])
  return catalog.filter((extension) => wanted.has(extension.lang)).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

export interface SyncReport {
  installed: string[]
  updated: string[]
  alreadyInstalled: string[]
  /** Absentes du catalogue : dépôt non configuré, nom mal écrit, extension retirée. */
  missing: string[]
  failed: { pkgName: string; error: string }[]
}

/**
 * Installe (ou met à jour) les extensions demandées. Le catalogue est relu
 * d'abord (`fetchExtensions`) ; les installations sont faites une à une, le
 * pont convertissant chaque APK : en parallèle, il saturerait sa JVM.
 */
export async function ensureExtensions(client: SuwayomiClient, entries: readonly string[], log: ProviderLog): Promise<SyncReport> {
  const report: SyncReport = { installed: [], updated: [], alreadyInstalled: [], missing: [], failed: [] }
  if (entries.length === 0) return report
  const catalog = await client.refreshExtensions()

  for (const entry of entries) {
    const extension = catalog.find((candidate) => matchesPackage(candidate.pkgName, entry))
    if (!extension) {
      report.missing.push(entry)
      continue
    }
    try {
      if (!extension.isInstalled) {
        await client.installExtension(extension.pkgName)
        report.installed.push(extension.pkgName)
      } else if (extension.hasUpdate) {
        await client.updateExtension(extension.pkgName)
        report.updated.push(extension.pkgName)
      } else {
        report.alreadyInstalled.push(extension.pkgName)
      }
    } catch (error) {
      report.failed.push({ pkgName: extension.pkgName, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const summary = [
    report.installed.length > 0 && `installées : ${report.installed.join(', ')}`,
    report.updated.length > 0 && `mises à jour : ${report.updated.join(', ')}`,
    report.alreadyInstalled.length > 0 && `déjà là : ${report.alreadyInstalled.length}`,
    report.missing.length > 0 && `absentes du catalogue : ${report.missing.join(', ')} (dépôt EXTENSION_STORES configuré ?)`,
    report.failed.length > 0 && `échecs : ${report.failed.map((failure) => `${failure.pkgName} (${failure.error})`).join(', ')}`,
  ].filter(Boolean)
  log(`extensions — ${summary.join(' · ') || 'rien à faire'}`)
  return report
}

/**
 * Synchronisation au démarrage, en tâche de fond : le pont (une JVM) met
 * souvent plus longtemps que l'API à démarrer. Nouvel essai toutes les
 * `delayMs` tant qu'il est injoignable ; jamais bloquant, jamais fatal.
 */
export function scheduleExtensionSync(
  client: SuwayomiClient,
  entries: readonly string[],
  options: { log: ProviderLog; onSynced?: (report: SyncReport) => void; attempts?: number; delayMs?: number },
): void {
  if (entries.length === 0) return
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 30_000

  const attempt = (remaining: number) => {
    ensureExtensions(client, entries, options.log)
      .then((report) => options.onSynced?.(report))
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        if (remaining <= 1) {
          options.log(`extensions non synchronisées, abandon (${reason})`)
          return
        }
        options.log(`pont injoignable (${reason}), nouvel essai dans ${Math.round(delayMs / 1000)} s`)
        setTimeout(() => attempt(remaining - 1), delayMs).unref()
      })
  }
  setTimeout(() => attempt(attempts), 0).unref()
}
