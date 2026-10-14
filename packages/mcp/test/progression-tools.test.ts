import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from '../src/tools'
import { ApiClient } from '../src/http-client'
import { progressionSummary } from '../src/progression-tools'
import { syntheticProgramme, syntheticSlot } from '../../core/test/fixtures/synthetic-programme'

let root: string, env: Record<string,string>, tools: ReturnType<typeof createTools>
const call = (name: string, p: any = {}): any => tools.find(t => t.name === name)!.handler(p)
const at = { week: 1, day: 'd1', session: 'main', slot: 'bench' }
const rule = (id = 'linear'): any => ({ id, kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding: { increment: 5, mode: 'nearest', usePlates: false } })
const create = (d = syntheticProgramme()) => call('create_program_draft', { from: 'scratch', definition: d })
const params = (d: any, extra: any = {}) => ({ draft_id: d.draft_id, expected_rev: d.rev, ...extra })
const full = (d: any) => call('get_program_draft', { draft_id: d.draft_id, full: true })
const patch = (d: any, ops: any[]) => call('patch_program_draft', params(d, { ops }))
beforeEach(() => { root = mkdtempSync(join(tmpdir(),'p6-local-')); env = { OPENGYM_AUTHORING_DIR: join(root,'drafts'), OPENGYM_ENABLE_PROGRAMME_AUTHORING: '1' }; tools = createTools({ env }) })
afterEach(() => rmSync(root,{ recursive: true, force: true }))

test('progression validation is pure, token-free and never changes supplied JSON', async () => {
  const d = syntheticProgramme(); d.progressionRules = [rule()]; syntheticSlot(d).progression.rules = ['linear']
  const before = JSON.stringify(d); expect(await call('validate_progression',{ definition: d })).toEqual({ ok: true, issues: [] }); expect(JSON.stringify(d)).toBe(before)
  d.progressionRules[0].increment = 0; expect((await call('validate_progression',{ definition: d })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'rule.range' })]))
})
test('inert direct-JSON index edge explicitly uses the catalogue-only index without an HTTP profile', () => {
  // There is no custom catalogue input on this pure path; the index is intentionally inert.
  const ast = parse(readFileSync(new URL('../src/progression-tools.ts',import.meta.url),'utf8'),{ sourceType: 'module', plugins: ['typescript'] })
  let site: any
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'CallExpression' && n.callee?.name === 'validateProgression' && n.arguments[0]?.object?.name === 'p' && n.arguments[0]?.property?.name === 'definition') site = n
    for (const value of Object.values(n)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value)
  }
  walk(ast); expect(site.arguments[1].callee.name).toBe('createExerciseIndex'); expect(site.arguments[1].arguments).toEqual([])
})
test.each([{}, { definition: {}, draft_id: 'a' }, { definition: {}, programme_id: 'a' }, { draft_id: 'a', programme_id: 'a' }, { definition: {}, arbitrary: true }])('validate_progression refuses ambiguous or unknown input %j', async p => {
  await expect(Promise.resolve().then(() => call('validate_progression',p))).rejects.toMatchObject({ code: 'EINVAL' })
})
test('setProgressionRules, attachRule and detachRule use stable identities and retain existing instructions', async () => {
  let d = await create(), e = syntheticSlot(full(d).definition), instructions = e.progression.instructions
  d = patch(d,[{ op: 'setProgressionRules', rules: [rule()] }]); expect(d.rev).toBe(2)
  d = patch(d,[{ op: 'attachRule', at: [at], ruleId: 'linear' }]); expect(syntheticSlot(full(d).definition).progression).toMatchObject({ rules: ['linear'], instructions })
  d = patch(d,[{ op: 'attachRule', at, ruleId: 'linear' }]); expect(syntheticSlot(full(d).definition).progression.rules).toEqual(['linear'])
  d = patch(d,[{ op: 'detachRule', at, ruleId: 'linear' }, { op: 'setProgressionRules', rules: [] }])
  expect(syntheticSlot(full(d).definition).progression).toMatchObject({ rules: [], instructions }); expect(full(d).definition.progressionRules).toEqual([])
})
test('rule sugar upserts and attaches with one revision, preserves metadata and supports stall onStall', async () => {
  let d = await create(), initial = full(d)
  d = call('set_progression_rule',params(d,{ rule: rule(), at })); expect(d.rev).toBe(2); expect(d.level).toBe('Ready')
  d = call('set_progression_rule',params(d,{ rule: { ...rule(), increment: 10 } })); expect(full(d).definition.progressionRules).toHaveLength(1); expect(full(d).definition.progressionRules[0].increment).toBe(10)
  const stall = { id: 'stall', kind: 'stall', after: 2, action: { kind: 'repeat' }, appliesTo: 'load' }
  d = call('set_progression_rule',params(d,{ rule: stall, at })); expect(syntheticSlot(full(d).definition).progression).toMatchObject({ rules: ['linear'], onStall: 'stall' })
  d = patch(d,[{ op: 'detachRule', at, ruleId: 'stall' }]); expect(syntheticSlot(full(d).definition).progression.onStall).toBeUndefined()
  expect(full(d).origin).toEqual(initial.origin); expect(full(d).decisions).toEqual(initial.decisions); expect(full(d).definition.source).toEqual(initial.definition.source)
})
test.each([
  { ...rule(), kind: 'execute' }, { ...rule(), increment: 0 }, { ...rule(), script: 'expression' },
  { ...rule(), rounding: undefined }, { ...rule(), id: 'UPPER' },
])('closed rule schema rejects malformed sugar atomically %j', async bad => {
  const d = await create(), before = full(d)
  expect(() => call('set_progression_rule',params(d,{ rule: bad, at }))).toThrow()
  expect(full(d)).toEqual(before)
})
test('unknown references, missing slots, stale revision and two load rules leave complete draft unchanged', async () => {
  const d = call('set_progression_rule',params(await create(),{ rule: rule(), at })), before = full(d)
  for (const ops of [
    [{ op: 'setMetadata', patch: { name: 'Must roll back' } }, { op: 'attachRule', at, ruleId: 'unknown' }],
    [{ op: 'attachRule', at: { ...at, slot: 'missing' }, ruleId: 'linear' }],
    [{ op: 'setProgressionRules', rules: [rule(),rule('second')] }, { op: 'attachRule', at, ruleId: 'second' }],
    [{ op: 'setProgressionRules', rules: [] }],
    [{ op: 'setProgressionRules', rules: [rule(),rule()] }],
  ]) { expect(() => patch(d,ops)).toThrow(); expect(full(d)).toEqual(before) }
  expect(() => call('set_progression_rule',params(d,{ expected_rev: 1, rule: rule() }))).toThrow(/Draft changed/)
  expect(full(d)).toEqual(before)
})
test('draft sugar needs authoring gate before opening a store; no write gate or API token needed for private draft edits', async () => {
  const d = await create(); env.OPENGYM_ENABLE_PROGRAMME_AUTHORING = '0'
  expect(() => call('set_progression_rule',params(d,{ rule: rule(), at }))).toThrow(/AUTHORING/)
  env.OPENGYM_ENABLE_PROGRAMME_AUTHORING = '1'; expect(call('set_progression_rule',params(d,{ rule: rule(), at })).rev).toBe(2)
})
test('new rule attachment creates valid authored instructions for an unfinished slot', async () => {
  const def = syntheticProgramme(); delete syntheticSlot(def).progression
  const d = call('set_progression_rule',params(await create(def),{ rule: rule(), at }))
  expect(syntheticSlot(full(d).definition).progression).toMatchObject({ kind: 'authored', rules: ['linear'] }); expect(d.level).toBe('Ready')
})
test.each(['linear','stall'])('detaching unattached %s preserves absent guidance and Complete conformance', async kind => {
  const def = syntheticProgramme(); delete syntheticSlot(def).progression
  const r = kind === 'linear' ? rule() : { id: 'stall', kind: 'stall', after: 2, action: { kind: 'repeat' }, appliesTo: 'load' }
  let d = await create(def); d = patch(d,[{ op: 'setProgressionRules', rules: [r] }]); const before = full(d)
  d = patch(d,[{ op: 'detachRule', at, ruleId: r.id }])
  expect(syntheticSlot(full(d).definition)).toEqual(syntheticSlot(before.definition)); expect(d.level).toBe('Complete')
  expect(syntheticSlot(full(d).definition).progression).toBeUndefined()
})
test('summary carries slot/set Why with every numeric or athlete-picks load without altering the full result', () => {
  const why: any = { ruleId: 'linear', kind: 'linear', inputs: { increment: 5 }, text: 'Synthetic load explanation.' }
  const result: any = { weeks: [{ index: 1, slots: [{ ref: at, why: [why], sets: [100,null,0].map(load => ({ reps: 5, load, unit: 'lb', why: [why] })) }] }], warnings: [], tm: { bench: [] } }, before = JSON.stringify(result)
  const view = progressionSummary(result); expect(view.weeks[0]!.slots[0]!.sets.map(s => s.load)).toEqual([100,null,0]); expect(view.weeks[0]!.slots[0]!.sets.every(s => s.why[0]!.text === why.text)).toBe(true)
  expect(view.weeks[0]!.slots[0]!.why[0]).toEqual({ ruleId: 'linear', kind: 'linear', text: why.text }); expect(JSON.stringify(result)).toBe(before)
})
test.each([409,422])('progression HTTP %i preserves safe diagnostics and redacts renewed and initial tokens', async status => {
  const initial = 'synthetic-initial-secret', renewed = 'synthetic-renewed-secret'
  const client = new ApiClient({ OPENGYM_URL: 'http://127.0.0.1:1', OPENGYM_UID: 'synthetic', OPENGYM_TOKEN: initial },async url => new Response(JSON.stringify(url.endsWith('/api/me') ? { user: { id: 'synthetic', name: 'Synthetic' }, token: renewed } : { code: status === 409 ? 'REV_CONFLICT' : 'INVALID_RULES', error: initial, state: { token: renewed }, issues: [{ path: '/rule', fix: initial }], warnings: [{ code: 'rounding.large-adjustment', message: renewed }] }),{ status: url.endsWith('/api/me') ? 200 : status }))
  await client.checkProfile(); const e = await client.request('POST','/api/progression/apply',{}).catch(e => e)
  expect(e.status).toBe(status); expect(e.issues[0].path).toBe('/rule'); expect(e.warnings[0].code).toBe('rounding.large-adjustment')
  expect(e.message).not.toContain(initial); expect(e.message).not.toContain(renewed); expect(e.message).not.toContain('"state"'); expect(e.message).not.toContain('"token"')
})
