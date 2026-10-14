import { setNavReaders } from '../src/lib/nav'
beforeEach(() => setNavReaders({ sheetEntry: () => history.state?.openGymSheet, currentHash: () => location.hash }))
import './workout-sheet-environment'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutSettings } from '../src/components/WorkoutSettingsSheet'
import { useUI } from '../src/store/useUI'
import { useStore } from '../src/store/useStore'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const sound = vi.hoisted(() : any => ({ canVibrate: true, iPhone: false }))
vi.mock('../src/lib/sound', () : any => ({
  unlock: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(),
  vibrateSupported: () : any => sound.canVibrate, appleTouchDevice: () : any => sound.iPhone,
}))
vi.mock('../src/lib/wakelock', () : any => ({ wakeLockSupported: () : any => true }))
const navTo = vi.hoisted(() : any => vi.fn())
vi.mock('../src/lib/nav', async (importOriginal: any ) : Promise<any> => {
  const real: any = await importOriginal()
  real.setNav(navTo)
  return real
})

let host: any, root: any, originalS: any, close: any

beforeEach(() : any => {
  originalS = useStore.getState().S
  useStore.setState({ S: {
    ...originalS, restSec: 90, sound: false, vibrate: true, timerFlash: false, keepAwake: true,
    workoutView: 'cards', effort: 'none', gifSize: 'full',
    active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [], workoutView: 'list' },
  } })
  useUI.setState({ sheets: [] })
  sound.canVibrate = true; sound.iPhone = false
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() : any => root.render(<WorkoutSettings close={close} />))
})

afterEach(() : any => {
  act(() : any => root.render(null))
  useUI.setState({ sheets: [] })
  useStore.setState({ S: originalS })
  host.remove()
  navTo.mockReset()
})

const row = (title: any ) : any => [...host.querySelectorAll('.lrow')].find((r: any ) : any => r.querySelector('.lrow-t')?.textContent === title)
const S = () : any => useStore.getState().S

describe('the in-workout settings sheet', () : any => {
  it('has the rows people change at the gym, then All settings', () : any => {
    expect([...host.querySelectorAll('.lrow-t')].map((e: any ) : any => e.textContent)).toEqual([
      'Rest timer', 'Play a sound', 'Vibrate', 'Flash the screen', 'Keep screen awake',
      'Layout', 'Effort scale', "Don't track effort", 'Swipe actions', 'All settings',
    ])
    expect(row('Rest timer').querySelector('.lrow-v').textContent).toBe('1:30')
    expect(row('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(row('Exercise animations')).toBeUndefined()
  })

  it('writes the same fields as Settings', () : any => {
    act(() : any => row('Play a sound').querySelector('[role=switch]').click())
    act(() : any => row('Vibrate').querySelector('[role=switch]').click())
    act(() : any => row('Flash the screen').querySelector('[role=switch]').click())
    act(() : any => row('Keep screen awake').querySelector('[role=switch]').click())
    act(() : any => [...row('Effort scale').querySelectorAll('button')].find((b: any ) : any => b.textContent === 'RIR').click())
    expect(S()).toMatchObject({ sound: true, vibrate: false, timerFlash: true, keepAwake: false, effort: 'rir', gifSize: 'full' })
  })

  it('shows this session’s layout, and a pick here is saved and replaces it', () : any => {
    expect(row('Layout').querySelector('button.on').textContent).toBe('List')
    act(() : any => [...row('Layout').querySelectorAll('button')].find((b: any ) : any => b.textContent === 'Compact').click())
    expect(S().workoutView).toBe('compact')
    expect(S().active.workoutView).toBeUndefined()
  })

  it('sets the rest timer on the wheel, 0:00 being off', () : any => {
    act(() : any => row('Rest timer').click())
    const sheet: any = useUI.getState().sheets.at(-1)
    const el: any = document.createElement('div')
    document.body.appendChild(el)
    const r: any = createRoot(el)
    act(() : any => r.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
    expect(el.querySelector('h3').textContent).toBe('Rest timer')
    expect(el.querySelector('.dw-read').textContent).toBe('1:30')
    act(() : any => [...el.querySelectorAll('button')].find((b: any ) : any => b.textContent === 'Done').click())
    expect(S().restSec).toBe(90)
    act(() : any => r.unmount()); el.remove()
  })

  it('greys Vibrate out on an iPhone and says why', () : any => {
    sound.canVibrate = false; sound.iPhone = true
    act(() : any => root.render(<WorkoutSettings close={close} key="iphone" />))
    expect(row('Vibrate').classList.contains('dis')).toBe(true)
    expect(row('Vibrate').querySelector('.lrow-s').textContent).toBe('Not on iPhone')
    expect(row('Vibrate').querySelector('[role=switch]').disabled).toBe(true)
  })

  it('goes to Settings → Workout from All settings, closing the sheet', () : any => {
    act(() : any => row('All settings').click())
    expect(close).toHaveBeenCalled()
    expect(navTo).toHaveBeenCalledWith('/settings/workout')
  })

  // The sheet's own history entry used to stay behind: back from Settings went to the workout, and
  // the next back landed on the same workout again and seemed to do nothing.
  it('Settings takes the sheet\'s history entry instead of leaving it behind', () : any => {
    history.pushState({ openGymSheet: true }, '')
    act(() : any => row('All settings').click())
    expect(navTo).toHaveBeenCalledWith('/settings/workout', { replace: true })
    history.replaceState(null, '')
  })
})

it('switches between both scales and turns tracking off without touching current workout rows',(): any =>{
 const before=JSON.stringify(S().active)
 act((): any =>[...row('Effort scale').querySelectorAll('button')].find((b: any ): any =>b.textContent==='RPE').click())
 expect(S().effort).toBe('rpe');expect(host.textContent).toContain('RPE 8 = 2 reps in reserve')
 act((): any =>row("Don't track effort").querySelector('[role=switch]').click())
 expect(S().effort).toBe('none');expect(JSON.stringify(S().active)).toBe(before)
 expect(row('Effort scale').querySelector('.seg-sel')).toBeNull()
 expect(row('Effort scale').querySelector('button.on')).toBeNull()
 // The preference belongs to the profile, so closing/reopening the sheet retains it.
 act((): any =>root.render(null))
 act((): any =>useStore.setState({S:JSON.parse(JSON.stringify(S()))}))
 act((): any =>root.render(<WorkoutSettings close={close} />))
 act((): any =>row("Don't track effort").querySelector('[role=switch]').click())
 expect(S().effort).toBe('rpe')
 act((): any =>[...row('Effort scale').querySelectorAll('button')].find((b: any ): any =>b.textContent==='RIR').click())
 expect(S().effort).toBe('rir')
})
