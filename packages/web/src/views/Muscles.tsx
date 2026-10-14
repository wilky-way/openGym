import { nav } from '../lib/nav'
import { t } from '../lib/i18n'
import MuscleExplorer from '../components/MuscleExplorer'
import { exerciseDetailSheet, addToRoutineSheet } from './view-services'
import Icon from '../components/Icon'

export default function Muscles() {
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/library')} aria-label={t('Exercises')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Explore muscles')}</h1><div className="sub">{t('Choose a muscle to see exercises that train it.')}</div></div></div>

    <MuscleExplorer onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </>
}
