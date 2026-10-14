import { createBrowserPlatform } from '../../src/platform/browser'
import { createSyncEngine } from '../../src/store/sync-engine'
import { useStore as realStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { api } from './sync-api'
import { configureClientIO } from '../../src/lib/client-io'
import { askAddDeviceData } from './sync-prompts'
import { beforeEach } from 'vitest'
export { DEF, freshState, restartedState, restoredStateFor, hasData } from '../../src/store/useStore'
const platform = createBrowserPlatform()
configureClientIO(platform)
const services = { platform, api, prompts: {
  askAddDeviceData, toast: (message: string) => useUI.getState().toast(message),
  stopTimers: () => { useUI.getState().abandonWork?.(); useUI.getState().stopRest?.() },
} }
let engine = createSyncEngine(realStore.setState, realStore.getState, services)
realStore.setState(engine.actions)
export const dispose = () => engine.dispose()
// Legacy tests inject fixture documents through setState. This represents a new
// hydration, so align the fence with the fixture's durable ownership explicitly.
// Production actions use realStore directly and cannot invoke this fixture seam.
export const useStore = new Proxy(realStore, { get(target, property) {
  if (property === 'setState') return (patch: Parameters<typeof realStore.setState>[0]) => {
    realStore.setState(patch)
    engine.hydrateOwner()
  }
  return Reflect.get(target, property)
} })
beforeEach(() => {
  engine.dispose()
  engine = createSyncEngine(realStore.setState, realStore.getState, services)
  realStore.setState(engine.actions)
})
