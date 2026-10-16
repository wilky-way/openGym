import { parse } from '@babel/parser'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, rmSync, readFileSync, writeFileSync, statSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DraftStore, outsideGit } from '../src/draft-store'
import { createAuthoringTools } from '../src/authoring-tools'
import { createTools } from '../src/tools'
import { target } from './http-helpers'
import { syntheticProgramme } from '../../core/test/fixtures/synthetic-programme'
import { createExerciseIndex } from '@opengym/core/exercises'
import { generateDeload } from '../src/draft-ops'
import { progressionProgramme, syntheticRules } from '../../core/test/fixtures/synthetic-progression'

let root:string,env:Record<string,string>,tools:ReturnType<typeof createAuthoringTools>
const at={week:1,day:'d1',session:'main',slot:'bench'}
const call=(name:string,p:any={})=>tools.find(t=>t.name===name)!.handler(p)
const create=()=>call('create_program_draft',{from:'scratch',definition:syntheticProgramme()})
const full=(draft:any)=>call('get_program_draft',{draft_id:draft.draft_id,full:true})
const patch=(d:any,ops:any[])=>call('patch_program_draft',{draft_id:d.draft_id,expected_rev:d.rev,ops})
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'m02-synthetic-'));env={OPENGYM_AUTHORING_DIR:join(root,'authoring'),OPENGYM_ENABLE_PROGRAMME_AUTHORING:'1'};tools=createAuthoringTools({env,now:()=> '2026-10-13T00:00:00.000Z'})})
afterEach(()=>rmSync(root,{recursive:true,force:true}))
test('phase 0 validates, creates, summarizes, lists and deletes with no API config',async()=>{
  expect((await call('validate_program',{definition:syntheticProgramme()})).level).toBe('Ready')
  const d=await create();expect(d.rev).toBe(1);expect(d.level).toBe('Ready');expect(d.definition).toBeUndefined()
  expect(full(d).definition.source.private).toBe(true)
  expect(call('list_program_drafts').drafts).toHaveLength(1)
  expect((await call('validate_program',{draft_id:d.draft_id})).counts.byCode).toEqual({})
  expect(call('delete_program_draft',{draft_id:d.draft_id,expected_rev:1}).deleted).toBe(true)
  expect(()=>full(d)).toThrow('Draft not found')
  expect(statSync(join(root,'authoring','drafts.db')).mode&0o777).toBe(0o600)
})
test('scratch can remain Invalid and ids are stable across edits',async()=>{
  const d=await call('create_program_draft',{from:'scratch',name:'Synthetic scratch',unit:'kg'})
  expect(d.level).toBe('Invalid')
  let next=patch(d,[{op:'addWeek',week:{index:1,days:[{key:'d',sessions:[{routineSnapshot:{ex:[{id:'0025',sets:2,reps:5}]}}]}]}}])
  const a=full(next).definition.weeks[0].days[0].sessions[0]
  expect(a.sessionTemplateId).toMatch(/^session:/);expect(a.routineSnapshot.ex[0].slotId).toMatch(/^slot:/)
  next=patch(next,[{op:'setMetadata',patch:{goal:'Strength'}}])
  expect(full(next).definition.weeks[0].days[0].sessions[0]).toEqual(a)
})
test('all mutations are gated independently of programme writes',async()=>{
  const d=await create();env.OPENGYM_ENABLE_PROGRAMME_AUTHORING='0'
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'New'}}])).toThrow('Enable OPENGYM_ENABLE_PROGRAMME_AUTHORING')
  expect(()=>call('delete_program_draft',{draft_id:d.draft_id,expected_rev:1})).toThrow('Enable OPENGYM_ENABLE_PROGRAMME_AUTHORING')
  expect(full(d).rev).toBe(1)
})
test('transaction rollback and compare-and-swap work across independent SQLite connections',async()=>{
  const d=await create()
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Rollback'}},{op:'removeSlot',at:{...at,slot:'missing'}}])).toThrow('does not exist')
  expect(full(d).definition.name).toBe('Synthetic authored block');expect(full(d).rev).toBe(1)
  const next=patch(d,[{op:'setMetadata',patch:{name:'Winner'}}]);expect(next.rev).toBe(2)
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Stale'}}])).toThrow('current rev is 2')
  expect(()=>call('delete_program_draft',{draft_id:d.draft_id,expected_rev:1})).toThrow('current rev is 2')
})
test('private clone/import remain private and metadata downgrade is atomic',async()=>{
  const d=await create(), clone=await call('create_program_draft',{from:'clone',draft_id:d.draft_id})
  expect(full(clone).definition.id).not.toBe(full(d).definition.id);expect(full(clone).definition.source.private).toBe(true)
  const imported=await call('create_program_draft',{from:'import',format:'json',content:JSON.stringify(syntheticProgramme())})
  expect(full(imported).definition.source.private).toBe(true)
  expect(()=>call('set_program_metadata',{draft_id:d.draft_id,expected_rev:1,patch:{source:{private:false}}})).toThrow('cannot be made public')
  expect(full(d).rev).toBe(1)
  expect(()=>patch(d,[{op:'setMetadata',patch:{source:{private:false}}}])).toThrow('cannot be made public')
})
test('typed sugar preserves identity and requires valid progression and target lengths',async()=>{
  let d=await create()
  d=call('set_slot',{draft_id:d.draft_id,expected_rev:d.rev,at,exercise:{open:true,category:'chest'},prescription:{sets:3,reps:8}})
  d=call('set_slot_targets',{draft_id:d.draft_id,expected_rev:d.rev,at,target:{rir:2},setTargets:[{rir:2},{rir:2},{rir:2}]})
  d=call('set_progression',{draft_id:d.draft_id,expected_rev:d.rev,at,progression:{kind:'linear',instructions:'Add on success',parameters:{successSessions:2,increment:5,unit:'lb'}}})
  const e=full(d).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
  expect(e.slotId).toBe('bench');expect(e.open).toBe(true);expect(e.id).toBeUndefined();expect(e.progression.parameters.increment).toBe(5)
  expect(()=>call('set_slot_targets',{draft_id:d.draft_id,expected_rev:d.rev,at,setTargets:[{rir:2}]})).toThrow('One target')
  expect(()=>call('set_progression',{draft_id:d.draft_id,expected_rev:d.rev,at,progression:{kind:'double',instructions:'x',parameters:{repsLow:10,repsHigh:5,condition:'all-sets',increment:5,unit:'lb',resetTo:5}}})).toThrow()
  expect(()=>call('set_slot',{draft_id:d.draft_id,expected_rev:d.rev,at,prescription:{sets:2,mode:'time'}})).toThrow()
})
test('stable operations add/move/remove slots, sessions and days and retain review evidence',async()=>{
  let d=await create()
  d=patch(d,[{op:'addDay',week:1,day:{key:'d2',sessions:[]}},{op:'addSession',week:1,day:'d2',session:{sessionTemplateId:'s2',routineSnapshot:{ex:[]}}},{op:'addSlot',at:{week:1,day:'d2',session:'s2'},slot:{id:'0025',slotId:'a',sets:1,reps:5}},{op:'addSlot',at:{week:1,day:'d2',session:'s2'},slot:{id:'0025',slotId:'b',sets:1,reps:5},index:0}])
  d=patch(d,[{op:'moveSlot',at:{week:1,day:'d2',session:'s2',slot:'a'},index:0},{op:'setWeek',week:1,patch:{label:'Synthetic edited'}},{op:'setGuidance',at,restSec:120,note:'Synthetic guidance'},{op:'setEndPlan',endPlan:{kind:'stop',instructions:'Review'}},{op:'acknowledgeReview',decision:{code:'review.unresolved',location:{week:1},decision:'Reviewed',evidence:'Synthetic author source'}}])
  expect(full(d).definition.weeks[0].days[1].sessions[0].routineSnapshot.ex.map((e:any)=>e.slotId)).toEqual(['a','b'])
  expect(full(d).decisions[0].evidence).toBe('Synthetic author source')
  d=patch(d,[{op:'removeSlot',at:{week:1,day:'d2',session:'s2',slot:'a'}},{op:'removeSession',week:1,day:'d2',session:'s2'},{op:'removeDay',week:1,day:'d2'}])
  expect(full(d).definition.weeks[0].days).toHaveLength(1)
})
test('repeat is concrete, retention choices required, and budgets are checked before allocation',async()=>{
  const d=await create(),p={draft_id:d.draft_id,expected_rev:1,fromWeek:1,copies:2,keep:{targets:false,rules:false}}
  const next=call('repeat_week',p),weeks=full(next).definition.weeks
  expect(weeks.map((w:any)=>w.index)).toEqual([1,2,3]);expect(weeks[1].days[0].sessions[0].routineSnapshot.ex[0].target).toBeUndefined();expect(weeks[1].days[0].sessions[0].routineSnapshot.ex[0].progression).toBeUndefined()
  expect(()=>call('repeat_week',{draft_id:d.draft_id,expected_rev:next.rev,fromWeek:1,copies:63,keep:{targets:true,rules:true}})).toThrow('At most 64')
  expect(()=>call('repeat_week',{draft_id:d.draft_id,expected_rev:next.rev,fromWeek:1,copies:1})).toThrow()
  const removed=patch(next,[{op:'removeWeek',week:2}]);expect(full(removed).definition.weeks.map((w:any)=>w.index)).toEqual([1,2])
})
test('deload preview writes nothing, confirm inserts once, no numeric policy is invented',async()=>{
  const def=syntheticProgramme();def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight=100
  const d=await call('create_program_draft',{from:'scratch',definition:def}),params={draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}}
  const preview=call('generate_deload',params);expect(preview.applied).toBe(false);expect(preview.preview.mode).toBe('deload');expect(preview.preview.deload.authored).toBe(true)
  expect(full(d).rev).toBe(1);expect(full(d).definition.weeks).toHaveLength(1)
  const next=call('generate_deload',{...params,confirm:true}),slot=full(next).definition.weeks[1].days[0].sessions[0].routineSnapshot.ex[0]
  expect(next.rev).toBe(2);expect(slot.sets).toBe(1);expect(slot.weight).toBe(70);expect(slot.target).toEqual({rir:4});expect(slot.progression.kind).toBe('none')
  expect(()=>call('generate_deload',{...params,expected_rev:2,policy:{kind:'factor',fromWeek:1,setsFactor:.5,effort:{rir:4}}})).toThrow()
  expect(()=>call('generate_deload',{...params,expected_rev:2,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{}}})).toThrow()
})
test('custom assistance deload raises assistance through the explicit index',()=>{
  const def=syntheticProgramme(),e=def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];e.id='c-help';e.weight=100
  const d:any={definition:def},index=createExerciseIndex([{id:'c-help',n:'Synthetic assistance',eq:'leverage machine',bp:'chest',assisted:true}])
  const w=generateDeload(d,{afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}},index)
  expect(w.days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(130)
})
test('repository paths, worktree git files, symlink aliases and case variants are refused before writes',()=>{
  const repo=join(root,'Repo');mkdirSync(repo);writeFileSync(join(repo,'.git'),'gitdir: /synthetic')
  symlinkSync(repo,join(root,'alias'))
  for(const dir of [join(repo,'new','drafts'),join(root,'alias','drafts'),join(root,'repo','drafts')])expect(()=>new DraftStore(dir)).toThrow('outside every git')
  expect(existsSync(join(repo,'new'))).toBe(false)
  const inner=join(repo,'external');symlinkSync(root,inner)
  expect(()=>new DraftStore(join(inner,'escaped'))).toThrow('outside every git')
  const upper=join(root,'upper');mkdirSync(upper);mkdirSync(join(upper,'.GIT'));expect(()=>outsideGit(join(upper,'child'))).toThrow()
})
test('database symlinks and hard links cannot redirect drafts into a repository',()=>{
  const safe=join(root,'safe');mkdirSync(safe);const file=join(root,'existing');writeFileSync(file,'Synthetic')
  symlinkSync(file,join(safe,'drafts.db'));expect(()=>new DraftStore(safe)).toThrow('regular, unlinked');expect(readFileSync(file,'utf8')).toBe('Synthetic')
  rmSync(join(safe,'drafts.db'));linkSync(file,join(safe,'drafts.db'));expect(()=>new DraftStore(safe)).toThrow('regular, unlinked')
})
test('draft-count and byte caps refuse writes atomically',()=>{
  const s=new DraftStore(join(root,'caps'),()=> '2026-10-13T00:00:00.000Z')
  try {for(let i=0;i<50;i++)s.create({definition:syntheticProgramme(),origin:{kind:'scratch'}})
    expect(()=>s.create({definition:syntheticProgramme(),origin:{kind:'scratch'}})).toThrow('At most 50');expect(s.list()).toHaveLength(50)
    const d=s.list()[0]!;expect(()=>s.edit(d.draftId,1,d=>d.definition.note='x'.repeat(5*1024*1024))).toThrow('5 MiB');expect(s.get(d.draftId).rev).toBe(1)
  }finally{s.close()}
})
test('HTTP programme validation and clone preserve custom lookup; authoring never changes state rev',async()=>{
  const custom=[{id:'c-synthetic',n:'Synthetic assistance',eq:'leverage machine',bp:'chest',assisted:true}],def=syntheticProgramme();def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id=custom[0]!.id;def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight=100
  const api=await target({_rev:7,_wid:'synthetic-epoch',customEx:custom,programmes:{definitions:[def],cycles:[]},routines:[],workouts:[]})
  try {
    tools=createTools({env:{...env,...api.env},fetcher:api.fetcher})
    const before=await api.request('GET','/api/data')
    expect((await call('validate_program',{programme_id:'synthetic'})).level).toBe('Ready')
    const d=await call('create_program_draft',{from:'clone',programme_id:'synthetic'});expect(d.level).toBe('Ready')
    const p=patch(d,[{op:'setMetadata',patch:{name:'Synthetic changed'}}]);expect(p.rev).toBe(2)
    const candidate=call('generate_deload',{draft_id:d.draft_id,expected_rev:2,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}})
    expect(candidate.preview.days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(130)
    const deload=call('generate_deload',{draft_id:d.draft_id,expected_rev:2,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}},confirm:true})
    expect(deload.preview.days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(130)
    call('delete_program_draft',{draft_id:d.draft_id,expected_rev:3})
    expect((await api.request('GET','/api/data')).body).toEqual(before.body)
    expect(api.calls.every(c=>c.method==='GET')).toBe(true)
    expect(()=>call('validate_program',{programme_id:'../invalid'})).toThrow()
  }finally{await api.close()}
})

test('validate_program surfaces binding progression composition issues without mutation',async()=>{
  for(const [code,change] of [
    ['rule.two-volume-ramps',(d:any)=>{d.progressionRules=[syntheticRules()[7],{...syntheticRules()[7],id:'ramp-two'}];d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.rules=['ramp','ramp-two']}],
    ['rule.multiple-amrap-bumps',(d:any)=>{d.progressionRules.push(syntheticRules()[4],{...syntheticRules()[4],id:'amrap-two'})}],
    ['rule.amrap-source-not-amrap',(d:any)=>{d.progressionRules=[syntheticRules()[4]];d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.rules=[]}],
    ['rule.tm-stall-without-key',(d:any)=>{d.progressionRules=[syntheticRules()[3],{...syntheticRules()[5],appliesTo:'tm'}];const e=d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];e.progression.rules=['linear'];e.progression.onStall='stall'}],
  ] as [string,(d:any)=>void][]) {
    const def=progressionProgramme();change(def);const before=JSON.stringify(def)
    const result=await call('validate_program',{definition:def})
    expect(result.issues.map((i:any)=>i.code)).toContain(code);expect(result.level).not.toBe('Ready');expect(JSON.stringify(def)).toBe(before)
  }
})
test('library import retains unresolved exercises and source script review issues as personal drafts',async()=>{
  const content={schema:'opengym-library/1',id:'synthetic-library',name:'Synthetic library',unit:'lb',length_weeks:1,source:{name:'Synthetic'},rules:{progression_scripts:['throw new Error("must not run")']},weeks:[{n:'1',days:[{n:1,name:'Upper',exercises:[{slot:'1',name:'Unknown synthetic lift',parsed:true,sets:[{count:2,reps:5,rpe:8}]}]}]}]}
  const draft=await call('create_program_draft',{from:'import',format:'library',content})
  expect(draft.issues.length).toBeGreaterThan(0);expect(draft.level).not.toBe('Ready');expect(full(draft).definition.source.private).toBe(true)
})
test('explicit deload preserves author prescriptions and summary output is capped',async()=>{
  const d=await create(),w=structuredClone(syntheticProgramme().weeks[0]);w.days[0].sessions[0].routineSnapshot.ex[0].sets=1
  const preview=call('generate_deload',{draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy:{kind:'explicit',week:w}})
  expect(preview.preview.days[0].sessions[0].routineSnapshot.ex[0].sets).toBe(1);expect(preview.preview.deload).toEqual({authored:true});expect(full(d).rev).toBe(1)
  const def=syntheticProgramme();def.weeks=Array.from({length:64},(_,i)=>({...structuredClone(def.weeks[0]),index:i+1,label:'Synthetic label '.repeat(100)}));def.lengthWeeks=64
  const large=await call('create_program_draft',{from:'scratch',definition:def})
  expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThanOrEqual(64*1024);expect(large.truncated).toBe(true)
})

test('safe authoring directories with several missing ancestor levels are created',async()=>{
  env.OPENGYM_AUTHORING_DIR=join(root,'first','second','authoring')
  const d=await create();expect(d.rev).toBe(1);expect(existsSync(join(env.OPENGYM_AUTHORING_DIR,'drafts.db'))).toBe(true)
})
test('preview summary describes the stored revision while preview describes the candidate',async()=>{
  const d=await create(),before=full(d)
  const result=call('generate_deload',{draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}})
  expect(result.summary.weeks).toHaveLength(1);expect(result.level).toBe(before.level);expect(result.rev).toBe(1);expect(result.preview.index).toBe(2)
  expect(full(d)).toEqual(before)
})
test.each([false,true])('numeric-string deload seeds are scaled, assisted=%s',async assisted=>{
  const def=syntheticProgramme(),e=def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];e.weight='100'
  const d:any={definition:def}
  if(assisted)e.id='custom-help'
  const w=generateDeload(d,{afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}},createExerciseIndex(assisted?[{id:'custom-help',n:'Synthetic helper',bp:'chest',eq:'leverage machine',assisted:true}]:[]))
  expect(w.days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(assisted?130:70)
})
test('preserved long day/session/slot identities remain addressable through typed ops',async()=>{
  const def=syntheticProgramme(),day=def.weeks[0].days[0];day.key='d'.repeat(129);day.sessions[0].sessionTemplateId='s'.repeat(129);day.sessions[0].routineSnapshot.ex[0].slotId='e'.repeat(129)
  const d=await call('create_program_draft',{from:'scratch',definition:def})
  const next=call('set_slot_targets',{draft_id:d.draft_id,expected_rev:1,at:{week:1,day:day.key,session:day.sessions[0].sessionTemplateId,slot:day.sessions[0].routineSnapshot.ex[0].slotId},target:{rir:3}})
  expect(full(next).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].target).toEqual({rir:3})
})
test('large deload preview and confirm responses are capped unless full is explicit',async()=>{
  const def=syntheticProgramme(),s=def.weeks[0].days[0].sessions[0],e=s.routineSnapshot.ex[0];s.routineSnapshot.ex=Array.from({length:100},(_,i)=>({...structuredClone(e),slotId:'slot-'+i,note:'Synthetic guidance '.repeat(100)}))
  const d=await call('create_program_draft',{from:'scratch',definition:def}),p={draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}}
  const small=call('generate_deload',p);expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(64*1024);expect(small.preview.truncated).toBe(true)
  expect(call('generate_deload',{...p,full:true}).preview.days[0].sessions[0].routineSnapshot.ex).toHaveLength(100)
  const saved=call('generate_deload',{...p,confirm:true});expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThanOrEqual(64*1024);expect(saved.preview.truncated).toBe(true)
})

test('inert conformance/import index edges retain explicit forwarding in the authoring module',()=>{
  // Conformance can reconstruct exactly the same index from the explicitly supplied catalogue.
  // Local imports have only the catalogue (no profile transport or custom exercise context).
  const ast=parse(readFileSync(new URL('../src/authoring-tools.ts',import.meta.url),'utf8'),{sourceType:'module',plugins:['typescript']})
  const calls:any[]=[]
  const walk=(node:any)=>{if(!node || typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return}if(node.type==='CallExpression' && ['programmeConformance','importProgramme'].includes(node.callee?.name))calls.push(node);for(const [k,v] of Object.entries(node))if(!['loc','start','end'].includes(k))walk(v)}
  walk(ast);expect(calls).toHaveLength(2)
  for(const call of calls)expect(call.arguments.at(-1)?.callee?.name).toBe('createExerciseIndex')
})


test('Invalid conformance drafts are explicitly permitted by PROGRAM-API but malformed batches roll back',async()=>{
  const d=await create(),before=full(d)
  const invalid=patch(d,[{op:'setSlotExercise',at,exercise:{id:'synthetic-unknown'}}])
  expect(invalid.level).toBe('Invalid');expect(full(invalid).rev).toBe(2)
  expect(()=>patch(invalid,[{op:'setMetadata',patch:{name:'Must roll back'}},{op:'setPrescription',at,sets:2,reps:5,repsMin:6}])).toThrow('Invalid repsMin')
  expect(full(invalid).definition.name).toBe(before.definition.name);expect(full(invalid).rev).toBe(2)
})
test.each(['pyramidWeight','setTargets','tm'])('inconsistent retained %s rejects the whole patch atomically',async field=>{
  const def=syntheticProgramme(),e=def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
  e.pyramid=[5,5];e.pyramidWeight=[100,100];e.setTargets=[{rir:2},{rir:2}];e.tm={key:'bench',percentages:[.7,.7],reference:'tm'}
  for(const k of ['pyramidWeight','setTargets','tm'])if(k!==field)delete e[k]
  const d=await call('create_program_draft',{from:'scratch',definition:def}),before=full(d)
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Must roll back'}},{op:'setPrescription',at,sets:1,pyramid:[5]}])).toThrow('nothing was written')
  expect(full(d)).toEqual(before)
})
test('new slots with contradictory per-set arrays also roll back the entire patch',async()=>{
  const d=await create(),before=full(d)
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Must roll back'}},{op:'addSlot',at:{week:1,day:'d1',session:'main'},slot:{id:'0025',sets:2,pyramid:[5,5],pyramidWeight:[100]}}])).toThrow('nothing was written')
  expect(full(d)).toEqual(before)
})
test('an atomic batch may resize a prescription and its per-set targets together',async()=>{
  const d=await create(),withTargets=call('set_slot_targets',{draft_id:d.draft_id,expected_rev:1,at,setTargets:[{rir:2},{rir:2}]})
  const next=patch(withTargets,[{op:'setPrescription',at,sets:1,reps:5},{op:'setTargets',at,setTargets:[{rir:3}]}])
  expect(next.rev).toBe(3);expect(next.level).toBe('Ready')
  expect(full(next).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets).toEqual([{rir:3}])
})
test.each([{kind:'factor',lastWeek:2},{kind:'explicit',lastWeek:2},{kind:'factor',lastWeek:3},{kind:'explicit',lastWeek:3}])('deload insertion remaps percentage and AMRAP refs Ready to Ready: $kind/$lastWeek',async ({kind,lastWeek})=>{
  const def=progressionProgramme(),second=structuredClone(def.weeks[0]);second.index=lastWeek
  second.days[0].sessions[0].routineSnapshot.ex[0].sets=3
  def.weeks.push(second);def.lengthWeeks=2
  def.progressionRules[0].weeks[String(lastWeek)]=[{pct:.6,reps:5},{pct:.7,reps:5},{pct:.8,reps:'amrap',repsMin:5}]
  const amrap=syntheticRules()[4] as any;amrap.source.slot.week=lastWeek;amrap.source.set=2;def.progressionRules.push(amrap)
  const d=await call('create_program_draft',{from:'scratch',definition:def});expect(d.level).toBe('Ready')
  const explicit=structuredClone(syntheticProgramme().weeks[0])
  const policy=kind==='factor'?{kind,fromWeek:lastWeek,setsFactor:.5,loadFactor:.7,effort:{rir:4}}:{kind,week:explicit}
  const params={draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy}
  const preview=call('generate_deload',params);expect(preview.applied).toBe(false);expect(full(d).rev).toBe(1)
  const candidate=structuredClone(full(d));generateDeload(candidate,{afterWeek:1,policy})
  expect((await call('validate_program',{definition:candidate.definition})).level).toBe('Ready')
  const next=call('generate_deload',{...params,confirm:true}),stored=full(next).definition
  expect(next.level).toBe('Ready');expect(next.issues).toEqual([])
  expect(stored.progressionRules[0].weeks['2']).toBeUndefined();expect(stored.progressionRules[0].weeks['3']).toHaveLength(3)
  expect(stored.progressionRules[1].source.slot.week).toBe(3)
  expect(stored.weeks[1]).toEqual(preview.preview)
})
test('deload remaps rpe tables, schedules, ramp scopes and legacy percentage week tables',()=>{
  const def=syntheticProgramme();def.weeks.push({...structuredClone(def.weeks[0]),index:2});def.lengthWeeks=2
  def.progressionRules=[syntheticRules()[1],syntheticRules()[6],syntheticRules()[7]]
  def.progressionRules[0].weeks['2']=[{reps:5,rpe:8}]
  def.progressionRules[1].weeks=[2];def.progressionRules[2].weeks=[2];def.progressionRules[2].scope.slots[0].week=2
  def.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].progression={kind:'percentage',instructions:'Authored percentages',parameters:{reference:'tm',byWeek:{'1':[.7],'2':[.8],'*':[.6]}}}
  generateDeload({definition:def} as any,{afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}})
  expect(def.progressionRules[0].weeks).toHaveProperty('3');expect(def.progressionRules[0].weeks).toHaveProperty('*')
  expect(def.progressionRules[1].weeks).toEqual([3]);expect(def.progressionRules[2].weeks).toEqual([3]);expect(def.progressionRules[2].scope.slots[0].week).toBe(3)
  expect(def.weeks[2].days[0].sessions[0].routineSnapshot.ex[0].progression.parameters.byWeek).toEqual({'1':[.7],'3':[.8],'*':[.6]})
})


test.each(['addSlot','addSession','addDay','addWeek'])('malformed prescription insertion %s rejects atomically',async op=>{
  const d=await create(),before=full(d),slot={id:'0025',sets:2,reps:5,repsMin:6},session={routineSnapshot:{ex:[slot]}},day={key:'new',sessions:[session]}
  const insertion=op==='addSlot'?{op,at:{week:1,day:'d1',session:'main'},slot}:op==='addSession'?{op,week:1,day:'d1',session}:op==='addDay'?{op,week:1,day}:{op,week:{index:2,days:[day]}}
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Must roll back'}},insertion])).toThrow('Invalid repsMin')
  expect(full(d)).toEqual(before)
})
test.each([{pyramidWeight:[-10,20]},{pyramidWeight:['not a load',20]},{tm:{key:'bench',percentages:[0,.7]}},{tm:{key:'bench',percentages:'wrong'}}])('malformed per-set load insertion rejects atomically: %j',async fields=>{
  const d=await create(),before=full(d)
  expect(()=>patch(d,[{op:'setMetadata',patch:{name:'Must roll back'}},{op:'addSlot',at:{week:1,day:'d1',session:'main'},slot:{id:'0025',sets:2,pyramid:[5,5],...fields}}])).toThrow('Invalid per-set')
  expect(full(d)).toEqual(before)
})
test.each([null,{id:'unfinished',kind:'percentage'},{id:'unfinished',kind:'volume-ramp',weeks:null,scope:{slots:[null]}}])('unfinished Invalid rule data survives deload preview and confirm: %j',async rule=>{
  const def=syntheticProgramme();def.progressionRules=[rule]
  const d=await call('create_program_draft',{from:'scratch',definition:def}),p={draft_id:d.draft_id,expected_rev:1,afterWeek:1,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}}
  expect(call('generate_deload',p).applied).toBe(false);expect(full(d).rev).toBe(1)
  const next=call('generate_deload',{...p,confirm:true})
  expect(next.rev).toBe(2);expect(full(next).definition.progressionRules).toEqual([rule]);expect(next.level).not.toBe('Ready')
})
test.each([{kind:'rule',lastWeek:2,afterWeek:1,unknown:3},{kind:'legacy',lastWeek:2,afterWeek:1,unknown:3},{kind:'rule',lastWeek:3,afterWeek:3,unknown:2},{kind:'legacy',lastWeek:3,afterWeek:3,unknown:2}])('colliding $kind week tables reject preview and confirmation atomically ($lastWeek/$afterWeek)',async ({kind,lastWeek,afterWeek,unknown})=>{
  const def=syntheticProgramme();def.weeks.push({...structuredClone(def.weeks[0]),index:lastWeek});def.lengthWeeks=2
  const table={'1':[.7,.7],[String(lastWeek)]:[.8,.8],[String(unknown)]:[.9,.9]}
  if(kind==='rule')def.progressionRules=[{...syntheticRules()[0],weeks:Object.fromEntries(Object.entries(table).map(([k,values])=>[k,values.map(pct=>({pct,reps:5}))]))}]
  else def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression={kind:'percentage',instructions:'Unfinished table',parameters:{reference:'tm',byWeek:table}}
  const d=await call('create_program_draft',{from:'scratch',definition:def}),before=full(d)
  const p={draft_id:d.draft_id,expected_rev:1,afterWeek,policy:{kind:'factor',fromWeek:1,setsFactor:.5,loadFactor:.7,effort:{rir:4}}}
  for(const confirm of [false,true])expect(()=>call('generate_deload',{...p,confirm})).toThrow('would overwrite an existing prescription')
  expect(full(d)).toEqual(before)
})
