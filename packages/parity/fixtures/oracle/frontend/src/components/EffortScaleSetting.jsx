import { useStore } from '../store/useStore.js'
import { effortOf } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { Row, Switch, Segmented } from './ui.jsx'

export default function EffortScaleSetting({ children }) {
  const S = useStore(s => s.S), update = useStore(s => s.update)
  const kind = effortOf(S)
  const choose = value => update(s => {
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
