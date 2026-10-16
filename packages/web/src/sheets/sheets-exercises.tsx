import Media, { Thumb } from '../components/Media'
import { useUI } from '../store/useUI'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, byCategory, smOf, searchExercises, similarExercises, exOr, isAssisted, isCustomEx } from '@opengym/core/exercises'
import { activeProfile, exAvailable, ALL_EQUIPMENT, newProfile, profileEquipment, ACC_V } from '@opengym/core/equipment'
import { fmtDate, fmtNum, fmtPlate, exerciseNameText, fmtVol, uid, exCount } from '@opengym/core/format'
import { lastEntryFor, bestWeightFor, buildSets, setLabel, defaultConfig, cleanupSg, modeOf, EFFORT, capEffort, stepEffort, isBw, isPerSide, sideReps, applyIntensifierPlan, MAX_PLANNED_WARMUPS } from '@opengym/core/history'
import { usesBar, defaultBarWeight, hasBarOverride, isNoBar } from '@opengym/core/bar'
import { PLATE_SIZES, pairsOf, ownsPlates, withPlatePairs, withStandardPlates, withLoadKind, loadKindFor, baseWeightFor, dropGrid } from '@opengym/core/plates'
import { toScale, rirOf, EFFORT_PRESETS, effortColor } from '@opengym/core/effort'
import { t, tn, instrFor, descFor, exerciseNameFor, exerciseNameClass, useLang } from '../lib/i18n'
import { nav } from '../lib/nav'
import LineChart from '../components/LineChart'
import { Stepper } from '../components/ui'
import { durationSheet } from '../components/DurationWheel'
import { REST_MAX, fmtRest } from '../lib/duration'
import Icon from '../components/Icon'
import { Button, Switch, Segmented, SelectRow, Row, TextField, NumberField, MultiSelectRow } from '../components/ui'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from '../lib/glyphs'
import MuscleExplorer from '../components/MuscleExplorer'
import ExerciseViewToggle from '../components/ExerciseViewToggle'
import { sameMuscleFirst, swapMuscleOf } from '@opengym/core/similar-exercises'
import { exerciseMuscleSnapshot, MUSCLES, MUSCLE_NAME, muscleWeightsOf, normalizeMuscleGroups, hasExplicitMuscleMetadata, inMuscleOrder } from '@opengym/core/muscles'
import { estimate1RM, best1RM, REP_CAP, formulaOf, FORMULA_NAMES } from '@opengym/core/onerm'
import { exerciseHistory } from '@opengym/core/exercise-history'
import { isBellEx, dbLoadOf, dbLoadFor, withDbLoad, withMeaning, historyAs, currentDbLoad, isOneArm, ownedWeightsFor, dumbbellsOf, withDumbbells, presetWeights, cleanWeights } from '@opengym/core/dumbbells'
import { policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS, MAX_TRIPLE_SETS, weightIncrement } from '@opengym/core/progression'
import { normalizeRepRange } from '@opengym/core/rep-range'
import { isBackoff, backoffWeights } from '@opengym/core/backoff'
import { isPyramid, normalizePyramid, normalizePyramidRest, normalizePyramidWeight, pyramidFromFlat, flatFromPyramid, pyramidLabel, PYRAMID_MAX, MAX_PYRAMID_SETS, PYRAMID_PRESETS } from '@opengym/core/pyramid'
import { speedUnitOf, toSpeed, fromSpeed } from '@opengym/core/speed'
import { swapActiveExercise } from '@opengym/core/active-exercise-swap'
import { useSheetKeyboard, useRevealActiveChip, tappable } from '../lib/use-sheet-keyboard'
import { useAutoMore } from '../lib/use-auto-more'
import { isFav, toggleFav, sortFavouritesFirst, sortYoursFirst } from '@opengym/core/favourites'
import { buildPlannedEntry, builtOutOfProgression } from '@opengym/core/session-start'
import { retainProgrammePrescription, authoredPrescriptionFields } from '@opengym/core/programme-prescription'
import { sessionHistory } from '@opengym/core/backfill'
import { captureContext, targetUnchanged, openEditor, createSheetUpdater, type ValidateTarget } from './sheet-target'
import { preserveEquipmentRecord, validEquipmentNumber, rejectInvalidEquipmentInput } from './equipment-record'
import type { StoreDocument } from '../store/useStore'
import type { Exercise } from '@opengym/core/exercises'

/** Historic exercise/config extension shapes are accepted; public callbacks remain typed. */
type ExerciseRow = Exercise & StoreDocument & { id: string; n: string; bp: string; eq: string }
type Close = () => void
type PickExercise = (exercise: Exercise, quick?: boolean) => void
type SaveConfig = (config: StoreDocument) => void
type ConfigProps = { validate: ValidateTarget; ex: ExerciseRow; existing?: StoreDocument | null; initial?: StoreDocument | null; onSave: SaveConfig; onDelete?: Close | null; onReplace?: Close | null; close: Close; routine?: StoreDocument | null; saveLabel?: string }

const S = () => useStore.getState().S
const indexOf = () => useStore.getState().index
const ui = () => useUI.getState()
const toast = (message: string) => ui().toast(message)
export interface ExerciseConfirmOptions { title?: string; message: string; confirmText?: string; danger?: boolean; onConfirm?: () => void }
let confirmService: ((options: ExerciseConfirmOptions) => unknown) | undefined
/** W11/shell supplies its shared dialog without a store ↔ sheets cycle. */
export function configureExerciseSheets(services: { confirmSheet: (options: ExerciseConfirmOptions) => unknown }): void { confirmService = services.confirmSheet }
function ConfirmExerciseDialog({ close, validate, title, message, confirmText, danger, onConfirm }: ExerciseConfirmOptions & { close: () => void; validate: ValidateTarget }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { if (!validate()) return; close(); onConfirm?.() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
const confirmSheet = (options: ExerciseConfirmOptions) => confirmService ? confirmService(options) : openEditor((close, validate) => <ConfirmExerciseDialog {...options} close={close} validate={validate} />, { kind: 'center' })
function BarWeightEditor({ ex, cfg, extra, validate }: { ex: ExerciseRow; cfg?: StoreDocument; extra?: string; validate: ValidateTarget }) {
  const update = createSheetUpdater(validate)
  const st = useStore(s => s.S)
  const bar = usesBar(ex, indexOf())
  const ctx: any = { ...(cfg || {}), id: ex.id }
  const kind = loadKindFor(st, ctx, indexOf())
  const explicit = hasBarOverride(st, ex.id)
  const noBar = bar && isNoBar(st, ex.id)
  const def = defaultBarWeight(ex.eq, st.unit)
  const base = baseWeightFor(st, ex, indexOf())
  // The kinds a pick would only be restating. With a `cfg` there is one: the same default the
  // rows derive. Without one the equipment decides — and for body-weight equipment that answer
  // ('single', the load being whatever you hang on) is not the one a routine logging the total
  // derives ('none', bodyweight: false), so the segment sits lit on a kind the rows do not use
  // and the pick that would fix it is the only way to say so: both readings are consulted, and
  // it is stored unless it is the default under either. Everything else keeps the plain rule —
  // a dumbbell's cfg-less 'none' is what a dumbbell row derives, and storing it would freeze
  // 'none' onto the exercise everywhere, override the 'single' an added-weight entry derives,
  // and leave no pick that takes the key off again.
  const defaults = cfg ? [loadKindFor(null, ctx, indexOf())]
    : isBodyweightEq(ex.id, indexOf()) ? [true, false].map((b: any) => loadKindFor(null, { id: ex.id, bodyweight: b }, indexOf()))
    : [loadKindFor(null, ctx, indexOf())]
  // Picking what the equipment already implies puts the exercise back on it (a stamped null,
  // lib/plates.js), so a later change of the equipment's own default still reaches it.
  const setKind = (k: any) => validate() && update((s: any) => {
    s.loadKind = preserveEquipmentRecord(s.loadKind, withLoadKind(s.loadKind, ex.id, defaults.every((d: any) => d === k) ? null : k), ex.id)
  })
  const setBar = (v: number) => {
    if (!validate()) return
    if (!validEquipmentNumber(v)) { toast(t('Enter a weight from 0 to 9999')); return }
    update((s: any) => {
      s.barWeights = s.barWeights || {}
      const n = Math.round(v * 100) / 100
      if (n > 0) s.barWeights[ex.id] = n; else delete s.barWeights[ex.id]
    })
  }
  // "No bar" is a stored 0, which is a different thing from no entry at all: a counterbalanced
  // Smith carriage weighs nothing in your hands, so the plate math and the drop-set steps must
  // start from what you logged (issue #138). Clearing it goes back to the bar type's default.
  const setNoBar = (on: any) => validate() && update((s: any) => {
    s.barWeights = s.barWeights || {}
    if (on) s.barWeights[ex.id] = 0; else delete s.barWeights[ex.id]
  })
  return <>
    <Segmented className="seg-inline" value={kind} onChange={setKind}
      options={[{ value: 'pairs', label: t('Per side') }, { value: 'single', label: t('Single stack') }, { value: 'none', label: t('Off') }]} />
    <div className="small dim" style={{ margin: '8px 0 12px' }}>
      {kind === 'pairs' ? t('Plates split over both sides of a bar.')
        : kind === 'single' ? t('One stack: a belt, a landmine, a plate-loaded machine, a sled.')
          : t('No plate line under the sets.')}
    </div>
    {kind !== 'none' && <>
      {bar && <div className="list menu-list" style={{ marginBottom: 6 }}>
        <Row icon="barbell" title={t('No bar')} subtitle={t('The weight you log is all plates.')}>
          <Switch checked={noBar} onChange={setNoBar} />
        </Row>
      </div>}
      {!noBar && <div className="row cfgrow" style={{ marginBottom: 6 }} onChangeCapture={e => rejectInvalidEquipmentInput(e, () => toast(t('Enter a weight from 0 to 9999')))}>
        <Stepper label={bar ? t('Bar ({0})', st.unit) : t('Base weight ({0})', st.unit)} value={base} step={2.5} onChange={setBar} />
      </div>}
      <div className="small dim" style={{ marginBottom: 18 }}>
        {noBar ? t('Plates are counted from 0. Turn this off for the default ({0}).', fmtNum(def) + ' ' + st.unit)
          : bar ? (explicit ? t('Set to 0 to go back to the default ({0}).', fmtNum(def) + ' ' + st.unit) : t('Default for this bar type.'))
            : t('The machine or sled itself, before any plate goes on. 0 if it is all plates.')}
        {extra ? ' ' + extra : ''}
      </div>
    </>}
  </>
}

// What a dumbbell or kettlebell weight means (issue #474, lib/dumbbells.js): as entered (the
// default, how every set before this was counted), one bell, or both together. `value` is the
// meaning in force and `onChange` stores a pick; the caller decides where (the routine's slot or
// the exercise's own default). The line under it says what the pick does to the numbers.
function DbLoadPicker({ ex, cfg, value, onChange }: { ex: ExerciseRow; cfg?: StoreDocument; value: string; onChange: (value: string) => void }) {
  const one = isOneArm({ ...(cfg || {}), id: ex.id }, indexOf())
  return <>
    <Segmented className="seg-inline" value={value} onChange={onChange}
      options={[{ value: 'as', label: t('As entered') }, { value: 'each', label: t('Each') }, { value: 'total', label: t('Both') }]} />
    <div className="small dim" style={{ margin: '8px 0 18px' }}>
      {value === 'each' ? (one ? t('The weight of the one you hold. One arm, so it counts once.') : t('The weight of one, so 20 means 20 in each hand. Volume counts both.'))
        : value === 'total' ? t('Both together, so 40 means two 20s.')
          : t('Counted as you type it, the way it always was.')}
    </div>
  </>
}

// Mid-workout sheet behind the ⋯ menu's "Plate loading" — same values, same editor.
function BarWeightSheet({ exId, cfg, close, validate }: { exId: string; cfg?: StoreDocument; close: Close; validate: ValidateTarget }) {
  const ex = exOr(exId, indexOf()) as ExerciseRow
  return <>
    <h3>{t('Plate loading')}</h3>
    <div className={`muted small ${exerciseNameClass(ex)}`} style={{ marginBottom: 12 }}>{exerciseNameFor(ex)}</div>
    <BarWeightEditor ex={ex} cfg={cfg} validate={validate} extra={t('Applies to this exercise everywhere, not just this plan.')} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const barWeightSheet = (exId: string, cfg?: StoreDocument) => openEditor((close, validate) => <BarWeightSheet exId={exId} cfg={cfg} close={close} validate={validate} />)

// The plates you own, as pairs per size, for the profile's unit (Settings → Equipment → Plates).
// The first edit copies the standard set into S.plates[unit] and changes one count in it, so the
// list you see is always the list the set rows load from. "Back to the standard set" empties the
// unit's list again. Both are stamped (lib/plates.js), so the last change wins a sync.
function PlateInventorySheet({ close, validate }: { close: Close; validate: ValidateTarget }) {
  const update = createSheetUpdater(validate)
  const st = useStore(s => s.S)
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const own = ownsPlates(st)
  const setPairs = (w: number, n: number) => {
    if (!validate()) return
    if (!validEquipmentNumber(n)) { toast(t('Enter a pair count from 0 to 9999')); return }
    update((s: any) => { s.plates = preserveEquipmentRecord(s.plates, withPlatePairs(s, w, n), unit) })
  }
  const reset = () => validate() && update((s: any) => { s.plates = preserveEquipmentRecord(s.plates, withStandardPlates(s), unit, true) })
  return <>
    <h3>{t('Plates')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Pairs of each size you own. Every set row loads from this list, so a home gym with one pair of 45s is never told to use two.')}
    </div>
    {PLATE_SIZES[unit].map((w: any) => (
      <div className="row cfgrow" key={w} style={{ marginBottom: 6 }} onChangeCapture={e => rejectInvalidEquipmentInput(e, () => toast(t('Enter a pair count from 0 to 9999')))}>
        <Stepper label={fmtPlate(w) + ' ' + unit} value={pairsOf(st, w)} step={1} decimal={false} unit={t('pairs')} onChange={(n: any) => setPairs(w, n)} />
      </div>
    ))}
    <div className="small dim" style={{ margin: '4px 0 14px' }}>
      {own ? t('Your own list for {0}.', unit) : t('The standard set, plenty of each. Change any count to make it yours.')}
    </div>
    {own && <Button onClick={reset} style={{ marginBottom: 8 }}>{t('Back to the standard set')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const plateInventorySheet = () => openEditor((close, validate) => <PlateInventorySheet close={close} validate={validate} />)

// The dumbbells you own, for the profile's unit (Settings → Equipment → Dumbbells, issue #376):
// a list of single bells, kept per unit like the plates (lib/dumbbells.js). With one, progression,
// deloads, warm-ups, drops and the stepper of every dumbbell lift land on these; an empty list
// puts them back on the increment. Tapping a weight takes it off, the field adds one, and the
// quick fill writes the usual rack for the unit to edit from. Every change is stamped.
function DumbbellInventorySheet({ close, validate }: { close: Close; validate: ValidateTarget }) {
  const update = createSheetUpdater(validate)
  const st = useStore(s => s.S)
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const list = dumbbellsOf(st)
  const [draft, setDraft] = useState<number | null>(null)
  const save = (ws: any) => validate() && update((s: any) => { s.dumbbells = preserveEquipmentRecord(s.dumbbells, withDumbbells(s, ws), unit) })
  const preset = presetWeights(unit)
  const add = () => {
    const w = cleanWeights([draft])[0]
    if (!w) { toast(t('Enter a valid weight')); return }
    save([...list, w])
    setDraft(null)
  }
  return <>
    <h3>{t('Dumbbells')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('The weights you own, one bell each. Progression, deloads, warm-ups and the + and − buttons of dumbbell lifts land only on these.')}
    </div>
    {list.length > 0
      ? <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', touchAction: 'auto', marginBottom: 12 }}>
        {list.map((w: any) => <button key={w} className="chip on nocap" aria-label={t('Remove {0}', fmtPlate(w) + ' ' + unit)}
          onClick={() => save(list.filter((x: any) => x !== w))}>{fmtPlate(w)} <Icon name="xmark" /></button>)}
      </div>
      : <div className="small dim" style={{ marginBottom: 12 }}>{t('No list yet, so dumbbell lifts step by their increment as usual.')}</div>}
    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      <NumberField className="input" decimal value={draft ?? ''} onChange={(v: any) => setDraft(v)}
        aria-label={t('Weight ({0})', unit)} placeholder={t('Weight ({0})', unit)} onKeyDown={(e: any) => { if (e.key === 'Enter') add() }} />
      <Button icon="plus" onClick={add} style={{ flex: '0 0 auto', width: 'auto' }}>{t('Add')}</Button>
    </div>
    <Button onClick={() => save(preset)} style={{ marginBottom: 8 }}>
      {t('Fill in {0} to {1} {2}, every {3}', fmtPlate(preset[0]), fmtPlate(preset.at(-1)), unit, fmtPlate(preset[1]! - preset[0]!))}
    </Button>
    {list.length > 0 && <Button variant="danger" onClick={() => save([])} style={{ marginBottom: 8 }}>{t('Clear the list')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const dumbbellInventorySheet = () => openEditor((close, validate) => <DumbbellInventorySheet close={close} validate={validate} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }: { ex: ExerciseRow }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id, undefined, undefined, indexOf())
  const [w, setW] = useState<any>(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState<any>(best ? best.r : 5)
  const est = estimate1RM(w, r, formulaOf(st))
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '–' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps. Beyond that it’s basically guesswork.', REP_CAP)
      : formulaOf(st) === 'weighted'
        ? t('A blend of seven formulas: calculated from one set, not a tested max.')
        : t('{0} formula: calculated from one set, not a tested max.', (FORMULA_NAMES as Record<string, any>)[formulaOf(st)])}</div>
  </>
}

// A muscle the catalogue credits with nothing (a bench press's biceps, #359) is not one it trains,
// so it is not shown as a tag either; "By muscle" already leaves the exercise out.
const trainedBy = (ex: any) => { const weights = muscleWeightsOf(ex) as Record<string, number>; return (slug: any) => weights[slug] !== 0 }
// The detail page's tags: body part, main muscles, equipment, then up to three helpers. A word
// says once what it says: the body part "Chest" and the main muscle "Chest" of a bench press
// were two tags (QA 10-06), and a helper never repeats a main muscle.
export function detailTags(ex: Exercise) {
  const seen: any = new Set()
  const out: any = []
  const add = (label: any, extra?: any) => {
    const k = String(label || '').trim().toLocaleLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    out.push({ key: out.length, label, ...extra })
    return true
  }
  add(t(ex.bp), { acc: true })
  if (ex.bp === 'cardio') add(t((MUSCLE_NAME as Record<string, any>)['cardiovascular system']), { icon: 'figureStrength' })
  else for (const s of (ex.primaries?.length ? ex.primaries : (ex.tg ? [ex.tg] : [])).filter(trainedBy(ex))) add(t((MUSCLE_NAME as Record<string, any>)[s] || s), { icon: 'figureStrength' })
  add(t(ex.eq), { icon: 'kettlebell' })
  let helpers = 0
  for (const s of (ex.secondaries?.length ? ex.secondaries : smOf(ex)).filter(trainedBy(ex))) {
    if (helpers >= 3) break
    if (add(t((MUSCLE_NAME as Record<string, any>)[s] || s))) helpers++
  }
  return out
}

function ExerciseDetail({ ex, close, validate }: { ex: ExerciseRow; close: Close; validate: ValidateTarget }) {
  const update = createSheetUpdater(validate)
  useLang() // the description and steps arrive in their own chunk the first time a sheet asks
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id, currentDbLoad(st, ex.id), indexOf())
  const fav = isFav(st, ex.id)
  const flipFav = () => {
    if (!validate()) return
    let on = false
    if (!update((s: any) => { on = toggleFav(s, ex.id) })) return
    toast(on ? t('Added to favourites') : t('Removed from favourites'))
  }
  return <>
    <Media ex={ex} />
    <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
      <h3 className={'exdetail-name ' + exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
      <button className={'iconbtn fav-btn' + (fav ? ' on' : '')} aria-pressed={fav}
        aria-label={fav ? t('Remove from favourites') : t('Add to favourites')} onClick={flipFav}>
        <Icon name={fav ? 'starFill' : 'star'} />
      </button>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      {detailTags(ex).map((tg: any) => <span key={tg.key} className={'tag' + (tg.acc ? ' acc' : '')}>{tg.icon && <Icon name={tg.icon} />}{tg.label}</span>)}
    </div>
    {descFor(ex) && <div className="exnote">{descFor(ex)}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent" style={{ whiteSpace: 'nowrap' }}>{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d, false)}: ${last.sets.map((s: any) => setLabel(ex.id, s, last.target, speedUnitOf(st), indexOf())).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => { if (validate()) addToRoutineSheet(ex) }}>{t('Add to my plan')}</Button>
    {last && <Button icon="history" style={{ marginTop: 4 }} onClick={() => exerciseHistorySheet(ex.id)}>{t('History')}</Button>}
    {isCustomEx(ex, indexOf()) && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { if (!validate()) return; close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => { if (validate()) deleteCustomEx(ex, close) }}>{t('Delete')}</Button>
    </div>}
    {modeOf({ id: ex.id }, indexOf()) === 'reps' && <>
      <h4 className="sec">{t('Plate loading')}</h4>
      <BarWeightEditor ex={ex} validate={validate} extra={t('You still log the total weight. This only feeds the plate line under each set.')} />
    </>}
    {/* The exercise's own default meaning of its weight (S.dbLoad), stamped like the loading
        above. A routine can still pick its own on the exercise's settings. */}
    {isBellEx(ex, indexOf()) && <>
      <h4 className="sec">{t('Weight means')}</h4>
      <DbLoadPicker ex={ex} value={dbLoadFor(st, ex.id, indexOf())}
        onChange={(v: any) => validate() && update((s: any) => { s.dbLoad = preserveEquipmentRecord(s.dbLoad, withDbLoad(s.dbLoad, ex.id, v), ex.id) })} />
    </>}
    {/* No one-rep max on an assistance machine: the load is the help you were given, so the
        calculator would answer "your 1RM is 23 kg" about a number that gets smaller as you get
        stronger (issue #232). Cardio has none for the same kind of reason. */}
    {!isCardio(ex, indexOf()) && !isAssisted(ex, indexOf()) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}</h4><ol className="steps-list">{instrFor(ex).map((s: any, i: any) => <li key={i}>{s}</li>)}</ol></>}
    {/* The catalogue is community-edited (catalogue/README.md): a wrong muscle, a clumsy step or a
        missing translation is one tap from an issue that already names the exercise. */}
    {!isCustomEx(ex, indexOf()) && !ex.missing && <a className="small dim exfix-link" target="_blank" rel="noopener"
      href={'https://github.com/DuarteSantos8/openGym/issues/new?template=exercise.yml&exercise=' + encodeURIComponent(ex.id + ', ' + ex.n)}>
      <Icon name="pencil" /> {t('Suggest a fix for this exercise')}</a>}
  </>
}
export const exerciseDetailSheet = (ex: Exercise) => openEditor((close, validate) => <ExerciseDetail ex={ex as ExerciseRow} close={close} validate={validate} />)

/* ============================ exercise history ============================ */
// What you did on this exercise before, reachable mid-workout (issue #43): the curve first,
// then the last sessions set by set, so the question "what did I do last month" is answered
// without leaving the workout for Stats. Derived once per log change — the sheet re-renders on
// every store tick while a session runs, and LineChart drops its hover whenever `points`
// changes identity, so a series rebuilt per render would lose the tooltip under your finger.
function ExerciseHistory({ exId }: { exId: string }) {
  const st = useStore(s => s.S)
  const ex = exOr(exId, indexOf()) as ExerciseRow
  const h = useMemo(() => exerciseHistory(st, exId, undefined, indexOf()), [st.workouts, exId])
  const [curve, setCurve] = useState<any>('top')
  const onE1 = curve === 'e1rm' && h.e1rmPoints.length > 0
  const unit = h.metric === 'weight' ? st.unit : h.metric === 'reps' ? t('reps') : h.metric === 'sec' ? 's' : t('min')
  const e1Best = useMemo(() => Math.max(0, ...h.e1rmPoints.map((p: any) => p.y)), [h])
  if (!h.total) return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No sessions logged yet')}</div>
  </>
  const tail = (s: any) => [
    s.volume > 0 && t('Volume') + ' ' + fmtVol(s.volume, st.unit),
    s.e1rm != null && t('Est. 1RM') + ' ' + fmtNum(s.e1rm) + ' ' + st.unit,
  ].filter(Boolean).join(' · ')
  return <>
    <h3 className={exerciseNameClass(ex)} style={{ marginBottom: 2 }}>{exerciseNameFor(ex)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Exercise history')} · {tn('{0} session', '{0} sessions', h.total)}</div>
    {/* Only reps work with a load produces an estimate, so the toggle is absent for the rest. */}
    {h.e1rmPoints.length > 0 && h.metric === 'weight' && <Segmented className="seg-range" value={curve} onChange={setCurve}
      options={[{ value: 'top', label: t('Top set') }, { value: 'e1rm', label: t('Est. 1RM') }]} />}
    <div className="chart" style={{ marginTop: 8 }}>
      <LineChart points={onE1 ? h.e1rmPoints : h.points} h={140} unit={onE1 ? st.unit : unit} color="var(--blue)" />
    </div>
    <div className="small row" style={{ margin: '6px 0 4px', gap: 5 }}>
      <Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />
      {t('Best:')} <b className="accent">{fmtNum(onE1 ? e1Best : h.best)} {onE1 ? st.unit : unit}</b>
    </div>
    <h4 className="sec">{h.sessions.length < h.total ? t('Last {0} sessions', h.sessions.length) : t('Sessions')}</h4>
    <div className="list">
      {h.sessions.map((s: any) => <div key={s.id} className="item" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tt">{fmtDate(s.d, true)} {s.pr && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{s.sets.map((x: any) => setLabel(exId, x, s.target, speedUnitOf(st), indexOf())).join('  ·  ')}</div>
          {tail(s) && <div className="small dim" style={{ marginTop: 3 }}>{tail(s)}</div>}
        </div>
        {s.value != null && s.value > 0 && <b className="accent nocap" style={{ whiteSpace: 'nowrap' }}>{fmtNum(s.value)} {unit}</b>}
      </div>)}
    </div>
  </>
}
export const exerciseHistorySheet = (exId: string) => ui().openSheet((close: Close) => <ExerciseHistory exId={exId} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close, validate }: { ex: ExerciseRow; close: Close; validate: ValidateTarget }) {
  const st = useStore(s => s.S)
  const pick = (rid: any) => {
    if (!validate()) return
    const routine = S().routines.find((r: any) => r.id === rid)
    if (rid !== '_new' && !routine) { toast(t('The target changed. Open this sheet again.')); return }
    const before = JSON.stringify(routine)
    const context = captureContext()
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, (cfg: any) => {
      const update = createSheetUpdater(state => context(state) && (isNew || targetUnchanged(before, (state || S()).routines.find((r: any) => r.id === rid))))
      if (!update((s: any) => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find((x: any) => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })) return
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find((x: any) => x.id === rid)
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find((x: any) => x.id === rid))
  }
  return <>
    <h3 className={exerciseNameClass(ex)}>{t('Add “{0}”', exerciseNameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine. Sets, reps and weight come next.')}</div>
    <div className="list">
      {st.routines.map((r: any) => <div key={r.id} className="item" {...tappable(() => pick(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some((e: any) => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" {...tappable(() => pick('_new'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="plusCircle" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = (ex: Exercise) => openEditor((close, validate) => <AddToRoutine ex={ex as ExerciseRow} close={close} validate={validate} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name, body part and equipment make a custom exercise. Existing opaque fields
// survive an edit; the deleted media/link editor produces no new references.
function CustomExForm({ existing, prefill, onDone, close, validate }: { validate: ValidateTarget; existing?: ExerciseRow | null; prefill?: string; onDone?: (exercise: Exercise | undefined) => void; close: Close }) {
  const update = createSheetUpdater(validate)
  const nameRef = useRef<HTMLInputElement>(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const [n, setN] = useState<any>(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState<any>(existing ? existing.bp : '')
  const [eq, setEq] = useState<any>(existing ? (existing.eq || '') : '')
  const storedEq = existing && typeof existing.eq === 'string' && existing.eq && !ALL_EQUIPMENT.includes(existing.eq) ? existing.eq : null
  const [desc, setDesc] = useState<any>(existing ? (existing.desc || '') : '')
  const [primaries, setPrimaries] = useState<any>(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...existing.primaries]
    if (existing?.bp === 'cardio') return ['cardiovascular system']
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.length ? [norm[0]] : []
  })
  const [secondaries, setSecondaries] = useState<any>(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...(existing.secondaries || [])]
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.slice(1)
  })
  // Every primary chip this sheet saw a tap on, in that order. `primaries` alone cannot say what the
  // user reached for first: an existing exercise seeds it in the map's order, because that is how the
  // muscles are stored. The taps are the only record of the user's own order, and they decide the
  // target when the one the exercise had is un-ticked.
  const [primaryTaps, setPrimaryTaps] = useState<string[]>([])
  const togglePrimary = (value: any) => {
    setPrimaryTaps((current: any) => [...current, value])
    setPrimaries((current: any) => current.includes(value) ? current.filter((m: any) => m !== value) : [...current, value])
  }
  const toggleSecondary = (value: any) => setSecondaries((current: any) => current.includes(value) ? current.filter((m: any) => m !== value) : [...current, value])
  const save = () => {
    if (!validate()) return
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    if (!eq) { toast(t('Pick equipment')); return }
    // An exercise kept under its own name is not a duplicate, even when the catalogue has one
    // spelled the same (an imported "trap bar deadlift"): only a new or changed name is checked.
    const renamed = !existing || name.toLowerCase() !== String(existing.n || '').trim().toLowerCase()
    const dup = renamed && allExercises(S()).find((e: any) => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    // Stored in the map's order, not the order the chips were tapped in — the tags on the exercise
    // used to shuffle with every edit.
    const prim = bp === 'cardio' ? ['cardiovascular system'] : inMuscleOrder(primaries)
    const sm = inMuscleOrder(secondaries.filter((m: any) => !prim.includes(m)))
    const groups: any = [...prim, ...sm]
    // The one-word target (the library row, the picker, the Muscles view) is not the sorted list's
    // head — a hip thrust with Traps as an extra primary is not a Traps exercise. It is the primary
    // tapped first, and an edit keeps the exercise's target as long as that muscle is still a primary.
    // Once that muscle is gone the next answer is the first one tapped here that survived — a tap that
    // only turned a chip off says nothing and is skipped with it. The sorted list is the last resort,
    // for the user who drops the target and adds nothing in its place.
    const tg = (existing && prim.includes(existing.tg)) ? existing.tg : (primaryTaps.find((m: any) => prim.includes(m)) || prim[0] || '')
    let id = existing && existing.id
    let applied: boolean
    if (existing) applied = update((s: any) => { const c = (s.customEx || []).find((x: any) => x.id === id); if (c) {
      c.n = name; c.bp = bp; c.desc = d; c.tg = tg; c.sm = sm; c.muscleGroups = groups; c.primaries = prim; c.secondaries = sm; c.eq = eq
    } })
    else {
      id = 'c' + uid()
      applied = update((s: any) => { const c: any = { id, n: name, bp, desc: d, tg, sm, muscleGroups: groups, primaries: prim, secondaries: sm, eq, custom: true }; (s.customEx = s.customEx || []).push(c) })
    }
    if (!applied) return
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(indexOf()[id!])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part. It works just like any other exercise.')}</div>
    <input ref={nameRef} className="input" placeholder={t('Exercise name')} maxLength={80} value={n} onFocus={onNameFocus} onChange={(e: any) => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map((b: any) => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    <div className="chips" style={{ margin: '12px 0' }}>
      {ALL_EQUIPMENT.map((k: any) => (<button key={k} className={'chip' + (eq === k ? ' on' : '')} onClick={() => setEq(k)}>{t(k)}</button>))}
      {/* An imported exercise can carry equipment the list does not have (`custom` from a CSV or
          Hevy import). It stays a chip of its own, picked, so Save does not stop on "Pick equipment". */}
      {storedEq && <button key={storedEq} className={'chip' + (eq === storedEq ? ' on' : '')} onClick={() => setEq(storedEq)}>{t(storedEq)}</button>}
    </div>
    {bp && <>
      {bp !== 'cardio' && <MultiSelectRow title={t('Primary muscle groups')} sheetTitle={t('Primary muscle groups')}
        values={primaries}
        options={MUSCLES.map((m: any) => ({ value: m, label: t((MUSCLE_NAME as Record<string, any>)[m]) }))}
        onToggle={togglePrimary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
      }
      <MultiSelectRow title={t('Additional muscle groups')} sheetTitle={t('Additional muscle groups')}
        values={secondaries}
        options={MUSCLES.filter((m: any) => !primaries.includes(m)).map((m: any) => ({ value: m, label: t((MUSCLE_NAME as Record<string, any>)[m]) }))}
        onToggle={toggleSecondary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
    </>}
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional): setup, cues, anything you want to remember')}
      value={desc} onChange={(e: any) => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { if (!validate()) return; close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing?: Exercise | null, onDone?: (exercise: Exercise | undefined) => void, prefill?: string) => {
  const before = JSON.stringify(existing && S().customEx.find((row: any) => row.id === existing.id))
  return openEditor((close, validate) => <CustomExForm existing={existing as ExerciseRow | undefined} prefill={prefill} onDone={onDone} close={close} validate={(state = S()) => validate(state) && (!existing || targetUnchanged(before, state.customEx.find((row: any) => row.id === existing.id)))} />)
}

export function deleteCustomEx(ex: Exercise, afterDelete?: () => void) {
  const context = captureContext()
  const before = JSON.stringify(S().customEx.find((row: any) => row.id === ex.id))
  const update = createSheetUpdater((state = S()) => {
    if (!context(state) || !targetUnchanged(before, state.customEx.find((row: any) => row.id === ex.id))) return false
    if (state.active?.entries.some((entry: any) => entry.id === ex.id)) { toast(t('Finish your current workout first')); return false }
    return true
  })
  if (S().active?.entries.some((e: any) => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      if (!context() || !targetUnchanged(before, S().customEx.find((row: any) => row.id === ex.id))) return
      if (S().active?.entries.some((entry: any) => entry.id === ex.id)) { toast(t('Finish your current workout first')); return }
      if (!update((s: any) => {
        // Keep display and muscle metadata in history before the custom catalogue row disappears.
        const snapshot = exerciseMuscleSnapshot(ex)
        s.workouts.forEach((w: any) => w.entries.forEach((e: any) => {
          if (e.id !== ex.id) return
          e.n = ex.n
          if (!e.muscleSnapshot || !Object.keys(e.muscleSnapshot).length) e.muscleSnapshot = snapshot
        }))
        s.customEx = (s.customEx || []).filter((x: any) => x.id !== ex.id)
        s.routines.forEach((r: any) => { r.ex = r.ex.filter((e: any) => e.id !== ex.id); cleanupSg(r.ex) })
        delete s.exWeights[ex.id!]
        s.favEx = (s.favEx || []).filter((id: any) => id !== ex.id)
      })) return
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st: any) {
  const u: any = {}
  st.routines.forEach((r: any) => r.ex.forEach((e: any) => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach((w: any) => w.entries.forEach((e: any) => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
// The swap pickers' own scope (#473): exercises sharing the swapped exercise's target muscle.
const SAME = '≈'
function ExercisePicker({ onPick, title, close, like, validate }: { validate: ValidateTarget; onPick: PickExercise; title?: string; close: Close; like?: string }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState<string>('')
  // What a swap is away from: the picker opens on what trains the same muscle, if anything you
  // can use does, and "All" is one tap back to everything.
  const likeEx = like ? (indexOf()[like] || allExercises(st).find((e: any) => e.id === like) || null) : null
  // A muscle nothing else trains gets no chip at all rather than one that lists nothing.
  const likeTg = swapMuscleOf(likeEx) && sameMuscleFirst(allExercises(st), likeEx).length ? swapMuscleOf(likeEx) : ''
  const [bp, setBp] = useState<any>(() => {
    if (!likeTg) return ''
    const prof = activeProfile(st)
    return sameMuscleFirst(allExercises(st), likeEx).some((e: any) => !prof || exAvailable(st, e)) ? SAME : ''
  })                                        // '' = all, '★' = chosen, '☆' = favourites, '≈' = same muscle, else a body part
  const [eq, setEq] = useState<any>('')          // '' = any equipment
  const [cat, setCat] = useState<any>('')        // '' = any type
  const [showAll, setShowAll] = useState<any>(false)
  const [shown, setShown] = useState<number>(50)
  const [byMuscle, setByMuscle] = useState<any>(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const bpStrip = useRef<HTMLDivElement>(null), eqStrip = useRef<HTMLDivElement>(null), catStrip = useRef<HTMLDivElement>(null)
  const onSearchFocus = useSheetKeyboard(searchRef)
  const moreRef = useAutoMore(() => setShown((s: any) => s + 50))
  const all = allExercises(st)
  const profile = activeProfile(st)
  const inScope = (e: any) => bp === '★' ? usage[e.id] : bp === '☆' ? isFav(st, e.id) : (!bp || e.bp === bp)
  let inPart = searchExercises(bp === SAME ? sameMuscleFirst(all, likeEx) : all.filter(inScope), q)
  if (bp === '★') inPart = [...inPart].sort((a: any, b: any) => (usage[b.id] - usage[a.id]) || exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
  // The Library's Type row (issue #521), with its fallback: a type the search or muscle group
  // narrowed away is ignored for this view, not forgotten.
  const { opts: catOpts, on: catOn, list: base } = byCategory(inPart, cat)
  const eqFiltered = (profile && !showAll) ? base.filter((e: any) => exAvailable(st, e)) : base
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  // On the same-muscle list the equipment order wins: what is on the same kit comes first,
  // favourites leading within each half.
  // While searching, what you have logged or planned follows right after them.
  const narrowedList = eqOn ? eqFiltered.filter((e: any) => e.eq === eqOn) : eqFiltered
  const ranked = q.trim() ? sortYoursFirst(narrowedList, st, usage) : sortFavouritesFirst(narrowedList, st)
  const f = bp === SAME ? sameMuscleFirst(ranked, likeEx) : ranked
  const chosenCount = Object.keys(usage).length
  const favCount = (st.favEx || []).length
  const special = bp === '★' || bp === '☆'
  // The Library's live result count (GitLab !31), for the same reason: how many are left.
  const narrowed = !!(q.trim() || bp || eqOn || catOn)
  useRevealActiveChip(bpStrip, bp)
  useRevealActiveChip(eqStrip, eqOn)
  useRevealActiveChip(catStrip, catOn)
  // Close but not exact (a typo too many, most of the words, a similar name), listed under the
  // results once you have scrolled to their end, so a search almost never ends on nothing.
  // Worked out a beat behind the typing (useDeferredValue): the list itself never waits for it.
  const qLate = useDeferredValue(q)
  const similar = q.trim() && qLate === q && !special && f.length <= shown
    ? similarExercises((profile && !showAll ? all.filter((e: any) => exAvailable(st, e)) : all).filter((e: any) => bp === SAME || !bp || e.bp === bp), q, f, f.length ? 12 : 30)
    : []
  const pickRow = (e: any) => <div key={e.id} className="item" {...tappable(() => onPick(e))}>
        <Thumb ex={e} /><div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(st, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss capitalize">{t((MUSCLE_NAME as Record<string, any>)[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
        {/* Accent tag = already in a routine/log ("Chosen"); the yellow star by the name = favourite. */}
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}
        {/* A "+" glyph reads as "add this now" — it used to just open the same detail sheet as
            tapping the row, so it added nothing until you'd scrolled past the sets/reps config
            and found the real button. Now it does what it looks like: adds with the default
            config right away. Tapping the row itself still opens the detail/config sheet, for
            when you want to set sets/reps before adding. */}
        <button className="iconbtn chev" aria-label={t('Add “{0}”', exerciseNameFor(e))} style={{ padding: 8, margin: -8 }}
          onClick={(ev: any) => { ev.stopPropagation(); onPick(e, true) }}><Icon name="plus" /></button>
      </div>
  if (byMuscle) return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="ghost" onClick={() => setByMuscle(false)}>{t('All')}</Button>
    </div>
    <MuscleExplorer onPick={onPick} />
  </>

  return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="tinted" icon="figureStrength" onClick={() => setByMuscle(true)}>{t('By muscle')}</Button>
    </div>
    {/* .picker-search is what index.css keys the keyboard-aware sheet layout on: the sheet
        lifts above the keys and the search stays put while the list scrolls under it. */}
    <div className="picker-search"><div className="search-row"><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input ref={searchRef} className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onFocus={onSearchFocus} onChange={(e: any) => { setQ(e.target.value); setShown(50) }} />
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}
      {q && <button className="clear" onClick={() => { setQ(''); setShown(50) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}</div>
      <ExerciseViewToggle /></div></div>
    {profile && <div className="small dim row" style={{ margin: '8px 0 2px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll((v: any) => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {/* Changing muscle group keeps the equipment filter: if it still has exercises under the new
        group the filter stays applied, and if not the eqOn fallback above drops it for this view
        without forgetting the choice (issue #71). The favourites/chosen chips still clear it —
        those are cross-body-part views where a stale equipment filter would be confusing. */}
    <div className="chips" ref={bpStrip} style={{ margin: eqOpts.length > 1 || catOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {likeTg && <button className={'chip nocap' + (bp === SAME ? ' on' : '')} onClick={() => { setBp(SAME); setShown(50) }}><Icon name="figureStrength" style={{ fontSize: 12, display: 'inline-block', marginInlineEnd: 4, verticalAlign: '-1px' }} />{t('Same muscle: {0}', t((MUSCLE_NAME as Record<string, any>)[likeTg] || likeTg))}</button>}
      {favCount > 0 && <button className={'chip' + (bp === '☆' ? ' on' : '')} onClick={() => { setBp('☆'); setEq(''); setShown(50) }}><Icon name="starFill" className="fav-star" />{t('Favourites')} ({favCount})</button>}
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginInlineEnd: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map((b: any) => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(50) }}>{t(b)}</button>)}
    </div>
    {catOpts.length > 1 && <div className="chips" ref={catStrip} style={{ marginBottom: eqOpts.length > 1 ? 6 : 10 }}>
      <button className={'chip nocap' + (!catOn ? ' on' : '')} onClick={() => { setCat(''); setShown(50) }}>{t('Any type')}</button>
      {catOpts.map((x: any) => <button key={x} className={'chip' + (catOn === x ? ' on' : '')} onClick={() => { setCat(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map((x: any) => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className={'list' + (st.exerciseView === 'cards' ? ' ex-grid' : '')}>
      {!special && <div className="item ex-new" {...tappable(() => { if (validate()) customExSheet(null, (ex: any) => onPick(ex), q.trim()) })}>
        <div className="thumb thumb-x"><Icon name="plusCircle" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(pickRow)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing picked yet. Add some exercises and they’ll show up here.')}</div>}
      {f.length === 0 && bp === '☆' && <div className="empty">{t('No favourites yet. Tap the star on an exercise to add one.')}</div>}
      {similar.length > 0 && <h4 className="sec similar-label">{f.length ? t('Similar exercises') : t('No exact match. These come close:')}</h4>}
      {similar.map(pickRow)}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button ref={moreRef} onClick={() => setShown((s: any) => s + 50)}>{t('Show more')}</Button></>}
  </>
}
// `title` names what the pick is for when it is not an add — the routine editor's Replace (#110).
// `like` is the exercise a swap or a replace is away from: the picker then opens on the ones that
// train the same muscle, same equipment first (#473).
export const exercisePicker = (onPick: PickExercise, { title, like }: { title?: string; like?: string } = {}) => openEditor((close, validate) => <ExercisePicker validate={validate} onPick={(ex, quick) => { if (validate()) onPick(ex, quick) }} title={title} like={like} close={close} />)

/** Start a safe swap for one exact active-workout occurrence. */
export function swapActiveWorkoutExercise(index: number) {
  const active = S().active
  if (!active?.entries?.[index]) return
  const context = captureContext()
  const before = JSON.stringify(active.entries)
  const validSlot: ValidateTarget = (state = S()) => context(state) && targetUnchanged(before, state.active?.entries)
  const update = createSheetUpdater(validSlot)

  // The "+" on a picker row commits with the default config, exactly as it does in the add
  // flows; tapping the row still opens the config sheet first.
  // Worded for the session, not the routine: a swap changes today's workout only.
  const picker = exercisePicker((ex: any, quick: any) => quick ? swapTo(ex, defaultConfig(ex.id, undefined, indexOf())) : exConfigSheet(ex, null, (cfg: any) => swapTo(ex, cfg), null, null, null, null, t('Use in this workout')), { title: t('Swap exercise'), like: active.entries[index].id })
  function swapTo(ex: any, cfg: any) {
    if (!validSlot()) return
    // The picker is a chooser here, not a stack you keep adding from: one swap, then back to
    // the workout. (The add flow deliberately leaves it open.)
    picker.close()
    const full: any = { ...cfg, id: ex.id }
    const st = S()
    const current = st.active?.entries?.[index]
    if (!current) return
    // A swap is an in-place substitution — routine identity is unchanged, so the replacement
    // keeps the slot's own `rid` and reads its prescription from that routine (not a
    // session-wide one). A slot with no `rid` is freestyle.
    const slotRoutine = current.rid ? st.routines.find((r: any) => r.id === current.rid) : null
    const freestyle = !slotRoutine
    // Same rows the add flow builds: last time's loads and, in a planned session, the
    // prescription — swapping barbell for dumbbell bench must not start you at an empty bar.
    // Built from what came before the session's day when it is logged into the past (sessionHistory).
    const step = modeOf(full, indexOf()) === 'reps' ? weightIncrement(full, st.unit, indexOf()) : defaultIncrement(ex.id, st.unit, indexOf())
    const past = sessionHistory(st)
    // A freestyle swap logs dumbbell weights the way the exercise means them now, and starts
    // from last time read in that meaning (lib/dumbbells.js), as a planned one does.
    const built = freestyle
      ? { target: withMeaning(st, cfg, ex.id, indexOf()), plan: null, sets: applyIntensifierPlan(buildSets(historyAs(past, ex.id, dbLoadFor(st, full, indexOf()), indexOf()), full, { step: (modeOf(full, indexOf()) === 'reps' && ownedWeightsFor(st, full, indexOf())) || step, preferLast: true }, indexOf()), full, dropGrid(st, full, indexOf()), indexOf()) }
      : buildPlannedEntry(past, full, slotRoutine, { noProg: builtOutOfProgression(current, slotRoutine) }, indexOf())
    const replacement: any = {
      id: ex.id,
      ...built,
      ...(current.rid ? { rid: current.rid } : {}),
      // A slot kept out of progression stays out once swapped. Replaced in place the entry keeps
      // it anyway; inserted beside logged sets, the replacement would otherwise count as a
      // regular session of the new exercise. Only a deload or rehab slot is built without a
      // prescription (above): one kept out by hand keeps the marker and its Undo on the card,
      // and an Undo must leave numbers that are right to count.
      ...(current.noProg === true ? { noProg: true } : {}),
    }

    const apply = (options?: any) => {
      if (!validSlot()) return
      // A timed callback closes over entry/set indexes. Invalidate it, and the current rest,
      // before the selected occurrence can be replaced or a new entry shifts those indexes.
      update((state: any) => {
        ui().stopWork(); ui().stopRest()
        swapActiveExercise(state.active, index, replacement, options)
      }, true)
    }
    const logged = (current.sets || []).some((set: any) => set?.done === true || Object.values(set?.sides || {}).some((side: any) => side?.done === true))
    if (!logged) { apply(); return }

    if (current.sg) {
      openEditor((close, validate) => <>
        <h3>{t('Swap exercise?')}</h3>
        <div className="muted small" style={{ marginBottom: 12 }}>
          {t('Logged sets stay with the original exercise. Choose where the replacement belongs.')}
        </div>
        <Button variant="primary" onClick={() => { if (!validate()) return; close(); apply({ loggedConfirmed: true, groupDisposition: 'keep' }) }}>
          {t('Keep replacement in this group')}
        </Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" onClick={() => { if (!validate()) return; close(); apply({ loggedConfirmed: true, groupDisposition: 'detach' }) }}>
          {t('Insert after this group')}
        </Button>
      </>)
      return
    }

    confirmSheet({
      title: t('Swap exercise?'),
      message: t('Logged sets stay with the original exercise. The replacement will be inserted afterward.'),
      confirmText: t('Continue'),
      onConfirm: () => apply({ loggedConfirmed: true })
    })
  }
}

/* ============================ equipment profiles ============================ */
// Create or edit one profile ("Home", "Gym", ...): a name plus a checklist of what you have.
function EquipmentProfileSheet({ profile, close, validate }: { profile?: StoreDocument; close: Close; validate: ValidateTarget }) {
  const update = createSheetUpdater(validate, true)
  const nameRef = useRef<HTMLInputElement>(null)
  const [checked, setChecked] = useState<any>(new Set(profile ? profileEquipment(profile) : []))
  const toggle = (k: any) => setChecked((s: any) => { const n: any = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const save = () => {
    if (!validate()) return
    const name = (nameRef.current!.value || '').trim()
    if (!name) { return }
    if (!update((s: any) => {
      s.equipProfiles = s.equipProfiles || []
      const equipment: any = [...checked]
      if (profile) {
        const p = s.equipProfiles.find((x: any) => x.id === profile.id)
        if (p) { p.name = name; p.equipment = equipment; p.accV = ACC_V }
      } else {
        const p = newProfile(name); p.equipment = equipment
        s.equipProfiles.push(p)
        if (!s.activeEquipId) s.activeEquipId = p.id
      }
    })) return
    close()
  }
  return <>
    <h3>{profile ? t('Edit profile') : t('New equipment profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Name it after where you train (like "Home" or "Gym"), then tick what you’ve got there.')}
    </div>
    <TextField ref={nameRef} defaultValue={profile?.name || ''} placeholder={t('Profile name')} maxLength={40} />
    <div style={{ height: 12 }} />
    <div className="chips">
      {ALL_EQUIPMENT.map((k: any) => (
        <button key={k} className={'chip' + (checked.has(k) ? ' on' : '')} onClick={() => toggle(k)}>{t(k)}</button>
      ))}
    </div>
    <div className="dim small" style={{ marginTop: 10 }}>
      {t('Body-weight exercises are always available, unless they need a pull-up bar or a bench.')}
    </div>
    <div style={{ height: 14 }} /><Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const equipmentProfileSheet = (profile?: StoreDocument) => {
  const before = JSON.stringify(profile && S().equipProfiles?.find((row: any) => row.id === profile.id))
  return openEditor((close, validate) => <EquipmentProfileSheet profile={profile} close={close} validate={(state = S()) => validate(state) && (!profile || targetUnchanged(before, state.equipProfiles?.find((row: any) => row.id === profile.id)))} />)
}

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
const progressionStepOf = (c: any, mode: any, ex: any, unit: any) =>
  c.inc >= 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit, indexOf()))
// Back-off sets step down by the same Step, so a plan using them needs one even with no rule.
const progressionStepIsValid = (step: any, policy: any, backoff: any = false) =>
  (policy === 'off' && !backoff) || (Number.isFinite(step) && step > 0)
// Back-off sets (lib/backoff.js) are offered where there is a load to step down: rep work on a
// loaded exercise, not a pyramid (it owns each set), not a rest-pause (one work set), not an
// assistance machine (less load is harder there).
const backoffOffered = (c: any, mode: any, ex: any, bw: any) => mode === 'reps' && !bw && !isAssisted({ ...c, id: ex.id }, indexOf())
  && !(Array.isArray(c.pyramid) && c.pyramid.length) && c.intensifier?.type !== 'restpause'

// Double and triple progression both climb a rep range (`repsMin`..`reps`), so the sheet keeps it
// normalised for either.
const climbsRange = (policy: any) => policy === 'double' || policy === 'triple'
// Triple progression's set ceiling while it is being edited: never below the starting sets.
const setsMaxOf = (c: any) => Math.max(Math.max(1, Math.round(c.sets) || 1), Math.min(MAX_TRIPLE_SETS, Math.round(c.setsMax) || 0))

function ProgressionFields({ ex, mode, c, setC, routine, unit, perSide, bw }: any) {
  // Triple progression adds sets and then load. Bodyweight work with nothing added already climbs
  // reps and then sets on its own (the rep ceiling below), and has no load to finish the cycle
  // with, so it is not offered there.
  const options = ((POLICIES_FOR as Record<string, any>)[mode] || ['off']).filter((p: any) => p !== 'triple' || !bw || c.weight > 0 || c.prog === 'triple')
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode, indexOf())
  const active = policyFor({ ...c, id: ex.id }, routine, mode, indexOf())
  const inc = progressionStepOf(c, mode, ex, unit)
  const canBackoff = backoffOffered(c, mode, ex, bw)
  const backoff = canBackoff && c.backoff === true
  const invalid = !progressionStepIsValid(inc, active, backoff)
  // "26 → 24 → 22 kg": what the sets will open at, from the weight and step typed above.
  const preview = backoff && c.weight > 0 && inc > 0
    ? backoffWeights(c.weight, Math.max(1, Math.round(c.sets) || 1), inc).map(fmtNum).join(' → ') + ' ' + unit
    : ''
  const stride = mode === 'reps' && perSide ? 2 : 1
  const range = climbsRange(active) ? normalizeRepRange(c.reps, c.repsMin, stride) : null
  const epleyEligible = mode === 'reps' && !isBw({ ...c, id: ex.id }, indexOf()) && (active === 'linear' || climbsRange(active))
  // What is typed is shown as typed, 0 for an emptied field included: shown as the default 90
  // instead, the field could not be emptied to type a new percentage.
  const deloadPercent = Math.round((c.deloadFactor != null && Number.isFinite(Number(c.deloadFactor)) ? Number(c.deloadFactor) : 0.9) * 100)
  const setRule = (v: any) => setC((x: any) => {
    const next: any = { ...x, prog: v || undefined }
    // Greyskull's final set is taken to failure by design, so choosing it here switches "Last set
    // to failure" on too, unless it was already decided. Only the sheet's draft: nothing is
    // written until Save, and a plan saved before stays what it was.
    if (v === 'greyskull' && next.lastToFailure == null) next.lastToFailure = true
    const picked = policyFor({ ...next, id: ex.id }, routine, mode, indexOf())
    // Triple progression opens with room for two more sets, the usual 3 to 5.
    if (picked === 'triple' && !(next.setsMax > 0)) next.setsMax = Math.min(MAX_TRIPLE_SETS, Math.max(1, Math.round(next.sets) || 1) + 2)
    return climbsRange(picked)
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, stride) }
      : next
  })
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={setRule}
        options={[{ value: '', label: t('Follow the routine ({0})', t((POLICY_NAME as Record<string, any>)[inherited])) },
          ...options.map((p: any) => ({ value: p, label: t((POLICY_NAME as Record<string, any>)[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t((POLICY_DESC as Record<string, any>)[active])}</div>
    {/* Double progression on a weighted exercise fills this row with four steppers; `cfgrow-4`
        lets it wrap into two pairs on phones, where four abreast left the inputs a few px wide. */}
    {(active !== 'off' || backoff) && <div className={'row cfgrow' + ((active === 'double' && epleyEligible) || active === 'triple' ? ' cfgrow-4' : '')} style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} invalid={invalid} className={invalid ? 'invalid' : ''}
        onChange={(v: any) => setC((x: any) => ({ ...x, inc: v }))} />
      {climbsRange(active) && <>
        {/* The draft stays as typed: normalising on every keystroke turned "12" into 92 (the
            "1" was pulled above the lower bound first). Save and the engine normalise anyway. */}
        <Stepper label={t('Reps from')} value={c.repsMin ?? range!.repsMin} step={stride} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, repsMin: v }))} />
        <Stepper label={t('Reps up to')} value={c.reps ?? range!.reps} step={stride} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, reps: v }))} />
      </>}
      {/* Where triple progression stops adding sets; the Sets above are where it starts. */}
      {active === 'triple' && <Stepper label={t('Sets up to')} value={c.setsMax ?? setsMaxOf(c)} step={1} decimal={false}
        onChange={(v: any) => setC((x: any) => ({ ...x, setsMax: v }))} />}
      {epleyEligible && <Stepper label={t('Deload 1RM (%)')} value={deloadPercent} step={5} min={50} max={95} decimal={false}
        onChange={(v: any) => setC((x: any) => ({ ...x, deloadFactor: Number(v) / 100 }))} />}
    </div>}
    {invalid && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: -10, marginBottom: 18 }}>
      {t('Enter a positive step to use this progression rule.')}
    </div>}
    {/* Off by default and only written when on, so every plan saved before it stays the shape
        it was. The step is the one above: the gear's own increment, set once per exercise. */}
    {canBackoff && <>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <Row icon="steps" iconTint="var(--acc)" title={t('Back-off sets')}
          subtitle={t('Each set one step lighter than the one before. The weight above is the first set.')}>
          <Switch checked={backoff} onChange={(v: any) => setC((x: any) => ({ ...x, backoff: v || undefined }))} />
        </Row>
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {backoff
          ? (preview ? t('Sets open at {0}. The first set goes up when every set reaches its reps, and the rest follow it.', preview) : t('The first set goes up when every set reaches its reps, and the rest follow it.'))
          : t('All sets at the same weight.')}
      </div>
    </>}
  </>
}

// The drop-set and rest-pause fields take what is typed and are held to their minimums once left
// (Stepper `min`). A sheet saved from a field still being typed in is held to them here: an
// emptied weight drop would otherwise plan drops at the same weight.
const intensifierToSave = (x: any) => (x.type === 'dropset'
  ? { ...x, count: Math.max(1, Math.round(x.count) || 0), pct: Math.max(5, Number(x.pct) || 0) }
  : x.type === 'restpause'
    ? { ...x, totalReps: Math.max(1, Math.round(x.totalReps) || 0), restSec: Math.max(5, Number(x.restSec) || 0) }
    : x)

// Fields this sheet canonicalizes or deliberately clears; prescription fields are handled
// by retainProgrammePrescription (including its explicit removals) rather than carried back.
const configCanonicalFields = new Set([
  'id', 'sg', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'bodyweight', 'side', 'prog', 'inc',
  'deloadFactor', 'note', 'warmupSets', 'restSec', 'dbLoad', 'lastToFailure', 'reps',
  'pyramid', 'pyramidRest', 'pyramidWeight', 'repsMin', 'setsMax', 'repsMax', 'intensifier',
  'backoff', ...authoredPrescriptionFields,
])
function ExConfig({ validate, ex, existing, onSave, onDelete, onReplace, close, routine, initial, saveLabel }: ConfigProps) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id, indexOf())
  const speedUnit = speedUnitOf(st)
  const seed = existing || initial || defaultConfig(ex.id, undefined, indexOf())
  const [c, setC] = useState<any>(() => {
    const cfg: any = { ...seed }
    // A session's target carries the meaning of its dumbbell weight as a stamp (lib/dumbbells.js);
    // one that only repeats the exercise's own default is not the slot's choice, so it is not kept.
    if (cfg.dbLoad != null && dbLoadOf(cfg.dbLoad) === dbLoadFor(st, ex.id, indexOf())) delete cfg.dbLoad
    return climbsRange(policyFor({ ...cfg, id: ex.id }, routine, modeOf({ ...cfg, id: ex.id }, indexOf()), indexOf()))
      ? { ...cfg, ...normalizeRepRange(cfg.reps, cfg.repsMin, isPerSide(cfg) ? 2 : 1) }
      : cfg
  })
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id }, indexOf())
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id }, indexOf())
  const perSide = isPerSide(c)
  // Pyramid sets: one rep target per set, in place of the flat Sets × Reps (CONTEXT.md).
  const pyramid = mode === 'reps' && isPyramid({ ...c, mode })
  const setPyramidAt = (i: any, v: any) => setC((x: any) => ({ ...x, pyramid: x.pyramid.map((p: any, j: any) => (j === i ? v : p)) }))
  const progressionPolicy =policyFor({ ...c, id: ex.id }, routine, mode, indexOf())
  const progressionStepInvalid = !progressionStepIsValid(progressionStepOf(c, mode, ex, st.unit), progressionPolicy, c.backoff === true && backoffOffered(c, mode, ex, bw))
  const activePolicy = policyFor({ ...c, id: ex.id }, routine, mode, indexOf())
  // Both climb a range: the flat Reps stepper gives way to "Reps from" / "Reps up to".
  const ranged = mode === 'reps' && climbsRange(activePolicy)
  const triple = mode === 'reps' && activePolicy === 'triple'
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = (m: any) => setC((x: any) => {
    const next: any = { ...defaultConfig(ex.id, m, indexOf()), ...x, mode: m }
    return m === 'reps' && climbsRange(policyFor({ ...next, id: ex.id }, routine, 'reps', indexOf()))
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, isPerSide(next) ? 2 : 1) }
      : next
  })
  const save = () => {
    if (!validate() || progressionStepInvalid) return
    close()
    const saveConfig = (out: any) => {
      // ExConfig unknown-key preservation (GM safety exception): unlike legacy
      // sheets.jsx:1687, ordinary Save retains newer clients' opaque keys. Known
      // fields still use exactly the legacy canonicalization and removal rules.
      const opaque = { ...existing }
      for (const key of configCanonicalFields) delete opaque[key]
      onSave({ ...opaque, ...retainProgrammePrescription(c, out) })
    }
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog: any = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Epley deloading is configurable per occurrence, but the default stays omitted so older
    // plans retain their compact shape and keep the existing 90% behaviour.
    if (mode === 'reps' && !bw && (activePolicy === 'linear' || climbsRange(activePolicy))) {
      const deloadFactor = Math.max(0.5, Math.min(0.95, Number(c.deloadFactor) || 0.9))
      if (deloadFactor !== 0.9) prog.deloadFactor = deloadFactor
    }
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps. `side` used to be dropped on
    // switching to Time too — a timed hold has no rep count to split — but "per side" does not
    // have to mean splitting: for a hold it means doing the whole thing once per side, so the
    // flag now survives the switch and buildWorkSets doubles the planned sets instead.
    const flags: any = {}
    if (bw !== isBodyweightEq(ex.id, indexOf())) flags.bodyweight = bw
    // Free text, e.g. a pyramid's per-set loading ("bar only, +1 plate/side each set") — the
    // sets/reps/weight fields are one flat target and have no room for that on their own.
    // Mode-independent, so it is spread in below rather than folded into `flags`.
    const note = (c.note || '').trim().slice(0, 500)
    const withNote = note ? { note } : {}
    // Only written when there are any, so a plan that never asked for warm-ups keeps the exact
    // shape it had — and reads back as 0 either way (buildSets).
    const warmupSets = Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(c.warmupSets) || 0))
    const withWarmups = warmupSets ? { warmupSets } : {}
    // Per-exercise rest (issue #10): written only when a positive value was set, so 0 keeps
    // inheriting the global rest timer and a config that never touched it stays the shape it
    // was. Mode-independent — a heavy triple, a plank and a cardio interval all rest.
    const restSec = Math.max(0, Math.round(c.restSec) || 0)
    const withRest = restSec ? { restSec } : {}
    // What a dumbbell weight means in this slot (lib/dumbbells.js): written only when the slot
    // picked its own, so every other config stays the shape it was.
    const dbLoad = isBellEx(ex, indexOf()) && !bw ? dbLoadOf(c.dbLoad) : null
    const withMeant = dbLoad ? { dbLoad } : {}
    // "Last set to failure": written only when on, so a plan that never asked keeps its shape.
    const withFailure = c.lastToFailure === true ? { lastToFailure: true } : {}
    if (cardio) saveConfig({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8), ...withNote, ...withRest })
    else if (mode === 'time') saveConfig({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...withNote, ...withWarmups, ...withRest, ...withMeant, ...withFailure })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const stride = perSide ? 2 : 1
      let reps = perSide ? Math.ceil(typed / stride) * stride : typed
      let range = null
      if (ranged) {
        range = normalizeRepRange(reps, c.repsMin, stride)
        reps = range!.reps
      }
      const out: any = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...withNote, ...withWarmups, ...withRest, ...withMeant }
      // The list is the prescription; sets and reps follow it, so everything that reads the
      // flat target (a config sheet reopened with the toggle off, older builds) still makes sense.
      const list = pyramid ? normalizePyramid(c.pyramid, stride) : []
      if (list.length) Object.assign(out, flatFromPyramid(list), { pyramid: list })
      const pyramidRest = list.length ? normalizePyramidRest(c.pyramidRest, list.length) : []
      if (pyramidRest.length) out.pyramidRest = pyramidRest
      const pyramidWeight = list.length && !bw ? normalizePyramidWeight(c.pyramidWeight, list.length) : []
      if (pyramidWeight.length) out.pyramidWeight = pyramidWeight
      if (ranged) out.repsMin = range!.repsMin
      // Triple progression's set ceiling, written only when it is above the starting sets: at the
      // same number it would add nothing, and the plan keeps the shape it had.
      if (triple && !list.length && setsMaxOf(c) > sets) out.setsMax = setsMaxOf(c)
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      // Every set in this exercise becomes a drop-set/rest-pause (buildSets stamps the rows) —
      // decided here, in the plan, not re-decided live each time you train it.
      if (!list.length && c.intensifier && c.intensifier.type) out.intensifier = intensifierToSave(c.intensifier)
      // Back-off sets: written only when on, and only where the sheet offered them.
      if (c.backoff === true && backoffOffered(out, 'reps', ex, bw) && isBackoff({ ...out, backoff: true })) out.backoff = true
      // A pyramid has its own Max set for this, so the flag is not offered (or kept) there.
      if (!list.length) Object.assign(out, withFailure)
      saveConfig(out)
    }
  }
  return <>
    <Media ex={ex} />
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    {/* The same tags the exercise detail sheet shows, secondaries included: choosing what goes
        into a plan is exactly when "what else does this hit" matters, and until now that was
        only visible from the Exercises tab, after the fact. Custom exercises and the newer
        metadata name muscles by the map's ids ("forearm", "gluteal"), which only MUSCLE_NAME
        turns into a translatable label. */}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t((MUSCLE_NAME as Record<string, any>)[ex.tg!] || ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
      {!cardio && (ex.secondaries?.length ? ex.secondaries : smOf(ex)).filter(trainedBy(ex)).slice(0, 3)
        .map((s: any, i: any) => <span key={i} className="tag dim">{t((MUSCLE_NAME as Record<string, any>)[s] || s)}</span>)}
    </div>
    {descFor(ex) && <div className="exnote">{descFor(ex)}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, min: v }))} />
        {/* Typed and stepped in the profile's unit, kept in km/h (lib/speed.js). */}
        <Stepper label={speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={toSpeed(c.speed, speedUnit)} step={0.5}
          onChange={(v: any) => setC((x: any) => ({ ...x, speed: fromSpeed(v, speedUnit) }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, sec: v }))} />
        {/* A bodyweight hold's load is the "Added" row below — showing both put two fields on
            one value. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={(v: any) => setC((x: any) => ({ ...x, weight: v }))} />}
      </> : <>
        {/* Rest-pause always trains as exactly two rows — a warm-up at this rep count, then one
            rest-pause work set — so "Sets" has nothing left to mean and only invites a mismatch. */}
        {c.intensifier?.type !== 'restpause' && !pyramid &&
          <Stepper label={triple ? t('Sets from') : t('Sets')} value={c.sets} step={1} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, sets: v }))} />}
        {!ranged && !pyramid && <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={(v: any) => setC((x: any) => ({ ...x, reps: v }))} />}
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && !pyramid && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={(v: any) => setC((x: any) => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {/* Pyramid sets: a row per set, each with its own reps or Max, rest and weight. A set left
        at 0 weight starts from that same set last time (buildSets). */}
    {pyramid && <div style={{ marginTop: -10, marginBottom: 18 }}>
      {/* Presets replace the list (and its rests and weights) in one tap; the sheet is not saved
          until Save. */}
      <div className="chips" style={{ marginBottom: 10 }}>
        {PYRAMID_PRESETS.map((preset: any, k: any) => <button key={k} type="button" className="chip"
          onClick={() => setC((x: any) => ({ ...x, pyramid: [...preset], pyramidRest: undefined, pyramidWeight: undefined }))}>{pyramidLabel(preset)}</button>)}
      </div>
      {c.pyramid.map((p: any, i: any) => <div key={i} style={{ marginBottom: 10 }}>
        <div className="row cfgrow" style={{ marginBottom: 4 }}>
          {p === PYRAMID_MAX
            ? <div className="small"><strong>{t('Set {0}', i + 1)}</strong> · {t('Max: as many reps as you can')}</div>
            : <Stepper label={t('Set {0}', i + 1)} value={p} step={perSide ? 2 : 1} min={1} decimal={false} onChange={(v: any) => setPyramidAt(i, v)} />}
          <Stepper label={t('Rest (s)')} value={(c.pyramidRest || [])[i] || 0} step={15} decimal={false}
            onChange={(v: any) => setC((x: any) => {
              const rest = Array.from({ length: x.pyramid.length }, (_: any, j: any) => (x.pyramidRest || [])[j] || 0)
              rest[i] = v
              return { ...x, pyramidRest: rest }
            })} />
        </div>
        {/* Bodyweight work has its one "Added" load below instead. */}
        {!bw && <div className="row cfgrow" style={{ marginBottom: 4 }}>
          <Stepper label={t('Weight ({0})', st.unit)} value={(c.pyramidWeight || [])[i] || 0} step={2.5}
            onChange={(v: any) => setC((x: any) => {
              const weight = Array.from({ length: x.pyramid.length }, (_: any, j: any) => (x.pyramidWeight || [])[j] || 0)
              weight[i] = v
              return { ...x, pyramidWeight: weight }
            })} />
        </div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button size="sm" variant={p === PYRAMID_MAX ? 'primary' : 'plain'} aria-pressed={p === PYRAMID_MAX}
            onClick={() => setPyramidAt(i, p === PYRAMID_MAX ? (c.reps || 10) : PYRAMID_MAX)}>{t('Max')}</Button>
          {c.pyramid.length > 1 && <Button size="sm" icon="trash" aria-label={t('Remove set')} title={t('Remove set')}
            onClick={() => setC((x: any) => ({ ...x, pyramid: x.pyramid.filter((_: any, j: any) => j !== i), pyramidRest: x.pyramidRest?.filter((_: any, j: any) => j !== i), pyramidWeight: x.pyramidWeight?.filter((_: any, j: any) => j !== i),
              ...(x.setTargets ? {setTargets:x.setTargets.filter((_: any,j: any)=>j!==i)} : {}),
              ...(x.setRepsMin ? {setRepsMin:x.setRepsMin.filter((_: any,j: any)=>j!==i)} : {}),
              ...(x.tm ? {tm:{...x.tm,percentages:x.tm.percentages.filter((_: any,j: any)=>j!==i)}} : {}),
            }))} />}
        </div>
      </div>)}
      <Button size="sm" icon="plus" disabled={c.pyramid.length >= MAX_PYRAMID_SETS}
        onClick={() => setC((x: any) => ({
          ...x,
          pyramid: [...x.pyramid, x.pyramid[x.pyramid.length - 1]],
          // The new set copies the last one's rest too, like its target.
          pyramidRest: x.pyramidRest?.length ? [...x.pyramid.map((_: any, j: any) => x.pyramidRest[j] || 0), x.pyramidRest[x.pyramid.length - 1] || 0] : x.pyramidRest,
          pyramidWeight: x.pyramidWeight?.length ? [...x.pyramid.map((_: any, j: any) => x.pyramidWeight[j] || 0), x.pyramidWeight[x.pyramid.length - 1] || 0] : x.pyramidWeight,
        }))}>{t('Add set')}</Button>
      <div className="small dim" style={{ marginTop: 8 }}>{t('A set left at 0 rest uses the exercise’s rest.')}</div>
      {!bw && <div className="small dim" style={{ marginTop: 4 }}>{t('A set left at 0 weight starts from that set’s weight last time.')}</div>}
    </div>}
    {c.intensifier?.type === 'restpause' && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {t('Rest-pause always trains as one warm-up set at this rep count, then one rest-pause work set. "Sets" isn’t used here.')}
    </div>}
    {/* Planned warm-ups: the session used to start at the work weight and you added every
        warm-up by hand, every time. Rest-pause is excluded because it builds its own warm-up
        row, and cardio because an interval plan has no load to ramp. */}
    {!cardio && c.intensifier?.type !== 'restpause' && <>
      <div className="row cfgrow" style={{ marginBottom: 6 }}>
        <Stepper label={t('Warm-up sets')} value={c.warmupSets || 0} step={1} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, warmupSets: Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(v) || 0)) }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {(c.warmupSets || 0) > 0
          ? t('Added before your work sets and left out of volume, records and progression. Each one closes half the gap to the work weight, never below the bar on a barbell lift, and you can still change any of them mid-session.')
          : t('Ramp-up sets added before the work sets, so you do not have to add them by hand each session.')}
      </div>
    </>}
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* Per-exercise rest (issue #10). Its own full-width row, like the other steppers with an
        explanation under them, and outside every mode branch because a heavy triple, a plank
        and a cardio interval all rest — they just do not all want the same break. */}
    {/* On the same wheel as the default rest timer (v1.3.11): 0:00 is "no rest of its own", so
        the default applies, and the row says which default that is. */}
    <div className="sect-b cfg-rest" style={{ marginBottom: 6 }}>
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest for this exercise')} accessory="chevron"
        value={c.restSec > 0 ? fmtRest(c.restSec) : t('Default ({0})', fmtRest(st.restSec))}
        onClick={() => durationSheet({
          title: t('Rest for this exercise'), value: c.restSec > 0 ? c.restSec : 0, max: REST_MAX,
          off: t('Default ({0})', fmtRest(st.restSec)),
          footer: t('Rest after each set of this exercise. 0:00 means your default rest.'),
          onDone: (v: any) => setC((x: any) => ({ ...x, restSec: v })),
        })} />
    </div>
    <div className="small dim" style={{ marginBottom: 18 }}>
      {t('Rest after each set of this exercise. 0:00 means your default rest.')}
    </div>
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? (mode === 'time' ? t('No weight to enter. Just time the hold.') : t('No weight to enter. Just log the reps.')) : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={(v: any) => setC((x: any) => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode !== 'cardio' && <Row icon="sides" iconTint="var(--blue)" title={t('Per side')}
        subtitle={mode === 'time'
          ? (perSide
            ? tn('{0} set becomes {1}: one on each side, {2}s held every time.', '{0} sets become {1}: one on each side, {2}s held every time.', c.sets || 0, (c.sets || 0) * 2, c.sec || 0)
            : t('For side planks, single-arm holds and the like. Trains each side on its own.'))
          : (perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.'))}>
        {/* Reps: turning it on rounds the target up to an even number, since half of an odd total
            is a rep one side does not get. Time: nothing to round — a hold's whole duration
            happens twice, so only the flag changes (buildWorkSets doubles the planned sets). */}
        <Switch checked={perSide} onChange={(v: any) => setC((x: any) => {
          if (mode === 'time') return { ...x, side: v || undefined }
          const next: any = { ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }
          return climbsRange(policyFor({ ...next, id: ex.id }, routine, 'reps', indexOf()))
            ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, v ? 2 : 1) }
            : next
        })} />
      </Row>}
      {/* Off keeps the list as `pyramidDraft`, so a stray tap does not lose it before Save
          (save writes neither field unless the toggle is on). */}
      {/* The last work set of every session is marked as taken to failure, like Greyskull's
          final AMRAP set (workout-model isFailureSet, history.js applyFailurePlan). A pyramid
          already has its Max set for that. */}
      {!pyramid && <Row icon="gauge" iconTint="var(--purple)" title={t('Last set to failure')}
        subtitle={c.lastToFailure ? t('The last set goes until nothing is left, and counts as all-out effort unless you rate it.') : t('Plan the final set as an all-out one.')}>
        <Switch checked={c.lastToFailure === true} onChange={(v: any) => setC((x: any) => ({ ...x, lastToFailure: v || undefined }))} />
      </Row>}
      {mode === 'reps' && <Row icon="steps" iconTint="var(--acc)" title={t('Pyramid sets')}
        subtitle={t('A different rep target for each set, e.g. 12 · 8 · 6 · Max · 12.')}>
        <Switch checked={pyramid} onChange={(v: any) => setC((x: any) => (v
          ? { ...x, pyramid: x.pyramidDraft || pyramidFromFlat(x), intensifier: undefined }
          : { ...x, ...flatFromPyramid(x.pyramid), pyramidDraft: x.pyramid, pyramid: undefined }))} />
      </Row>}
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={(v: any) => setC((x: any) => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={(v: any) => setC((x: any) => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    {/* A pyramid already shapes every set; a drop-set or rest-pause would reshape them again. */}
    {mode === 'reps' && !pyramid && <>
      <h4 className="sec">{t('Drop-set / rest-pause')}</h4>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow title={t('Intensifier')} sheetTitle={t('Intensifier')} value={c.intensifier?.type || ''}
          onChange={(v: any) => setC((x: any) => ({
            ...x,
            intensifier: !v ? undefined : v === 'dropset'
              ? { type: 'dropset', count: x.intensifier?.count || 1, pct: x.intensifier?.pct || 20 }
              // The activation set's own reps are whatever "Reps" above already says — a
              // rest-pause plan only adds two new numbers: the total extra reps wanted past
              // it, and the rest between the bursts that total gets split into.
              : { type: 'restpause', totalReps: x.intensifier?.totalReps || x.reps || 8, restSec: x.intensifier?.restSec || st.restPauseSec || 15 },
          }))}
          options={[
            { value: '', label: t('None') },
            { value: 'dropset', label: t('Drop-set') },
            { value: 'restpause', label: t('Rest-pause') },
          ]} />
      </div>
      {c.intensifier?.type === 'dropset' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Drops')} value={c.intensifier.count} step={1} min={1} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, intensifier: { ...x.intensifier, count: v } }))} />
        <Stepper label={t('Weight drop (%)')} value={c.intensifier.pct} step={5} min={5} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, intensifier: { ...x.intensifier, pct: v } }))} />
      </div>}
      {c.intensifier?.type === 'restpause' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Rest-pause reps')} value={c.intensifier.totalReps} step={1} min={1} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, intensifier: { ...x.intensifier, totalReps: v } }))} />
        <Stepper label={t('Rest (s)')} value={c.intensifier.restSec} step={5} min={5} decimal={false}
          onChange={(v: any) => setC((x: any) => ({ ...x, intensifier: { ...x.intensifier, restSec: v } }))} />
      </div>}
      {c.intensifier?.type && <div className="small dim" style={{ marginTop: -2, marginBottom: 18 }}>
        {c.intensifier.type === 'dropset'
          ? t('Every set becomes a drop-set: after the main set, {0} drop(s) with no rest, each about {1}% lighter.', c.intensifier.count, c.intensifier.pct)
          : t('Every set becomes rest-pause: {0} reps to start, then {1} more split into short bursts, {2}s rest before each, roughly halving each time.', c.reps || 0, c.intensifier.totalReps, c.intensifier.restSec)}
      </div>}
    </>}
    {/* What a dumbbell weight means, for this routine's slot (cfg.dbLoad). Picking what the
        exercise already means drops the key, so the slot follows the exercise's default again. */}
    {isBellEx(ex, indexOf()) && !bw && mode !== 'cardio' && <>
      <h4 className="sec">{t('Weight means')}</h4>
      <DbLoadPicker ex={ex} cfg={c} value={dbLoadFor(st, { ...c, id: ex.id }, indexOf())}
        onChange={(v: any) => setC((x: any) => ({ ...x, dbLoad: v === dbLoadFor(st, ex.id, indexOf()) ? undefined : v }))} />
    </>}
    {/* How the weight is plate-loaded and what the bar weighs — per exercise, not per plan, so
        it sits apart from the config fields above and writes straight to S.barWeights/S.loadKind. */}
    {mode === 'reps' && <>
      <h4 className="sec">{t('Plate loading')}</h4>
      <BarWeightEditor ex={ex} cfg={c} validate={validate} extra={t('Applies to this exercise everywhere, not just this plan.')} />
    </>}
    {pyramid
      ? <div className="small dim" style={{ marginBottom: 18 }}>{t('Weight is up to you: pyramid sets are not progressed automatically.')}</div>
      : <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} perSide={perSide} bw={bw} />}
    <textarea className="input" rows={3} maxLength={500} style={{ marginBottom: 18 }}
      placeholder={t('Note (optional): loading cues, "bar only, then +1 plate/side each set", anything worth remembering')}
      value={c.note || ''} onChange={(e: any) => setC((x: any) => ({ ...x, note: e.target.value }))} />
    {/* What saving does, when it is neither of the two usual things: the routine editor's
        Replace (#110) seeds this sheet with the slot it replaces, and saving puts the exercise
        into that slot. */}
    <Button variant="primary" disabled={progressionStepInvalid} onClick={save}>{saveLabel || (existing ? t('Save') : t('Add to routine'))}</Button>
    {isCustomEx(ex, indexOf()) && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { if (!validate()) return; close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {/* The routine editor's counterpart to a workout's Swap (#110): another exercise in this
        slot, with the slot's sets, reps, weight, rule and note kept (lib/routines.js). What was
        changed on this sheet and not saved is left behind, as closing it would. */}
    {onReplace && <><div style={{ height: 8 }} /><Button icon="swap" onClick={() => { if (!validate()) return; close(); onReplace() }}>{t('Replace exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { if (!validate()) return; close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex: Exercise, existing: StoreDocument | null, onSave: (cfg: StoreDocument) => void, onDelete?: (() => void) | null, routine?: any, initial?: any, onReplace?: (() => void) | null, saveLabel?: string) => {
  const target = routine?.id && S().routines.find((row: any) => row.id === routine.id), before = JSON.stringify(target)
  return openEditor((close, validate) => <ExConfig validate={(state = S()) => validate(state) && (!target || targetUnchanged(before, state.routines.find((row: any) => row.id === routine.id)))} ex={ex as ExerciseRow} existing={existing} initial={initial} onSave={onSave} onDelete={onDelete} onReplace={onReplace} routine={routine} saveLabel={saveLabel} close={close} />)
}

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current: string | null | undefined, onPick: (glyph: string) => void) => {
  const cur = glyphOf(current)
  return openEditor((close, validate) => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map((g: any) => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map((n: any) => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { if (!validate()) return; close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ effort quick picker (RIR / RPE) ============================ */
// Rating a set used to mean walking a +/- stepper up the scale — eleven taps to log "5 reps
// left". This is the one-tap replacement: a colour-coded button per preset, plus a free field
// for the value between two presets. Presets are stored in RIR internally; a profile that logs
// RPE sees the same buttons labelled on its own scale (toScale), coloured identically — the
// colour is the effort, not the number, so 0 RIR and 10 RPE are both the "went to failure" end.
function EffortPicker({ kind, value, onPick, close }: { kind: 'rir' | 'rpe'; value?: number | null; onPick: (rating: number | null) => void; close: Close }) {
  // Local mirror so the ticked preset and the exact field track typing live.
  const [v, setV] = useState<any>(value ?? null)
  // The exact field used to write through on every change, and onPick concludes the set (issue
  // #64): it ticks the set, beeps and starts the rest. Since stepEffort(kind, null, 1) returns
  // the band's minimum, one tap of + — or typing the `1` of `10` — was a committed rating, fired
  // under the sheet you were still typing into, and on the last set of the last exercise it
  // stacked workoutCompleteSheet on top of the picker. So typing moves the mirror only, and the
  // rating is written once, when the sheet goes away: Done, the backdrop, a swipe or Escape all
  // unmount this. A preset row still commits on the spot, which is what makes it one tap.
  const typed = useRef<any>(value ?? null)
  const done = useRef<any>(false)
  const set = (nv: any) => { typed.current = nv; setV(nv) }
  useEffect(() => () => {
    if (done.current) return
    if (typed.current !== (value ?? null)) onPick(typed.current)
  }, [])
  // `v` is in the profile's own scale (whatever sits on the set: s.rir or s.rpe). Compare in
  // RIR so the tick lands on the right preset on either scale, and so a typed RPE colours the
  // same as the RIR it equals.
  const curRir = rirOf(kind === 'rpe' ? { rpe: v } : { rir: v })
  const curColor = effortColor(curRir)
  const commit = (nv: any) => { done.current = true; close(); onPick(nv) }
  const pick = (rir: any) => commit(toScale(kind, rir))
  const hd = (EFFORT as Record<string, any>)[kind].hd
  // Same list the ⋯ menus use: a tinted square with the value where the icon goes, the sentence
  // as the row title, a tick on the current one. The exact field is the app's own stepper,
  // tinted like the logged cell in the set row, so the sheet and the row read as one thing.
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('How hard was that set?')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Tap how many reps you had left, or type an exact {0}.', hd)}</div>
    <div className="list menu-list effpick">
      {EFFORT_PRESETS.map((p: any) => {
        const label = fmtNum(toScale(kind, p.rir)) + (p.tail ? '+' : '')
        const on = curRir != null && curRir === p.rir
        return <div key={p.rir} className={'item menu-item' + (on ? ' on' : '')} style={{ '--bc': p.color } as import('react').CSSProperties}
          {...tappable(() => pick(p.rir))}>
          <span className="lrow-i effpick-n">{label}</span>
          <div className="grow"><div className="tt">{t(p.feel)}</div></div>
          <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
        </div>
      })}
      <div className="item menu-item effpick-free">
        <div className="grow"><div className="tt">{t('Exact {0}', hd)}</div></div>
        <div className="stp effcell-stp"
          style={curColor ? { color: curColor, background: `color-mix(in srgb, ${curColor} 20%, var(--surface-2))` } : undefined}>
          <button aria-label={t('Decrease')} onClick={() => set(stepEffort(kind, v, -1))}><Icon name="minus" /></button>
          <span className="val"><NumberField decimal nullable value={v ?? ''} placeholder="–"
            onChange={(nv: any) => set(capEffort(kind, nv))} /></span>
          <button aria-label={t('Increase')} onClick={() => set(stepEffort(kind, v, 1))}><Icon name="plus" /></button>
        </div>
      </div>
    </div>
    {v != null && <>
      <div style={{ height: 10 }} />
      {/* Only after the exact field has moved the value off what is stored: the preset rows
          close themselves, so this row exists for the one path that does not. */}
      {v !== (value ?? null) && <Button icon="check" onClick={() => commit(v)}>{t('Done')}</Button>}
      <Button variant="ghost" className="dim" icon="xmark" onClick={() => commit(null)}>{t('Clear rating')}</Button>
    </>}
    <div style={{ height: 4 }} />
  </>
}
// kind is 'rir' | 'rpe'; value is the set's current rating on that scale (or null); onPick
// receives the new value on that same scale (null to clear). The caller stores it exactly as
// weight/reps are stored — a null drops the key rather than writing a zero.
export const effortPickerSheet = (kind: 'rir' | 'rpe', value: number | null | undefined, onPick: (rating: number | null) => void) => {
  const context = captureContext()
  const cur = S().active?.cur
  const before = JSON.stringify(cur == null ? null : [cur, S().active?.entries])
  // Dismissal intentionally commits on unmount, so editor membership is not required here.
  return ui().openSheet((close: Close) => <EffortPicker kind={kind} value={value} onPick={rating => {
    if (context() && targetUnchanged(before, cur == null ? null : [S().active?.cur, S().active?.entries])) onPick(rating)
  }} close={close} />)
}
