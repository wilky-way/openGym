import fs from 'node:fs'
import path from 'node:path'
import { openStore } from '../../src/storage'
import { DataService } from '../../src/data'
const [dir, mode] = process.argv.slice(2) as [string, string]
const store = openStore(dir)
const stop = () => {
  fs.writeFileSync(path.join(dir, 'put-ready'), 'READY')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
}
const data = new DataService(store.db, dir, {
  now: () => 1791800000000,
  ...(mode === 'transaction' ? { beforeCommit: stop } : { mirror: stop }),
})
data.compareAndWrite('u1', { baseRev: 1, stamped: true, state: { workouts: [{ id: 'new' }], routines: [] } })
