import type { ReactNode } from 'react'
import { clientPlatform } from '../lib/client-io'
import { Component } from 'react'
import { useStore } from '../store/useStore'
import { t } from '@opengym/core/i18n-core'
import Icon from './Icon'
import { Button } from './ui'
import { captureSheetTarget } from '../lib/sheet-target'

/**
 * Last line of defence: one bad render used to blank the whole app, with no way back —
 * a workout referencing an exercise the build doesn't know would white-screen and, since
 * the running workout is persisted, do it again on every reload.
 *
 * Sits inside #app so the tab bar stays usable; the shell keys this subtree on the route,
 * so switching tabs re-mounts it and clears the error by itself.
 */
export default class ErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  constructor(props: { children?: ReactNode }) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: Error) { console.error('openGym render error:', err) }

  render() {
    if (!this.state.failed) return this.props.children
    const active = useStore.getState().S.active
    const target = captureSheetTarget()
    return (
      <div className="narrow">
        <div className="empty" style={{ marginTop: '18vh' }}>
          <div className="ico"><Icon name="info" /></div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('Something went wrong')}</div>
          {t('This screen could not be drawn. Your data is safe on this device.')}
        </div>
        <Button variant="primary" icon="reset" onClick={() => clientPlatform().nav.reload()}>{t('Reload openGym')}</Button>
        {active && <>
          <div style={{ height: 8 }} />
          <Button variant="danger" icon="trash" onClick={() => {
            let discarded = false
            const stale = Symbol('stale discard target')
            try {
              useStore.getState().update(s => {
                if (!target(s)) throw stale
                s.active = null; discarded = true
              })
            } catch (error) { if (error !== stale) throw error }
            if (discarded) clientPlatform().nav.reload()
          }}>{t('Discard the running workout')}</Button>
        </>}
      </div>
    )
  }
}
