import type { ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { effortOf } from '@opengym/core/history'
import { t } from '../lib/i18n'
import { Row, Switch, Segmented } from './ui'

export default function EffortScaleSetting({ children, guardedUpdate }: { children?: ReactNode; guardedUpdate?: (mutate: (S: import('../store/useStore').StoreDocument) => void) => unknown }) {
  const S = useStore(s => s.S), storeUpdate = useStore(s => s.update)
  const update = guardedUpdate ?? storeUpdate
  const kind = effortOf(S)
  const choose = (value: string) => update(s => {
    const previous = effortOf(s)
    if (value !== 'none') s.lastEffortScale = value
    else if (previous !== 'none') s.lastEffortScale = previous
    s.effort = value; delete s.showRir
  })
  return <>
    <Row icon="gauge" iconTint="var(--purple)" title={t('Effort scale')} subtitle={t('RPE 8 = 2 reps in reserve')}>
      {children}
      <Segmented allowEmpty className="seg-inline" options={[{ value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
        value={kind} onChange={choose} />
    </Row>
    <Row title={t("Don't track effort")}>
      <Switch aria-label={t("Don't track effort")} checked={kind === 'none'} onChange={off => choose(off ? 'none' : S.lastEffortScale === 'rpe' ? 'rpe' : 'rir')} />
    </Row>
  </>
}
