import { guardedStoreUpdate } from '../lib/guarded-update'
import { captureSheetTarget, type SheetTarget } from '../lib/sheet-target'
import { useState, type ReactNode } from 'react'
import EffortScaleSetting from '../components/EffortScaleSetting'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
import { workoutControls } from '@opengym/core/workout-controls'
import { speedUnitOf } from '@opengym/core/speed'
import { formulaOf, FORMULA_NAMES } from '@opengym/core/onerm'
import { weekStartOf, MONDAY, SUNDAY, fmtPlate } from '@opengym/core/format'
import { inventoryFor, ownsPlates } from '@opengym/core/plates'
import { dumbbellsOf } from '@opengym/core/dumbbells'
import { unlock, chime, playOnSilentSupported, vibrateSupported, appleTouchDevice } from '../lib/sound'
import { REST_SOUND_IDS, restSoundOf } from '../lib/rest-sounds'
import { scheduleModeOf, chooseFixedWeek, chooseRotation } from '@opengym/core/rotation'
import { queueOf } from '@opengym/core/queue'
import { wakeLockSupported } from '../lib/wakelock'
import { t } from '../lib/i18n'
import { REST_MAX, REST_PAUSE_MIN, REST_PAUSE_MAX, fmtRest, fmtDuration } from '../lib/duration'
import Icon from '../components/Icon'
import { durationSheet } from '../components/DurationWheel'
import { Section, Row, SelectRow, Switch, Segmented, Button } from '../components/ui'

export interface EquipmentProfile { id: string; name: string; equipment: string[] }
export interface SettingsBServices {
  navigate(path: string): void
  starterPlanSheet(): void
  confirmSheet(options: { title: string; message: string; confirmText: string; danger?: boolean; onConfirm(): void }): void
  menuSheet(options: { title: string; subtitle: string; items: { icon: string; label: string; onClick(): void }[] }): void
  equipmentProfileSheet(profile: EquipmentProfile | null): void
  plateInventorySheet(): void
  dumbbellInventorySheet(): void
}
const missing = (): never => { throw new Error('Settings B services have not been configured') }
let services: SettingsBServices = { navigate: missing, starterPlanSheet: missing, confirmSheet: missing, menuSheet: missing, equipmentProfileSheet: missing, plateInventorySheet: missing, dumbbellInventorySheet: missing }
export function configureSettingsB(next: SettingsBServices): void { services = next }
const confirmSheet: SettingsBServices['confirmSheet'] = options => services.confirmSheet(options)
const menuSheet: SettingsBServices['menuSheet'] = options => services.menuSheet(options)
const starterPlanSheet = () => services.starterPlanSheet()
const equipmentProfileSheet = (profile: EquipmentProfile | null) => services.equipmentProfileSheet(profile)
const plateInventorySheet = () => services.plateInventorySheet()
const dumbbellInventorySheet = () => services.dumbbellInventorySheet()
type SheetOwner = { target: SheetTarget }
const sheetOwner = (_s: StoreDocument): SheetOwner => ({target: captureSheetTarget()})
function guardedUpdate(owner: SheetOwner, matches: (s: StoreDocument) => boolean, change: (s: StoreDocument) => void,
  update: (mut: (s: StoreDocument) => void) => void = useStore.getState().update, action = false): boolean {
  return guardedStoreUpdate(s => owner.target(s) && matches(s), change, {update, action,
    onStale: () => useUI.getState().toast(t('The profile or setting changed. Open it again.'))})
}
const snapshot = (value: unknown) => JSON.stringify(value)
export const SETTINGS_B_PAGES = ['workout', 'advanced', 'alerts', 'plan', 'units', 'equipment', 'look'] as const
export type SettingsBPage = typeof SETTINGS_B_PAGES[number]

export default function SettingsB({ page = 'workout' }: { page?: SettingsBPage }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const rawUpdate = useStore(s => s.update)
  // SelectRow stores this render's callback when its chooser opens. Keep its owner
  // and original field with that callback even after Settings rerenders for B.
  const selectOwner = sheetOwner(S)
  const update = (mutate: (s: StoreDocument) => void) => guardedUpdate(selectOwner, () => true, mutate, rawUpdate)
  const selectSetting = (field: string, value: string) => guardedUpdate(selectOwner,
    s => snapshot(s[field]) === snapshot(S[field]), s => { s[field] = value }, update)
  const nav = (path: string) => services.navigate(path)
  const wakeOK = wakeLockSupported()
  const liveQ = queueOf(S)
  const externalQ = !!liveQ && (!S.rotation || liveQ.rotationId !== S.rotation.id)
  const switchUnit = (v: string) => {
    if (v === S.unit) return
    const owner = sheetOwner(S), source = S.unit, unitSet = snapshot(S.unitSet)
    const setUnit = (options?: { convert: boolean }) => guardedUpdate(owner,
      s => s.unit === source && snapshot(s.unitSet) === unitSet, () => {
        // The real sync store action owns conversion, stamps and its immediate push.
        // Suppress the outer draft's save so it cannot overwrite that action.
        useStore.getState().setUnit(v, options)
      }, update, true)
    menuSheet({
      title: t('Convert to {0}?', v),
      subtitle: t('Every stored weight (logged sets, working weights, routine targets, body weight, bar weights) is in {0}. Convert the numbers, or keep them and only change the label?', S.unit),
      items: [
        { icon: 'calculator', label: t('Convert the numbers'), onClick: () => setUnit() },
        { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => setUnit({ convert: false }) },
      ],
    })
  }

  // Fixed Week or Rotation. A live queue always wins (scheduleModeOf, lib/rotation.js) — a queue
  // written by a planner switches the app to Rotation on its own — but choosing Rotation with
  // nothing built yet has no queue to derive from, so S.scheduleMode is what keeps it selected
  // (and the weekday grid hidden, on both Home and Plan) until the first routine is added.
  // Fixed Week behaves as on Plan (views/Plan.jsx setMode), with the same words: with no loop
  // running there is nothing to lose and it switches at once; a running loop asks first.
  const setScheduleMode = (v: string) => {
    if (v === scheduleModeOf(S)) return
    if (v === 'week') {
      // A planner's own queue is never this app's to drop — this control is text-only while one
      // is live (below), but the guard stays here too rather than trust the render alone.
      if (!liveQ) { update(s => { chooseFixedWeek(s) }); return }
      const owner = sheetOwner(S), pass = snapshot(S.queue), rotation = snapshot(S.rotation)
      confirmSheet({
        title: t('Back to a fixed week?'),
        message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
        confirmText: t('Use Fixed Week'),
        onConfirm: () => { guardedUpdate(owner, s => snapshot(s.queue) === pass && snapshot(s.rotation) === rotation,
          s => { chooseFixedWeek(s) }, update) },
      })
      return
    }
    // The same switch as Plan's "How you train" (lib/rotation.js). With nothing to start (no
    // saved sequence, or a malformed queue Plan has to sort out) the choice holds and you stay
    // here: the page then offers the way to Plan (below), so picking a value never leaves it.
    update(s => { chooseRotation(s) })
  }

  const canVibrate = vibrateSupported()
  const mode = scheduleModeOf(S)
  const layout = ['list', 'compact', 'focus'].includes(S.workoutView) ? S.workoutView : 'cards'
  const open = (id: string) => nav('/settings/' + id)
  const restRow = <Row icon="timer" iconTint="var(--orange)" title={t('Rest timer')} value={fmtRest(S.restSec)} accessory="chevron"
    onClick={() => {
      const owner = sheetOwner(S), value = S.restSec
      durationSheet({
      title: t('Rest timer'), value: S.restSec, max: REST_MAX, off: t('Off'),
      footer: t('Scroll to 0:00 to turn the rest timer off.'),
      onDone: v => { guardedUpdate(owner, s => s.restSec === value, s => { s.restSec = v }, update) },
    }) }} />
  // Default for a rest-pause burst added live on a plain set. A planned exercise's own "Rest (s)"
  // (in its drop set / burst config) overrides it, the same way the main rest timer is the
  // fallback for an exercise without a rest of its own. On the wheel too, 5 s to 5 min: the
  // burst's rest is never 0 (lib/history.js keeps it at 5 s at least), so the wheel stops there.
  const restPauseRow = <Row icon="bolt" iconTint="var(--orange)" title={t('Rest-pause rest')} value={fmtDuration(S.restPauseSec || 15)} accessory="chevron"
    onClick={() => {
      const owner = sheetOwner(S), value = S.restPauseSec
      durationSheet({
      title: t('Rest-pause rest'), value: S.restPauseSec || 15, min: REST_PAUSE_MIN, max: REST_PAUSE_MAX,
      footer: t('The short break between the bursts of a rest-pause set.'),
      onDone: v => { guardedUpdate(owner, s => s.restPauseSec === value, s => { s.restPauseSec = v }, update) },
    }) }} />

  const pages: Record<SettingsBPage, () => ReactNode> = {
    workout: () => <>
      <Section title={t('Rest')} footer={t('Each exercise can have its own rest too. Set it in the exercise settings of a routine.')}>
        {restRow}
        {restPauseRow}
      </Section>
      <Section title={t('Logging')}>
        {/* Two names for the same judgement, so the column asks in the scale you already think in.
            The (i) sits before the control: you read it on the way to the choice, not after it. */}
        <EffortScaleSetting>
          <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        </EffortScaleSetting>
        {/* The line under each exercise that the rows are held against (#173). Tapping the line in
            a workout switches it too; this is where the choice can be found without knowing that. */}
        <SelectRow icon="history" iconTint="var(--blue)" title={t('Shown under each exercise')}
          value={S.logRef === 'best' ? 'best' : 'last'} onChange={v => { selectSetting('logRef', v) }}
          options={[
            { value: 'last', label: t('Last time'), subtitle: t('What you did the last time, in that routine.') },
            { value: 'best', label: t('Best set'), subtitle: t('Your heaviest set of the exercise, from any workout.') },
          ]} />
        {/* One exercise at a time (cards with Prev/Next), the whole session stacked as a
            scrollable list, or that list stripped to just names and set rows (compact). Legacy or
            unknown values read as cards. The workout's ⋯ menu can override it for one session. */}
        <Row icon="layout" iconTint="var(--blue)" title={t('Layout')}>
          <Segmented className="seg-inline"
            options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }, { value: 'focus', label: t('Focus') }]}
            value={layout} onChange={v => update(s => { s.workoutView = v })} />
        </Row>
        {/* The saved side of the Layout menu's "Collapse completed exercises" (#241): on here, every
            session starts with it, and the menu still flips it for one session. Setting it here
            also drops a running session's own choice, so the switch does what it says right away. */}
        <Row icon="minimize" iconTint="var(--teal)" title={t('Collapse completed exercises')}
          subtitle={t('In List and Compact, a finished exercise folds into one line.')}>
          <Switch aria-label={t('Collapse completed exercises')} checked={!!S.collapseCompleted}
            onChange={v => update(s => { s.collapseCompleted = v; if (s.active) delete s.active.collapseCompleted })} />
        </Row>
      </Section>
      <Section title={t('Before and during')}>
        {/* The quick weigh-in that opens on Start (sheets.jsx startFlow, issue #137); off skips
            straight to the session. Home and Stats still log weight by hand. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Weigh in before workouts')}
          subtitle={t('Asks for your body weight when a workout starts. Off starts the session straight away.')}>
          <Switch checked={S.weighIn !== false} onChange={v => update(s => { s.weighIn = v })} />
        </Row>
        {<Row icon="phoneScreen" iconTint="var(--yellow)" title={t('Keep screen awake')}
            subtitle={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : t('Not supported in this browser.')}>
            <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
              onChange={v => update(s => { s.keepAwake = v })} />
          </Row>}
      </Section>
      <Section>
        <Row icon="wrench" iconTint="var(--grey)" title={t('Fine-tuning')} subtitle={t('Buttons, timed sets')} accessory="chevron" onClick={() => open('advanced')} />
      </Section>
    </>,

    advanced: () => {
      // S.wc overlays DEF.wc, so a profile from before these switches existed reads as the lean default.
      const wc = workoutControls(S)
      const setWc = (k: string, v: boolean) => update(s => { s.wc = { ...workoutControls(s), [k]: v } })
      return <>
        <Section title={t('Sessions and timed sets')}>
          {/* Whose reps a planned session opens with (lib/session-start.js). The plan's by default:
              the routine is what you said you would do, and history and progression decide the
              weight. The other choice is the old behaviour, reps carried over from last time.
              Absent (an older profile) reads as the plan. */}
          <SelectRow icon="clipboard" iconTint="var(--green)" title={t('Planned sessions start from')}
            value={S.startFrom === 'last' ? 'last' : 'plan'} onChange={v => { selectSetting('startFrom', v) }}
            options={[
              { value: 'plan', label: t('Your plan'), subtitle: t('The routine’s sets and reps. Your history decides the weight.') },
              { value: 'last', label: t('Your last session'), subtitle: t('The reps you logged last time in that routine, carried over.') },
            ]} />
          <Row icon="stopwatch" iconTint="var(--orange)" title={t('Keep timing after target')}
            subtitle={t('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')}>
            <Switch aria-label={t('Keep timing after target')} checked={!!S.timedSetOvertime}
              onChange={v => update(s => { s.timedSetOvertime = v })} />
          </Row>
        </Section>
        {/* The lean workout screen keeps the sets and one "more" button per exercise; each switch
            brings one of the old always-visible button groups back for people who liked them. */}
        <Section title={t('Buttons on the workout screen')} footer={t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}>
          <Row icon="plusCircle" iconTint="var(--green)" title={t('Weight and reps buttons')} subtitle={t('Off: tap the number and type it')}>
            <Switch checked={wc.steppers} onChange={v => setWc('steppers', v)} />
          </Row>
          <Row icon="bolt" iconTint="var(--orange)" title={t('Drop and burst shortcuts on every set')}>
            <Switch checked={wc.setShortcuts} onChange={v => setWc('setShortcuts', v)} />
          </Row>
          {/* Swipe actions (v1.3.11): not a button, but the same question of what a set row does. The
              one switch covers Plan's lists too; the stored key keeps its old name, swipeSets. */}
          <Row icon="swap" iconTint="var(--indigo)" title={t('Swipe actions')} subtitle={t('Sets, routines and the loop: left removes, right copies')}>
            <Switch aria-label={t('Swipe actions')} checked={wc.swipeSets} onChange={v => setWc('swipeSets', v)} />
          </Row>
          {/* The chip row at the top of a workout (#323): not a button row, but the same question of
              what the workout screen shows. On by default, it is about one line tall. */}
          <Row icon="more" iconTint="var(--mint)" title={t('Exercise chips at the top')} subtitle={t('A numbered dot per exercise, filled as you go. Tap one to jump there.')}>
            <Switch aria-label={t('Exercise chips at the top')} checked={wc.exerciseChips} onChange={v => setWc('exerciseChips', v)} />
          </Row>
          <Row icon="link" iconTint="var(--blue)" title={t('Superset buttons in the exercise header')}>
            <Switch checked={wc.pairButtons} onChange={v => setWc('pairButtons', v)} />
          </Row>
          <Row icon="swap" iconTint="var(--teal)" title={t('Move, swap and remove buttons below the exercise')}>
            <Switch checked={wc.exerciseButtons} onChange={v => setWc('exerciseButtons', v)} />
          </Row>
        </Section>
      </>
    },

    alerts: () => {
      const iPhone = appleTouchDevice()
      return <>
        <Section title={t('When a rest ends')}>
          <Row icon="speaker" iconTint="var(--pink)" title={t('Play a sound')}>
            {/* Turning the sound on is a tap: unlock the audio context now so a timer that ends
                before the next set check can already sound (iOS, #152). */}
            <Switch checked={!!S.sound} onChange={v => { if (v) unlock(true); update(s => { s.sound = v }) }} />
          </Row>
          {/* The chime that replaced the original three beeps (Discord: "too quiet under music")
              is not an improvement for everyone: louder is a cost with headphones or in a quiet
              room, and some want a sound that feels like theirs (#306). The chime by default; the
              sheet plays each one as you tap it (restSoundSheet). */}
          {S.sound && <Row icon="speaker" iconTint="var(--pink)" title={t('Sound')} value={t(REST_SOUND_LABEL[restSoundOf(S)])}
            accessory="chevron" onClick={restSoundSheet} />}
          {/* iOS only (WebKit's audio-session API, iOS 17+): with it off the ring/silent switch
              mutes the timer. On, the phone treats the timer like a music player (exclusive, and
              the music app is not told it may resume), so it is a choice, off by default. */}
          {S.sound && playOnSilentSupported() && (
            <Row icon="speaker" iconTint="var(--orange)" title={t('Play even on silent')}
              subtitle={<>{t('Music playing on this phone stops during a workout and does not resume by itself.')}<br />{t('iPhone only')}</>}>
              <Switch checked={!!S.soundOnSilent} onChange={v => update(s => { s.soundOnSilent = v })} />
            </Row>
          )}
        </Section>
        {/* The buzz at the end of a rest or a hold and on a set tick, on its own switch like the
            sound (Discord, asierlama). iOS has no navigator.vibrate: the row stays, greyed out,
            and says so, instead of an iPhone user looking for a setting that is not there. */}
        <Section footer={!canVibrate && iPhone ? t('iPhone doesn’t let openGym vibrate. A sound or a flash does the job.') : null}>
          <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate')} className={canVibrate ? '' : 'dis'}
            subtitle={canVibrate ? null : iPhone ? t('Not on iPhone') : t('Not supported in this browser.')}>
            <Switch checked={canVibrate && S.vibrate !== false} disabled={!canVibrate} onChange={v => update(s => { s.vibrate = v })} />
          </Row>

          <Row icon="sun" iconTint="var(--yellow)" title={t('Flash the screen')}>
            <Switch checked={!!S.timerFlash} onChange={v => update(s => { s.timerFlash = v })} />
          </Row>
        </Section>
      </>
    },

    plan: () => <>
      <Section>
        {/* Fixed Week (S.week) or Rotation (the live queue, lib/queue.js + lib/rotation.js).
            Derived from the queue, never stored. */}
        <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
          {externalQ
            ? <span className="small dim">{t('Rotation')} · {t('Externally managed')}</span>
            : <Segmented className="seg-inline"
                options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]}
                value={mode} onChange={setScheduleMode} />}
        </Row>
        {/* Rotation chosen with no loop running yet: the loop is built on Plan. */}
        {mode === 'rotation' && !liveQ && <Row icon="calendar" iconTint="var(--orange)" title={t('Build your loop in Plan')}
          accessory="chevron" onClick={() => nav('/plan')} />}
        {/* Monday or Sunday: the Plan list, the Home strip, the calendar grid and every "this
            week" total follow it. Stored as a getDay() index (see lib/format.js). */}
        <Row icon="calendar" iconTint="var(--orange)" title={t('Week starts on')}>
          <Segmented className="seg-inline"
            options={[{ value: MONDAY, label: t('Monday') }, { value: SUNDAY, label: t('Sunday') }]}
            value={weekStartOf(S)} onChange={v => update(s => { s.weekStart = v })} />
        </Row>
      </Section>
      <Section>
        <Row icon="clipboard" iconTint="var(--green)" title={t('Load starter plan')} accessory="chevron" onClick={starterPlanSheet} />
      </Section>
    </>,

    units: () => <>
      <Section footer={t('Switching the unit offers to convert every stored weight.')}>
        <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
          <Segmented className="seg-inline"
            options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
            value={S.unit} onChange={v => switchUnit(v)} />
        </Row>
        {/* Display only: one decimal reads fine for plate-loadable numbers, two for anyone whose
            per-side figure lands on .25 or .75, or who loads microplates (issue #139). Nothing is
            stored or rounded differently; lib/format.js fmtNum just prints what is already there. */}
        <Row icon="ruler" iconTint="var(--teal)" title={t('Weight decimals')} subtitle={t('How precisely weights are shown.')}>
          <Segmented className="seg-inline"
            options={[{ value: 1, label: t('0.5') }, { value: 2, label: t('0.25') }]}
            value={S.wdec === 2 ? 2 : 1} onChange={v => update(s => { s.wdec = v })} />
        </Row>
        {/* Cardio speed (Discord "miles per hour"). Unlike the weight unit this converts nothing:
            speeds stay stored in km/h and only what is shown and typed follows it (lib/speed.js).
            Until chosen it follows the weight unit, so a profile in pounds already reads mph. */}
        <Row icon="figureRun" iconTint="var(--teal)" title={t('Speed unit')}>
          <Segmented className="seg-inline"
            options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]}
            value={speedUnitOf(S)} onChange={v => update(s => { s.speedUnit = v })} />
        </Row>
        {/* Which formula turns a set into an estimated 1RM (Discord, #155): the exercise page,
            the 1RM chart and records all follow it. Formula names are people, not words. */}
        <SelectRow icon="chart" iconTint="var(--teal)" title={t('1RM formula')}
          value={formulaOf(S)} onChange={v => { selectSetting('oneRmFormula', v) }}
          options={[
            { value: 'epley', label: 'Epley', subtitle: t('The common one. A bit generous at higher reps.') },
            { value: 'brzycki', label: 'Brzycki', subtitle: t('More conservative above five reps.') },
            { value: 'lombardi', label: 'Lombardi', subtitle: t('Generous, especially at high reps.') },
            { value: 'oconner', label: FORMULA_NAMES.oconner, subtitle: t('The most conservative of the classics.') },
            { value: 'mayhew', label: 'Mayhew' },
            { value: 'wathan', label: 'Wathan' },
            { value: 'lander', label: 'Lander' },
            { value: 'weighted', label: t('Blend of all'), subtitle: t('Averages seven formulas and reads your RIR when you log it.') },
          ]} />
      </Section>
    </>,

    equipment: () => <EquipmentCard S={S} update={update} />,

    look: () => <>
      <Section footer={!user ? undefined : t('synced with your profile')}>
        <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
          <Segmented
            className="seg-inline"
            options={[
              { value: 'dark', icon: 'moon', label: t('Dark') },
              { value: 'light', icon: 'sun', label: t('Light') },
              { value: 'system', icon: 'gear', label: t('System') },
            ]}
            value={S.theme || 'dark'}
            onChange={v => update(s => { s.theme = v })}
          />
        </Row>
        {/* How the muscle map is drawn. The exercise drawings follow it until they are set below. */}
        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
          <Segmented
            className="seg-inline"
            options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
            value={S.body === 'female' ? 'female' : 'male'}
            onChange={v => update(s => { s.body = v })}
          />
        </Row>
      </Section>
      <Section title={t('On Home')}>
        {/* Membership QR codes on Home (views/CheckIn.jsx); off = no Home card, no route. */}
        <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')}
          subtitle={t('Show a card on Home with your membership QR codes.')}>
          <Switch checked={S.checkIn !== false} onChange={v => update(s => { s.checkIn = v })} />
        </Row>
        {/* The Home summary is optional; hiding it leaves weight logging, history and Stats intact. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Body weight')}
          subtitle={t('Show the body weight card on Home.')}>
          <Switch checked={S.showWeightCard !== false} onChange={v => update(s => { s.showWeightCard = v })} />
        </Row>

        {<Row icon="cloud" iconTint="var(--blue)" title={t('Show connection status')}
          subtitle={t('Off: the bar at the top is hidden. A dot on Home still warns when syncing is stuck.')}>
          <Switch checked={S.connStatus !== false} onChange={v => update(s => { s.connStatus = v; if (v) s.connLocal = true })} />
        </Row>}
      </Section>
    </>,

  }
  return <div className="narrow sp-page">{pages[page]()}</div>
}

const EFFORT_ROWS = [
  ['0', '10', 'Nothing left, went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy, warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

// Settings → Sound (#306): every end-of-rest sound, each played as it is picked so you hear it
// before the next rest does. The sheet stays open for the next one; Done closes it. Stored as
// S.restSound, with S.classicChime kept for an app from before (lib/rest-sounds.js restSoundOf).
const REST_SOUND_LABEL: Record<string, string> = { chime: 'Chime (louder)', classic: 'Classic beeps', bell: 'Bell', beep: 'Beep-beep', whistle: 'Whistle', soft: 'Soft' }
const REST_SOUND_HINT: Record<string, string> = {
  classic: 'The quieter three-beep sound from before 1.3.9, instead of the louder chime.',
  bell: 'Ding-dong. Rest is over, class is in.',
  beep: 'Your sports watch, calling you back.',
  whistle: 'Coach wants you back on the bar.',
  soft: 'Gentle, for headphones or a quiet room.',
}
export function pickRestSound(id: string) {
  unlock(true)
  useStore.getState().update(s => { s.restSound = id; s.classicChime = id === 'classic' })
  chime(true, id)
}
export function RestSoundSheet({ close, owner: openedOwner }: { close(): void; owner?: SheetOwner }) {
  const S = useStore(s => s.S)
  const [owner] = useState(() => openedOwner ?? sheetOwner(S))
  const cur = restSoundOf(S)
  return <>
    <h3>{t('Sound')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Tap one to hear it.')}</div>
    <Section>
      {REST_SOUND_IDS.map(id => <Row key={id} icon={id === cur ? 'speaker' : 'play'} iconTint="var(--pink)" title={t(REST_SOUND_LABEL[id])}
        subtitle={REST_SOUND_HINT[id] ? t(REST_SOUND_HINT[id]) : null} accessory={id === cur ? 'check' : 'none'}
        onClick={() => {
          if (guardedUpdate(owner, () => true, s => { s.restSound = id; s.classicChime = id === 'classic' })) {
            unlock(true); chime(true, id)
          }
        }} />)}
    </Section>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
const restSoundSheet = () => {
  const owner = sheetOwner(useStore.getState().S)
  return useUI.getState().openSheet(close => <RestSoundSheet close={close} owner={owner} />)
}

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left in the tank; RPE reads the same effort off a 10-point scale, so RPE ≈ 10 − RIR. Pick whichever you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

function EquipmentCard({ S, update }: { S: StoreDocument; update(mut: (draft: StoreDocument) => void): void }) {
  const profiles: EquipmentProfile[] = S.equipProfiles || []
  const selectOwner = sheetOwner(S), activeId = S.activeEquipId
  const remove = (p: EquipmentProfile) => {
    const owner = sheetOwner(S), id = p.id, target = snapshot(p)
    confirmSheet({
    title: t('Delete profile?'), message: t('"{0}" and its equipment list will be removed.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { guardedUpdate(owner, s => snapshot((s.equipProfiles || []).find((x: EquipmentProfile) => x.id === id)) === target, s => {
      s.equipProfiles = (s.equipProfiles || []).filter((x: EquipmentProfile) => x.id !== id)
      if (s.activeEquipId === id) s.activeEquipId = (s.equipProfiles[0] && s.equipProfiles[0].id) || null
    }, update) },
  })
  }
  // The plates you own, per unit (lib/plates.js) — what the set rows' plate lines load from.
  const plateSummary = ownsPlates(S)
    ? inventoryFor(S).map(p => fmtPlate(p.w) + '×' + p.n).join(' · ') || t('None')
    : t('Standard set. Tap to count the pairs you own.')
  // The dumbbells you own, per unit (lib/dumbbells.js): what dumbbell lifts step and progress over.
  const bells = dumbbellsOf(S)
  const dumbbellSummary = bells.length
    ? bells.map(fmtPlate).join(' · ')
    : t('Any weight. Tap to list the ones you own.')
  return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    <Row icon="plate" iconTint="var(--orange)" title={t('Plates')} subtitle={plateSummary} accessory="chevron" onClick={() => plateInventorySheet()} />
    <Row icon="dumbbell" iconTint="var(--teal)" title={t('Dumbbells')} subtitle={dumbbellSummary} accessory="chevron" onClick={() => dumbbellInventorySheet()} />
    {profiles.length > 0 && <Row icon="kettlebell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={v => update(s => { s.equipFilterOn = v })} />
    </Row>}
    {profiles.length > 0 && <SelectRow icon="house" iconTint="var(--blue)" title={t('Active profile')}
      value={S.activeEquipId || ''} onChange={v => { guardedUpdate(selectOwner,
        s => s.activeEquipId === activeId && snapshot((s.equipProfiles || []).find((p: EquipmentProfile) => p.id === v)) ===
          snapshot(profiles.find(p => p.id === v)), s => { s.activeEquipId = v }, update) }}
      options={profiles.map((p: EquipmentProfile) => ({ value: p.id, label: p.name }))} />}
    {profiles.map(p => (
      <Row key={p.id} icon="house" iconTint="var(--teal)" title={p.name}
        subtitle={t('{0} equipment types', p.equipment.length)} accessory="chevron"
        onClick={() => equipmentProfileSheet(p)}>
        <button className="iconbtn" aria-label={t('Delete')} onClick={ev => { ev.stopPropagation(); remove(p) }}><Icon name="trash" /></button>
      </Row>
    ))}
    <Row icon="plus" iconTint="var(--acc)" title={t('Add equipment profile')} accessory="chevron" onClick={() => equipmentProfileSheet(null)} />
  </Section>
}
