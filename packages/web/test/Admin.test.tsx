// @vitest-environment happy-dom
// The admin drill-down (QA C16): a profile whose stored workouts hold a null or otherwise
// shapeless entry must still open, because the sheet host sits outside the route's
// ErrorBoundary — a throw here blanked the whole app and left the account un-disableable.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {configureTestClient} from './client-fixture'
import Admin from '../src/views/Admin'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})

const mocks: any = vi.hoisted(() => ({ answers: {}, sheets: [] }))
vi.mock('../src/lib/api', () => ({
  api: (path: any) => {
    const key: any = path.split('?')[0]
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../src/store/useStore', () => {
  const user={id:'adm',name:'Admin',admin:true}
  const snap: any = () => ({ user, S: {}, update:(mut:any)=>mut({}) })
  const useStore: any = (selector: any) => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: () => {}, openSheet: (render: any) => mocks.sheets.push(render) })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/sheets', () => ({ confirmSheet: vi.fn() }))

const mounted: any = []
function render(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const settle = () => act(async () => { await vi.dynamicImportSettled() })

const good: any = { id: 'w1', name: 'Push day', d: '2026-09-10', start: 1000, end: 61000, entries: [{ sets: [{ done: true }, { done: false }] }] }

beforeEach(() => {
  configureTestClient()
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 2, lastSync: null, disabled: false }], invite_only: false },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { rows: [] },
    '/api/admin/user': {
      user: { id: 'u1', name: 'Mallory', created: '2026-09-01T00:00:00Z', disabled: false, admin: false },
      unit: 'kg', lastSync: null, routines: [], bodyweight: [],
      // What GET /api/admin/user hands over for a document written before PUT /api/data dropped
      // such entries: a null, and a bare object without entries, next to a real session.
      workouts: [null, good, {}]
    }
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

describe('Admin user drill-down', () => {
  it('opens a profile with malformed workout entries and still offers "Disable account"', async () => {
    const page: any = render(<Admin />)
    await settle()
    const row: any = [...page.querySelectorAll('.item')].find((el: any) => el.textContent.includes('Mallory'))
    expect(row).toBeTruthy()
    act(() => row.click())
    expect(mocks.sheets.length).toBe(1)
    const sheet: any = render(mocks.sheets[0](() => {}))
    await settle()
    const buttons: any = [...sheet.querySelectorAll('button')].map((b: any) => b.textContent)
    expect(buttons).toContain('Disable account')
    // The one real session is listed; the two shapeless entries are skipped, not drawn as blanks.
    const rows: any = [...sheet.querySelectorAll('.list > div')]
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('Push day')
    expect(rows[0].textContent).toContain('1 sets')
  })
})

describe('Admin when the users cannot be loaded', () => {
  const text: any = (page: any) => page.textContent
  it('an answer without a list is an error, not an endless "Loading…"', async () => {
    mocks.answers['/api/admin/users'] = {}
    const page: any = render(<Admin />)
    await settle()
    expect(text(page)).not.toContain('Loading…')
    expect(text(page)).toContain('Could not load the users')
    expect(text(page)).toContain('The server answered without a list of users.')
  })

  it('a failed call says why, and "Try again" loads the list once the server answers', async () => {
    delete mocks.answers['/api/admin/users']
    const page: any = render(<Admin />)
    await settle()
    expect(page.querySelector('[role="alert"]').textContent).toContain('not found')

    mocks.answers['/api/admin/users'] = { users: [{ id: 'u1', name: 'Mallory', workouts: 2, lastSync: null, disabled: false }], invite_only: false }
    const retry: any = [...page.querySelectorAll('button')].find((b: any) => b.textContent === 'Try again')
    act(() => retry.click())
    await settle()
    expect(page.querySelector('[role="alert"]')).toBeNull()
    expect(text(page)).toContain('1 users')
    expect([...page.querySelectorAll('.item')].some((el: any) => el.textContent.includes('Mallory'))).toBe(true)
  })

  it('a list that loaded stays up when a later update fails, marked as the last one', async () => {
    const page: any = render(<Admin />)
    await settle()
    delete mocks.answers['/api/admin/users']
    const refresh: any = page.querySelector('[aria-label="refresh"]')
    act(() => refresh.click())
    await settle()
    expect(text(page)).toContain('The last update failed')
    expect([...page.querySelectorAll('.item')].some((el: any) => el.textContent.includes('Mallory'))).toBe(true)
  })
})

it('uses the inspected account’s custom dumbbell exercise index for unstored volume',async()=>{
 mocks.answers['/api/admin/user'].customEx=[{id:'custom-bw',n:'Synthetic single arm press',eq:'dumbbell',bp:'chest',custom:true}]
 mocks.answers['/api/admin/user'].workouts=[{...good,bw:80,entries:[{id:'custom-bw',target:{id:'custom-bw',dbLoad:'each'},sets:[{w:5,r:10,done:true}]}]}]
 const page=render(<Admin/>);await settle();act(()=>[...page.querySelectorAll('.item')].find((el:any)=>el.textContent.includes('Mallory')).click())
 const sheet=render(mocks.sheets[0](()=>{}));await settle();expect(sheet.textContent).toContain('50 kg')
})
