// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {configureTestClient} from './client-fixture'
import Admin from '../src/views/Admin'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})

/* The admin's half of password sign-in (#118): "Reset password" in a user's drill-down, which
   asks first and then shows the one-time code exactly once, on a sheet that a stray tap cannot
   close. Only an instance with password sign-in sends `password` on the user, and only then is
   any of this there. */
const mocks: any = vi.hoisted(() => ({ answers: {}, sheets: [], posts: [], confirm: vi.fn() }))
vi.mock('../src/lib/api', () => ({
  api: (path: any, init: any) => {
    if (init?.method === 'POST') mocks.posts.push({ path, body: JSON.parse(init.body) })
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
  const snap: any = () => ({ toast: () => {}, openSheet: (render: any, opts: any) => mocks.sheets.push({ render, opts }) })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/sheets', () => ({ confirmSheet: (...a: any) => mocks.confirm(...a) }))

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
const button: any = (host: any, text: any) => [...host.querySelectorAll('button')].find((b: any) => b.textContent === text)

const detail: any = (extra: any) => ({
  user: { id: 'u1', name: 'Mallory', created: '2026-09-01T00:00:00Z', disabled: false, admin: false, ...extra },
  unit: 'kg', lastSync: null, routines: [], bodyweight: [], workouts: []
})
async function openMallory() {
  const page: any = render(<Admin />)
  await settle()
  act(() => [...page.querySelectorAll('.item')].find((el: any) => el.textContent.includes('Mallory')).click())
  const sheet: any = render(mocks.sheets.at(-1).render(() => {}))
  await settle()
  return sheet
}

beforeEach(() => {
  configureTestClient()
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.posts.length = 0
  mocks.confirm.mockClear()
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 0, lastSync: null, disabled: false }], invite_only: false },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { events: [], total: 0, enabled: true, retention: { days: 90 }, ip_mode: 'off' },
    '/api/admin/user/password-reset': { ok: true, name: 'Mallory', code: 'K7WQ-2MZP-4HXA', expires: Date.now() + 86400000 },
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

describe('Admin → Reset password', () => {
  it('is not there on an instance without password sign-in', async () => {
    mocks.answers['/api/admin/user'] = detail()
    const sheet: any = await openMallory()
    expect(button(sheet, 'Disable account')).toBeTruthy()
    expect(button(sheet, 'Reset password')).toBeUndefined()
  })

})

describe('Admin → sign-in e-mail', () => {
  it('shows nothing where the server sends no address', async () => {
    mocks.answers['/api/admin/user'] = detail({ password: true, email: null, resetUntil: null })
    const sheet: any = await openMallory()
    expect(sheet.textContent).not.toContain('@')
  })
})
