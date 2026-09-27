/**
 * Gestion des extensions du pont Tachiyomi, en ligne de commande.
 *
 *   npm run tachiyomi -w backend -- extensions fr en     # catalogue, par langue
 *   npm run tachiyomi -w backend -- install en.asurascans fr.mangascantrad
 *   npm run tachiyomi -w backend -- sources               # sites interrogés par Bookshelf
 *
 * En production (image Docker) :
 *   docker compose exec backend node dist/extensions/tachiyomi.cli.js extensions fr
 */
import { config } from '../config.js'
import { LANGUAGES, type Language } from '../lib/language.js'
import { createSuwayomiClient } from './providers/suwayomi.client.js'
import { createTachiyomiBridgeProvider } from './providers/tachiyomiBridge.provider.js'
import { ensureExtensions, extensionsForLanguages } from './providers/tachiyomiExtensions.js'

const settings = config.sources.tachiyomi
const print = (line: string) => process.stdout.write(`${line}\n`)
const client = createSuwayomiClient({
  ...settings,
  // Installer ou relire le catalogue prend du temps : la CLI n'a pas l'impatience de l'API.
  timeoutMs: 30_000,
  userAgent: config.mangadexUserAgent,
  log: (message) => process.stderr.write(`[Tachiyomi] ${message}\n`),
})

async function main(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case 'extensions': {
      const languages = args.filter((code): code is Language => LANGUAGES.includes(code as Language))
      const catalog = extensionsForLanguages(await client.refreshExtensions(), languages.length > 0 ? languages : settings.languages)
      for (const extension of catalog) {
        const state = extension.isInstalled ? (extension.hasUpdate ? 'MAJ ' : 'OK  ') : '    '
        const short = extension.pkgName.replace(/^eu\.kanade\.tachiyomi\.extension\./, '')
        print(`${state}${short.padEnd(34)} ${extension.name}${extension.isNsfw ? ' (18+)' : ''}`)
      }
      print(`\n${catalog.length} extension(s). Installer : npm run tachiyomi -w backend -- install <paquet>`)
      return 0
    }
    case 'install': {
      if (args.length === 0) {
        print('Usage : install <paquet> [paquet…]   (ex. en.asurascans fr.mangascantrad)')
        return 1
      }
      const report = await ensureExtensions(client, args, print)
      return report.missing.length + report.failed.length > 0 ? 1 : 0
    }
    case 'sources': {
      const provider = createTachiyomiBridgeProvider({ ...settings, client, userAgent: config.mangadexUserAgent, log: () => {} })
      const sources = await provider.activeSources()
      for (const source of sources) print(`${source.lang}  ${source.id.padEnd(20)} ${source.name}`)
      print(`\n${sources.length} site(s) interrogé(s) par Bookshelf${settings.enabled ? '' : ' — pont désactivé (TACHIYOMI_BRIDGE_ENABLED=false)'}.`)
      return 0
    }
    default:
      print('Commandes : extensions [fr|en…] · install <paquet…> · sources')
      return command ? 1 : 0
  }
}

main(process.argv[2], process.argv.slice(3)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    print(`Échec : ${error instanceof Error ? error.message : String(error)} (pont : ${settings.baseUrl})`)
    process.exit(1)
  },
)
