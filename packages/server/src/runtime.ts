import { bootStore, listUsers } from './storage'
import { createAuth } from './auth'
import { DataService } from './data'
import { startServer } from './index'
import { loadConfig, type ServerConfig } from './config'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { AuthService } from './auth'

/** Compose the same storage/auth/data/admin/passkey services for Docker and the sidecar. */
export function startRuntime(config: ServerConfig = loadConfig(), boot: (message: string) => void = console.log) {
  const store = bootStore(config.dataDir)
  let auth: AuthService | undefined
  try {
    if (config.staticDir) {
      const dataRoot = realpathSync(config.dataDir), staticRoot = realpathSync(config.staticDir)
      const contains = (parent: string, child: string) => {
        const path = relative(parent, child)
        return path === '' || path !== '..' && !path.startsWith('..' + sep)
      }
      if (contains(staticRoot, dataRoot) || contains(dataRoot, staticRoot)) throw new Error('DATA_DIR and STATIC_DIR must not overlap')
    }
    let listener: ReturnType<typeof startServer> | undefined
    auth = createAuth(store.db, config, { address: request => listener?.requestIP(request)?.address ?? '' })
    const data = new DataService(store.db, config.dataDir)
    const server = startServer(config, { auth, data, userCount: () => listUsers(store.db).length }, boot)
    listener = server
    const stop = server.stop.bind(server)
    let stopping: Promise<void> | undefined
    server.stop = closeActiveConnections => {
      // Every caller waits for the listener and storage to close, even during shutdown.
      return stopping ??= (async () => {
        await stop(closeActiveConnections)
        store.close()
      })()
    }
    return server
  } catch (error) {
    auth?.auditLog.close()
    store.close()
    throw error
  }
}
