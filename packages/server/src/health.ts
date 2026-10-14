import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export function writableProbe(dataDir: string, now: () => number = Date.now, log: (message: string) => void = console.error): () => boolean {
  let cached: { at: number; ok: boolean } | undefined
  // Distinct app instances in the same process must not unlink one another's probe.
  const probe = join(dataDir, `.health-${process.pid}-${crypto.randomUUID()}`)
  return () => {
    const time = now()
    if (cached && time - cached.at < 5000) return cached.ok
    let ok = false
    try { writeFileSync(probe, ''); ok = true }
    catch { log('health: cannot write to data directory') }
    finally { try { unlinkSync(probe) } catch { /* creation may have failed */ } }
    cached = { at: time, ok }
    return ok
  }
}
