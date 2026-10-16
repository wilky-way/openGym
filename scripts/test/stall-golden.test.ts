import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {assertStallGoldenEnabled} from '../assert-stall-golden-enabled'
const source = readFileSync('packages/core/test/progression-stall.golden.test.ts','utf8')
it('requires the real enabled stall-extension golden without changing its arithmetic', () => {
  expect(() => assertStallGoldenEnabled(source)).not.toThrow()
  for (const changed of [source.replace('const stallExtensions = p3Extensions','const stallExtensions = {}'),source.replace("describe('P3-MUST-ENABLE", "describe.skip('P3-MUST-ENABLE"),source.replace('evaluate(x,stallExtensions)','evaluate(x,{})')]) expect(() => assertStallGoldenEnabled(changed)).toThrow()
})
