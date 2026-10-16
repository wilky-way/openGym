import { expect, test } from 'vitest'
import { legacyTestNames, registeredTestNames } from '../src/golden/api-test-map'

test('finite loop products, object keys, conditionals and escaped names expand to registered cases', () => {
  const source = `const shapes = { empty: [], mixed: [null] };
    for (const stamped of [false, true]) for (const [shape, data] of Object.entries(shapes)) {
      test(\`\${stamped ? 'stamped' : 'unstamped'} \${shape}\`, () => {});
    }
    describe('group', () => { it('owner\\\'s case', () => {}); });`
  expect(registeredTestNames(source)).toEqual(['unstamped empty', 'unstamped mixed', 'stamped empty', 'stamped mixed', "owner's case"])
  expect(registeredTestNames(source.replace('mixed: [null]', 'added: [], mixed: [null]'))).toContain('stamped added')
  expect(registeredTestNames(source.replace('mixed: [null]', 'renamed: [null]'))).toContain('unstamped renamed')
  expect(() => registeredTestNames('for (const name of unknown) test(`${name}`, () => {})')).toThrow('not a finite for-of')
})

test('the legacy inventory contains concrete fixture and imported-constant names, not template source', () => {
  const names = legacyTestNames()
  expect(names).toHaveLength(434)
  expect(names.filter(n => n.name.includes('${'))).toEqual([])
  expect(names.filter(n => n.file === 'programme-fix2.test.js')).toHaveLength(50)
  expect(names.some(n => n.name === 'stops at 20 passkeys per profile')).toBe(true)
  expect(names.filter(n => n.file === 'media-refs.test.js').length).toBeGreaterThan(10)
})

test.each([
  "if (enabled) test('hidden', () => {})",
  "if (enabled) { it('hidden', () => {}) }",
  "switch (value) { case 1: test('hidden', () => {}); break }",
  "[1].forEach(() => test('hidden', () => {}))",
  "function register() { test('hidden', () => {}) }",
  "const registered = test('hidden', () => {})",
  "test.skip('hidden', () => {})",
  "describe.each([1])('group', () => test('hidden', () => {}))",
  "describe('group', (() => () => test('hidden', () => {}))())",
  "const { x = test('hidden', () => {}) } = {}",
  "describe('group', (x = test('hidden', () => {})) => {})",
  "test('outer', { timeout: (test('hidden', () => {}), 1000) }, () => {})",
  "it('outer', { timeout: (it('hidden', () => {}), 1000) }, () => {})",
  "test('outer', () => { test('hidden', () => {}) })"
])('unrecognised registration syntax fails closed: %s', source => {
  expect(() => registeredTestNames(source)).toThrow('unrecognised wrapped registration')
})


test('describe callbacks supplied through unknown bindings fail closed', () => {
  expect(() => registeredTestNames("describe('group', registerCases)")).toThrow('unrecognised describe callback')
})
