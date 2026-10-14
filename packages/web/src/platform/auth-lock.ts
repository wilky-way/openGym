import type { AcquireAuthLock } from '../store/sync-engine'
import { ux } from './ux'
/** Inject into SyncServices. Web Locks serializes cookie and bearer ceremonies across tabs. */
const acquire = (mode: 'shared' | 'exclusive'): ReturnType<AcquireAuthLock> => new Promise(resolve => {
  const locks = ux().window?.navigator.locks
  // Without Web Locks no authentication can install a new carrier, so existing sync remains safe.
  if (!locks) { resolve(mode === 'shared' ? () => {} : null); return }
  void locks.request('opengym-auth-carrier', { ifAvailable: true, mode }, async lock => {
    if (!lock) { resolve(null); return }
    await new Promise<void>(release => { resolve(release) })
  }).catch(() => resolve(null))
})

/** Both providers must be injected: authentication is exclusive, sync requests are shared. */
export const browserAuthLock: AcquireAuthLock = () => acquire('exclusive')
export const browserSyncLock: AcquireAuthLock = () => acquire('shared')
