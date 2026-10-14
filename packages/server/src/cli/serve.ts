import { loadConfig } from '../config'
import { startRuntime } from '../runtime'

const server = startRuntime(loadConfig(process.env, process.argv.slice(2)))
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.stop(true).then(() => process.exit(0)) })
}
