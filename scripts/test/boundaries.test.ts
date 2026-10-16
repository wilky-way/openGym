import { expect, it } from 'vitest'
import { boundaryErrors, isBoundarySource } from '../boundaries'
import { assertionCount, checkAssertionBudget, checkMappingCoverage } from '../assert-count'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

it('keeps the bounded public oracle exclusive to differential and parity code', () => {
  const source = "import { value } from '../../parity/fixtures/oracle/frontend/src/lib/bar.js'"
  expect(boundaryErrors('packages/core/src/planted.ts', source).length).toBeGreaterThan(0)
  expect(boundaryErrors('packages/web/src/lib/planted.ts', source.replace('../../parity', '../../../parity')).length).toBeGreaterThan(0)
  expect(boundaryErrors('packages/core/test/planted.test.ts', source).length).toBeGreaterThan(0)
  expect(boundaryErrors('packages/core/test/planted.diff.test.ts', source)).toEqual([])
  expect(isBoundarySource('packages/parity/src/oracle.ts')).toBe(true)
  expect(isBoundarySource('packages/parity/fixtures/oracle/frontend/src/lib/bar.js')).toBe(false)
})

it('keeps the browser worker privilege at its entry instead of importing it into the app', () => {
  const sources = ["import '../public/sw.js'", "export * from '../public/sw.js'", "const worker = import('../public/sw.js')", "require('../public/sw.js')"]
  for (const source of sources) {
    expect(boundaryErrors('packages/web/src/main.ts', source), source).toContainEqual(expect.stringContaining('service-worker entry'))
    expect(boundaryErrors('packages/web/src/platform/probe.ts', source.replaceAll('../public/', '../../public/')), source).toContainEqual(expect.stringContaining('service-worker entry'))
  }
})

it('rejects resolved and transitive app imports of the browser worker while allowing the worker entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-worker-boundary-'))
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  const linter = fileURLToPath(new URL('../boundaries.ts', import.meta.url))
  const run = () => Bun.spawnSync(['bun', linter], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  try {
    write('packages/web/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', types: [], paths: { worker: ['./public/sw.js'] } }, include: ['src/**/*', 'public/**/*'] }))
    write('packages/web/public/sw.js', 'self.addEventListener("fetch", e => e.respondWith(fetch(e.request))); caches.open("synthetic")')
    write('packages/web/src/main.ts', 'export {}')
    const safe = run()
    expect(safe.exitCode, new TextDecoder().decode(safe.stderr)).toBe(0)
    for (const source of ["import '../public/sw.js'", "import 'worker'", "import './platform/bridge'", "export * from './bridge'"]) {
      write('packages/web/src/main.ts', source)
      if (source.includes('./platform/bridge')) write('packages/web/src/platform/bridge.ts', "import 'worker'")
      if (source.includes("'./bridge'")) write('packages/web/src/bridge.ts', "import 'worker'")
      const rejected = run()
      expect(rejected.exitCode, source).not.toBe(0)
      expect(new TextDecoder().decode(rejected.stderr), source).toContain('service-worker entry')
      rmSync(join(root, 'packages/web/src/platform'), { recursive: true, force: true })
      rmSync(join(root, 'packages/web/src/bridge.ts'), { force: true })
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
it('permits the Platform transport while forbidding direct fetch, navigation, and digest globals', () => {
  for (const source of ['platform.transport.fetch("/api/me")', 'platform.transport["fetch"]("/api/me")', 'platform["transport"]["fetch"]("/api/me")', 'platform?.transport?.fetch("/api/me")']) {
    expect(boundaryErrors('packages/web/src/lib/api.ts', source)).toEqual([])
  }
  for (const source of ['fetch("/api/me")', 'window.fetch("/")', 'globalThis.fetch("/")', 'client.fetch("/")', 'window.transport.fetch("/")', 'navigator["serviceWorker"]', 'window.localStorage', 'indexedDB.open("cache")', 'history.replaceState(null, "")', 'window.history.state', 'globalThis["history"].state', 'crypto.subtle.digest("SHA-256", data)', 'window.crypto.subtle', 'const {crypto: c} = window', 'const {history: h} = globalThis']) {
    expect(boundaryErrors('packages/web/src/lib/planted.ts', source).length, source).toBeGreaterThan(0)
  }
  expect(boundaryErrors('packages/web/src/platform/browser.ts', 'window.fetch("/");window.localStorage;window.history;crypto.subtle')).toEqual([])
  expect(boundaryErrors('packages/web/src/lib/domain.ts', 'state.history;state["history"];state.crypto;state["crypto"];({history: []})')).toEqual([])
  expect(boundaryErrors('packages/core/src/domain.ts', 'state["history"]')).toEqual([])
})
it('keeps DOM globals inside the browser platform while allowing element-ref APIs', () => {
  for (const source of ['window.innerHeight', 'document.createElement("audio")', 'navigator.userAgent', 'globalThis.navigator', 'new Audio("beep")', 'new FileReader()', 'new DOMParser()', 'new Worker("worker.js")', 'matchMedia("(prefers-color-scheme:dark)")', 'screen.height', 'visualViewport.height', 'self.navigator', 'new ResizeObserver(listener)', 'getComputedStyle(node)', 'requestAnimationFrame(tick)', 'addEventListener("online", listener)', 'const browser = window', 'const dom = document', 'const nav = navigator', 'const root = globalThis']) {
    expect(boundaryErrors('packages/web/src/lib/planted.ts', source).length, source).toBeGreaterThan(0)
    expect(boundaryErrors('packages/web/src/platform/ux.ts', source), source).toEqual([])
  }
  expect(boundaryErrors('packages/web/src/components/Scroll.tsx', 'ref.current.addEventListener("scroll", listener);ref.current.scrollIntoView();ref.current.getBoundingClientRect()')).toEqual([])
  expect(boundaryErrors('packages/web/test/browser.test.ts', 'window;document;navigator;globalThis;new Audio()')).toEqual([])
})
it('distinguishes local bindings and declaration keys from browser global references', () => {
  for (const source of ['const history = state.history;consume(history)', 'function read(history) { return history.length }', '{ const screen = model.screen; consume(screen) }', 'const {history, screen: window} = state;consume(history,window)', 'const document = ux().document;document.addEventListener("click", listener)', 'const window = ux().window;window["history"];const {crypto} = window', 'interface Transport { fetch(path: string): Promise<Response> }', 'interface Ux { window: Window; document: Document }']) {
    expect(boundaryErrors('packages/web/src/lib/domain.ts', source), source).toEqual([])
  }
  for (const source of ['{const history = state.history;}consume(history)', 'switch(kind) {case 0: const history = []; break} history.back()', 'switch(history.length) {case 0: const history = []; break}', 'function read(value = history) {var history = []}', 'function read(window) { return window.innerHeight };window.innerHeight', 'const window = globalThis;window.fetch("/")', 'declare const window: Window;window.innerHeight']) {
    expect(boundaryErrors('packages/web/src/lib/planted.ts', source).length, source).toBeGreaterThan(0)
  }
})
it('allows a production consumer to reach the actual Platform contract and browser adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-platform-boundary-'))
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  try {
    write('tsconfig.base.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', types: [], paths: { '@opengym/contract/platform/adapters': ['./packages/contract/platform/adapters.ts'] } } }))
    for (const pkg of ['web', 'contract']) write(`packages/${pkg}/tsconfig.json`, JSON.stringify({ extends: '../../tsconfig.base.json', include: ['**/*.ts'] }))
    for (const file of ['packages/contract/platform/adapters.ts', 'packages/web/src/lib/nav.ts', 'packages/web/src/platform/browser.ts', 'packages/web/src/platform/storage.ts', 'packages/web/src/platform/ux.ts']) write(file, readFileSync(file, 'utf8'))
    write('packages/web/src/consumer.ts', 'import type {Platform} from "../../contract/platform/adapters";import {createBrowserPlatform} from "./platform/browser";const platform: Platform = createBrowserPlatform();export const request = () => platform.transport.fetch("/api/me")')
    const child = Bun.spawnSync(['bun', fileURLToPath(new URL('../boundaries.ts', import.meta.url))], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
it('N5 rejects self platform globals in core', () => {
  for (const source of ['self.fetch("/")', 'self.localStorage.getItem("key")', 'self["fetch"]("/")', 'const {fetch:f}=self']) {
    expect(boundaryErrors('packages/core/src/probe.ts', source).some(error => error.includes('core uses a platform API')), source).toBe(true)
  }
})

it('N2 rejects indirect require and dynamic evaluation in production sources', () => {
  for (const source of [
    'require?.("node:fs")', '(0, require)("node:fs")', 'const load=require; load("node:fs")',
    'module.require("node:fs")', 'module["require"]("node:fs")', 'const {require:load}=module', 'const {"require":load}=module;load("node:fs")',
    'eval("fetch()")', '(0,eval)("code")', 'const run=eval;run("code")',
    'new Function("return fetch")', 'Function("return fetch")', 'const Build=Function;new Build("code")',
  ]) expect(boundaryErrors('packages/core/src/probe.ts', source).length, source).toBeGreaterThan(0)
  for (const pkg of ['contract', 'server', 'web', 'mcp', 'parity']) {
    for (const source of ['eval("code")', 'new Function("code")', 'const {eval:run}=globalThis;run("code")', 'const {"Function":Build}=globalThis;new Build("code")', 'const {["Func"+"tion"]:Build}=globalThis;Build("code")']) {
      expect(boundaryErrors(`packages/${pkg}/src/probe.ts`, source).some(error => error.includes('dynamic code')), `${pkg}: ${source}`).toBe(true)
    }
  }
  expect(boundaryErrors('packages/core/src/probe.ts', 'require("./pure")')).toEqual([])
  expect(boundaryErrors('packages/core/src/probe.ts', 'type Constructor = Function; const data = {eval: 1, Function: 2, require: 3}')).toEqual([])
})

it('N3 rejects reflective platform access and capturing platform roots in web', () => {
  for (const source of [
    "Reflect.get(globalThis,'fetch')('/')", "Reflect.get(window,'localStorage')", "Reflect.get(window,'sessionStorage')",
    "Reflect.get(globalThis,'indexedDB')", "Reflect.get(navigator,'serviceWorker')", "Reflect.get(document,'location')",
    "Reflect['get'](self,'fetch')", 'Reflect.get(globalThis,key)', "Reflect.get(window,'local'+'Storage')",
    'const doc=document; doc.location.assign("/")', 'const doc=document; const alias=doc; alias.location.assign("/")',
    'let doc; doc=document; doc.location.assign("/")', 'const doc=(document as Document); doc.location.assign("/")',
    'const root=globalThis; Reflect.get(root,"fetch")',
    'document.querySelector("main"); Reflect.get(data,"fetch"); const doc={location:1};doc.location',
  ]) expect(boundaryErrors('packages/web/src/probe.ts', source).length, source).toBeGreaterThan(0)
  expect(boundaryErrors('packages/web/src/ui.ts', 'ux().document?.querySelector("main"); Reflect.get(data,"fetch"); const doc={location:1};doc.location')).toEqual([])
  expect(boundaryErrors('packages/web/src/platform/browser.ts', 'const doc=document; Reflect.get(globalThis,"fetch")')).toEqual([])
})
it('rejects planted bad imports and platform access', () => {
  for (const s of ["import x from '../../../legacy/frontend/src/lib/bar.js'", "import x from '../../../frontend/src/lib/bar.js'", "import x from 'frontend/src/lib/api.js'", "import x from '../../web/src/index'", "import fs from 'fs/promises'", "import path from 'path/posix'", "export * from 'node:fs'", "const x = import('react')", 'fetch("/")', 'globalThis.fetch("/")', 'globalThis["fetch"]("/")']) expect(boundaryErrors('packages/core/src/planted.ts', s).length).toBeGreaterThan(0)
  expect(boundaryErrors('packages/web/src/planted.ts', 'window.location.assign("/")').length).toBeGreaterThan(0)
  expect(boundaryErrors('packages/core/src/planted.diff.test.ts', "import x from '../../../legacy/frontend/src/lib/bar.js'")).toEqual([])
  expect(boundaryErrors('packages/core/src/ok.ts', '// fetch("/")\nexport const x = "localStorage"')).toEqual([])
})
it('counts executable expect/assert calls, excluding comments and strings', () => {
  expect(assertionCount('expect(1).toBe(1); assert.equal(2,2); // expect(0)\nconst s="expect(0)"')).toBe(2)
})
it('fails closed on dynamic imports, type queries and hidden platform globals', () => {
  for (const source of [
    'import(`react`)', 'import(name)', 'require(name)', 'require(`react`)',
    "type X = import('../../../legacy/frontend/src/lib/bar.js')",
    'const {fetch:f}=globalThis', "window['local'+'Storage']", 'globalThis[`fetch`]',
    'process.env.PORT', 'Bun.file("data")', 'Deno.readTextFile("data")',
  ]) expect(boundaryErrors('packages/core/src/planted.ts', source).length, source).toBeGreaterThan(0)
  for (const source of ['const {fetch:f}=globalThis', "window['local'+'Storage']", 'globalThis[`fetch`]', 'location.assign("/")', 'document.location.assign("/")', '({location: loc}=window);loc.assign("/")', 'const {["loc"+"ation"]: loc}=window;loc.assign("/")', 'const {navigator:{serviceWorker:sw}}=globalThis']) {
    expect(boundaryErrors('packages/web/src/planted.ts', source).length, source).toBeGreaterThan(0)
  }
})

it('rejects every import form of the temporary loose shim, including test and declaration consumers', () => {
  for (const source of [
    "import { loose } from './loose'",
    "export { loose } from '../test/loose.ts'",
    "export * from '@opengym/core/loose'",
    "const shim = import('./loose.js')",
    "const shim = require('./loose')",
    "type Shim = typeof import('./loose')",
    "import shim = require('./loose')",
  ]) {
    for (const file of ['packages/core/src/planted.ts', 'packages/core/test/planted.test.ts', 'packages/contract/core-api/planted.d.ts']) {
      if (file.endsWith('.d.ts') && source.startsWith('const ')) continue // Runtime expressions are not legal declarations.
      expect(boundaryErrors(file, source).some(error => error.includes('loose shim must remain unused')), `${file}: ${source}`).toBe(true)
    }
  }
  expect(boundaryErrors('packages/core/test/ok.ts', '// import { loose } from "./loose"\nexport const note = "loose"')).toEqual([])
})

it('requires documented assertion waivers and a nonnegative budget', () => {
  expect(() => checkAssertionBudget(2, 1, { reason: 'deleted feature', assertions: 1 }, 'No waivers')).toThrow()
  expect(() => checkAssertionBudget(2, 1, { reason: 'deleted feature', assertions: -1 }, 'deleted feature')).toThrow()
  expect(() => checkAssertionBudget(2, 1, { reason: 'deleted feature', assertions: 1 }, 'deleted feature')).not.toThrow()
  expect(() => checkAssertionBudget(2, 1, undefined, '')).toThrow()
})
it('requires explicit legacy inventory coverage even when a port is renamed', () => {
  const legacy = 'legacy/frontend/src/lib/bar.test.js', inventory = new Set([legacy])
  const base = { packages: ['core'], tests: [], legacyTests: [legacy] }
  expect(() => checkMappingCoverage(base, inventory, '', 'K05')).toThrow('unmapped legacy inventory')
  expect(() => checkMappingCoverage({ packages: ['core'], tests: [] }, inventory, '', 'K05')).toThrow('explicit legacyTests')
  expect(() => checkMappingCoverage({ ...base, tests: [{ legacy, ported: 'packages/core/test/renamed.test.ts' }] }, inventory, '', 'K05')).not.toThrow()
  expect(() => checkMappingCoverage({ packages: ['core'], tests: [], legacyTests: [] }, inventory, '', 'K05')).toThrow('reviewed reason')
  expect(() => checkMappingCoverage({ packages: ['core'], tests: [], legacyTests: [], newTestsOnlyReason: 'New feature only' }, inventory, 'New feature only', 'P1')).not.toThrow()
})

it('keeps type-space identifiers and property names separate from runtime platform globals', () => {
  for (const source of [
    'export interface Options { window?: number; fetch?: string }',
    'type window = { value: string }; type Options = window',
    'type Options = typeof window',
    "import type { window } from './types'; export type { window }",
    'const data = {window() { return 1 }}; class Options { window = 1; fetch() { return 2 } }',
    'const data = {window: 1, fetch: 2}; data.window; data.fetch',
  ]) expect(boundaryErrors('packages/core/src/types.ts', source), source).toEqual([])
  for (const source of ['window.location', 'fetch("/")', 'const data = {window}', 'const data = window as unknown', 'enum Example { value = window.value }', 'const data = {[window]: 1}']) {
    expect(boundaryErrors('packages/core/src/runtime.ts', source).length, source).toBeGreaterThan(0)
  }
  for (const source of ['window.fetch("/")', 'navigator.serviceWorker', 'window.location.assign("/")', 'location.assign("/")', 'new window.XMLHttpRequest()', 'new globalThis.WebSocket("/")', 'window.navigator.serviceWorker.register("/")', 'self.fetch("/")', '(window as Window).fetch("/")', 'window!.fetch("/")', '(window satisfies Window).fetch("/")', '(navigator as Navigator).serviceWorker.register("/sw.js")']) {
    expect(boundaryErrors('packages/web/src/runtime.ts', source).length, source).toBeGreaterThan(0)
  }
})


it('treats parent, top, frames and opener as web platform roots', () => {
  for (const root of ['parent', 'top', 'frames', 'opener']) {
    for (const source of [
      `${root}.fetch('/')`, `${root}?.location?.assign('/')`,
      `${root}['local'+'Storage']`, `${root}[key]`,
      `Reflect.get(${root},'fetch')`, `const alias=${root};alias.location`,
      `const {fetch:request}=${root}`, `const {safe,...rest}=${root}`,
      `(${root} as Window).navigator.serviceWorker`, `${root}.frames[0].fetch('/')`,
    ]) {
      expect(boundaryErrors('packages/web/src/probe.ts', source).length, source).toBeGreaterThan(0)
      expect(boundaryErrors('packages/web/src/platform/browser.ts', source), source).toEqual([])
    }
    expect(boundaryErrors('packages/web/src/probe.ts', `const data={${root}:1}; data.${root}; Reflect.get(data,'fetch')`)).toEqual([])
  }
})

it('type-only imports do not hide runtime browser globals', () => {
  for (const source of [
    `import type window from './domain';window.innerHeight`,
    `import type {Window as window} from './domain';window.innerHeight`,
    `import {type Window as window} from './domain';window.innerHeight`,
    `import type * as window from './domain';window.innerHeight`,
  ]) expect(boundaryErrors('packages/web/src/lib/planted.ts', source).length, source).toBeGreaterThan(0)
  expect(boundaryErrors('packages/web/src/lib/domain.ts', `import {surface as window} from './domain';window['history']`)).toEqual([])
})

it('checks every application and public script while permitting only the named browser worker APIs',()=>{
 const worker='self.addEventListener("fetch", e => e.respondWith(fetch(e.request))); caches.open("synthetic");new URL("./",self.location)'
 expect(boundaryErrors('packages/web/public/sw.js',worker)).toEqual([])
 for(const file of ['packages/web/src/app.ts','packages/web/public/other.js','packages/web/src/sw.js','packages/native/public/sw.js']) {
  if(file.startsWith('packages/web/'))expect(boundaryErrors(file,worker).length,file).toBeGreaterThan(0)
 }
 for(const source of ['window.location','navigator.serviceWorker','localStorage.getItem("x")','indexedDB.open("x")','self.navigator','document.body',"import '../../../legacy/frontend/src/lib/api.js'",'import(name)',"import '../test/fixture.ts'"])expect(boundaryErrors('packages/web/public/sw.js',source).length,source).toBeGreaterThan(0)
 expect(isBoundarySource('packages/web/dist/assets/index.js')).toBe(false)
 expect(isBoundarySource('packages/server/dist/index.js')).toBe(false)
 expect(isBoundarySource('packages/web/src/dist/app.ts')).toBe(true)
 expect(isBoundarySource('packages/web/public/sw.js')).toBe(true)
})


it('limits public checker entry imports to their exact test origin and named helper', () => {
  const entries = [
    ['packages/parity/test/public-oracle.test.ts', 'verify-public-oracle'],
    ['packages/parity/test/public-assertion-budget.test.ts', 'assertion-budget'],
    ['packages/parity/test/public-assertion-budget.test.ts', 'assert-count'],
    ['packages/parity/test/public-checks.test.ts', 'public-checks'],
    ['packages/parity/test/public-checks.test.ts', 'test-execution'],
  ] as const
  for (const [origin, helper] of entries) {
    expect(boundaryErrors(origin, `import * as checker from '../../../scripts/${helper}'`), origin).toEqual([])
  }
  for (const origin of ['packages/parity/src/planted.ts', 'packages/parity/test/foreign.test.ts', 'packages/core/test/planted.test.ts', 'packages/web/src/planted.ts']) {
    for (const form of ["import * as checker from '../../../scripts/public-checks'", "export * from '../../../scripts/public-checks'"]) {
      expect(boundaryErrors(origin, form).some(error => error.includes('inert root tree')), `${origin}: ${form}`).toBe(true)
    }
  }
  for (const helper of ['public-checks', 'files', 'gate', 'units']) {
    expect(boundaryErrors('packages/parity/test/public-oracle.test.ts', `import * as checker from '../../../scripts/${helper}'`).some(error => error.includes('inert root tree')), helper).toBe(true)
  }
})

it('resolves checker aliases canonically and refuses foreign, transitive and escaped helper edges', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-checker-boundary-'))
  const external = mkdtempSync(join(tmpdir(), 'opengym-checker-node_modules-shadow-'))
  const linter = fileURLToPath(new URL('../boundaries.ts', import.meta.url))
  const write = (path: string, source: string) => { mkdirSync(join(root, path, '..'), {recursive:true}); writeFileSync(join(root, path), source) }
  const config = (target = '../../scripts/public-checks.ts', vitest?: string) => write('packages/parity/tsconfig.json', JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',types:[],paths:{checker:[target],...(vitest?{vitest:[vitest]}:{})}},include:['test/**/*.ts','src/**/*.ts']}))
  const reset = () => {
    for (const name of ['packages', 'scripts']) rmSync(join(root,name), {recursive:true,force:true})
    config()
    write('packages/parity/test/public-checks.test.ts', "import {value} from 'checker'; export {value}")
    write('scripts/public-checks.ts', "export {value} from './files'")
    write('scripts/files.ts', 'export const value=1')
  }
  const run = () => Bun.spawnSync(['bun', linter], {cwd:root,stdout:'pipe',stderr:'pipe'})
  const refused = (reason: RegExp) => {
    const child=run(),stderr=new TextDecoder().decode(child.stderr)
    expect(child.exitCode,stderr).not.toBe(0)
    expect(stderr).toMatch(reason)
  }
  try {
    reset()
    const allowed=run()
    expect(allowed.exitCode,new TextDecoder().decode(allowed.stderr)).toBe(0)
    const trustedVitestTypes=fileURLToPath(new URL('./dist/index.d.ts',import.meta.resolve('vitest/package.json')))
    config('../../scripts/public-checks.ts',trustedVitestTypes)
    write('packages/parity/test/public-checks.test.ts',"import {value} from 'checker'; import {test} from 'vitest'; export {value,test}")
    const dependency=run()
    expect(dependency.exitCode,new TextDecoder().decode(dependency.stderr)).toBe(0)
    reset()
    write('scripts/not-approved.ts','export const value=1')
    write('scripts/files.ts',"export {value} from './not-approved'")
    refused(/explicit checker helper closure|inert root tree/)

    reset()
    write('scripts/assert-count.ts','export const value=1')
    config('../../scripts/assert-count.ts')
    refused(/explicit checker helper closure|inert root tree/)

    reset()
    rmSync(join(root,'packages/parity/test/public-checks.test.ts'))
    write('packages/parity/test/foreign.test.ts',"export {value} from 'checker'")
    refused(/inert root tree/)

    reset()
    write('packages/parity/src/bridge.ts',"export {value} from '../../../scripts/public-checks'")
    write('packages/parity/test/public-checks.test.ts',"export {value} from '../src/bridge'")
    refused(/explicit checker helper closure|inert root tree/)

    reset()
    mkdirSync(join(external,'node_modules/vitest'),{recursive:true})
    writeFileSync(join(external,'node_modules/vitest/index.ts'),'export const value=1')
    config(join(external,'node_modules/vitest/index.ts'))
    refused(/checker import escapes repository/)
    // The real allowed bare package name must not borrow trust from a fake path.
    config('../../scripts/public-checks.ts',join(external,'node_modules/vitest/index.ts'))
    write('packages/parity/test/public-checks.test.ts',"export {value} from 'vitest'")
    refused(/checker import escapes repository/)

    reset()
    writeFileSync(join(external,'foreign.ts'),'export const value=1')
    rmSync(join(root,'scripts/public-checks.ts'))
    symlinkSync(join(external,'foreign.ts'),join(root,'scripts/public-checks.ts'))
    refused(/checker import escapes repository/)
  } finally {
    rmSync(root,{recursive:true,force:true})
    rmSync(external,{recursive:true,force:true})
  }
}, 60_000)


it('pins the full saxes type correction to one helper edge and refuses modified, aliased and linked substitutes', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-saxes-boundary-'))
  const external = mkdtempSync(join(tmpdir(), 'opengym-saxes-external-'))
  const declaration = readFileSync('packages/parity/types/saxes-6.0.0.d.ts', 'utf8')
  const linter = fileURLToPath(new URL('../boundaries.ts', import.meta.url))
  const write = (path: string, source: string) => { mkdirSync(join(root, path, '..'), {recursive:true}); writeFileSync(join(root, path), source) }
  const config = (name = 'saxes', target = './types/saxes-6.0.0.d.ts') => write('packages/parity/tsconfig.json', JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',types:[],paths:{[name]:[target]}},include:['test/**/*.ts','types/**/*.d.ts']}))
  const reset = () => {
    for (const name of ['packages', 'scripts']) rmSync(join(root,name), {recursive:true,force:true})
    config()
    write('packages/parity/test/public-checks.test.ts', "export {value} from '../../../scripts/public-checks'")
    write('scripts/public-checks.ts', "export {value} from './test-execution'")
    write('scripts/test-execution.ts', "import {SaxesParser} from 'saxes';export const value=SaxesParser")
    write('packages/parity/types/saxes-6.0.0.d.ts', declaration)
  }
  const run = () => Bun.spawnSync(['bun', linter], {cwd:root,stdout:'pipe',stderr:'pipe'})
  const refused = (reason: RegExp) => {
    const child=run(),stderr=new TextDecoder().decode(child.stderr)
    expect(child.exitCode,stderr).not.toBe(0)
    expect(stderr).toMatch(reason)
  }
  try {
    reset()
    const allowed=run()
    expect(allowed.exitCode,new TextDecoder().decode(allowed.stderr)).toBe(0)
    write('packages/parity/types/saxes-6.0.0.d.ts', declaration+'\n// changed\n')
    refused(/explicit checker helper closure/)
    reset()
    writeFileSync(join(external,'same.d.ts'),declaration)
    config('saxes',join(external,'same.d.ts'))
    refused(/checker import escapes repository/)
    reset()
    rmSync(join(root,'packages/parity/types/saxes-6.0.0.d.ts'))
    symlinkSync(join(external,'same.d.ts'),join(root,'packages/parity/types/saxes-6.0.0.d.ts'))
    refused(/Symlink|checker import escapes repository/)
    reset()
    write('scripts/test-execution.ts', "export {value} from './files'")
    write('scripts/files.ts', "import {SaxesParser} from 'saxes';export const value=SaxesParser")
    refused(/explicit checker helper closure/)
    reset()
    config('pretend-saxes')
    write('scripts/test-execution.ts', "import {SaxesParser} from 'pretend-saxes';export const value=SaxesParser")
    refused(/explicit checker helper closure/)
  } finally {
    rmSync(root,{recursive:true,force:true})
    rmSync(external,{recursive:true,force:true})
  }
}, 60_000)
