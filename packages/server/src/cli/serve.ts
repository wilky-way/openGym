import { loadConfig } from '../config'
import { startRuntime } from '../runtime'
import { snapshotCommand } from './snapshot'

if (process.argv[2] === 'backup') {
  try { snapshotCommand(process.argv.slice(3)) }
  catch (error) { console.error((error as Error).message); process.exitCode = 1 }
} else {
  const server = startRuntime(loadConfig(process.env, process.argv.slice(2)))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void server.stop(true).then(() => process.exit(0)) })
  }
}
