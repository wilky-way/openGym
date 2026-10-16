import { guardedStoreUpdate, abortGuardedUpdate } from './lib/guarded-update'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, type StoreDocument } from './store/useStore'
import { useUI } from './store/useUI'
import { activeProfile, profileEquipment, type EquipmentProfile } from '../../core/src/equipment'
import { buildStarterPlan, starterPlanDays, starterPlanOptions } from '../../core/src/starter'
import { fmtDate, fmtDateRange, fmtNum, todayISO, weekStartOf, DAYN } from '@opengym/core/format'
import { lastBW, effortOf } from '@opengym/core/history'
import { t, tn, dateLocale } from '@opengym/core/i18n-core'
import { closeThenNav } from './lib/nav'
import { tappable } from './lib/use-sheet-keyboard'
import { mergeImport, type WorkoutImport, type BodyweightImport } from '../../core/src/import-csv'
import { importHevyData, HevyApiError, HEVY_DEV_SETTINGS, mergeHevyRoutines, type HevyProgress } from './lib/import-hevy'
import { weeklyWeights } from '@opengym/core/bodyweight'
import { ImportFileError, readImportExport } from './lib/import-export'
import { captureSheetTarget, type SheetTarget } from './lib/sheet-target'
import LineChart from './components/LineChart'
import Icon from './components/Icon'
import { Button, Slider, Switch, TextField, NumberField } from './components/ui'

export interface ConfirmOptions { title?: ReactNode; message?: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean; onConfirm?: (valid?: SheetTarget) => void; onCancel?: (valid?: SheetTarget) => void; onStale?: () => void; locked?: boolean }
export interface MenuItem { icon?: string; label: ReactNode; sub?: ReactNode; onClick?: (valid?: SheetTarget) => void; danger?: boolean; disabled?: boolean; on?: boolean | null; accent?: boolean; chevron?: boolean }
type OptionalMenuItem = MenuItem | false | null | undefined
export interface MenuOptions { title?: ReactNode; titleClass?: string; subtitle?: ReactNode; items?: OptionalMenuItem[]; sections?: { title?: ReactNode; items?: OptionalMenuItem[] }[] }
export interface BwOptions { required?: boolean; onDone?: (weight: number | null, valid: SheetTarget) => void }
type CloseProps = { close: () => void }
type ParsedImport = WorkoutImport | BodyweightImport
interface WeighIn { d: string; w: number; t?: number }
interface SheetRoutine { id: string; name: string; ex: { id: string }[] }
interface WeightWeek { key: string; avg: number; n: number; delta: number | null; entries: WeighIn[] }
type HevyPayload = Awaited<ReturnType<typeof importHevyData>>
const S = () => useStore.getState().S
// Shared sentinel boundary aborts before W07 stamps or saves.
const update = (mutate: (draft: StoreDocument) => void, valid: SheetTarget = captureSheetTarget()) =>
  guardedStoreUpdate(draft => valid(draft), mutate)

const ui = () => useUI.getState()
const toast = (message: string) => ui().toast(message)
const index = () => useStore.getState().index

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, onCancel, close }: Omit<ConfirmOptions, "onConfirm" | "onCancel"> & {onConfirm?(): void; onCancel?(): void} & CloseProps) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); onCancel && onCancel() }}>{cancelText || t('Cancel')}</Button>
  </div>
}
// "1 workouts and 1 weigh-ins" read wrong: a count of one takes the singular, per noun. Four
// whole sentences rather than two spliced counts, so every language keeps its own word order.
export function addDeviceDataMessage(workouts: unknown, weighIns: unknown) {
  const one = (n: unknown) => Number(n) === 1
  return one(workouts)
    ? one(weighIns)
      ? t('{0} workout and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workout and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
    : one(weighIns)
      ? t('{0} workouts and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workouts and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
}
// Sign-in found workouts on this device that the profile does not have (logged while signed
// out). The profile is the truth — settings and plan come from the server either way — the
// question is only whether these entries are added to it or dropped. Resolves true to add.
// Routines and the rest of a plan made here while signed out: asked about as well (they come along
// with "Add them"), in their own words when there is nothing else.
export function addDeviceSetupMessage(routines: unknown) {
  const n = Number(routines) || 0
  return n === 0
    ? t('Your plan, notes or gym cards on this device were set up while signed out. Add them to your profile, or keep the profile exactly as it is on the server.')
    : n === 1
      ? t('{0} routine was made on this device while signed out. Add it to your profile, or keep the profile exactly as it is on the server.', n)
      : t('{0} routines were made on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', n)
}
export function askAddDeviceData(extras: { workouts?: number; bodyweight?: number; customEx?: number; routines?: number }): Promise<boolean> {
  const logged = extras.workouts || extras.bodyweight || extras.customEx
  return new Promise<boolean>(resolve => confirmSheet({
    title: logged ? t('Add this device\'s workouts to your profile?') : t('Add this device\'s plan to your profile?'),
    message: logged ? addDeviceDataMessage(extras.workouts, extras.bodyweight) : addDeviceSetupMessage(extras.routines),
    confirmText: t('Add them'), cancelText: t('Keep profile as is'),
    onConfirm: () => resolve(true), onCancel: () => resolve(false), onStale: () => resolve(false), locked: true
  }))
}
/* ============================ menu sheet ============================ */
// A list of actions, one per row, closing on tap. This is where the workout screen parks
// everything that is not a set you are about to log: the point of a single "more" button is
// that the ten things you do once a session stop competing with the two you do every set.
// items: [{ icon, label, sub, onClick, danger, disabled, on }] — `on` draws a check for toggles.
// sections: [{ title, items }] instead of `items` splits a longer menu into groups, each with an
// optional small header; a group whose items are all falsy is left out, header and all.
// `accent` tints a row's icon, for the one entry a menu leads with.
// A title is shown as written: most are sentences ("Convert to lb?", "Set 2"), which a default
// title-casing turned into "Convert To Lb?". An exercise name passes exerciseNameClass as
// titleClass, which title-cases the lower-case packs and leaves a cased one alone.
function MenuSheet({ title, titleClass = '', subtitle, items, sections, close }: MenuOptions & CloseProps) {
  const groups = (sections || [{ items }])
    .map(g => ({ title: g.title, items: (g.items || []).filter((item): item is MenuItem => !!item) }))
    .filter(g => g.items.length)
  return <>
    {title && <h3 className={titleClass || undefined} style={{ marginBottom: subtitle ? 2 : 10 }}>{title}</h3>}
    {subtitle && <div className="muted small" style={{ marginBottom: 10 }}>{subtitle}</div>}
    {groups.map((g, gi) => <div key={gi} className={'menu-group' + (sections ? ' grouped' : '')}>
      {g.title && <div className="menu-sec">{g.title}</div>}
      <div className="list menu-list">
        {g.items.map((it, i) => <div key={i}
          className={'item menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '') + (it.accent ? ' accent' : '')}
          aria-disabled={it.disabled || undefined}
          {...tappable(it.disabled ? null : () => { close(); it.onClick && it.onClick(captureSheetTarget()) })}>
          {it.icon && <span className="lrow-i"><Icon name={it.icon} /></span>}
          <div className="grow"><div className="tt">{it.label}</div>{it.sub && <div className="ss">{it.sub}</div>}</div>
          {it.on != null && <span className={'menu-on' + (it.on ? ' is-on' : '')}><Icon name="check" /></span>}
          {it.chevron && <Icon name="chevronRight" className="menu-chev" />}
        </div>)}
      </div>
    </div>)}
  </>
}
export function menuSheet(opts: MenuOptions) {
  const valid = captureSheetTarget()
  const guarded = (item: OptionalMenuItem): OptionalMenuItem => item && ({ ...item, onClick: () => { if (valid()) item.onClick?.(valid) } })
  ui().openSheet(close => <MenuSheet {...opts} items={opts.items?.map(guarded)} sections={opts.sections?.map(s => ({ ...s, items: s.items?.map(guarded) }))} close={close} />)
}

// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts: ConfirmOptions) {
  const valid = captureSheetTarget()
  let answered = false
  const answer = (callback?: (valid?: SheetTarget) => void) => {
    if (answered) return
    answered = true
    if (valid()) callback?.(valid); else opts.onStale?.()
  }
  ui().openSheet(close => <ConfirmDialog {...opts} onConfirm={() => answer(opts.onConfirm)} onCancel={() => answer(opts.onCancel)} close={close} />, { kind: 'center', ...(opts.locked ? { locked: true } : {}) })
}

/* ============================ starter plan ============================ */
// Plan names and blurbs live here, not in lib/starter.js: check-source-strings.mjs only finds
// string literals written inside a t() call, so copy parked in the catalog and passed in as a
// variable is invisible to it — it would quietly stay English in every language.
const PLAN_COPY: Record<string, () => { name: string; about: string }> = {
  ppl: () => ({ name: t('Push / Pull / Legs'), about: t('Push, pull and legs each get their own day.') }),
  'upper-lower': () => ({ name: t('Upper / Lower'), about: t('Upper body twice, lower body twice.') }),
  'full-body': () => ({ name: t('Full Body'), about: t('Three sessions, the whole body each time.') }),
  '5x5': () => ({ name: t('5×5'), about: t('Five sets of five on the main barbell lifts.') })
}

// Adds the plan's routines (reusing one you already have under the same name) and puts them on
// its weekdays. Existing routines are never touched
// and only the weekdays the plan asks for are reassigned; an id with no plan behind it changes
// nothing at all. planId is deliberately required — a default invites `onClick={loadStarterPlan}`,
// which hands the click event in as the plan and silently loads nothing.
export function loadStarterPlan(planId?: string, profile?: EquipmentProfile | null, valid: SheetTarget = captureSheetTarget()) {
  const plan = buildStarterPlan(planId, profile ? profileEquipment(profile) : undefined, index())
  if (!plan) return false
  const applied = update(st => {
    // Loading the same plan again reuses the routines it added last time (same name, same
    // exercises) for the weekdays instead of a second Upper A, Lower A, ... under the same names.
    // A plan fitted to different equipment has other exercises, so it is added alongside.
    const idOf: Record<string, string> = {}
    const sameLift = (a: SheetRoutine, b: SheetRoutine) => a.ex.length === b.ex.length && a.ex.every((e, i) => e.id === b.ex[i]!.id)
    plan.routines.forEach(r => {
      const have = st.routines.find((x: SheetRoutine) => x.name === r.name && sameLift(x, r))
      if (have) idOf[r.id] = have.id
      else { st.routines.push(r); idOf[r.id] = r.id }
    })
    plan.schedule.forEach(({ day, routineId }) => { st.week[day] = [idOf[routineId]!] })
  }, valid)
  if (!applied) return false
  if (plan.fit) toast(t('{0} loaded, fitted to "{1}": {2} swapped, {3} dropped', PLAN_COPY[planId!]!().name, profile!.name, plan.fit.swapped, plan.fit.dropped))
  else toast(t('{0} loaded', PLAN_COPY[planId!]!().name))
  return true
}

// Intl joins the days the way each language does it — "and" vs "und", "、" in Chinese.
const dayList = (days: number[]) => new Intl.ListFormat(dateLocale()).format(days.map(d => t(DAYN[d]!)))

function StarterPlanChooser({ close, valid }: CloseProps & { valid: SheetTarget }) {
  const week = useStore(s => s.S.week)
  const routines = useStore(s => s.S.routines)
  const profiles: EquipmentProfile[] = useStore(s => s.S.equipProfiles) || []
  // Fitting starts on for the profile you already filter by; '' leaves the plan as written.
  const [fitId, setFitId] = useState(() => activeProfile(useStore.getState().S)?.id || '')
  const fit = profiles.find(p => p.id === fitId) || null
  const choose = (id: string, name: string) => {
    if (!valid()) { close(); return }
    const days = starterPlanDays(id)!
    close()
    // A confirmation is only worth showing when one of those days is actually occupied — by a
    // routine that still exists, not by a stale id the Plan already shows as "Rest".
    const taken = (day: number) => ([] as string[]).concat(week[day] || []).some(id => routines.some((r: SheetRoutine) => r.id === id))
    if (!days.some(taken)) { loadStarterPlan(id, fit, valid); return }
    confirmSheet({
      title: t('Load {0}?', name),
      message: t('The new plan goes on {0}. Your existing routines stay; only those days of the weekly plan change.', dayList(days)),
      confirmText: t('Load plan'),
      onConfirm: () => { if (valid()) loadStarterPlan(id, fit, valid) }
    })
  }
  return <>
    <h3>{t('Choose starter plan')}</h3>
    {profiles.length > 0
      ? <div className="chips" style={{ margin: '0 0 10px' }}>
          <div className="small dim" style={{ width: '100%' }}>{t('Fit to my equipment')}</div>
          <button className={'chip nocap' + (!fit ? ' on' : '')} onClick={() => setFitId('')}>{t('As written')}</button>
          {profiles.map(p => <button key={p.id} className={'chip nocap' + (fit?.id === p.id ? ' on' : '')} onClick={() => setFitId(p.id || '')}>{p.name}</button>)}
        </div>
      : <div className="small dim" style={{ margin: '0 0 10px' }}>{t('Add an equipment profile in Settings to fit a plan to what you own.')}</div>}
    <div className="list">
      {starterPlanOptions().map(({ id, days }) => {
        const { name, about } = PLAN_COPY[id]!()
        return <div key={id} className="item" {...tappable(() => choose(id, name))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="clipboard" /></span>
          <div className="grow"><div className="tt">{name}</div><div className="ss">{t('{0} days per week', days)} · {about}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
    </div>
  </>
}

export const starterPlanSheet = () => {
  const valid = captureSheetTarget()
  return ui().openSheet(close => <StarterPlanChooser close={close} valid={valid} />)
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons, and typing straight into the read-out, cover
// exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = (unit: string) => (unit === 'lb' ? 660 : 300)
// A typed body weight may sit past the slider (a 320 kg lifter is real), but not past any
// person: 9999 saved, drew the chart from -0 to 10,000 and set a goal 9,922 kg away.
const bwMax = (unit: string) => (unit === 'lb' ? 1500 : 700)
const bwTooHeavy = (n: number, unit: string) => {
  if (n <= bwMax(unit)) return false
  toast(t('That looks too heavy. Keep it at {0} or less.', fmtNum(bwMax(unit)) + ' ' + unit))
  return true
}
function WeightInput({ value, setValue, unit }: { value: number; setValue: (value: number) => void; unit: string }) {
  const W_HI = wHi(unit)
  const clamp = (x: number) => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = (v: number) => setValue(clamp(v))
  const onType = (v: number) => setValue(v)

  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label={t('Decrease by {0}', fmtNum(0.1))}><Icon name="minus" /></button>
      <label className="bw-read">
        <NumberField fit value={value} onChange={onType} aria-label={t('Weight ({0})', unit)} enterKeyHint="done"
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <span className="u"> {unit}</span>
      </label>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label={t('Increase by {0}', fmtNum(0.1))}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close, valid }: BwOptions & CloseProps & { valid: SheetTarget }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState<number>(bw ? bw.w : 70)
  const save = () => {
    if (!valid()) { close(); return }
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    if (bwTooHeavy(n, unit)) return
    const applied = update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find((b: WeighIn) => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a: WeighIn, b: WeighIn) => (a.d < b.d ? -1 : 1))
    }, valid)
    close()
    if (!applied) return
    if (onDone) onDone(n, valid); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight] as WeighIn[]
  const latest = recent.reverse().slice(0, 3)
  return <>
    {/* This sheet opens `locked` — swipe/backdrop/Escape/Android-back all no-op on it (see
        Modals.jsx) so an accidental tap on "Start" can't be walked back by reflex the way
        every other sheet in the app can. The two buttons below already cover leaving it
        deliberately; this is the same close a normal sheet gets everywhere else, just
        opted back in explicitly instead of by omission. Plain close() — no onDone, no
        nav — so it's a true no-op: the screen underneath is exactly where you left it. */}
    {required
      ? <div className="row between" style={{ marginBottom: 14 }}>
          <h3 style={{ marginBottom: 0 }}>{t('Quick check-in')}</h3>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={() => close()}><Icon name="xmark" /></button>
        </div>
      : <h3>{t('Log body weight')}</h3>}
    <div className="muted small">{required ? t('Slide or tap to set your weight. We ask before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { const current = valid(); close(); if (current) onDone?.(null, valid) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="swap" onClick={() => closeThenNav(close, '/workout')}>{t('Choose a different workout')}</Button>
    </>}
    {!required && latest.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {latest.map(b => <WeighInRow key={b.d} b={b} unit={unit} valid={valid} />)}
      </div>
      {st.bodyweight.length > latest.length && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
      </div>}
    </>}
  </>
}
export function bwSheet(opts: BwOptions = {}) {
  const valid = captureSheetTarget()
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} valid={valid} />, { locked: !!opts.required })
  return h
}

// One weigh-in with its delete button, in the log sheet's recent three and in the full list.
// The full list asks first (`confirm`): it is months of history scrolled through on a phone, and a
// stray tap on one of its trash buttons took a past weigh-in with nothing to bring it back. The log
// sheet's three are the ones just typed, where taking back a typo in one tap is the point.
function WeighInRow({ b, unit, confirm = false, valid }: { b: WeighIn; unit: string; confirm?: boolean; valid: SheetTarget }) {
  const delEntry = () => {
    if (!valid()) return
    const current = S().bodyweight.find((x: WeighIn) => x.d === b.d)
    if (!current || current.w !== b.w || current.t !== b.t) { toast(t('This weigh-in changed. Open it again.')); return }
    update(s => {
      const current = s.bodyweight.find((x: WeighIn) => x.d === b.d)
      if (!current || current.w !== b.w || current.t !== b.t) { toast(t('This weigh-in changed. Open it again.')); abortGuardedUpdate() }
      s.bodyweight = s.bodyweight.filter((x: WeighIn) => x.d !== b.d)
    }, valid)
  }
  const ask = () => { if (!valid()) return; confirmSheet({
    title: t('Delete weigh-in?'), message: `${fmtDate(b.d, true)} · ${fmtNum(b.w)} ${unit}`,
    confirmText: t('Delete'), danger: true, onConfirm: delEntry,
  }) }
  return <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
    <span className="small muted">{fmtDate(b.d, true)}</span>
    <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={confirm ? ask : delEntry} aria-label={t('Delete weigh-in')}><Icon name="trash" /></button></span>
  </div>
}

/* ============================ weigh-ins ============================ */
// Every weigh-in, week by week (Discord 'Weight'): each week under its mean and how far that
// moved from the week before, the numbers behind the curve on the card. The chart plots the
// weekly means, since the swing from one morning to the next is what makes a single weigh-in
// hard to read. The weeks start on the profile's first day of the week.
function WeighIns({ valid }: { valid: SheetTarget }) {
  const st = useStore(s => s.S)
  const ws = weekStartOf(st)
  const weeks = useMemo(() => weeklyWeights(st.bodyweight, ws) as WeightWeek[], [st.bodyweight, ws])
  const points = useMemo(() => [...weeks].reverse()
    .map(w => ({ t: new Date(w.key + 'T12:00:00').getTime(), y: Math.round(w.avg * 100) / 100, d: w.key })), [weeks])
  const n = weeks.reduce((sum, w) => sum + w.n, 0)
  if (!n) return <>
    <h3>{t('Weigh-ins')}</h3>
    <div className="empty"><div className="ico"><Icon name="scale" /></div>{t('No weigh-ins yet. Log your weight to start the curve.')}</div>
  </>
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Weigh-ins')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{tn('{0} weigh-in', '{0} weigh-ins', n)}</div>
    <div className="chart"><LineChart points={points} h={140} unit={st.unit} goal={st.targetW} /></div>
    <div className="small dim" style={{ marginTop: 6 }}>{t('Weekly average')}</div>
    {weeks.map(w => {
      // Only a change the display can show: at one decimal, 0.02 kg is "0", and an arrow over a
      // zero says something moved when, as far as the screen goes, nothing did.
      const moved = w.delta != null && fmtNum(Math.abs(w.delta!)) !== fmtNum(0)
      return <div key={w.key} data-week={w.key}>
        <div className="row between" style={{ margin: '16px 2px 4px', gap: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t('Week of {0}', fmtDate(w.key, false))}</span>
          <span className="small row" style={{ gap: 8 }}>
            {moved && <span className="row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(w.delta, w.avg) }}>
              <Icon name={w.delta! > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(w.delta!))}
            </span>}
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{t('Average {0}', fmtNum(w.avg) + ' ' + st.unit)}</span>
          </span>
        </div>
        <div className="list" style={{ gap: 0 }}>{w.entries.map(b => <WeighInRow key={b.d} b={b} unit={st.unit} valid={valid} confirm />)}</div>
      </div>
    })}
  </>
}
export const weighInsSheet = () => {
  const valid = captureSheetTarget()
  return ui().openSheet(close => <WeighIns valid={valid} />)
}

/* ============================ import from another app ============================ */
// "12 sets bring an RPE with them": the file rated its sets. The column is off by default, so
// with it off the line says where to switch it on.
const effortLine = (effort: string, n: number, scale: string) => effort === 'none'
  ? tn('{0} set brings an {1} with it. Switch on Effort per set in Settings to see it.', '{0} sets bring an {1} with them. Switch on Effort per set in Settings to see it.', n, scale)
  : tn('{0} set brings an {1} with it.', '{0} sets bring an {1} with them.', n, scale)
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
function ImportSummary({ parsed, close, valid }: { parsed: ParsedImport; valid: SheetTarget } & CloseProps) {
  const st = useStore(s => s.S)
  const isBW = parsed.kind === 'bodyweight'
  const have = isBW
    ? parsed.bodyweight.filter(b => st.bodyweight.some((x: WeighIn) => x.d === b.d)).length
    : parsed.workouts.filter(w => st.workouts.some((x: { d: string }) => x.d === w.d)).length
  const fresh = (isBW ? parsed.bodyweight.length : parsed.workouts.length) - have

  const doImport = () => {
    if (!valid()) { close(); return }
    let res = { added: 0 }
    const applied = update(s => { res = mergeImport(s as Parameters<typeof mergeImport>[0], parsed, index()) }, valid)
    close()
    if (!applied) return
    toast(isBW
      ? tn('{0} weigh-in imported', '{0} weigh-ins imported', res.added)
      : tn('{0} workout imported', '{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {fmtDateRange(parsed.from, parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'start' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {(!isBW && parsed.mixedUnits) ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb, so each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1}, so weights get converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {!isBW && !parsed.fileUnit && !(!isBW && parsed.mixedUnits) && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file doesn’t say which unit it uses, so numbers are imported as they are.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {effortLine(effortOf(st), parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {/* Rows the parser could not use (no date or name, nothing measured, impossible numbers)
        are left out; say how many, so a short history does not look like a lost one. */}
    {!isBW && parsed.skipped > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {tn('{0} row skipped (couldn’t read it)', '{0} rows skipped (couldn’t read them)', parsed.skipped)}
    </div>}
    {!isBW && parsed.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library, so they’re added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {parsed.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {parsed.unmatchedNames.length > 12 && <span className="mchip">+{parsed.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file: Blob, onDone?: () => void, opened?: SheetTarget): void {
  const captured = captureSheetTarget(), valid: SheetTarget = draft => captured(draft) && (!opened || opened(draft))
  void readImportExport(file, { unit: S().unit, customEx: S().customEx }, index()).then(parsed => {
    if (!valid()) return
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("We don't recognise that file's columns. Check the docs for supported apps.")); return }
    if (parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length) {
      toast(t('Nothing to import from that file')); return
    }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} valid={valid} />)
    onDone?.()
  }, error => toast(error instanceof ImportFileError ? error.message : t('Could not read that file')))
}

/* ============================ import from Hevy API ============================ */
// The key lives in React state for this sheet only — dismissed with the sheet, never
// written to the store / localStorage / the server. After a successful fetch the user
// picks workouts and/or weigh-ins before anything is merged.

export function importFromHevy(opened?: SheetTarget) {
  const captured = captureSheetTarget(), valid: SheetTarget = draft => captured(draft) && (!opened || opened(draft))
  ui().openSheet(close => <HevyImportSheet close={close} valid={valid} />)
}

function hevyProgressLabel(p: HevyProgress | null) {
  if (!p) return t('Fetching from Hevy…')
  if (p.stage === 'templates') return t('Fetching exercises… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'workouts') return t('Fetching workouts… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'routines') return t('Fetching routines… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'body') return t('Fetching weigh-ins… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'parse') return t('Matching exercises…')
  return t('Fetching from Hevy…')
}

function HevyImportSheet({ close, valid }: CloseProps & { valid: SheetTarget }) {
  const st = useStore(s => s.S)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<HevyProgress | null>(null)
  const [payload, setPayload] = useState<HevyPayload | null>(null) // { workouts, routines, bodyweight }
  const [wantWorkouts, setWantWorkouts] = useState(true)
  const [wantRoutines, setWantRoutines] = useState(true)
  const [wantBody, setWantBody] = useState(true)
  const keyRef = useRef<HTMLInputElement>(null)

  // Drop the key from memory when the sheet goes away (unmount or successful import).
  useEffect(() => () => { setApiKey('') }, [])

  const wipeKey = () => { setApiKey(''); if (keyRef.current) keyRef.current.value = '' }

  const fetchAccount = async () => {
    if (!valid()) { close(); return }
    const key = apiKey.trim()
    if (!key) { toast(t('Paste your Hevy API key first')); return }
    setBusy(true)
    setProgress({ stage: 'templates', page: 1, pageCount: 1 })
    setPayload(null)
    try {
      const data = await importHevyData(key, { unit: st.unit, customEx: st.customEx, onProgress: setProgress }, index())
      wipeKey()
      if (!valid()) { close(); return }
      const empty = !data.workouts.workouts.length && !data.routines.routines.length && !data.bodyweight.bodyweight.length
      if (empty) {
        toast(t('Nothing to import from Hevy'))
        return
      }
      setWantWorkouts(!!data.workouts.workouts.length)
      setWantRoutines(!!data.routines.routines.length)
      setWantBody(!!data.bodyweight.bodyweight.length)
      setPayload(data)
    } catch (e) {
      if (e instanceof HevyApiError && e.message === 'auth') toast(t('That Hevy API key was refused'))
      else if (e instanceof HevyApiError && e.message === 'rate-limit') toast(t('Hevy is rate-limiting requests. Wait a minute and try again'))
      else if (e instanceof HevyApiError && e.message === 'empty') toast(t('Paste your Hevy API key first'))
      else toast(t('Couldn’t reach Hevy. Check the key and try again'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const doImport = () => {
    if (!payload) return
    if (!valid()) { close(); return }
    const parts: string[] = []
    let addedW = 0, addedR = 0, addedB = 0
    const applied = update(s => {
      if (wantWorkouts && payload.workouts.workouts.length) {
        const res = mergeImport(s as Parameters<typeof mergeImport>[0], payload.workouts, index())
        addedW = res.added
        parts.push(tn('{0} workout imported', '{0} workouts imported', res.added))
      }
      if (wantRoutines && payload.routines.routines.length) {
        const res = mergeHevyRoutines(s, payload.routines)
        addedR = res.added
        parts.push(tn('{0} routine imported', '{0} routines imported', res.added))
      }
      if (wantBody && payload.bodyweight.bodyweight.length) {
        const res = mergeImport(s as Parameters<typeof mergeImport>[0], payload.bodyweight, index())
        addedB = res.added
        parts.push(tn('{0} weigh-in imported', '{0} weigh-ins imported', res.added))
      }
    }, valid)
    close()
    if (!applied) return
    if (!addedW && !addedR && !addedB) toast(t('Nothing new to import'))
    else toast(parts.join(' · '))
  }

  if (!payload) {
    return <>
      <h3>{t('Import from Hevy')}</h3>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        {t('Pull your history with a Hevy Pro API key. The key is only used for this import and is not saved.')}
      </div>
      <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>{t('Hevy API key')}</label>
      <TextField
        ref={keyRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        value={apiKey}
        disabled={busy}
        onChange={e => setApiKey(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !busy) fetchAccount() }}
      />
      <div className="small" style={{ margin: '10px 0 16px', lineHeight: 1.45 }}>
        <a href={HEVY_DEV_SETTINGS} target="_blank" rel="noopener noreferrer">{t('Get your API key')}</a>
        <span className="dim"> · {t('Hevy → Settings → Developer')}</span>
      </div>
      {busy && <div className="small dim" style={{ marginBottom: 12 }}>{hevyProgressLabel(progress)}</div>}
      <Button variant="primary" onClick={fetchAccount} disabled={busy || !apiKey.trim()}>
        {busy ? t('Fetching from Hevy…') : t('Fetch from Hevy')}
      </Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
    </>
  }

  const w = payload.workouts
  const r = payload.routines
  const b = payload.bodyweight
  const haveW = w.workouts.filter(x => st.workouts.some((y: { d: string }) => y.d === x.d)).length
  const freshW = w.workouts.length - haveW
  const haveB = b.bodyweight.filter(x => st.bodyweight.some((y: WeighIn) => y.d === x.d)).length
  const freshB = b.bodyweight.length - haveB
  // Routines are always added as new copies (same as plan import).
  const freshR = r.routines.length
  const canImport = (wantWorkouts && freshW > 0) || (wantRoutines && freshR > 0) || (wantBody && freshB > 0)
  const unmatched = [...new Set([
    ...(wantWorkouts ? w.unmatchedNames : []),
    ...(wantRoutines ? r.unmatchedNames : []),
  ])].sort()

  return <>
    <h3>{t('Import from Hevy')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {w.from && (w.from === w.to ? fmtDate(w.from, true) : fmtDate(w.from, true) + ' – ' + fmtDate(w.to, true))}
      {!w.from && b.from && (b.from === b.to ? fmtDate(b.from, true) : fmtDate(b.from, true) + ' – ' + fmtDate(b.to, true))}
    </div>

    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{r.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.matched + r.matched}</div></div>
      <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.created + r.created}</div></div>
    </div>

    {w.workouts.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', gap: 12 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import workouts')}</div>
        <div className="small dim">{t('{0} new · {1} days already here', freshW, haveW)}</div>
      </div>
      <Switch checked={wantWorkouts} onChange={setWantWorkouts} />
    </div>}
    {r.routines.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', gap: 12 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import routines')}</div>
        <div className="small dim">{t('{0} routines · {1} exercises, added as new plans', freshR, r.exerciseCount)}</div>
      </div>
      <Switch checked={wantRoutines} onChange={setWantRoutines} />
    </div>}
    {b.bodyweight.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', gap: 12, marginBottom: 8 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import weigh-ins')}</div>
        <div className="small dim">{t('{0} new · {1} days already here', freshB, haveB)}</div>
      </div>
      <Switch checked={wantBody} onChange={setWantBody} />
    </div>}
    {!b.bodyweight.length && <div style={{ borderBottom: '1px solid var(--sep)', marginBottom: 8 }} />}

    {(w.converted || r.converted) && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('Hevy stores weights in kg, so they’ll be converted to {0}.', st.unit)}
    </div>}
    {wantWorkouts && (w.rirSets + w.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {effortLine(effortOf(st), w.rirSets || w.rpeSets, w.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {unmatched.length > 0 && <>
      <h4 className="sec">{t('Not in the library, so they’re added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {unmatched.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {unmatched.length > 12 && <span className="mchip">+{unmatched.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!canImport}>
      {canImport ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { setPayload(null); wipeKey() }}>{t('Back')}</Button>
  </>
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta: number | null, currentW: number) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close, valid }: CloseProps & { valid: SheetTarget }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState<number>(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      if (!valid()) { close(); return }
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      if (bwTooHeavy(n, st.unit)) return
      const applied = update(s => { s.targetW = n }, valid); close()
      if (!applied) return
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { if (!valid()) { close(); return }; const applied = update(s => { s.targetW = null }, valid); close(); if (applied) toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => {
  const valid = captureSheetTarget()
  return ui().openSheet(close => <GoalSheet close={close} valid={valid} />)
}
