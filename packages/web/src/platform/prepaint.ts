import type { KeyValueStore } from '@opengym/contract/platform/adapters'
import { browserKeyValueStore } from './storage'

/** Parser-time browser bootstrap: theme only, no document or account mutation. */
export function prepaintTheme(win: Window, kv: Pick<KeyValueStore, 'get'>): void {
  try {
    const state = JSON.parse(kv.get('gym_state_v1') || '{}') as { theme?: unknown }
    const theme = state.theme
    const selected = theme === 'light' || theme === 'dark' ? theme : (win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    win.document.documentElement.dataset.theme = selected
    const meta = win.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = selected === 'light' ? '#F2EBE8' : '#1A1415'
  } catch { /* blocked or corrupt storage retains the default, as in the legacy bootstrap */ }
}
if (typeof window !== 'undefined') prepaintTheme(window, browserKeyValueStore(window))
