// Child process for the kill -9 drills. Each mode does its write and then parks at the point where a crash
// matters: the parent sends SIGKILL there and then boots the store again. Parked means no further output.
//   mirror:   state committed, state mirror temporary file complete, not yet renamed
//   commit:   state committed, no state mirror written at all
//   accounts: a new account committed, db.json temporary file complete, not yet renamed
import { openStore, commitStateDoc, writeStateMirror, writeAccountsMirror } from '../../src/storage'
import * as repo from '../../src/storage/repos'

const [mode, dir, text] = process.argv.slice(2)
if (!mode || !dir) throw new Error('usage: crash-mirror.ts <mirror|commit|accounts> <dataDir> [stateText]')

const park = (): void => {
  console.log('READY')
  Bun.sleepSync(60_000)
}
const store = openStore(dir)
if (mode === 'mirror') {
  if (!text) throw new Error('mirror mode needs a state text')
  commitStateDoc(store.db, 'p1', text, Date.now(), 30)
  writeStateMirror(store.db, dir, 'p1', { beforeRename: park })
} else if (mode === 'commit') {
  if (!text) throw new Error('commit mode needs a state text')
  commitStateDoc(store.db, 'p1', text, Date.now(), 30)
  park()
} else if (mode === 'accounts') {
  repo.putUser(store.db, { id: 'p2', name: 'name-p2', created: '2026-10-01T00:00:00.000Z', admin: 0, disabled: 0, sv: 0,
    invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord: 1, x: '{}' })
  writeAccountsMirror(store.db, dir, { beforeRename: park })
} else {
  throw new Error(`unknown mode ${mode}`)
}
store.close()
