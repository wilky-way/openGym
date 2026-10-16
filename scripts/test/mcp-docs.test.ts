import {expect,test} from 'vitest'
import {spawnSync} from 'node:child_process'

test('generated runtime tool inventory is current',()=>{
  // Use the generator's actual Bun runtime, rather than importing the MCP
  // package's SDK/Zod graph into the independent foundation Vitest config.
  const result=spawnSync('bun',['scripts/gen-mcp-tools.ts','--check'],{cwd:new URL('../..',import.meta.url),encoding:'utf8'})
  expect(result.status,result.stderr).toBe(0)
})
