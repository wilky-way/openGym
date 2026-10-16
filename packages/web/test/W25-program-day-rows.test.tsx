// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { URL as FileURL } from 'node:url'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { configureProgrammeUi } from '../src/lib/programme-ui-services'
import { workoutSheetPlatform } from './workout-sheet-environment'
import Programs from '../src/views/Programs'
import { p7Fixture } from './p7-fixture'

let root: Root
let host: HTMLDivElement
function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(s => <div key={s.id}>{s.render(() => useUI.getState().closeSheet(s.id))}</div>)}</>
}
function mount(S: any, selected = 'definition') {
  configureProgrammeUi({platform: workoutSheetPlatform, initialProgramId: () => selected,
    startFlow: vi.fn(), confirmSheet: vi.fn(), workoutDetailSheet: vi.fn(), dayOverrideSheet: vi.fn()})
  act(() => {useStore.setState({S, user: null}); useUI.setState({sheets: []})})
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<React.StrictMode><Programs/><Sheets/></React.StrictMode>))
  return host.querySelector('.program-week .program-weeks-grid')!
}
function definitionFixture(sessions = 1) {
  const S = p7Fixture(false), d = structuredClone(S.programmes.cycles[0].snapshot)
  d.id = 'definition'
  for (const w of d.weeks) {
    const main = w.days[0].sessions[0]
    for (let i = 1; i < sessions; i++) w.days[0].sessions.push({...structuredClone(main),
      sessionTemplateId: `extra-${i}`, routineSnapshot: {...structuredClone(main.routineSnapshot), name: `Evening session ${i}`}})
  }
  S.programmes = {definitions: [d], cycles: []}; S.routines = []; S.queue = null
  return S
}
beforeEach(() => vi.setSystemTime(new Date('2026-10-12T12:00:00Z')))
afterEach(() => {act(() => root?.unmount()); document.body.innerHTML = ''})

it('renders one row for a single-session definition day and previews that exact session directly', () => {
  const S = definitionFixture(), grid = mount(S), before = JSON.stringify(useStore.getState().S)
  const rows = grid.querySelectorAll('button.program-cell')
  expect(rows).toHaveLength(1)
  expect(grid.querySelectorAll('.program-session-cell')).toHaveLength(0)
  act(() => (rows[0] as HTMLButtonElement).click())
  const preview = host.querySelector('[aria-label="Session preview"]')!
  expect(preview.querySelector('h3')?.textContent).toBe('Synthetic session')
  expect(preview.textContent).toContain('Read-only preview')
  expect(JSON.stringify(useStore.getState().S)).toBe(before)
})

it.each([2, 3])('renders the day plus %i session sub-rows and selects each session independently', sessions => {
  const grid = mount(definitionFixture(sessions))
  expect(grid.querySelectorAll('button.program-cell')).toHaveLength(1 + sessions)
  const subrows = grid.querySelectorAll<HTMLButtonElement>('.program-session-cell')
  expect(subrows).toHaveLength(sessions)
  for (const row of subrows) {
    expect(row.querySelector(':scope > .program-day-name')).toBeTruthy()
    expect(row.querySelector(':scope > .icn')).toBeTruthy()
    act(() => row.click())
    expect(host.querySelector('[aria-label="Session preview"] h3')?.textContent).toBe(row.querySelector('.program-day-name')?.textContent)
    act(() => useUI.getState().closeSheet(useUI.getState().sheets[0]!.id))
  }
  act(() => grid.querySelector<HTMLButtonElement>('.program-cell')!.click())
  expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Synthetic session')
  expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Evening session 1')
})

it('places names in the flexible third column and chevrons in the fifth column, with indented session sub-rows', () => {
  const css = readFileSync(new FileURL('../src/views/Programs.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.program-cell\{[^}]*grid-template-columns:10px 26px minmax\(0,1fr\) auto 16px/)
  expect(css).toMatch(/\.program-cell>\.program-day-name\{grid-column:3\}/)
  expect(css).toMatch(/\.program-cell>\.icn\{grid-column:5\}/)
  expect(css).toMatch(/\.program-session-cell>\.program-day-name\{padding-inline-start:12px\}/)
})

it('keeps cycle occurrence rows singular with their complete five-column structure and preview', () => {
  const S = p7Fixture(false), grid = mount(S, 'c')
  expect(grid.querySelectorAll('.program-cell')).toHaveLength(1)
  expect(grid.querySelectorAll('.program-session-cell')).toHaveLength(0)
  expect(grid.querySelector('.program-cell')?.children).toHaveLength(5)
  act(() => grid.querySelector<HTMLButtonElement>('.program-cell')!.click())
  expect(host.querySelector('[aria-label="Session preview"] h3')?.textContent).toBe(S.routines[0].name)
})
