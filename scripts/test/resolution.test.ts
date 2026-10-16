import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { files } from '../files'
const linter = fileURLToPath(new URL('../boundaries.ts', import.meta.url))
it('confines CSS runtime bytes after resolving directory symlinks, including similar package prefixes', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-css-realpath-'))
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  const resolver = fileURLToPath(new URL('../resolution.ts', import.meta.url))
  try {
    write('packages/web/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*'] }))
    write('packages/web/src/main.ts', "import './linked/styles.css'")
    write('packages/web/src/env.d.ts', "declare module '*.css'")
    for (const directory of ['outside', 'packages/web-extra/styles', 'packages/web/styles']) write(directory + '/styles.css', 'body{color:black}')
    for (const [directory, allowed] of [['outside', false], ['packages/web-extra/styles', false], ['packages/web/styles', true]] as const) {
      const link = join(root, 'packages/web/src/linked')
      symlinkSync(join(root, directory), link)
      try {
        // Exercise the resolver directly: source discovery rejects symlinks separately and
        // must not hide whether the resolver authorizes escaped runtime bytes.
        const code = `import {resolvePackageImports} from ${JSON.stringify(resolver)};import {realpathSync} from 'node:fs';const map=resolvePackageImports('web',['packages/web/src/main.ts','packages/web/src/env.d.ts']);console.log(JSON.stringify(map.get(realpathSync('packages/web/src/main.ts')+'\\0./linked/styles.css')??null))`
        const child = Bun.spawnSync(['bun', '--eval', code], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
        expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0)
        expect(JSON.parse(new TextDecoder().decode(child.stdout)), directory).toBe(allowed ? realpathSync(join(root, directory, 'styles.css')) : null)
      } finally { rmSync(link) }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
it('resolves TS paths and rejects platform imports through allowed-package re-exports', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-resolution-'))
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  try {
    write('tsconfig.base.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', types: [], paths: { leak: ['./packages/server/src/secret.ts'], bridge: ['./packages/contract/src/bridge.ts'], safe: ['./packages/contract/src/safe.ts'], reactBridge: ['./packages/contract/src/react-bridge.ts'], casts: ['./packages/core/test/loose.ts'], network: ['./packages/contract/src/network.ts'] } } }))
    for (const pkg of ['core', 'contract', 'server', 'web']) write(`packages/${pkg}/tsconfig.json`, JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src/**/*'] }))
    write('packages/server/src/secret.ts', 'export const value=1')
    write('packages/contract/src/bridge.ts', "export { value } from '../../server/src/secret'")
    write('node_modules/react/package.json', JSON.stringify({ name: 'react', types: 'index.d.ts' }))
    write('node_modules/react/index.d.ts', 'export declare const value: number')
    write('packages/contract/src/react-bridge.ts', "export { value } from 'react'")
    write('packages/core/test/loose.ts', 'export const value=1')
    write('packages/contract/src/network.ts', 'export const value = () => fetch("https://synthetic.invalid")')
    write('packages/contract/src/safe.ts', 'export const value=1')
    for (const [source, failed] of [["import {value} from 'leak'", true], ["import {value} from 'bridge'", true], ["import {value} from 'safe'", false], ["import {value} from 'reactBridge'", true], ["import {value} from 'network'", true]] as const) {
      write('packages/core/src/probe.ts', source)
      const child = Bun.spawnSync(['bun', linter], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const output = new TextDecoder().decode(child.stderr)
      expect(child.exitCode !== 0, output).toBe(failed)
      if (failed) expect(output).toMatch(/core (?:reaches platform\/runtime (?:code|import)|uses a platform API)/)
    }
    write('packages/core/src/probe.ts', 'export {}')
    write('packages/core/test/probe.test.ts', "import {value} from 'casts'")
    const aliasedShim = Bun.spawnSync(['bun', linter], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(aliasedShim.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(aliasedShim.stderr)).toContain('temporary loose shim')
    rmSync(join(root, 'packages/core/test/probe.test.ts'))
    write('packages/web/src/platform/network.ts', 'export const request = () => fetch("https://synthetic.invalid")')
    write('packages/web/src/ui.ts', "import {request} from './platform/network'")
    const platformAdapter = Bun.spawnSync(['bun', linter], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(platformAdapter.exitCode, new TextDecoder().decode(platformAdapter.stderr)).toBe(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
it('rejects symlinked files and directories rather than skipping their contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-symlink-'))
  try {
    mkdirSync(join(root, 'outside')); writeFileSync(join(root, 'outside/value.ts'), 'export const value=1')
    symlinkSync(join(root, 'outside/value.ts'), join(root, 'file.ts'))
    expect(() => files(root)).toThrow('Symlink is forbidden')
    rmSync(join(root, 'file.ts')); symlinkSync(join(root, 'outside'), join(root, 'linked-dir'))
    expect(() => files(root)).toThrow('Symlink is forbidden')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('resolves existing relative SQL assets while rejecting missing or other unsupported assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-sql-'))
  const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  try {
    for (const pkg of ['server', 'contract']) write(`packages/${pkg}/tsconfig.json`, JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*'] }))
    write('packages/contract/storage/migrations/0001_init.sql', 'CREATE TABLE synthetic (id TEXT);')
    write('packages/contract/storage/migrations/unsupported.txt', 'Synthetic')
    // Even an available declaration must not make an absent SQL asset pass.
    write('packages/contract/storage/migrations/missing.d.sql.ts', 'declare const text: string; export default text')
    for (const [asset, failed] of [['0001_init.sql', false], ['missing.sql', true], ['unsupported.txt', true]] as const) {
      write('packages/server/src/db/migration.ts', `import migration from '../../../contract/storage/migrations/${asset}' with { type: 'text' }; export { migration }`)
      const child = Bun.spawnSync(['bun', linter], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const output = new TextDecoder().decode(child.stderr)
      expect(child.exitCode !== 0, output).toBe(failed)
      if (failed) expect(output).toContain('unresolved boundary import')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)

it('resolves only real CSS in its originating package and rejects missing, escaped or legacy paths',()=>{
 const root=mkdtempSync(join(tmpdir(),'opengym-css-'))
 const write=(path:string,text:string)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text)}
 try{
  for(const pkg of ['web','contract'])write(`packages/${pkg}/tsconfig.json`,JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',types:[]},include:['src/**/*']}))
  write('packages/web/src/env.d.ts',"declare module '*.css'")
  write('packages/web/src/styles.css','body{color:black}')
  write('packages/contract/src/styles.css','body{color:black}')
  write('legacy/styles.css','body{color:black}')
  for(const [asset,failed] of [['./styles.css',false],['./missing.css',true],['../../contract/src/styles.css',true],['../../../legacy/styles.css',true]] as const){
   write('packages/web/src/main.ts',`import '${asset}'`)
   const child=Bun.spawnSync(['bun',linter],{cwd:root,stdout:'pipe',stderr:'pipe'})
   expect(child.exitCode!==0,new TextDecoder().decode(child.stderr)).toBe(failed)
  }
 }finally{rmSync(root,{recursive:true,force:true})}
},30_000)
