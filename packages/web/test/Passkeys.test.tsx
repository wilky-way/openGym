import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { passkeyError, PasskeysRow, PasskeysSheet, DeviceLinkSheet, DeviceLinkRedeemSheet } from '../src/components/Passkeys'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
configureTestClient()

/* More passkeys and one-time codes for another device, on screen (#95): the Settings list and
   what editing, removing and adding send — removing and adding both behind the proof step; the
   code sheet with its proof, QR and expiry; and the other device's redeem sheet. The API and the passkey prompts are stand-ins; what each step
   sends, and what it says back in the UI language, is the point. */
const mocks: any = vi.hoisted(() => {
  const state: any = { webauthn: true, sheets: [], answers: {}, calls: [], store: {} }
  state.toast = vi.fn()
  state.setUser = vi.fn()
  state.adoptProfile = vi.fn(async () => ({}))
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'login-cid', credential: { id: 'k1' } }))
  state.createPasskey = vi.fn(async () => ({ id: 'new-key', response: {} }))
  state.copyText = vi.fn(async () => true)
  state.askAddDeviceData = vi.fn()
  state.api = vi.fn(async (path: any, init: any) => {
    const method: any = init?.method || 'GET'
    state.calls.push({ path, method, body: init?.body ? JSON.parse(init.body) : null })
    const a: any = state.answers[method + ' ' + path.split('?')[0]]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a() : a ?? {}
  })
  state.snapshot = () => ({ ...state.store, update: (mut: any) => mut(state.store.S), setUser: state.setUser, adoptProfile: state.adoptProfile })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  useStore.setState = (patch: any) => Object.assign(mocks.store, patch)
  return { useStore }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: (...a: any[]) => mocks.toast(...a), openSheet: (render: any, opts: any) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../src/lib/api', () => ({
  api: (...a: any[]) => mocks.api(...a),
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a: any[]) => mocks.passkeyAssertion(...a),
  createPasskey: (...a: any[]) => mocks.createPasskey(...a),
  // PasswordAuth.jsx, for passwordError, imports these too.
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../src/lib/clipboard', () => ({ copyText: (...a: any[]) => mocks.copyText(...a) }))
vi.mock('../src/lib/auth-ui-services', () => ({ askAddDeviceData: mocks.askAddDeviceData }))
// lean-qr loads on demand; what matters here is what the QR code carries.
vi.mock('../src/components/QrCanvas', () => ({ default: ({ value }: any) => <canvas data-qr={value} /> }))

const fail: any = (status: any, data: any) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })
const named: any = (name: any, e: any = new Error(name)) => Object.assign(e, { name })

const mounted: any = []
function mount(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
// Await native chunk completion and React's resulting commits, including rejected API reads.
const settle = () => act(async () => { await vi.dynamicImportSettled() })
function type(el: any, value: any) {
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const byPlaceholder: any = (host: any, p: any) => host.querySelector(`input[placeholder="${p}"]`)
const button: any = (host: any, text: any) => [...host.querySelectorAll('button')].find((b: any) => b.textContent === text)
const click: any = async (host: any, text: any) => { act(() => button(host, text).click()); await settle() }
const submit: any = async (host: any) => { act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle() }
const alertText: any = (host: any) => host.querySelector('[role="alert"]')?.textContent || null
// The sheet a tap opened, mounted on its own.
const openedSheet: any = (i: any = mocks.sheets.length - 1) => { const close: any = vi.fn(); return { host: mount(mocks.sheets[i].render(close)), close } }
// The last sheet mounted goes away, as when it is closed.
const unmountLast: any = () => act(() => { const m: any = mounted.pop(); m.root.unmount(); m.host.remove() })
// A passkey prompt that stays open until the test answers it, and says whether it was called off.
function openPrompt() {
  const p: any = {}
  mocks.passkeyAssertion.mockImplementationOnce(({ signal }: any = {}) => new Promise((resolve: any, reject: any) => {
    p.signal = signal
    p.answer = () => resolve({ cid: 'login-cid', credential: { id: 'k1' } })
    p.fail = (e: any) => reject(e)
  }))
  return p
}

const LIST: any = {
  passkeys: [
    { id: 'k/1+', name: 'Laptop', created: '2025-09-01T10:00:00.000Z', lastUsed: '2026-10-13T12:00:00.000Z', transports: ['internal'] },
    { id: 'k2', name: null, created: null, lastUsed: null, transports: [] }
  ],
  password: false, lastWayIn: false
}

beforeEach(() => {
  vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.answers = {}
  mocks.calls.length = 0
  mocks.store = { user: { id: 'u1', name: 'Ana' }, S: {}, linkCode: null }
  for (const f of [mocks.toast, mocks.setUser, mocks.adoptProfile, mocks.passkeyAssertion, mocks.createPasskey, mocks.copyText, mocks.askAddDeviceData]) f.mockClear()
})
afterEach(() => { vi.useRealTimers(); act(() => { mounted.splice(0).forEach(({ root, host }: any) => { root.unmount(); host.remove() }) }) })

describe('passkeyError', () => {
  it('words this feature’s refusals, and hands the proof refusals to the password sheet’s wording', () => {
    expect(passkeyError(named('InvalidStateError'))).toBe('This device already has a passkey for this profile.')
    expect(passkeyError(fail(400, { code: 'link-invalid' }))).toMatch(/wrong, already used or expired/)
    expect(passkeyError(fail(409, { code: 'last-way-in' }))).toMatch(/only way in/)
    expect(passkeyError(fail(409, { code: 'passkey-limit' }))).toMatch(/as many passkeys/)
    expect(passkeyError(fail(403, { code: 'passkey' }))).toBe('Your passkey could not be confirmed.')
  })
})

describe('Settings: the passkey list', () => {
  it('the row counts them, and says what none means', () => {
    expect(mount(<PasskeysRow state={LIST} changed={() => {}} />).textContent).toContain('2 passkeys')
    expect(mount(<PasskeysRow state={{ ...LIST, passkeys: [LIST.passkeys[0]] }} changed={() => {}} />).textContent).toContain('1 passkey')
    expect(mount(<PasskeysRow state={{ ...LIST, passkeys: [] }} changed={() => {}} />).textContent).toMatch(/None yet/)
    expect(mount(<PasskeysRow state={null} />).textContent).toBe('')
  })

  it('lists each one by name or number, with when it was added and last used — the year only when it is not this one', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST
    const host: any = mount(<PasskeysSheet close={() => {}} changed={() => {}} />)
    await settle()
    const rows: any = [...host.querySelectorAll('.lrow')].map((r: any) => r.textContent)
    expect(rows[0]).toMatch(/^Laptop/)
    expect(rows[0]).toMatch(/Added Sep 1, 2025 · Last used Oct 13$/)
    expect(rows[0]).not.toContain(String(new Date().getFullYear()))
    expect(rows[1]).toBe('Passkey 2')
    expect(host.textContent).not.toMatch(/only way in/)
  })

  it('says why the only passkey stays, and its sheet offers no Remove', async () => {
    mocks.answers['GET /api/account/passkeys'] = { passkeys: [LIST.passkeys[0]], password: false, lastWayIn: true }
    const host: any = mount(<PasskeysSheet close={() => {}} changed={() => {}} />)
    await settle()
    expect(host.textContent).toMatch(/only way in/)
    act(() => host.querySelector('.lrow').click())
    const { host: edit } = openedSheet()
    expect(button(edit, 'Remove passkey')).toBeUndefined()
    expect(edit.textContent).toMatch(/only way in/)
  })

  it('renames one', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST
    const changed: any = vi.fn()
    const host: any = mount(<PasskeysSheet close={() => {}} changed={changed} />)
    await settle()
    act(() => host.querySelector('.lrow').click())
    const { host: edit, close } = openedSheet()
    expect(edit.querySelector('h3').textContent).toBe('Laptop')
    mocks.answers['POST /api/account/passkeys/rename'] = { ...LIST, passkeys: [{ ...LIST.passkeys[0], name: 'Work laptop' }, LIST.passkeys[1]] }
    type(byPlaceholder(edit, 'Name, e.g. Work laptop'), 'Work laptop')
    await submit(edit)
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/passkeys/rename', method: 'POST', body: { id: 'k/1+', name: 'Work laptop' } })
    expect(close).toHaveBeenCalled()
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

/* Removing asks for the proof adding does (proveOwner in api/server.js), on the sheet that says
   what removing means: the tap that confirms it is the proof, and the proof goes with the removal
   and nothing else. */
describe('Settings: removing a passkey', () => {
  async function openRemove(list: any = LIST) {
    mocks.answers['GET /api/account/passkeys'] = list
    const changed: any = vi.fn()
    const host: any = mount(<PasskeysSheet close={() => {}} changed={changed} />)
    await settle()
    act(() => host.querySelector('.lrow').click())
    const edit: any = openedSheet()
    act(() => button(edit.host, 'Remove passkey').click())
    return { ...openedSheet(), edit, changed }
  }
  const deletes: any = () => mocks.calls.filter((c: any) => c.method === 'DELETE')

  it('says sessions stay, sends nothing until the passkey confirms, then removes with that proof', async () => {
    const { host, close, edit, changed } = await openRemove()
    expect(host.querySelector('h3').textContent).toBe('Remove this passkey?')
    expect(host.textContent).toContain('Laptop')
    expect(host.textContent).toMatch(/stays signed in. If it was lost, use Sign out everywhere/)
    expect(host.textContent).toContain('First confirm that it is you.')
    // No password on this profile, or none that counts: the passkey is the only proof offered.
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    expect(deletes()).toEqual([])
    expect(button(host, 'Confirm with a passkey').className).toMatch(/\bdanger\b/)

    mocks.answers['DELETE /api/account/passkeys'] = { ...LIST, passkeys: [LIST.passkeys[1]], lastWayIn: true }
    await click(host, 'Confirm with a passkey')
    expect(mocks.passkeyAssertion).toHaveBeenCalledTimes(1)
    expect(deletes()).toEqual([{ path: '/api/account/passkeys?id=k%2F1%2B', method: 'DELETE', body: { cid: 'login-cid', credential: { id: 'k1' } } }])
    expect(close).toHaveBeenCalled()
    expect(edit.close).toHaveBeenCalled()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Passkey removed')
  })


  it('a refusal stays on the sheet and says why; nothing is removed', async () => {
    const { host, close, changed } = await openRemove()
    mocks.answers['DELETE /api/account/passkeys'] = fail(403, { code: 'passkey' })
    await click(host, 'Confirm with a passkey')
    expect(alertText(host)).toBe('Your passkey could not be confirmed.')
    // Another device took the other passkey away meanwhile: this one is the last way in now.
    mocks.answers['DELETE /api/account/passkeys'] = fail(409, { code: 'last-way-in' })
    await click(host, 'Confirm with a passkey')
    expect(alertText(host)).toBe('It is your only way in, so it cannot be removed until there is another.')
    expect(close).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    // GM safety exception: safe transaction refusals also toast without signing out.
    expect(mocks.toast).toHaveBeenLastCalledWith('It is your only way in, so it cannot be removed until there is another.')
  })

  it('a dismissed prompt removes nothing and is no error; Cancel just closes', async () => {
    const { host, close } = await openRemove()
    mocks.passkeyAssertion.mockRejectedValueOnce(named('NotAllowedError'))
    await click(host, 'Confirm with a passkey')
    expect(deletes()).toEqual([])
    expect(alertText(host)).toBeNull()
    await click(host, 'Cancel')
    expect(close).toHaveBeenCalled()
    expect(deletes()).toEqual([])
  })

  it('a prompt still open when the sheet goes is called off, and an answer after that removes nothing', async () => {
    const { host } = await openRemove()
    const prompt: any = openPrompt()
    await click(host, 'Confirm with a passkey')
    expect(prompt.signal.aborted).toBe(false)
    unmountLast()
    expect(prompt.signal.aborted).toBe(true)
    // A browser that answers anyway: the answer is for a sheet that is gone.
    await act(async () => { prompt.answer() })
    await settle()
    expect(deletes()).toEqual([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('Settings: adding a passkey', () => {
  async function openAdd(list: any) {
    mocks.answers['GET /api/account/passkeys'] = list
    const host: any = mount(<PasskeysSheet close={() => {}} changed={() => {}} />)
    await settle()
    await click(host, 'Add a passkey')
    return openedSheet()
  }

  it('confirms with a passkey first, then opens the passkey prompt from its own tap and stores the new one', async () => {
    const { host, close } = await openAdd(LIST)
    // No password on this profile: only the passkey proof is offered.
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    type(byPlaceholder(host, 'Name, e.g. Work laptop'), 'YubiKey')
    mocks.answers['POST /api/account/passkeys/options'] = { cid: 'add-cid', options: { challenge: 'abc' } }
    await click(host, 'Confirm with a passkey')
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/passkeys/options', method: 'POST', body: { cid: 'login-cid', credential: { id: 'k1' } } })
    // Nothing is created until the second tap.
    expect(mocks.createPasskey).not.toHaveBeenCalled()
    mocks.answers['POST /api/account/passkeys/verify'] = LIST
    await click(host, 'Create passkey')
    expect(mocks.createPasskey).toHaveBeenCalledWith({ challenge: 'abc' })
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/passkeys/verify', method: 'POST', body: { cid: 'add-cid', credential: { id: 'new-key', response: {} }, name: 'YubiKey' } })
    expect(close).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Passkey added')
  })


  it('a dismissed prompt is no error; an authenticator that already holds one says so', async () => {
    const { host } = await openAdd(LIST)
    mocks.answers['POST /api/account/passkeys/options'] = { cid: 'add-cid', options: {} }
    await click(host, 'Confirm with a passkey')
    mocks.createPasskey.mockRejectedValueOnce(named('NotAllowedError'))
    await click(host, 'Create passkey')
    expect(alertText(host)).toBeNull()
    mocks.createPasskey.mockRejectedValueOnce(named('InvalidStateError'))
    await click(host, 'Create passkey')
    expect(alertText(host)).toBe('This device already has a passkey for this profile.')
  })
})

describe('Settings: a code for another device', () => {
  it('says plainly when nothing here can confirm it is the owner', async () => {
    // A profile that only has a password, on an instance that switched passwords off.
    mocks.answers['GET /api/account/passkeys'] = { passkeys: [], password: false, lastWayIn: true }
    const host: any = mount(<DeviceLinkSheet close={() => {}} />)
    await settle()
    expect(button(host, 'Confirm with a passkey')).toBeUndefined()
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    expect(host.textContent).toMatch(/has no passkey, and this server does not take passwords/)
    // A passkey this browser cannot use is another matter: another device can.
    mocks.webauthn = false
    mocks.answers['GET /api/account/passkeys'] = LIST
    const other: any = mount(<DeviceLinkSheet close={() => {}} />)
    await settle()
    expect(other.textContent).toMatch(/This browser cannot confirm with your passkey/)
    expect(mocks.calls.filter((c: any) => c.method !== 'GET')).toEqual([])
  })

  it('after the proof shows the code, a QR code of the link, and copies the link', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST
    mocks.answers['POST /api/account/device-link'] = { code: 'K7WQ-2MZP-4HXA', expires: Date.now() + 600000 }
    const host: any = mount(<DeviceLinkSheet close={() => {}} />)
    await settle()
    expect(host.querySelector('canvas')).toBeNull()
    await click(host, 'Confirm with a passkey')
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/device-link', method: 'POST', body: { cid: 'login-cid', credential: { id: 'k1' } } })
    const link: any = window.location.origin + window.location.pathname + '?link=K7WQ-2MZP-4HXA'
    expect(host.querySelector('canvas').dataset.qr).toBe(link)
    expect(host.textContent).toContain('K7WQ-2MZP-4HXA')
    expect(host.textContent).toMatch(/works once, for 10 minutes/)
    await click(host, 'Copy link')
    expect(mocks.copyText).toHaveBeenCalledWith(link)
    expect(mocks.toast).toHaveBeenCalledWith('Copied')
  })

  it('says when the code has expired, and makes a new one from the start', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST
    mocks.answers['POST /api/account/device-link'] = { code: 'K7WQ-2MZP-4HXA', expires: Date.now() - 1 }
    const host: any = mount(<DeviceLinkSheet close={() => {}} />)
    await settle()
    await click(host, 'Confirm with a passkey')
    await settle()
    expect(host.textContent).toContain('This code has expired.')
    expect(host.querySelector('canvas')).toBeNull()
    await click(host, 'Make a new code')
    expect(button(host, 'Confirm with a passkey')).toBeTruthy()
  })
})

describe('the other device: redeeming a code', () => {
  const OPTIONS: any = { cid: 'link-cid', options: { challenge: 'xyz' }, id: 'u1', name: 'Ana' }
  const CAUTION: any = 'Only continue if this code comes from a device of your own. This browser is then signed in to “Ana”, and what you log here goes to that profile.'

  it('checks a code from the link at once, then creates the passkey and signs in like a passkey sign-in', async () => {
    mocks.store = { user: null, linkCode: 'K7WQ-2MZP-4HXA' }
    mocks.answers['POST /api/device-link/options'] = OPTIONS
    mocks.answers['POST /api/device-link/verify'] = { user: { id: 'u1', name: 'Ana', admin: false } }
    const close: any = vi.fn()
    const host: any = mount(<DeviceLinkRedeemSheet close={close} />)
    await settle()
    expect(mocks.calls[0]).toEqual({ path: '/api/device-link/options', method: 'POST', body: { code: 'K7WQ-2MZP-4HXA' } })
    expect(host.textContent).toContain('for the profile “Ana”')
    // A guest is told where this device ends up, and that the code has to be their own.
    expect(host.textContent).toContain(CAUTION)
    expect(host.textContent).not.toMatch(/signed in as/)
    expect(byPlaceholder(host, 'Code from your other device').value).toBe('K7WQ-2MZP-4HXA')
    await submit(host)
    // The options already here are used as they are: the prompt opens straight from the tap.
    expect(mocks.calls.filter((c: any) => c.path === '/api/device-link/options')).toHaveLength(1)
    expect(mocks.createPasskey).toHaveBeenCalledWith({ challenge: 'xyz' })
    expect(mocks.calls.at(-1).path).toBe('/api/device-link/verify')
    expect(mocks.calls.at(-1).body).toMatchObject({ code: 'K7WQ-2MZP-4HXA', cid: 'link-cid', credential: { id: 'new-key' } })
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', name: 'Ana', admin: false }, { adopt: { alwaysAsk: true } })
    // What this device logged goes into that profile only when asked, even into an empty one.
    expect(mocks.adoptProfile).toHaveBeenCalledWith(mocks.askAddDeviceData, { alwaysAsk: true })
    expect(mocks.store.linkCode).toBeNull()
    expect(close).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Signed in as Ana')
  })

  it('a typed code is checked on the tap; a wrong one stays on the sheet and says so', async () => {
    mocks.store = { user: null, linkCode: null }
    mocks.answers['POST /api/device-link/options'] = fail(400, { code: 'link-invalid' })
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    expect(mocks.calls).toHaveLength(0)
    await submit(host)
    expect(alertText(host)).toBe('Enter the code from your other device.')
    type(byPlaceholder(host, 'Code from your other device'), 'wrng-code-0000')
    await submit(host)
    expect(mocks.calls[0].body).toEqual({ code: 'WRNG-CODE-0000' })
    expect(alertText(host)).toMatch(/wrong, already used or expired/)
    expect(mocks.createPasskey).not.toHaveBeenCalled()
    expect(mocks.setUser).not.toHaveBeenCalled()
  })

  it('after a refused verify it asks for fresh options next time, since the server spent the challenge', async () => {
    mocks.store = { user: null, linkCode: 'K7WQ-2MZP-4HXA' }
    mocks.answers['POST /api/device-link/options'] = OPTIONS
    mocks.answers['POST /api/device-link/verify'] = fail(400, { error: 'not verified' })
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    await submit(host)
    expect(alertText(host)).toBe('Could not confirm that it is you. Try again.')
    await submit(host)
    expect(mocks.calls.filter((c: any) => c.path === '/api/device-link/options')).toHaveLength(2)
  })

  it('the same account adding this browser keeps its copy as it is', async () => {
    // Renamed since this browser signed in: the id is what makes it the same profile.
    mocks.store = { user: { id: 'u1', name: 'Ana (old name)' }, linkCode: 'K7WQ-2MZP-4HXA' }
    mocks.answers['POST /api/device-link/options'] = OPTIONS
    mocks.answers['POST /api/device-link/verify'] = { user: { id: 'u1', name: 'Ana', admin: false } }
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    expect(host.textContent).not.toMatch(/signed in as/)
    expect(host.textContent).not.toContain(CAUTION)
    await submit(host)
    expect(mocks.adoptProfile).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Passkey added')
  })

  it('says so when another profile is signed in here', async () => {
    mocks.store = { user: { id: 'u2', name: 'Bea' }, linkCode: 'K7WQ-2MZP-4HXA' }
    mocks.answers['POST /api/device-link/options'] = OPTIONS
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    expect(host.textContent).toContain('This browser is signed in as “Bea”. Adding it to “Ana” signs “Bea” out here.')
    expect(host.textContent).toContain(CAUTION)
  })

  it('tells a different profile with the same name apart by its id', async () => {
    // Someone else's profile, named like the one signed in here on purpose.
    mocks.store = { user: { id: 'u2', name: 'Ana' }, linkCode: 'K7WQ-2MZP-4HXA' }
    mocks.answers['POST /api/device-link/options'] = OPTIONS
    mocks.answers['POST /api/device-link/verify'] = { user: { id: 'u1', name: 'Ana', admin: false } }
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    expect(host.textContent).toContain('This code is for a different profile that is also called “Ana”, not the one this browser is signed in as. Adding it there signs yours out here.')
    expect(host.textContent).toContain(CAUTION)
    await submit(host)
    // Went on anyway: signed in to that profile, never greeted as if it were the one before.
    expect(mocks.adoptProfile).toHaveBeenCalledWith(mocks.askAddDeviceData, { alwaysAsk: true })
    expect(mocks.toast).toHaveBeenCalledWith('Signed in as Ana')
    expect(mocks.toast).not.toHaveBeenCalledWith('Passkey added')
  })

  it('a browser without passkeys is told plainly, and nothing is asked of the server', async () => {
    mocks.webauthn = false
    mocks.store = { user: null, linkCode: 'K7WQ-2MZP-4HXA' }
    const host: any = mount(<DeviceLinkRedeemSheet close={() => {}} />)
    await settle()
    expect(host.textContent).toMatch(/cannot create passkeys/)
    expect(mocks.calls).toHaveLength(0)
  })
})

it('a device-link verify answered after the redeem sheet closed does not apply a sign-in', async () => {
  mocks.store.linkCode = 'LINK-CODE'
  mocks.answers['POST /api/device-link/options'] = {cid:'cid', options:{}, id:'u2', name:'Other'}
  let answer: (value: any) => void = () => {}
  mocks.answers['POST /api/device-link/verify'] = () => new Promise(resolve => {answer=resolve})
  const host = mount(<DeviceLinkRedeemSheet close={() => {}} />)
  await settle(); await submit(host); unmountLast()
  await act(async () => answer({user:{id:'u2',name:'Other'}}))
  expect(mocks.setUser).not.toHaveBeenCalled(); expect(mocks.adoptProfile).not.toHaveBeenCalled()
})
it('a device-link verify from a previous account does not switch a newly signed-in account', async () => {
  mocks.store.linkCode = 'LINK-CODE'
  mocks.answers['POST /api/device-link/options'] = {cid:'cid', options:{}, id:'u2', name:'Other'}
  let answer: (value: any) => void = () => {}
  mocks.answers['POST /api/device-link/verify'] = () => new Promise(resolve => {answer=resolve})
  const host = mount(<DeviceLinkRedeemSheet close={() => {}} />)
  await settle(); await submit(host); mocks.store.user={id:'u3',name:'Third'}
  await act(async () => answer({user:{id:'u2',name:'Other'}}))
  expect(mocks.setUser).not.toHaveBeenCalled(); expect(mocks.adoptProfile).not.toHaveBeenCalled()
})

// UI twins isolate the seam; store/auth-transaction.test.ts verifies real carrier and upload fencing.
vi.mock('../src/lib/auth-transactions', () => ({authenticate: async (exchange: any, valid: any, options: any) => {
  if (!valid()) return null
  const user = await exchange()
  if (!valid()) return null
  const {useStore} = await import('../src/store/useStore')
  useStore.getState().setUser(user, options)
  return user
}}))

it.each(['rename', 'remove', 'add'])('refuses %s for the previous account after a sheet is opened', async action => {
  mocks.answers['GET /api/account/passkeys']=LIST
  const list=mount(<PasskeysSheet close={()=>{}} />);await settle()
  let target: any
  if (action==='add') {await click(list,'Add a passkey');target=openedSheet().host}
  else {
    act(()=>list.querySelector('.lrow').click());target=openedSheet().host
    if (action==='remove') {await click(target,'Remove passkey');target=openedSheet().host}
  }
  mocks.calls.length=0;const next={id:'B',name:'Next',saved:{workouts:[{id:'private-B'}]}};mocks.store.user=next
  if (action==='rename') await submit(target);else await click(target,'Confirm with a passkey')
  expect(mocks.calls.filter((call:any)=>call.method!=='GET')).toEqual([])
  expect(next.saved).toEqual({workouts:[{id:'private-B'}]});expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/account.*changed/))
})
it('refuses generating a device-link code after its account changed', async () => {
  mocks.answers['GET /api/account/passkeys']=LIST
  const host=mount(<DeviceLinkSheet close={()=>{}} />);await settle();mocks.calls.length=0;mocks.store.user={id:'B'}
  await click(host,'Confirm with a passkey')
  expect(mocks.calls.filter((call:any)=>call.method!=='GET')).toEqual([]);expect(mocks.toast).toHaveBeenCalledWith('The account changed. Open this action again.')
})
it('refuses device-link redemption opened under a previous account', async () => {
  const host=mount(<DeviceLinkRedeemSheet close={()=>{}} />);type(byPlaceholder(host,'Code from your other device'),'ABCDEFGH');mocks.store.user={id:'B'}
  await submit(host);expect(mocks.createPasskey).not.toHaveBeenCalled();expect(mocks.setUser).not.toHaveBeenCalled();expect(mocks.toast).toHaveBeenCalledWith('The account changed. Open this action again.')
})
