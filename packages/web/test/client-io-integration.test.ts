// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://gym.test/gym/" }
import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest'
import {configureTestClient} from './client-fixture'
import {api, apiRoute, beacon, pairRedeem, setRemoteAuth, createPasskey, passkeyRegister, passkeyLogin, refreshApiCapabilities, bio, vault} from '../src/lib/api'
import {fetchHevyAccount, fetchHevyPages, importHevyData, HEVY_ID_MAP} from '../src/lib/import-hevy'
import {createExerciseIndex} from '@opengym/core/exercises'
import {sha256Hex} from '../src/lib/sha256'
import {copyText} from '../src/lib/clipboard'
import {stripLinkFromUrl} from '../src/lib/device-link'
import {configureClientIO} from '../src/lib/client-io'
import {createBrowserClientCapabilities} from '../src/platform/client'
let platform: ReturnType<typeof configureTestClient>
beforeEach(() => {platform = configureTestClient()})
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers(); history.replaceState(null, '', '/gym/')})
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), {status, headers})

describe('Platform HTTP integration', () => {
  it('keeps JSON property order and request headers under a proxy mount', async () => {
    const fetch = vi.fn(async () => json({z: 1, a: 2}))
    vi.stubGlobal('fetch', fetch)
    expect(JSON.stringify(await apiRoute('GET /api/data/rev', undefined))).toBe('{"z":1,"a":2}')
    await api('/api/data', {method: 'PUT', body: '{"z":1,"a":2}', headers: new Headers({'X-Probe': 'ok'})})
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0]![0]).toBe('https://gym.test/gym/api/data/rev')
    expect(new Headers(calls[1]![1].headers).get('x-probe')).toBe('ok')
    expect(calls[1]![1].body).toBe('{"z":1,"a":2}')
  })
  it('uses a remote bearer, isolates Hevy credentials and never stores its key', async () => {
    setRemoteAuth('https://remote.test', 'DEVICE_TOKEN')
    const fetch = vi.fn(async (url: string) => url.includes('hevyapp') ? json({page_count:1, workouts:[]}) : json({rev:3}))
    vi.stubGlobal('fetch', fetch)
    await api('/api/data/rev'); await fetchHevyPages('/v1/workouts', 'HEVY_KEY', {resultKey:'workouts'})
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(new Headers(calls[0]![1].headers).get('authorization')).toBe('Bearer DEVICE_TOKEN')
    expect(calls[0]![1].credentials).toBe('omit')
    expect(new Headers(calls[1]![1].headers).get('authorization')).toBeNull()
    expect(new Headers(calls[1]![1].headers).get('api-key')).toBe('HEVY_KEY')
    expect(JSON.stringify(localStorage)).not.toContain('HEVY_KEY')
  })
  it('redeems without a prior bearer even at the configured origin; probes have no auth preflight', async () => {
    setRemoteAuth('https://remote.test', 'PRIOR_TOKEN')
    const fetch = vi.fn(async () => json({token:'NEW', user:{id:'u', name:'test'}}))
    vi.stubGlobal('fetch', fetch)
    await pairRedeem('https://remote.test','CODE')
    await platform.transport.fetch('https://remote.test/api/health', {mode:'no-cors', headers:{Authorization:'Bearer explicit'}})
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(new Headers(calls[0]![1].headers).has('authorization')).toBe(false)
    expect(new Headers(calls[1]![1].headers).has('authorization')).toBe(false)
    expect(platform.kv.get('gym_device_token')).toBe('PRIOR_TOKEN')
  })
  it('sends same-origin activity with keepalive and refuses remote activity', async () => {
    const fetch = vi.fn(async () => json({ok:true})); vi.stubGlobal('fetch',fetch)
    expect(beacon('/api/activity',{left:true})).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    expect((fetch.mock.calls as unknown as [string,RequestInit][])[0]![1]).toMatchObject({method:'POST',keepalive:true,body:'{"left":true}',credentials:'include'})
    setRemoteAuth('https://remote.test','TOKEN')
    expect(beacon('/api/activity',{left:true})).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('Hevy request policy', () => {
  it('retries 429 twice, honors bounded Retry-After and then reports rate-limit', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => json({},429,{'retry-after':'1'}));vi.stubGlobal('fetch',fetch)
    const pending = fetchHevyPages('/v1/workouts','k',{resultKey:'workouts'}).catch(e=>e)
    await vi.advanceTimersByTimeAsync(999);expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({status:429,message:'rate-limit'})
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('rejects an empty key before HTTP and preserves optional measurements refusals', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('/body_measurements') ? json({},404) : json({page_count:1}));vi.stubGlobal('fetch',fetch)
    await expect(fetchHevyAccount('  ')).rejects.toMatchObject({status:0,message:'empty'})
    expect(fetch).not.toHaveBeenCalled()
    expect((await fetchHevyAccount(' k ')).bodyMeasurements).toEqual([])
    fetch.mockImplementation(async (url: string) => url.includes('/body_measurements') ? json({},403) : json({page_count:1}))
    await expect(fetchHevyAccount('k')).rejects.toMatchObject({status:403,message:'auth'})
  })
  it('forwards the real custom index to both workout and routine parsers', async () => {
    const map = HEVY_ID_MAP as Record<string,string>
    const previous = map.W01_SYNTHETIC
    map.W01_SYNTHETIC = 'custom-hevy'
    try {
      const custom = {id:'custom-hevy',n:'synthetic assisted lift',eq:'assisted',bp:'back',tg:'lats',custom:true}
      const index = createExerciseIndex([custom])
      const exercise = {exercise_template_id:'W01_SYNTHETIC',title:'Synthetic',sets:[{weight_kg:5,reps:3}]}
      vi.stubGlobal('fetch',vi.fn(async (url: string) => {
        const key = new URL(url).pathname.split('/').at(-1)!
        const pages: Record<string,unknown> = {exercise_templates:[{id:'W01_SYNTHETIC',title:'Synthetic'}], workouts:[{id:'w',start_time:'2026-01-02T12:00:00Z',exercises:[exercise]}],routines:[{id:'r',title:'Synthetic',exercises:[exercise]}],body_measurements:[]}
        return json({page_count:1,[key]:pages[key]})
      }))
      const result = await importHevyData('k',{},index)
      expect(result.workouts.workouts[0]!.entries![0]!.id).toBe('custom-hevy')
      expect(result.routines.routines[0]!.ex[0]!.id).toBe('custom-hevy')
    } finally {if(previous === undefined) delete map.W01_SYNTHETIC; else map.W01_SYNTHETIC = previous}
  })
})

describe('browser capability integration', () => {
  it('uses K01 native SHA options and returns the known vector', async () => {
    const original = Object.getOwnPropertyDescriptor(window,'crypto')
    const digest = vi.fn(async () => Uint8Array.from({length:32},()=>0xab).buffer)
    Object.defineProperty(window,'crypto',{configurable:true,value:{subtle:{digest}}})
    try {expect(await sha256Hex(new Uint8Array([1,2]))).toBe('ab'.repeat(32));expect(digest).toHaveBeenCalledOnce()}
    finally {if(original) Object.defineProperty(window,'crypto',original);else delete (window as any).crypto}
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('copies via the injected shell and strips only the link query', async () => {
    const copy = vi.fn(async () => true)
    configureClientIO(platform,{...createBrowserClientCapabilities(platform),copyText:copy})
    expect(await copyText('text')).toBe(true);expect(copy).toHaveBeenCalledWith('text')
    history.replaceState({kept:true},'', '/gym/?link=one&other=two#/settings')
    stripLinkFromUrl()
    expect(location.search).toBe('?other=two');expect(location.hash).toBe('#/settings');expect(history.state).toEqual({kept:true})
  })
  it('refreshes passkey UI phrases from the shell at boot', () => {
    configureClientIO(platform,{...createBrowserClientCapabilities(platform),userAgent:()=> 'iPhone'})
    refreshApiCapabilities();expect(bio()).toBe('Face ID / Touch ID');expect(vault()).toBe('iCloud Keychain')
  })
})

describe('connection persistence failure', () => {
  it('returns token write errors and restores the prior URL instead of retaining a stale pairing', async () => {
    await setRemoteAuth('https://prior.test','OLD_TOKEN')
    const setDeviceToken = vi.fn(async () => {throw new Error('token store denied')})
    const failing = {...platform,server:{...platform.server,setDeviceToken}}
    configureClientIO(failing,createBrowserClientCapabilities(failing))
    await expect(setRemoteAuth('https://next.test','NEW_TOKEN')).rejects.toThrow('token store denied')
    expect(platform.server.baseUrl()).toBe('https://prior.test')
    expect(platform.kv.get('gym_device_token')).toBe('OLD_TOKEN')
  })
})

describe('native connection seam', () => {
  it('awaits an independent endpoint/keychain and preserves it on refused writes', async () => {
    let base = '', token: string | null = null
    let release: (() => void) | undefined
    let fail = false
    const endpoint = {baseUrl:()=>base,authHeader:async(): Promise<Record<string,string>>=>token ? {Authorization:'Bearer '+token} : {},setDeviceToken:async(value:string|null)=>{token=value}}
    const native = {...platform,info:{...platform.info,kind:'tauri' as const},server:endpoint}
    configureClientIO(native,{...createBrowserClientCapabilities(platform),connection:{
      token:()=>token,
      async configure(nextBase,nextToken) {
        await new Promise<void>(resolve=>{release=resolve})
        if(fail) throw new Error('keychain refused')
        token=nextToken; base=nextBase
      },
    }})
    const pending=setRemoteAuth('https://native.test','KEYCHAIN_TOKEN')
    expect(endpoint.baseUrl()).toBe('')
    release!(); await pending
    expect(endpoint.baseUrl()).toBe('https://native.test')
    const {apiConnection}=await import('../src/lib/api-connection')
    expect(apiConnection().token).toBe('KEYCHAIN_TOKEN')
    expect(platform.kv.get('gym_server_url')).toBeNull()
    expect(platform.kv.get('gym_device_token')).toBeNull()
    expect(beacon('/api/activity',{})).toBe(false)
    fail=true
    const refused=setRemoteAuth('https://refused.test','BAD_TOKEN')
    release!(); await expect(refused).rejects.toThrow('keychain refused')
    expect(endpoint.baseUrl()).toBe('https://native.test')
    expect(apiConnection().token).toBe('KEYCHAIN_TOKEN')
  })
})
