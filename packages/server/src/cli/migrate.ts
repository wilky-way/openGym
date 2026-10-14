import { importLegacy, verifyLegacy } from '../migration/importer'
import { offloadLibrary, reinstallLibrary } from '../migration/library'
import { prepareRollback } from '../migration/rollback'
import { confirmationToken, type MigrationOptions } from '../migration/safety'

export function parseMigrationArgs(args: string[]): { command: string; options: MigrationOptions } {
  let applyRequested = false, dryRunRequested = false
  const command = args[0] ?? '', options: MigrationOptions = { data: '', liveDataDir: process.env.OPENGYM_LIVE_DATA_DIR || undefined }
  const values: Record<string, keyof MigrationOptions> = { '--data': 'data', '--scratch': 'scratch', '--confirm': 'confirm', '--profile': 'profile', '--archive': 'archive' }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (Object.hasOwn(values, arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('missing value for ' + arg)
      Object.assign(options, { [values[arg]!]: value })
    } else if (arg === '--apply') { applyRequested = true; options.apply = true }
    else if (arg === '--dry-run' || arg === '--preflight') { dryRunRequested = true; options.apply = false }
    else if (arg === '--live') options.live = true
    else if (arg === '--reconcile') options.reconcile = true
    else if (arg === '--include-new') options.includeNew = true
    else if (arg === '--originals') options.originals = true
    else throw new Error('unknown argument: ' + arg)
  }
  if (applyRequested && dryRunRequested) throw new Error('--apply conflicts with --dry-run/--preflight')
  if (options.archive && command !== 'import') throw new Error('--archive is only supported by import')
  if (!options.data) throw new Error('--data required; scratch writes require --scratch; default is dry-run, use --apply to commit')
  return { command, options }
}
if (import.meta.main) {
  try {
    const { command, options } = parseMigrationArgs(process.argv.slice(2))
    const result = command === 'token' ? { confirmationToken: confirmationToken(options.data) } : command === 'import' ? await importLegacy(options) : command === 'verify' ? verifyLegacy(options)
      : command === 'library:offload' ? offloadLibrary(options) : command === 'library:reinstall' ? reinstallLibrary(options)
      : command === 'rollback:prepare' ? prepareRollback(options) : (() => { throw new Error('command must be token, import, verify, library:offload, library:reinstall or rollback:prepare') })()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) { console.error('migration refused: ' + (error as Error).message); process.exitCode = 1 }
}
