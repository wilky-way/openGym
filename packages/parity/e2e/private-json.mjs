import {readFile, writeFile, rename, rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
const writes = new Map()
/** Publish a complete private snapshot; serialize writers so cleanup stays last. */
export function writePrivateJSON(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  const previous = writes.get(file) || Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, text, {mode: 0o600, flag: 'wx'})
      await rename(temporary, file)
    } finally { await rm(temporary, {force: true}).catch(() => {}) }
  })
  writes.set(file, next)
  const finished = () => { if (writes.get(file) === next) writes.delete(file) }
  void next.then(finished, finished)
  return next
}
/** Discovery can overlap an older in-place writer; never accept truncated JSON. */
export async function readPrivateJSON(file, {timeoutMs = 250, retryMs = 10, onRetry} = {}) {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    try { return JSON.parse(await readFile(file, 'utf8')) }
    catch (error) {
      if (!(error instanceof SyntaxError) && error?.code !== 'ENOENT') throw error
      if (performance.now() >= deadline) throw error
      onRetry?.()
      await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, Math.max(1, deadline - performance.now()))))
    }
  }
}
