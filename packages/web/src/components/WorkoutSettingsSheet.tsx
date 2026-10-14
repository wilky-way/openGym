import { useEffect, useRef } from 'react'
import { captureWorkoutTarget, workoutTargetUpdate, workoutTargetCallback, type WorkoutTarget } from '../views/workout-target'
import EffortScaleSetting from './EffortScaleSetting'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { t } from '../lib/i18n'
import { workoutControls } from '@opengym/core/workout-controls'
import { unlock, vibrateSupported, appleTouchDevice } from '../lib/sound'
import { wakeLockSupported } from '../lib/wakelock'
import { closeThenNav } from '../lib/nav'
import { REST_MAX, fmtRest } from '../lib/duration'
import { durationSheet } from './DurationWheel'
import { Section, Row, Switch, Segmented, Button } from './ui'

// The settings people touch at the gym, without leaving the workout (v1.3.11, opened from the
// workout's ⋯ → Workout settings). Every row writes the same S.* field as Settings → Workout and
// Settings → Timer alerts, so a change here sticks for the next session too; nothing in it is
// for this session only. The one exception to "same as Settings" is Layout: the running session
// may carry its own layout from the ⋯ menu (S.active.workoutView), and choosing one here clears
// that, or the saved choice would not show until the next workout.
export function WorkoutSettings({ close, target }: { close: () => void; target?: WorkoutTarget }) : any {
  const S = useStore((s: any ) : any => s.S)
  const opened = useRef(target ?? captureWorkoutTarget())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const valid: WorkoutTarget = S => mounted.current && opened.current(S)
  const update = (mutate: (S: import('../store/useStore').StoreDocument) => void) => workoutTargetUpdate(valid, mutate)
  const canVibrate = vibrateSupported()
  const iPhone = appleTouchDevice()
  const wakeOK = wakeLockSupported()
  const layout = ['list', 'compact'].includes(S.active?.workoutView || S.workoutView) ? (S.active?.workoutView || S.workoutView) : 'cards'
  const allSettings = workoutTargetCallback(valid, () => closeThenNav(close, '/settings/workout'))
  return <div className="ws-sheet">
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Workout settings')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Changes stick for your next workouts too.')}</div>
    <Section>
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest timer')} value={fmtRest(S.restSec)} accessory="chevron"
        onClick={workoutTargetCallback(valid, () => durationSheet({
          title: t('Rest timer'), value: S.restSec, max: REST_MAX, off: t('Off'),
          footer: t('Scroll to 0:00 to turn the rest timer off.'),
          onDone: (v: any ) : any => update((s: any ) : any => { s.restSec = v }),
        }))} />
      <Row icon="speaker" iconTint="var(--pink)" title={t('Play a sound')}>
        {/* A tap: unlock the audio now so a rest ending before the next tick can sound (iOS, #152). */}
        <Switch checked={!!S.sound} onChange={(v: any ) : any => { if (v) unlock(true); update((s: any ) : any => { s.sound = v }) }} />
      </Row>
      <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate')} className={canVibrate ? '' : 'dis'}
        subtitle={canVibrate ? null : iPhone ? t('Not on iPhone') : t('Not supported in this browser.')}>
        <Switch checked={canVibrate && S.vibrate !== false} disabled={!canVibrate} onChange={(v: any ) : any => update((s: any ) : any => { s.vibrate = v })} />
      </Row>
      <Row icon="sun" iconTint="var(--yellow)" title={t('Flash the screen')}>
        <Switch checked={!!S.timerFlash} onChange={(v: any ) : any => update((s: any ) : any => { s.timerFlash = v })} />
      </Row>
      {<Row icon="phoneScreen" iconTint="var(--yellow)" title={t('Keep screen awake')}
        subtitle={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : t('Not supported in this browser.')}>
        <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK} onChange={(v: any ) : any => update((s: any ) : any => { s.keepAwake = v })} />
      </Row>}
    </Section>
    <Section>
      <Row icon="layout" iconTint="var(--blue)" title={t('Layout')}>
        <Segmented className="seg-inline"
          options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }]}
          value={layout} onChange={(v: any ) : any => update((s: any ) : any => { s.workoutView = v; if (s.active) delete s.active.workoutView })} />
      </Row>
        <EffortScaleSetting guardedUpdate={update} />
      <Row icon="swap" iconTint="var(--indigo)" title={t('Swipe actions')} subtitle={t('Sets, routines and the loop: left removes, right copies')}>
        <Switch aria-label={t('Swipe actions')} checked={workoutControls(S).swipeSets}
          onChange={(v: any ) : any => update((s: any ) : any => { s.wc = { ...s.wc, ...workoutControls(s), swipeSets: v } })} />
      </Row>

    </Section>
    <Section>
      <Row icon="gear" iconTint="var(--grey)" title={t('All settings')} accessory="chevron" onClick={allSettings} />
    </Section>
  </div>
}

/** Opens the in-workout settings sheet. */
export function workoutSettingsSheet() {
  let id: string
  const target = captureWorkoutTarget(() => useUI.getState().sheets.some(sheet => sheet.id === id))
  const sheet = useUI.getState().openSheet(close => <WorkoutSettings close={close} target={target} />)
  id = sheet.id
  return sheet
}
