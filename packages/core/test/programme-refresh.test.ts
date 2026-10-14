import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import {it,expect} from 'vitest'
import {refreshProgrammeDefinitions} from '../src/programme-refresh'
import {importProgramme} from '../src/programme-import'
import {improveProgrammeDefinition} from '../src/programme-quality'
const raw: LegacyFixture=(id: LegacyFixture)=>({id,name:'Synthetic refresh',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:3,reps:5,rpe:8}]}]}]}]})
it('refreshes matching inactive ids and adds pending definitions without touching active state',()=>{
 const S: LegacyFixture={unit:'lb',programmes:{definitions:[{id:'active',name:'Keep'},{id:'paused',name:'Keep paused'},{id:'inactive',name:'Old'}],cycles:[{id:'c',programmeId:'active',status:'active',snapshot:{keep:true}},{id:'p',programmeId:'paused',status:'paused'}]},routines:[{id:'r',ex:[{id:'0025'}]}],queue:{ids:['r']},workouts:[{id:'w'}],active:{id:'in-flight'}}
 const result: LegacyFixture=refreshProgrammeDefinitions(S,['active','paused','inactive','pending'].map((id: LegacyFixture)=>({raw:raw(id),filename:id+'.json'})))
 expect(result.report).toMatchObject({protected:['active','paused'],updated:['inactive'],added:['pending']});expect(result.state.programmes.definitions.find((d: LegacyFixture)=>d.id==='inactive').name).toBe('Synthetic refresh')
 for (const key of ['routines','queue','workouts','active']) expect(result.state[key]).toEqual(S[key]);expect(result.state.programmes.cycles).toEqual(S.programmes.cycles);expect(S.programmes.definitions[2].name).toBe('Old')
})
it('reports unresolved files, skips the flagged index, and does not replace them',()=>{
 const bad: LegacyFixture=raw('bad');bad.weeks[0].days[0].exercises[0].id='missing';const S: LegacyFixture={programmes:{definitions:[{id:'bad',name:'Keep'}]}}
 const result: LegacyFixture=refreshProgrammeDefinitions(S,[{raw:bad,filename:'bad.json'},{raw:[],filename:'pub-_flagged.json'}]);expect(result.report.needsReview).toHaveLength(1);expect(result.report.skipped).toEqual(['pub-_flagged.json']);expect(result.state).toEqual(S)
})
it('the offline CLI preserves its input and writes a separate reviewed export',()=>{
 const original: LegacyFixture={data:{unit:'lb',routines:[],workouts:[],queue:{ids:[]}}},before: LegacyFixture=structuredClone(original)
 const result: LegacyFixture=refreshProgrammeDefinitions(original.data,[{raw:raw('synthetic'),filename:'synthetic.json'}])
 const prepared: LegacyFixture={...original,data:result.state}
 expect(result.report.added).toEqual(['synthetic']);expect(original).toEqual(before)
 expect(prepared.data.programmes.definitions[0].id).toBe('synthetic');expect(prepared.data).not.toBe(original.data)
})
it('repairs state-only exports and protects active snapshots, paused definitions and a running workout archive',()=>{
 const imported: LegacyFixture=(id: LegacyFixture)=>importProgramme(raw(id)).definition
 const S: LegacyFixture={routines:[],workouts:[],customEx:[],programmes:{definitions:['active','paused','running','inactive'].map(imported),cycles:[{id:'a',programmeId:'active',status:'active',snapshot:imported('active')},{id:'p',programmeId:'paused',status:'paused'},{id:'r',programmeId:'running',status:'archived'}]},active:{programmeInstance:{cycleId:'r'}}}
 const old: LegacyFixture=structuredClone(S),result: LegacyFixture=refreshProgrammeDefinitions(S,[],{repair:true})
 expect(result.report.protected).toEqual(['active','paused','running']);expect(result.report.updated).toEqual(['inactive']);expect(result.state.programmes.definitions.find((d: LegacyFixture)=>d.id==='inactive')).toMatchObject({lengthWeeks:1,daysPerWeek:1,equipment:['barbell']})
 for (const id of result.report.protected)expect(result.state.programmes.definitions.find((d: LegacyFixture)=>d.id===id)).toEqual(old.programmes.definitions.find((d: LegacyFixture)=>d.id===id))
 expect(result.state.programmes.cycles).toEqual(old.programmes.cycles);expect(S).toEqual(old)
})
it('retains a higher-quality saved definition when a source candidate regresses',()=>{
 const prior: LegacyFixture=importProgramme(raw('keep')).definition;prior.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].role='accessory'
 const bad: LegacyFixture=raw('keep');delete bad.weeks[0].days[0].exercises[0].sets[0].rpe
 const result: LegacyFixture=refreshProgrammeDefinitions({programmes:{definitions:[prior],cycles:[]}} as LegacyFixture,[{raw:bad,filename:'keep.json'}])
 expect(result.report.needsReview[0].reason).toContain('lower conformance');expect(result.report.conformance[0].after).toBe('Complete')
})
it('the CLI handles API state envelopes, retains revision, and refuses existing destinations',()=>{
 const original: LegacyFixture={state:{programmes:{definitions:[importProgramme(raw('synth')).definition],cycles:[]},workouts:[]},rev:42},before: LegacyFixture=structuredClone(original)
 const result: LegacyFixture=refreshProgrammeDefinitions(original.state,[],{repair:true}),prepared: LegacyFixture={...original,state:result.state}
 expect(result.report.conformance).toHaveLength(1);expect(prepared.rev).toBe(42)
 expect(prepared.state.programmes!.definitions[0]!.lengthWeeks).toBe(1);expect(original).toEqual(before)
 expect(result.state).not.toBe(original.state);expect(result.report.updated).toEqual(['synth'])
})
it('fails closed on duplicate sources rather than choosing whichever file appeared last',()=>{
 const d: LegacyFixture=importProgramme(raw('dup')).definition;const sources: LegacyFixture=[raw('dup'),raw('dup')];sources[0].weeks[0].days[0].exercises[0].role='main';sources[1].weeks[0].days[0].exercises[0].role='accessory'
 const result: LegacyFixture=refreshProgrammeDefinitions({programmes:{definitions:[d],cycles:[]}} as LegacyFixture,sources.map((raw: LegacyFixture,i: LegacyFixture)=>({raw,filename:`dup-${i}.json`})))
 expect(result.report.needsReview).toHaveLength(1);expect(result.report.needsReview[0].reason).toContain('no source chosen');expect(result.state.programmes!.definitions[0]!.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].role).toBeUndefined()
})

const imported: LegacyFixture=(id: LegacyFixture)=>importProgramme(raw(id)).definition
it('protects the definition a snapshot names even when programmeId differs or is missing',()=>{
 for (const cycle of [{id:'c',programmeId:'other',status:'active',snapshot:{...imported('saved')}},{id:'c',status:'paused',snapshot:{...imported('saved')}},{id:'c',programmeId:'other',status:'archived',snapshot:{...imported('saved')}}]) {
  const saved: LegacyFixture=imported('saved');delete saved.lengthWeeks
  const S: LegacyFixture={routines:[{id:'r',programme:{cycleId:'c'}}],workouts:[],programmes:{definitions:[saved,imported('other')],cycles:[cycle]},active:cycle.status==='archived'?{programmeInstance:{cycleId:'c'}}:undefined}
  const old: LegacyFixture=structuredClone(S),result: LegacyFixture=refreshProgrammeDefinitions(S,[{raw:raw('saved'),filename:'saved.json'}],{repair:true})
  expect(result.report.protected,cycle.status).toContain('saved');expect(result.state.programmes.definitions.find((d: LegacyFixture)=>d.id==='saved')).toEqual(old.programmes.definitions[0]);expect(result.report.updated).not.toContain('saved')
 }
})
it('reports a protected id that only appears in an input file',()=>{
 const S: LegacyFixture={programmes:{definitions:[],cycles:[{id:'c',programmeId:'file-only',status:'active',snapshot:{id:'file-only'}}]}}
 const result: LegacyFixture=refreshProgrammeDefinitions(S,[{raw:raw('file-only'),filename:'f.json'}]);expect(result.report.protected).toEqual(['file-only']);expect(result.report.added).toEqual([])
})
it('does not repair stored definitions unless repair is requested',()=>{
 const d: LegacyFixture=importProgramme(raw('mine')).definition;delete d.lengthWeeks
 const S: LegacyFixture={programmes:{definitions:[d],cycles:[]}}
 expect(refreshProgrammeDefinitions(S).report.updated).toEqual([]);expect(refreshProgrammeDefinitions(S,[],{repair:true}).report.updated).toEqual(['mine'])
})
it('does not recover from the first of two source weeks with the same number',()=>{
 const src: LegacyFixture=raw('dupweek');src.weeks[0].days[0].exercises[0].slot='1';const slotOf: LegacyFixture=(x: LegacyFixture)=>x.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 const stored: LegacyFixture=importProgramme(src).definition;delete slotOf(stored).setTargets;delete slotOf(stored).target;delete slotOf(stored).sourcePrescription
 // Control: one source week recovers the authored effort.
 expect(slotOf(improveProgrammeDefinition(stored,{sourceRaw:src}).definition).setTargets).toEqual([{rpe:8},{rpe:8},{rpe:8}])
 const dup: LegacyFixture=structuredClone(src);dup.weeks.push(structuredClone(dup.weeks[0]));dup.weeks[0].days[0].exercises[0].sets[0].rpe=3
 expect(JSON.stringify(improveProgrammeDefinition(stored,{sourceRaw:dup}).definition)).not.toContain('"rpe":3')
 expect(()=>importProgramme(dup)).toThrow()
 const out: LegacyFixture=refreshProgrammeDefinitions({programmes:{definitions:[stored],cycles:[]}} as LegacyFixture,[{raw:dup,filename:'d.json'}],{repair:true}).state.programmes!.definitions[0]!
 expect(JSON.stringify(out)).not.toContain('"rpe":3')
})
