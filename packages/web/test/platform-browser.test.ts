import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window as HappyWindow } from 'happy-dom'
import { browserNavReaders, browserSha256Options, configureBrowserServer, createBrowserPlatform, DEVICE_TOKEN_KEY, SERVER_URL_KEY } from '../src/platform/browser'
import { ux } from '../src/platform/ux'
import { navToWorkout, setNav, setNavReaders } from '../src/lib/nav'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setNav(() => {}); setNavReaders({ sheetEntry: () => false, currentHash: () => '' }) })
const page = (url = 'https://gym.example/gym/index.html?link=synthetic&keep=1#/home') => {
  const win = new HappyWindow({ url }) as unknown as Window
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('navigator', win.navigator)
  return win
}

describe('browser Platform endpoint and transport', () => {
  it('defaults to same-origin cookies and preserves the reverse-proxy mount', async () => {
    const win = page(), platform = createBrowserPlatform(), response = new Response('{}')
    const fetch = vi.spyOn(win, 'fetch').mockResolvedValue(response)
    await platform.server.setDeviceToken('synthetic-device')
    expect(platform.server.baseUrl()).toBe('')
    expect(await platform.server.authHeader()).toEqual({})
    expect(await platform.transport.fetch('/api/me')).toBe(response)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://gym.example/gym/api/me')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('reads persisted endpoints/tokens at each call and uses Bearer without cookies', async () => {
    const win = page(), platform = createBrowserPlatform()
    const fetch = vi.spyOn(win, 'fetch').mockResolvedValue(new Response('{}'))
    configureBrowserServer(platform.kv, 'https://remote.example:8443/')
    await platform.server.setDeviceToken('synthetic-device')
    const second = createBrowserPlatform()
    expect(second.server.baseUrl()).toBe('https://remote.example:8443')
    expect(second.kv.get(SERVER_URL_KEY)).toBe('https://remote.example:8443')
    expect(await second.server.authHeader()).toEqual({ Authorization: 'Bearer synthetic-device' })
    const controller = new AbortController()
    await second.transport.fetch('/api/data', { method: 'PUT', body: '{"z":1,"a":2}', headers: [['x-custom', 'yes'], ['authorization', 'stale']], signal: controller.signal, credentials: 'include' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://remote.example:8443/api/data')
    expect(init?.credentials).toBe('omit')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('{"z":1,"a":2}')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-device')
    expect(new Headers(init?.headers).get('x-custom')).toBe('yes')
    await platform.server.setDeviceToken(null)
    expect(second.kv.get(DEVICE_TOKEN_KEY)).toBeNull()
    expect(await second.server.authHeader()).toEqual({})
    configureBrowserServer(platform.kv, '')
    expect(second.server.baseUrl()).toBe('')
    expect(second.kv.get(SERVER_URL_KEY)).toBeNull()
  })

  it('refuses non-HTTPS and non-origin endpoints before writing or sending', async () => {
    const win = page(), platform = createBrowserPlatform(), fetch = vi.spyOn(win, 'fetch')
    configureBrowserServer(platform.kv, 'https://remote.example')
    for (const base of ['http://gym.example', '//gym.example', 'https://gym.example/gym', 'https://gym.example/?x=1', 'https://gym.example/#x', 'https://user:pass@gym.example', ' https://gym.example', 'broken']) {
      expect(() => configureBrowserServer(platform.kv, base), base).toThrow()
      expect(platform.server.baseUrl()).toBe('https://remote.example')
    }
    platform.kv.set(SERVER_URL_KEY, 'http://tampered.example')
    await expect(platform.transport.fetch('/api/data')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never attaches the device token to third-party or protocol-relative URLs', async () => {
    const win = page(), platform = createBrowserPlatform()
    const fetch = vi.spyOn(win, 'fetch').mockResolvedValue(new Response('{}'))
    configureBrowserServer(platform.kv, 'https://remote.example')
    await platform.server.setDeviceToken('synthetic-device')
    for (const url of ['https://hevy.example/workouts', '//third.example/api']) {
      await platform.transport.fetch(url, { headers: { 'api-key': 'synthetic-hevy' }, credentials: 'include' })
      const init = fetch.mock.calls.at(-1)![1]
      expect(init?.credentials).toBe('omit')
      expect(new Headers(init?.headers).get('api-key')).toBe('synthetic-hevy')
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    }
    await platform.transport.fetch('https://remote.example/api/me')
    expect(new Headers(fetch.mock.calls.at(-1)![1]?.headers).get('Authorization')).toBe('Bearer synthetic-device')
  })

  it('accepts object, Headers and tuple caller headers without mutating them', async () => {
    const win = page(), platform = createBrowserPlatform()
    const fetch = vi.spyOn(win, 'fetch').mockResolvedValue(new Response('{}'))
    for (const headers of [{ 'X-Client': 'test' }, new Headers({ 'X-Client': 'test' }), [['X-Client', 'test']] as [string, string][]]) {
      await platform.transport.fetch('/api/me', { headers })
      expect(new Headers(fetch.mock.calls.at(-1)![1]?.headers).get('X-Client')).toBe('test')
      expect(new Headers(headers).has('Authorization')).toBe(false)
    }
  })

  it('preserves response failures and fetch rejection semantics', async () => {
    const win = page(), platform = createBrowserPlatform()
    const response = new Response('conflict', { status: 409 })
    const fetch = vi.spyOn(win, 'fetch').mockResolvedValueOnce(response).mockRejectedValueOnce(new TypeError('offline'))
    expect(await platform.transport.fetch('/api/data')).toBe(response)
    await expect(platform.transport.fetch('/api/data')).rejects.toThrow('offline')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('browser Platform navigation and capabilities', () => {
  it('supplies K02 navigation readers with the actual sheet/history/hash contract', () => {
    const win = page(), navigate = vi.fn()
    setNav(navigate)
    setNavReaders(browserNavReaders(win))
    win.history.replaceState({ openGymSheet: true }, '', '#/home')
    navToWorkout()
    expect(navigate).toHaveBeenLastCalledWith('/workout', { replace: true })
    win.history.replaceState(null, '', '#/workout')
    navToWorkout()
    expect(navigate).toHaveBeenLastCalledWith('/workout', { replace: true })
    win.history.replaceState(null, '', '#/home')
    navToWorkout()
    expect(navigate).toHaveBeenLastCalledWith('/workout')
  })
  it('composes W04 browser UX at platform boot', () => {
    const win = page()
    const platform = createBrowserPlatform()
    expect(ux().window).toBe(win)
    expect(ux().document).toBe(win.document)
    expect(ux().wakeLock.supported()).toBe(false)
    expect(platform.nav.href()).toBe(ux().window!.location.href)
  })
  it('requires the ambient browser context instead of configuring UX against another window', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(() => createBrowserPlatform()).toThrow('Browser window is unavailable')
  })
  it('injects native subtle at the browser boundary, and leaves insecure contexts on the core fallback', async () => {
    const win = page()
    // Synthetic digest; no core global is read to obtain the injected implementation.
    Object.defineProperty(win, 'crypto', { value: globalThis.crypto, configurable: true })
    const options = browserSha256Options(win)
    expect(options.subtle).toBe(globalThis.crypto.subtle)
    const digest = await options.subtle!.digest('SHA-256', new TextEncoder().encode('abc'))
    expect(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    Object.defineProperty(win, 'crypto', { value: {}, configurable: true })
    expect(browserSha256Options(win)).toEqual({ subtle: undefined })
  })
  it('replaces/removes queries without changing the hash or the sheet history state', () => {
    const win = page(), platform = createBrowserPlatform()
    win.history.replaceState({ openGymSheet: true }, '', win.location.href)
    const readers = browserNavReaders(win)
    expect(readers.onSheetEntry()).toBe(true)
    expect(readers.currentRoute()).toBe('#/home')
    platform.nav.replaceQuery({ link: null, empty: '', add: 'a b' })
    expect(platform.nav.href()).toBe('https://gym.example/gym/index.html?keep=1&empty=&add=a+b#/home')
    expect(win.history.state).toEqual({ openGymSheet: true })
    const params = platform.nav.searchParams()
    expect(params.get('link')).toBeNull()
    params.set('local', 'only')
    expect(platform.nav.searchParams().has('local')).toBe(false)
    win.history.replaceState(null, '', '#/workout')
    expect(readers.onSheetEntry()).toBe(false)
    expect(readers.currentRoute()).toBe('#/workout')
    const reload = vi.spyOn(win.location, 'reload').mockImplementation(() => {})
    platform.nav.reload()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('gates SW registration by capability and HTTPS and exposes push/wake-lock/build info', async () => {
    const win = page(), register = vi.fn().mockResolvedValue({})
    Object.defineProperty(win.navigator, 'serviceWorker', { value: { register }, configurable: true })
    Object.defineProperty(win, 'PushManager', { value: class {}, configurable: true })
    Object.defineProperty(win, 'Notification', { value: class {}, configurable: true })
    Object.defineProperty(win.navigator, 'wakeLock', { value: {}, configurable: true })
    const platform = createBrowserPlatform({ buildSha: 'synthetic-build' })
    expect(platform.info).toEqual({ kind: 'browser', canServiceWorker: true, canWebPush: true, canWakeLock: true, buildSha: 'synthetic-build' })
    await platform.registerServiceWorker('sw.js')
    expect(register).toHaveBeenCalledWith('sw.js')
    win.location.href = 'http://gym.example/gym/'
    const insecure = createBrowserPlatform()
    expect(insecure.info.canServiceWorker).toBe(false)
    expect(insecure.info.canWebPush).toBe(false)
    await insecure.registerServiceWorker('sw.js')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('answers the worker build handshake from the actual loaded page build', () => {
    const win = page(), handlers: Record<string, (event: any) => void> = {}
    const controller = { postMessage: vi.fn() }, source = { postMessage: vi.fn() }
    Object.defineProperty(win.navigator, 'serviceWorker', { value: { controller, addEventListener: (name: string, cb: (event: any) => void) => { handlers[name] = cb } } })
    createBrowserPlatform({ buildSha: 'loaded-build' })
    expect(controller.postMessage).toHaveBeenCalledWith({ type: 'OPENGYM_BUILD_READY' })
    handlers.message!({ data: { type: 'OPENGYM_BUILD_QUERY', nonce: 12 }, source })
    expect(source.postMessage).toHaveBeenCalledWith({ type: 'OPENGYM_BUILD_REPLY', nonce: 12, buildSha: 'loaded-build', assets: [] })
    handlers.controllerchange!({})
    expect(controller.postMessage).toHaveBeenCalledTimes(2)
  })

  it('does not assume SW/push/wake-lock support and propagates registration errors', async () => {
    const win = page(), platform = createBrowserPlatform()
    expect(platform.info.canServiceWorker).toBe(false)
    expect(platform.info.canWebPush).toBe(false)
    expect(platform.info.canWakeLock).toBe(false)
    await expect(platform.registerServiceWorker('sw.js')).resolves.toBeUndefined()
    Object.defineProperty(win.navigator, 'serviceWorker', { value: { register: vi.fn().mockRejectedValue(new Error('SW refused')) } })
    await expect(createBrowserPlatform().registerServiceWorker('sw.js')).rejects.toThrow('SW refused')
  })
})
