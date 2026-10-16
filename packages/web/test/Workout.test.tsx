// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import Workout from './W17-harness'
import {useStore,DEF} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {nextPrescription} from '@opengym/core/progression'
import {isWarmupRow} from '@opengym/core/workout-model'
const mocks:any={exercisePicker:vi.fn(),menuSheet:vi.fn(),effortPickerSheet:vi.fn(),exerciseHistorySheet:vi.fn(),startWork:vi.fn(),startRest:vi.fn(),setNoteSheet:vi.fn()}
Object.defineProperty(mocks,'S',{get:()=>useStore.getState().S,set:(S:any)=>useStore.setState({S})})
mocks.uiSnapshot=()=>mocks
let root:any,container:any;const dom=globalThis
const menuItemsOf=(menu:any)=>(menu.sections?menu.sections.flatMap((g:any)=>g.items||[]):menu.items||[]).filter(Boolean)
import * as sheets from '../src/sheets'
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(sheets,'exercisePicker').mockImplementation(mocks.exercisePicker);vi.spyOn(sheets,'menuSheet').mockImplementation(mocks.menuSheet);vi.spyOn(sheets,'effortPickerSheet').mockImplementation(mocks.effortPickerSheet);vi.spyOn(sheets,'exerciseHistorySheet').mockImplementation(mocks.exerciseHistorySheet)})
function exercise(id:any,sets:any[],extra:any={}){return {id,target:{mode:'reps',reps:5,weight:60,bodyweight:false},sets:sets.map((done: any )=>({w:60,r:5,done})),...extra}}
function workout(entries:any,cur: any=0,overrides:any={}){const {active:activeOverrides={},...patch}=overrides;const base=structuredClone(DEF);return {...base,unit:'kg',effort:'none',...patch,active:{id:'active',d:'2026-10-13',name:'Test workout',start:100,cur,entries,workoutView:patch.workoutView??'cards',...activeOverrides}}}
function installDom(){container=document.createElement('div');document.body.append(container);root=createRoot(container)}
const callbacks={onStartTimed:mocks.startWork,onPairNext:()=>{},onMoveUp:()=>{},onMoveDown:()=>{},canMoveUp:true,canMoveDown:true,onSwap:()=>{},onRemoveExercise:()=>{}}
async function mount(entries:any,cur: any=0,overrides:any={}){await unmount();mocks.S=workout(entries,cur,overrides);installDom();await rerender()}
async function unmount(){if(root)await act(async()=>root.unmount());container?.remove();root=container=null}
async function rerender(){await act(async()=>root.render(<Workout callbacks={callbacks}/>))}
const buttonNamed=(name:string)=>container.querySelector(`button[aria-label="${name}"]`)
const click=async(el:any)=>{expect(el).toBeTruthy();await act(async()=>el.click())}
afterEach(async()=>{await unmount();vi.restoreAllMocks()})
describe('set ticks for screen readers', () => {
  it('names each tick by its set, not just "checkbox"', async () => {
    await mount([exercise('named-ticks', [false, false])])
    const labels = [...container.querySelectorAll('[role="checkbox"]')].map((c: any ) => c.getAttribute('aria-label'))
    expect(labels).toEqual(['Set 1 done', 'Set 2 done'])
  })
})
describe('active workout weight controls', () => {
  const press = async (label: any, selector: any) => {
    const control = container.querySelector(selector)
    const button = control?.querySelector(`button[aria-label="${label}"]`)
    expect(button).toBeTruthy()
    await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
  }

  it('uses the configured reps weight step for manual increases and decreases, with the default fallback', async () => {
    await mount([exercise('plain-bench', [false], {
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false, inc: 1 },
    })])

    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(61)
    await press('Decrease', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(60)

    await unmount()
    await mount([exercise('plain-bench', [false])])
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
  })

  it.each(['list', 'cards', 'compact'])('keeps added weight editable at zero in %s view', async (workoutView: any ) => {
    await mount([exercise('bodyweight-pull-up', [false], {
      target: { mode: 'reps', reps: 8, weight: 0, bodyweight: true, inc: 1 },
      sets: [{ w: 0, r: 8, done: false }],
    })], 0, { workoutView })

    expect(container.querySelector('.sethead').textContent).toContain('Added (kg)')
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 1, r: 8 })
    await press('Decrease', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(0)
    expect(container.querySelector('.sethead').textContent).toContain('Added (kg)')
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 1, r: 8 })
  })

  it('matches automatic progression rounding for a fractional configured step', async () => {
    const target = { mode: 'reps', sets: 1, reps: 5, weight: 60, bodyweight: false, inc: 1.25 }
    const automatic = nextPrescription({
      unit: 'kg',
      workouts: [{ d: '2026-08-30', entries: [{ id: 'plain-bench', target, sets: [{ w: 60, r: 5, done: true }] }] }],
    }, { id: 'plain-bench', ...target })

    await mount([exercise('plain-bench', [false], { target, sets: [{ w: 60, r: 5, done: false }] })])
    await press('Increase', '.setrow .stp.w')

    expect(automatic.weight).toBe(61.3)
    expect(mocks.S.active.entries[0].sets[0].w).toBe(automatic.weight)
  })

  it('uses the configured reps weight step for drop-set weight controls', async () => {
    await mount([exercise('plain-bench', [false], {
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false, inc: 1 },
      sets: [{ w: 60, r: 5, done: false, type: 'dropset', drops: [{ w: 50, r: 5 }] }],
    })])

    await press('Increase', '.subrow .stp')

    expect(mocks.S.active.entries[0].sets[0].drops[0].w).toBe(51)
  })

  it('keeps timed seconds and optional timed weight on their existing steps', async () => {
    await mount([exercise('timed-plank', [false], {
      target: { mode: 'time', sec: 30, weight: 60, bodyweight: false, inc: 1 },
      sets: [{ sec: 30, w: 60, done: false }],
    })])

    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].sec).toBe(35)
    await press('Increase', '.setrow .stp.r')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
  })
})
describe('progression guidance', () => {
  it('labels the visible outcome with the policy that calculated it', async () => {
    await mount([exercise('plain-bench', [false, false, false], {
      plan: {
        policy: 'linear',
        kind: 'up',
        weight: 62.5,
        why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
      },
    })])

    expect(container.querySelector('.progline')?.textContent)
      .toContain('Linear progression · Every rep last time. 2.5 kg more.')
  })

  

  

  

  

  
})
describe('effort cell (colour-coded RIR/RPE quick picker)', () => {
  // A rep exercise whose sets can carry an effort rating. `rir` per set is optional — an
  // unrated set simply omits the key, which is what the empty cell has to represent.
  const effExercise = (rirs: any) => ({
    id: 'plain-bench',
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: rirs.map((rir: any ) => ({ w: 60, r: 5, done: false, ...(rir == null ? {} : { rir }) })),
  })
  // A cell is one of two shapes: an empty `.effcell` button (label, opens picker) or, once a
  // rating is logged, a `.effcell-stp` −/value/+ group. `.effcell-list` returns the outer
  // element of each (carrying the colour on the logged one); `effCells` normalises them to the
  // value-bearing, picker-opening element so the existing assertions read the same either way:
  // for the empty button that is the button itself, for the stepper it is the `.val` button.
  const effCellList = () => [...container.querySelectorAll('.effcell,.effcell-stp')]
  const effCells = () => effCellList().map((el: any ) =>
    el.classList.contains('effcell-stp') ? el.querySelector('.val') : el)

  async function mountEffort(rirs: any, scale: any = 'rir') {
    mocks.S = workout([effExercise(rirs)])
    mocks.S.effort = scale
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
  }

  it('shows the effort column only when the profile logs a scale', async () => {
    await mount([exercise('plain-bench', [false])])   // effort: 'none' from workout()
    expect(effCells()).toHaveLength(0)
    await unmount()
    await mountEffort([null])
    expect(effCells()).toHaveLength(1)
  })

  it('labels an unrated cell with the scale name, not a value or a colour', async () => {
    await mountEffort([null], 'rir')
    const cell = effCells()[0]
    expect(cell.textContent).toBe('RIR')
    expect(cell.className).toContain('is-empty')
    // no rating means no inline colour on the button
    expect(cell.getAttribute('style') || '').not.toMatch(/color/)
  })

  it('uses the profile scale for the empty label — RPE profile reads "RPE"', async () => {
    await mountEffort([null], 'rpe')
    expect(effCells()[0].textContent).toBe('RPE')
  })

  it('shows a logged rating as its number, tinted by the band it falls in', async () => {
    await mountEffort([0, 2, null])
    const cells = effCells()
    const outer = effCellList()
    expect(cells[0].textContent).toBe('0')
    expect(outer[0].className).toContain('effcell-stp')   // logged: the stepper, not the label
    // 0 RIR = to failure = purple; 2 RIR = yellow (the colours effortColor assigns) — the
    // colour rides the outer stepper (border + tinted background), not the inner value button
    expect(outer[0].getAttribute('style')).toContain('--purple')
    expect(cells[1].textContent).toBe('2')
    expect(outer[1].getAttribute('style')).toContain('--yellow')
    expect(cells[2].textContent).toBe('RIR')      // the unrated one stays a label
    expect(outer[2].className).toContain('is-empty')
  })

  it('displays a logged value on the profile scale — RIR 2 reads as RPE 8', async () => {
    // the set is stored on whatever scale the profile logs; an RPE profile stores s.rpe
    mocks.S = workout([{
      id: 'plain-bench',
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
      sets: [{ w: 60, r: 5, done: false, rpe: 8 }],
    }])
    mocks.S.effort = 'rpe'
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(effCells()[0].textContent).toBe('8')
    // RPE 8 == RIR 2 == yellow: the colour is the effort, independent of the scale shown
    expect(effCellList()[0].getAttribute('style')).toContain('--yellow')
  })

  it('opens the picker for the set on tap, passing scale, current value and a writer', async () => {
    await mountEffort([2])
    await act(async () => {
      effCells()[0].dispatchEvent(new dom.Event('click', { bubbles: true }))
    })
    expect(mocks.effortPickerSheet).toHaveBeenCalledOnce()
    const [scale, value, onPick] = mocks.effortPickerSheet.mock.calls[0]
    expect(scale).toBe('rir')
    expect(value).toBe(2)
    // the writer stores the chosen value back on the set, and null clears the key
    await act(async () => { onPick(1) })
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(1)
    await click(effCells()[0]) // Reopen the closed picker for the changed row.
    await act(async () => { mocks.effortPickerSheet.mock.calls.at(-1)[2](null) })
    expect('rir' in mocks.S.active.entries[0].sets[0]).toBe(false)
  })

  // The mock store is a plain snapshot with no subscription, so a click updates mocks.S but
  // does not re-render on its own; each step is checked from its own mount rather than chained.
  const clickStep = async (label: any ) => {
    await act(async () => {
      effCellList()[0].querySelector(`button[aria-label="${label}"]`)
        .dispatchEvent(new dom.Event('click', { bubbles: true }))
    })
  }

  it('steps a logged rating up 0.5 on the scale with the + button, not through the picker', async () => {
    await mountEffort([2])
    expect(effCellList()[0].querySelectorAll('button[aria-label="Increase"],button[aria-label="Decrease"]')).toHaveLength(2)
    await clickStep('Increase')
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(2.5)
    expect(mocks.effortPickerSheet).not.toHaveBeenCalled()
  })

  it('steps a logged rating down 0.5 with the − button', async () => {
    await mountEffort([2])
    await clickStep('Decrease')
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(1.5)
  })

  it('clears the rating when stepped down off the floor', async () => {
    // RIR 0 is the bottom of the scale — one more − is a mistap-undo, dropping the key rather
    // than sticking at 0 (which reads as "went to failure")
    await mountEffort([0])
    await clickStep('Decrease')
    expect('rir' in mocks.S.active.entries[0].sets[0]).toBe(false)
  })
})
describe('workout focus view', () => {
  it('shows only the first incomplete set with its prescription and tactile controls', async () => {
    await mount([exercise('plain-bench', [true, false, false], {
      target: { mode: 'reps', reps: 5, repsMin: 3, weight: 60, restSec: 120 },
    })], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    expect(container.querySelector('[data-testid="focus-view"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="focus-set"]').length).toBe(1)
    expect(container.textContent).toContain('2/3')
    expect(container.textContent).toContain('3–5 Reps')
    expect(container.textContent).toContain('@ 60 kg')
    expect(container.textContent).toContain('Rest 120s')
    expect(buttonNamed('Previous set').disabled).toBe(false)
    expect(buttonNamed('Next set').disabled).toBe(false)
  })

  it('moves with chevrons, dots, and Skip without completing a set', async () => {
    await mount([exercise('plain-bench', [false, false, false])], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Next set'))
    expect(container.textContent).toContain('2/3')
    await click(container.querySelector('button[aria-label="Set 3"]'))
    expect(container.textContent).toContain('3/3')
    await click(buttonNamed('Previous set'))
    expect(container.textContent).toContain('2/3')
    await click(buttonNamed('Skip set'))
    expect(container.textContent).toContain('3/3')
    expect(mocks.S.active.entries[0].sets.every((set: any ) => !set.done)).toBe(true)
  })

  it('locks later Focus sets while keeping them inspectable', async () => {
    await mount([exercise('plain-bench', [false, false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Next set'))

    expect(container.querySelector('[data-testid="focus-set"]').classList.contains('locked')).toBe(true)
    expect(container.textContent).toContain('Complete set 1 to edit this one.')
    expect(buttonNamed('Increase load').disabled).toBe(true)
    expect(buttonNamed('Increase reps').disabled).toBe(true)
    expect(buttonNamed('RPE').disabled).toBe(true)
  })

  

  it('uses the shared effort picker for the selected RPE scale', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Increase load'))
    await click(buttonNamed('Increase reps'))
    await click(buttonNamed('RPE'))
    const [, value, onPick] = mocks.effortPickerSheet.mock.calls.at(-1)
    expect(mocks.effortPickerSheet.mock.calls.at(-1)[0]).toBe('rpe')
    expect(value).toBeNull()
    await act(async () => { onPick(6.5) })

    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
    expect(mocks.S.active.entries[0].sets[0].r).toBe(6)
    expect(mocks.S.active.entries[0].sets[0].rpe).toBe(6.5)
  })

  it('hides effort in Focus when Settings selects none and stores the selected RIR scale', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'none' })
    expect(buttonNamed('RPE')).toBeNull()
    expect(buttonNamed('RIR')).toBeNull()

    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rir' })
    await click(buttonNamed('RIR'))
    const [, , onPick] = mocks.effortPickerSheet.mock.calls.at(-1)
    await act(async () => { onPick(2) })
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ rir: 2 })
  })

  it('locks completed set inputs and mutes their values', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Complete set'))
    await rerender()

    expect(container.querySelector('[data-testid="focus-set"]').classList.contains('complete')).toBe(true)
    expect(buttonNamed('Increase load').disabled).toBe(true)
    expect(buttonNamed('Increase reps').disabled).toBe(true)
    expect(container.querySelectorAll('[data-testid="focus-set"] .stp input:disabled')).toHaveLength(2)
    expect(buttonNamed('RPE').disabled).toBe(true)
  })

  it('renders and updates independent unilateral sides', async () => {
    await mount([exercise('split-squat', [false], {
      target: { mode: 'reps', reps: 10, weight: 20, side: true },
      sets: [{
        w: 20, r: 10, done: false,
        sides: {
          L: { w: 20, r: 5, done: false },
          R: { w: 20, r: 5, done: false },
        },
      }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.querySelectorAll('[data-focus-side]').length).toBe(2)
    await click(container.querySelector('[data-focus-side="L"] button[aria-label="Increase reps"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.r).toBe(6)
    expect(mocks.S.active.entries[0].sets[0].sides.R.r).toBe(5)
    await click(container.querySelector('[data-focus-side="L"] button[aria-label="Complete left side"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.done).toBe(true)
    expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
  })

  

  

  it('renders and edits unilateral extras added through the set menu', async () => {
    await mount([exercise('split-squat', [false], {
      target: { mode: 'reps', reps: 10, weight: 20, side: true },
      sets: [{
        w: 20, r: 10, done: false,
        sides: {
          L: { w: 20, r: 5, done: false },
          R: { w: 20, r: 5, done: false },
        },
      }],
    })], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Set menu'))
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items[1].onClick() })
    await rerender()
    const left = container.querySelector('[data-focus-side="L"]')
    expect(left.textContent).toContain('Drop 1')
    await click(left.querySelectorAll('button[aria-label="Increase load"]')[1])
    expect(mocks.S.active.entries[0].sets[0].sides.L.drops[0].w).toBe(18.5)
    expect(mocks.S.active.entries[0].sets[0].sides.R.drops[0].w).toBe(16)

    await click(buttonNamed('Set menu'))
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items[2].onClick() })
    await rerender()
    const burstLeft = container.querySelector('[data-focus-side="L"]')
    expect(burstLeft.textContent).toContain('Drop 1')
    expect(burstLeft.textContent).toContain('Burst 1')
    const burst = [...burstLeft.querySelectorAll('.focus-extra')].find((row: any ) => row.textContent.includes('Burst 1'))
    await click(burst.querySelector('button[aria-label="Increase reps"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.clusters[0].r).toBe(4)
    expect(mocks.S.active.entries[0].sets[0].sides.R.clusters[0].r).toBe(3)
  })

  it('shows the existing timer action instead of reps for timed sets', async () => {
    await mount([exercise('plank', [false], {
      target: { mode: 'time', sec: 45, weight: 0 },
      sets: [{ sec: 45, w: 0, done: false }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('45s hold')
    expect(buttonNamed('Start set')).toBeTruthy()
    expect(buttonNamed('Increase reps')).toBeNull()
    await click(buttonNamed('Start set'))
    expect(mocks.uiSnapshot().startWork).toHaveBeenCalled()
  })

  

  

  it('uses the established duration and speed fields for cardio', async () => {
    await mount([exercise('plain-treadmill', [false], {
      target: { mode: 'cardio', min: 20, speed: 8 },
      sets: [{ min: 20, speed: 8, done: false }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('Duration (min)')
    expect(container.textContent).toContain('Speed (km/h)')
    expect(container.querySelectorAll('button[aria-label="Increase reps"]').length).toBe(0)
    await click(container.querySelector('button[aria-label="Increase duration"]'))
    await click(container.querySelector('button[aria-label="Increase speed"]'))
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ min: 21, speed: 8.5 })
  })

  it('keeps drop and burst rows editable and opens every set action', async () => {
    await mount([exercise('plain-bench', [false], {
      sets: [{
        w: 60, r: 8, done: false,
        drops: [{ w: 45, r: 8 }],
        clusters: [{ r: 3, restSec: 15 }],
      }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('Drop 1')
    expect(container.textContent).toContain('Burst 1')
    await click(container.querySelectorAll('button[aria-label="Increase load"]')[1])
    await click(container.querySelectorAll('button[aria-label="Increase reps"]')[2])
    expect(mocks.S.active.entries[0].sets[0].drops[0].w).toBe(47.5)
    expect(mocks.S.active.entries[0].sets[0].clusters[0].r).toBe(4)
    expect(mocks.S.active.entries[0].sets[0].r).toBe(9)
    await click(buttonNamed('Set menu'))
    const labels = mocks.menuSheet.mock.calls.at(-1)[0].items.filter(Boolean).map((item: any ) => item.label)
    expect(labels).toEqual(['Mark as warm-up', 'Add drop set', 'Add burst', 'Taken to failure', 'Delete set'])
    // Taken to failure toggles the mark, and the focus card shows its F.
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items.filter(Boolean).find((item: any ) => item.label === 'Taken to failure').onClick() })
    expect(mocks.S.active.entries[0].sets[0].failure).toBe(true)
    await rerender()
    expect(container.querySelector('.focus-failure').textContent).toBe('F')
  })

  it('does not expose a Focus-only set note action', async () => {
    await mount([exercise('plain-bench', [false, false])], 0, { active: { workoutView: 'focus' } })
    await click(buttonNamed('Next set'))
    expect(buttonNamed('Set note')).toBeNull()
  })

  

  

  

  

  

  

  

  

  
})
describe('workout compact view', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const withExtras = (done: any ) => exercise('plain-bench', done, {
    plan: {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
    },
  })

  

  it('strips the progression line, tags and last-time recap that list mode shows', async () => {
    const state = {
      workoutView: 'compact',
      exWeights: { 'plain-bench': { w: 80 } },
      workouts: [{ d: '2026-08-27', entries: [{ id: 'plain-bench', target: { reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }],
    }
    await mount([withExtras([false])], 0, state)

    expect(container.querySelector('.progline')).toBeNull()
    expect(container.textContent).not.toContain('Best:')
    expect(container.textContent).not.toContain('Last time')
    // The sets card and the ⋯ menu button survive — nothing is truly unreachable.
    expect(container.querySelector('.setrow')).toBeTruthy()
    expect(container.querySelector('button[aria-label="More"]')).toBeTruthy()
  })

  it('keeps those same elements in list mode (the strip is compact-only)', async () => {
    const state = {
      workoutView: 'list',
      exWeights: { 'plain-bench': { w: 80 } },
      workouts: [{ d: '2026-08-27', entries: [{ id: 'plain-bench', target: { reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }],
    }
    await mount([withExtras([false])], 0, state)

    expect(container.querySelector('.progline')).toBeTruthy()
    expect(container.textContent).toContain('Best:')
    expect(container.textContent).toContain('Last time')
  })

  
})
describe('the plan line', () => {
  const planned = (extra: any = {}) => exercise('plain-bench', [false, false], {
    planned: { sets: 2, reps: 10, weight: 60 },
    target: { mode: 'reps', sets: 2, reps: 10, weight: 62.5, bodyweight: false },
    ...extra,
  })
  const line = () => container.querySelector('.planline')?.textContent

  it('shows the plan quietly when the rows are the plan', async () => {
    await mount([planned()])
    expect(line()).toBe('Plan: 2 × 10')
  })

  it('says when progression moved the sets or reps', async () => {
    await mount([planned({ target: { mode: 'reps', sets: 3, reps: 10, weight: 0, bodyweight: true } })])
    expect(line()).toBe('Plan: 2 × 10 · today 3 × 10')
  })

  it('says when the reps were carried over from the last session', async () => {
    await mount([planned({ carried: true, sets: [{ w: 62.5, r: 15, done: false }, { w: 62.5, r: 15, done: false }] })])
    expect(line()).toBe('Plan: 2 × 10 · reps from your last session')
  })

  it('reads a double-progression aim inside the range as the plan', async () => {
    await mount([planned({ planned: { sets: 3, reps: 12, repsMin: 8, weight: 40 }, target: { mode: 'reps', sets: 3, reps: 11, repsMin: 8, weight: 40 } })])
    expect(line()).toBe('Plan: 3 × 8–12')
  })

  it('stays in compact view, where the last-time recap and progression line go', async () => {
    await mount([planned()], 0, { workoutView: 'compact' })
    expect(line()).toBe('Plan: 2 × 10')
    expect(container.textContent).not.toContain('Last time')
  })

  it('sits next to a "Last time" that reads this routine\'s own last session (#216)', async () => {
    const session = (d: any, rid: any, w: any, r: any) => ({ d, routineIds: [rid], entries: [{ id: 'plain-bench', rid, target: { reps: r, weight: w }, sets: [{ w, r, done: true }] }] })
    await mount([planned({ rid: 'A' })], 0, { workouts: [session('2026-08-24', 'A', 60, 10), session('2026-08-26', 'B', 40, 15)] })
    expect(container.textContent).toContain('60×10')
    expect(container.textContent).not.toContain('40×15')
  })

  it('reads a pyramid as its targets, like the routine row (#367)', async () => {
    await mount([planned({ planned: { sets: 5, reps: 12 }, target: { mode: 'reps', sets: 5, reps: 12, pyramid: [12, 8, 6, 'max', 12] } })])
    expect(line()).toBe('Plan: 12 · 8 · 6 · Max · 12')
  })

  it('is not there for an entry with no plan (freestyle, or started before plans were kept)', async () => {
    await mount([exercise('plain-bench', [false])])
    expect(container.querySelector('.planline')).toBeNull()
  })
})
describe('workout controls: the more menu and the set menu', () => {
  const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
  const item = (label: any ) => menuItemsOf(lastMenu()).find((it: any ) => it.label === label)

  it('shows one More button per exercise and no legacy button rows by default', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])])
    expect(container.querySelector('button[aria-label="More"]')).toBeTruthy()
    for (const label of ['Move up', 'Swap exercise']) expect(container.querySelector(`button[aria-label="${label}"]`)).toBeNull()
    expect([...container.querySelectorAll('button')].some((b: any ) => b.textContent.trim() === 'Remove exercise')).toBe(false)
    expect([...container.querySelectorAll('button')].some((b: any ) => b.textContent.trim() === '+ Drop')).toBe(false)
    expect([...container.querySelectorAll('button')].some((b: any ) => b.textContent.trim() === 'Add set')).toBe(true)
  })

  

  

  // Move down on a superset member's More menu moved the whole superset and left the member next
  // to the same partner (#377 reports it in the routine editor). It now swaps inside the superset.
  

  // A move reorders the entries, and two things the screen keeps by index have to follow their
  // exercise: the running rest (timer.forIdx) and how many sets of each exercise have already
  // counted as progress (the mark a tick is compared against to tell new work from a re-check).
  const openMore = async (exIdx: any ) => {
    const more = container.querySelector(`.ss-ex[data-exidx="${exIdx}"] button[aria-label="More"]`)
      || container.querySelector('button[aria-label="More"]')
    await act(async () => { more.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  }
  const restFor = (forIdx: any ) => ({ left: 60, total: 60, endsAt: Date.now() + 60_000, forIdx, kind: 'set' })

  

  

  

  it('opens the exercise history sheet from the More menu, for the tapped exercise', async () => {
    // the screen shows one exercise at a time, so "the tapped exercise" is the current one
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 1)
    await act(async () => { container.querySelector('button[aria-label="More"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    const history = item('History')
    expect(history.icon).toBe('history')
    history.onClick()
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledWith('plain-row')
  })

  it('opens a per-set menu from the set number with drop, burst and remove', async () => {
    await mount([exercise('plain-bench', [false, false])])
    await act(async () => { container.querySelector('button[aria-label="Set 2"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(menuItemsOf(lastMenu()).map((it: any ) => it.label)).toEqual(['Make it a warm-up set', 'Taken to failure', 'Drop set', 'Rest-pause burst', 'Copy this set', 'Remove this set'])
    expect(item('Make it a warm-up set').icon).toBe('sunrise')

    await act(async () => { item('Drop set').onClick() })
    expect(mocks.S.active.entries[0].sets[1].drops?.length).toBe(1)

    await act(async () => { container.querySelector('button[aria-label="Set 2"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await act(async () => { item('Remove this set').onClick() })
    expect(mocks.S.active.entries[0].sets.length).toBe(1)
  })

  it('marks a set as taken to failure from its menu, with an F on its number, and back', async () => {
    await mount([exercise('plain-bench', [false, false])])
    const openSet = async (label: any ) => { await act(async () => { container.querySelector(`button[aria-label="${label}"]`).dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
    await openSet('Set 2')
    expect(item('Taken to failure').on).toBe(false)
    await act(async () => { item('Taken to failure').onClick() })
    expect(mocks.S.active.entries[0].sets[1].failure).toBe(true)
    expect(mocks.S.active.entries[0].sets[0].failure).toBeUndefined()
    await rerender()
    const n = container.querySelector('button[aria-label="Set 2, Taken to failure"]')
    expect(n.querySelector('.failmark').textContent).toBe('F')
    await openSet('Set 2, Taken to failure')
    expect(item('Taken to failure').on).toBe(true)
    await act(async () => { item('Taken to failure').onClick() })
    expect('failure' in mocks.S.active.entries[0].sets[1]).toBe(false)
  })

  it('makes a work set a warm-up and back, and keeps one work set', async () => {
    await mount([exercise('plain-bench', [true, false])])
    // a warm-up's number button is "Set 1" too, so rows are picked by position
    const openSet = async (k: any ) => { await act(async () => { container.querySelectorAll('button.n')[k].dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
    await openSet(1)
    await act(async () => { item('Make it a warm-up set').onClick() })
    const sets = () => mocks.S.active.entries[0].sets
    // moved in front of the work sets, in the shape Add warm-up set gives one
    expect(sets()[0]).toEqual({ w: 60, r: 5, done: false, phase: 'warmup', warmup: true })
    expect(isWarmupRow(sets()[1])).toBe(false)
    // the last work set cannot become one too
    await rerender()
    await openSet(1)
    expect(item('Make it a warm-up set')).toBeUndefined()
    // and a warm-up counts as a working set again
    await openSet(0)
    expect(lastMenu().title).toBe('Warm-up')
    await act(async () => { item('Count it as a working set').onClick() })
    expect(sets().every((x: any ) => !isWarmupRow(x))).toBe(true)
    expect(sets()[0]).toEqual({ w: 60, r: 5, done: false })
  })


  it('drops the +/- buttons when steppers are off and keeps the number field', async () => {
    await mount([exercise('plain-bench', [false])], 0, { wc: { steppers: false } })
    expect(container.querySelector('.setrow .stp button[aria-label="Increase"]')).toBeNull()
    expect(container.querySelector('.setrow .stp.plain .num')).toBeTruthy()
  })
})
describe('Workout exercise tags', () => {
  it('names a custom exercise\'s target muscle by its display name', async () => {
    const registerCustom = (customEx:any[]) => useStore.getState().update((S: any )=>{S.customEx=customEx})
    const customEx = [{ id: 'cqa1', n: 'QA Custom Thrust', bp: 'upper legs', eq: 'barbell', custom: true, tg: 'gluteal', sm: [], primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'] }]
    try {
      await mount([exercise('cqa1', [false])],0,{customEx})
      const tags = [...container.querySelectorAll('.tag')].map((tag: any ) => tag.textContent.trim())
      expect(tags).toContain('Glutes')
      expect(tags).not.toContain('gluteal')
    } finally { registerCustom([]) }
  })

  // The cardio target "cardiovascular system" is a translated key of its own; mapping it through
  // MUSCLE_NAME must not turn "Herz-Kreislauf" back into English for every built-in cardio exercise.
  
})
describe('set-row column header', () => {
  // The L/R rows carry a badge in front of the weight cell that a straight row does not have, so
  // the shared header needs to know it is sitting over per-side rows to offset its columns (QA C5).
  it('marks the header of a per-side exercise so the CSS can offset it by the L/R badge', async () => {
    const side = () => ({ w: 20, r: 8, done: false })
    await mount([
      exercise('plain-bench', [false]),
      exercise('side-curl', [false], {
        target: { mode: 'reps', side: true, reps: 16, weight: 20, bodyweight: false },
        sets: [{ w: 20, r: 16, done: false, sides: { L: side(), R: side() } }],
      }),
    ], 0, { active: { workoutView: 'list' } })
    const heads = container.querySelectorAll('.sethead')
    expect(heads.length).toBe(2)
    expect(heads[0].classList.contains('per-side')).toBe(false)
    expect(heads[1].classList.contains('per-side')).toBe(true)
    expect(container.querySelector('.setrow-side .sidetag')).toBeTruthy()
  })

  // A unilateral warm-up is a side set too (issue #60), so it renders as the L/R stack like the
  // work set below it — not the old single scalar row where 12 reps meant 6 per side on one line
  // with one shared RIR. The render guard dropped its `!warm` exclusion for exactly this.
  it('renders a per-side warm-up as its own L/R stack, not a single scalar row', async () => {
    const side = (r: any) => ({ w: 20, r, done: false })
    await mount([
      exercise('side-curl', [], {
        target: { mode: 'reps', side: true, reps: 16, weight: 20, bodyweight: false },
        sets: [
          // a per-side warm-up (half the reps on each side) ...
          { w: 10, r: 16, phase: 'warmup', warmup: true, done: false, sides: { L: side(8), R: side(8) } },
          // ... and a per-side work set
          { w: 20, r: 16, done: false, sides: { L: side(8), R: side(8) } },
        ],
      }),
    ])
    // both the warm-up and the work set render as L/R stacks: two side rows, four L/R badges
    expect(container.querySelectorAll('.setrow-side').length).toBe(2)
    expect(container.querySelectorAll('.setrow-side .sidetag').length).toBe(4)
    // the warm-up phase label is present, and no warm-up fell through to a scalar .setrow
    expect(container.querySelector('.setph')).toBeTruthy()
  })

  // A weighted hold's row has the play button in front of the tick, so its cells get less room than
  // a straight row's and the CSS sizes them (and the header over them) by the `timed` marker.
  it('marks a timed hold\'s rows and header, and neither on a rep set', async () => {
    await mount([
      exercise('timed-plank', [false], {
        target: { mode: 'time', sec: 30, weight: 60, bodyweight: false },
        sets: [{ sec: 30, w: 60, done: false }],
      }),
      exercise('plain-bench', [false]),
    ], 0, { active: { workoutView: 'list' } })
    const heads = container.querySelectorAll('.sethead')
    expect(heads[0].classList.contains('timed')).toBe(true)
    expect(container.querySelector('.setrow.timed .setgo')).toBeTruthy()
    expect(heads[1].classList.contains('timed')).toBe(false)
    expect(container.querySelectorAll('.setrow.timed').length).toBe(1)
  })

  // With the +/- buttons switched off the cells' floors are the bare numbers; the header must
  // freeze its columns the same way or the labels drift, so it carries the cells' `plain`.
  it('carries `plain` on the header when the steppers are off', async () => {
    await mount([exercise('plain-bench', [false])], 0, { wc: { steppers: false } })
    expect(container.querySelector('.sethead').classList.contains('plain')).toBe(true)
    expect(container.querySelector('.setrow .stp.w').classList.contains('plain')).toBe(true)
  })
})
describe('the reference line: last time or best set', () => {
  const session = (d: any, rid: any, w: any, r: any) => ({ d, start: Date.parse(d + 'T18:00:00'), routineIds: [rid], entries: [{ id: 'plain-bench', rid, target: { reps: r, weight: w }, sets: [{ w, r, done: true }] }] })
  const history = [session('2026-08-10', 'B', 80, 5), session('2026-08-24', 'A', 60, 10), session('2026-08-26', 'A', 55, 8)]
  const line = () => container.querySelector('.refline')

  it('reads last time in this routine by default, and the best set once switched', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history })
    expect(line().textContent).toMatch(/^Last time \(.+\): 55×8$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('best')
    await rerender()
    // the heaviest set of the exercise from any routine, not just this one
    expect(line().textContent).toMatch(/^Best set \(.+\): 80×5$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('last')
  })

  // #363: how long ago, counted from the session's own day; the date stays in the title and name.
  it('says how long ago, counted from the day the session is logged on', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history, active: { d: '2026-08-29' } })
    expect(line().textContent).toBe('Last time (3 days ago): 55×8')
    const time = line().querySelector('time')
    expect(time.outerHTML).toMatch(/datetime="2026-08-26"/i)
    expect(time.getAttribute('title')).toMatch(/2026/)
    expect(line().getAttribute('aria-label')).toMatch(/^Last time \(3 days ago, .+2026\): 55×8\. Show your best set instead$/)
    await unmount()
    // back-filled into the past: last time is counted from that day, not from today
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history.slice(0, 2), active: { d: '2026-08-25' } })
    expect(line().textContent).toBe('Last time (yesterday): 60×10')
  })

  it('is not there before the exercise was ever logged', async () => {
    await mount([exercise('plain-bench', [false])], 0, { logRef: 'best' })
    expect(line()).toBeNull()
  })

  // Logged before only as a hold, today as reps: there is a last time but no best set in this
  // mode. The line used to vanish, and the switch back to "Last time" with it.
  it('stays on the card when there is no best set in this mode yet, and still switches back', async () => {
    const hold = { d: '2026-08-26', start: Date.parse('2026-08-26T18:00:00'), routineIds: ['A'],
      entries: [{ id: 'plain-bench', rid: 'A', target: { mode: 'time', sec: 30 }, sets: [{ sec: 30, w: 0, done: true }] }] }
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: [hold], logRef: 'best' })
    expect(line().textContent).toBe('Best set: nothing logged this way yet')
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('last')
    await rerender()
    expect(line().textContent).toMatch(/^Last time \(.+\): 0:30$/)
  })

  // #284 review: a workout logged into the past is held against what came before its day, the
  // history its rows were built from, not against a session logged after it.
  it('reads the history before the day of a workout logged into the past', async () => {
    const later = [...history, session('2026-08-28', 'A', 90, 3)]
    const past = { d: '2026-08-25', start: Date.parse('2026-08-25T18:00:00'), backfill: { durationMin: 60, replaceId: null } }
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: later, active: past })
    expect(line().textContent).toMatch(/^Last time \(.+\): 60×10$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
    expect(line().textContent).toMatch(/^Best set \(.+\): 80×5$/)
    expect(container.textContent).toContain('Best: 80 kg')
  })

  // Arabic: a set right after the label took the label's direction and read 8×60, while the
  // sets after a Latin "RIR" read 60×8. Each set is its own left-to-right island.
  it('isolates every set from the text around it', async () => {
    const two = [{ d: '2026-08-26', start: Date.parse('2026-08-26T18:00:00'), routineIds: ['A'],
      entries: [{ id: 'plain-bench', rid: 'A', target: { reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, rir: 3, done: true }, { w: 60, r: 8, rir: 2, done: true }] }] }]
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: two })
    const sets = [...line().querySelectorAll('bdi')]
    expect(sets.map((b: any ) => [b.getAttribute('dir'), b.textContent])).toEqual([['ltr', '60×8 (RIR 3)'], ['ltr', '60×8 (RIR 2)']])
    expect(line().textContent).toMatch(/^Last time \(.+\): 60×8 \(RIR 3\), 60×8 \(RIR 2\)$/)
  })

  // A per-side set in Arabic carries its side words ("يسار 15×8 · يمين 15×7"). Forced left to
  // right, each word stood on the wrong side of its numbers and the numbers after it turned
  // round; isolated in its own direction it reads as before, next to sets that are forced.

  // The text is the reference; the name also says what a tap does, after the text it shows.
  it('names the switch a tap makes', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history })
    expect(line().getAttribute('aria-label')).toMatch(/^Last time \(.+\): 55×8\. Show your best set instead$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
    expect(line().getAttribute('aria-label')).toMatch(/^Best set \(.+\): 80×5\. Show last time instead$/)
  })
})
it('shows the program effort target without recording an effort on unfinished sets', async () : Promise<any> => {
  await mount([exercise('0025', [false], { target: { mode: 'reps', reps: 5, weight: 60, target: { rir: 2 } }, sets: [{w:60,r:5,done:false,target:{rir:2}}] })], 0, { effort: 'rir' })
  expect(container.textContent).toContain('2 RIR target')
  expect(container.querySelector('.effcell.is-empty').textContent).toBe('2')
  expect(mocks.S.active.entries[0].sets[0].rir).toBeUndefined()
  expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
})
it('shows authored row effort, percentage and ranges with logging effort disabled in every layout',async(): Promise<any> =>{
 const en={id:'0025',target:{mode:'reps',sets:2,reps:5,weight:0,instructions:'Synthetic backoffs: drop 10% and repeat until @8'},sets:[{w:0,r:1,done:false,target:{rpe:8,pct:75}},{w:0,r:5,done:false,target:{rir:2},repTarget:{min:5,max:8}}]}
 for(const layout of ['cards','list','compact','focus']) {
  await mount([structuredClone(en)],0,{effort:'none',active:{workoutView:layout}})
  expect(container.textContent).toContain('@8 · 75%');expect(container.textContent).toContain(en.target.instructions)
  if(layout==='focus') await click(buttonNamed('Next set'))
  expect(container.textContent).toContain('5–8 · 2 RIR')
  expect(container.querySelectorAll('.set-target')).toHaveLength(layout==='focus'?1:2);expect(mocks.S.active.entries[0].sets.every((s: any ): any =>s.rpe==null && s.rir==null && !s.done)).toBe(true);await unmount()
 }
})
it('resolves an open slot with the existing picker while retaining its authored prescription',async(): Promise<any> =>{
 const cfg={open:true,label:'Back accessory, your pick',slotId:'back',sets:3,repsMin:10,reps:15,weight:0,prog:'off',target:{rir:2}}
 mocks.exercisePicker.mockReturnValue({close:vi.fn()})
 await mount([{id:null,rid:'r',target:cfg,sets:[]}],0,{routines:[{id:'r',ex:[cfg]}]})
 expect(container.textContent).toContain(cfg.label);expect(container.textContent).toContain('3 × 10–15')
 await click([...container.querySelectorAll('button')].find((b: any ): any =>b.textContent==='Choose exercise'))
 const call=mocks.exercisePicker.mock.calls.at(-1);expect(call[1].title).toBe('Choose exercise')
 await act(async(): Promise<any> =>call[0]({id:'0025'}));await rerender()
 expect(mocks.S.active.entries[0]).toMatchObject({id:'0025',target:{slotId:'back',sets:3,repsMin:10,reps:15}})
 expect(mocks.S.active.entries[0].sets).toHaveLength(3);expect(container.querySelector('.open-slot')).toBeNull();expect(mocks.S.routines[0].ex[0].id).toBe('0025')
})

it('switches current workout target hints and the new-set effort field immediately without changing logged ratings',async(): Promise<any> =>{
 const en={id:'0025',target:{mode:'reps',sets:2,reps:5,weight:100,target:{rir:1}},sets:[{w:100,r:5,done:true,rir:2,target:{rir:1.5}},{w:100,r:5,done:false,target:{rpe:8.5,pct:75}}]}
 await mount([en],0,{effort:'rir'})
 const before=JSON.stringify(mocks.S.active.entries[0].sets)
 expect(container.textContent).toContain('1.5 RIR · 75%')
 expect(container.querySelector('.effcell.is-empty').textContent).toBe('1.5')
 mocks.S.effort='rpe';await rerender()
 expect(container.textContent).toContain('RPE 8.5 · 75%');expect(container.textContent).toContain('RPE 9 target')
 expect(container.querySelector('.effcell.is-empty').textContent).toBe('8.5')
 expect(JSON.stringify(mocks.S.active.entries[0].sets)).toBe(before)
})

it('uses each working-row target for both unilateral empty effort cells and leaves warmups unhinted',async(): Promise<any> =>{
 const en={id:'0025',target:{mode:'reps',side:true,target:{rir:1}},sets:[
  {w:20,r:10,done:false,target:{rpe:8},sides:{L:{w:20,r:5,done:false},R:{w:20,r:5,done:false}}},
  {w:10,r:5,done:false,warmup:true,phase:'warmup'},
 ]}
 await mount([en],0,{effort:'rpe'})
 const hints=[...container.querySelectorAll('.effcell.is-empty')].map((b: any ): any =>b.textContent)
 expect(hints).toEqual(['8','8','RPE'])
 expect(mocks.S.active.entries[0].sets.every((s: any ): any =>s.rpe==null && s.rir==null && !s.done)).toBe(true)
})
