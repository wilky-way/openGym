import {it,expect} from 'vitest'
import {refreshProgrammeDefinitions} from './programme-refresh.js'
import {importProgramme} from './programme-import.js'
import {improveProgrammeDefinition} from './programme-quality.js'
const raw=id=>({id,name:'Synthetic refresh',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:3,reps:5,rpe:8}]}]}]}]})
it('refreshes matching inactive ids and adds pending definitions without touching active state',()=>{
 const S={unit:'lb',programmes:{definitions:[{id:'active',name:'Keep'},{id:'paused',name:'Keep paused'},{id:'inactive',name:'Old'}],cycles:[{id:'c',programmeId:'active',status:'active',snapshot:{keep:true}},{id:'p',programmeId:'paused',status:'paused'}]},routines:[{id:'r',ex:[{id:'0025'}]}],queue:{ids:['r']},workouts:[{id:'w'}],active:{id:'in-flight'}}
 const result=refreshProgrammeDefinitions(S,['active','paused','inactive','pending'].map(id=>({raw:raw(id),filename:id+'.json'})))
 expect(result.report).toMatchObject({protected:['active','paused'],updated:['inactive'],added:['pending']});expect(result.state.programmes.definitions.find(d=>d.id==='inactive').name).toBe('Synthetic refresh')
 for(const key of ['routines','queue','workouts','active']) expect(result.state[key]).toEqual(S[key]);expect(result.state.programmes.cycles).toEqual(S.programmes.cycles);expect(S.programmes.definitions[2].name).toBe('Old')
})
it('reports unresolved files, skips the flagged index, and does not replace them',()=>{
 const bad=raw('bad');bad.weeks[0].days[0].exercises[0].id='missing';const S={programmes:{definitions:[{id:'bad',name:'Keep'}]}}
 const result=refreshProgrammeDefinitions(S,[{raw:bad,filename:'bad.json'},{raw:[],filename:'pub-_flagged.json'}]);expect(result.report.needsReview).toHaveLength(1);expect(result.report.skipped).toEqual(['pub-_flagged.json']);expect(result.state).toEqual(S)
})
it('the offline CLI preserves its input and writes a separate reviewed export',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{execFileSync}=await import('node:child_process')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-refresh-'))
 try {
  fs.mkdirSync(path.join(dir,'library'));fs.writeFileSync(path.join(dir,'library','synthetic.json'),JSON.stringify(raw('synthetic')))
  const input=path.join(dir,'input.json'),output=path.join(dir,'new.json'),original={data:{unit:'lb',routines:[],workouts:[],queue:{ids:[]}}};fs.writeFileSync(input,JSON.stringify(original))
  const script=new URL('../../../scripts/programmes/refresh-library.mjs',import.meta.url)
  const report=JSON.parse(execFileSync(process.execPath,[script.pathname,'--state',input,'--library',path.join(dir,'library'),'--out',output],{encoding:'utf8'}));expect(report.added).toEqual(['synthetic']);expect(JSON.parse(fs.readFileSync(input))).toEqual(original)
  expect(JSON.parse(fs.readFileSync(output)).data.programmes.definitions[0].id).toBe('synthetic')
  expect(()=>execFileSync(process.execPath,[script.pathname,'--state',input,'--library',path.join(dir,'library'),'--out',input],{stdio:'pipe'})).toThrow()
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
it('repairs state-only exports and protects active snapshots, paused definitions and a running workout archive',()=>{
 const imported=id=>importProgramme(raw(id)).definition
 const S={routines:[],workouts:[],customEx:[],programmes:{definitions:['active','paused','running','inactive'].map(imported),cycles:[{id:'a',programmeId:'active',status:'active',snapshot:imported('active')},{id:'p',programmeId:'paused',status:'paused'},{id:'r',programmeId:'running',status:'archived'}]},active:{programmeInstance:{cycleId:'r'}}}
 const old=structuredClone(S),result=refreshProgrammeDefinitions(S,[],{repair:true})
 expect(result.report.protected).toEqual(['active','paused','running']);expect(result.report.updated).toEqual(['inactive']);expect(result.state.programmes.definitions.find(d=>d.id==='inactive')).toMatchObject({lengthWeeks:1,daysPerWeek:1,equipment:['barbell']})
 for(const id of result.report.protected)expect(result.state.programmes.definitions.find(d=>d.id===id)).toEqual(old.programmes.definitions.find(d=>d.id===id))
 expect(result.state.programmes.cycles).toEqual(old.programmes.cycles);expect(S).toEqual(old)
})
it('retains a higher-quality saved definition when a source candidate regresses',()=>{
 const prior=importProgramme(raw('keep')).definition;prior.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].role='accessory'
 const bad=raw('keep');delete bad.weeks[0].days[0].exercises[0].sets[0].rpe
 const result=refreshProgrammeDefinitions({programmes:{definitions:[prior],cycles:[]}},[{raw:bad,filename:'keep.json'}])
 expect(result.report.needsReview[0].reason).toContain('lower conformance');expect(result.report.conformance[0].after).toBe('Complete')
})
it('the CLI handles API state envelopes, retains revision, and refuses existing destinations',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{execFileSync}=await import('node:child_process')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-model-'))
 try {
  const original={state:{programmes:{definitions:[importProgramme(raw('synth')).definition],cycles:[]},workouts:[]},rev:42}
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.json');fs.writeFileSync(input,JSON.stringify(original))
  const args=[new URL('../../../scripts/programmes/refresh-library.mjs',import.meta.url).pathname,'--state',input,'--out',output,'--repair']
  const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));expect(result.conformance).toHaveLength(1)
  const prepared=JSON.parse(fs.readFileSync(output));expect(prepared.rev).toBe(42);expect(prepared.state.programmes.definitions[0].lengthWeeks).toBe(1);expect(JSON.parse(fs.readFileSync(input))).toEqual(original)
  expect(fs.statSync(output).mode&0o777).toBe(0o600);expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow()
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
it('fails closed on duplicate sources rather than choosing whichever file appeared last',()=>{
 const d=importProgramme(raw('dup')).definition;const sources=[raw('dup'),raw('dup')];sources[0].weeks[0].days[0].exercises[0].role='main';sources[1].weeks[0].days[0].exercises[0].role='accessory'
 const result=refreshProgrammeDefinitions({programmes:{definitions:[d],cycles:[]}},sources.map((raw,i)=>({raw,filename:`dup-${i}.json`})))
 expect(result.report.needsReview).toHaveLength(1);expect(result.report.needsReview[0].reason).toContain('no source chosen');expect(result.state.programmes.definitions[0].weeks[0].days[0].sessions[0].routineSnapshot.ex[0].role).toBeUndefined()
})

const imported=id=>importProgramme(raw(id)).definition
it('protects the definition a snapshot names even when programmeId differs or is missing',()=>{
 for(const cycle of [{id:'c',programmeId:'other',status:'active',snapshot:{...imported('saved')}},{id:'c',status:'paused',snapshot:{...imported('saved')}},{id:'c',programmeId:'other',status:'archived',snapshot:{...imported('saved')}}]) {
  const saved=imported('saved');delete saved.lengthWeeks
  const S={routines:[{id:'r',programme:{cycleId:'c'}}],workouts:[],programmes:{definitions:[saved,imported('other')],cycles:[cycle]},active:cycle.status==='archived'?{programmeInstance:{cycleId:'c'}}:undefined}
  const old=structuredClone(S),result=refreshProgrammeDefinitions(S,[{raw:raw('saved'),filename:'saved.json'}],{repair:true})
  expect(result.report.protected,cycle.status).toContain('saved');expect(result.state.programmes.definitions.find(d=>d.id==='saved')).toEqual(old.programmes.definitions[0]);expect(result.report.updated).not.toContain('saved')
 }
})
it('reports a protected id that only appears in an input file',()=>{
 const S={programmes:{definitions:[],cycles:[{id:'c',programmeId:'file-only',status:'active',snapshot:{id:'file-only'}}]}}
 const result=refreshProgrammeDefinitions(S,[{raw:raw('file-only'),filename:'f.json'}]);expect(result.report.protected).toEqual(['file-only']);expect(result.report.added).toEqual([])
})
it('does not repair stored definitions unless repair is requested',()=>{
 const d=importProgramme(raw('mine')).definition;delete d.lengthWeeks
 const S={programmes:{definitions:[d],cycles:[]}}
 expect(refreshProgrammeDefinitions(S).report.updated).toEqual([]);expect(refreshProgrammeDefinitions(S,[],{repair:true}).report.updated).toEqual(['mine'])
})
it('does not recover from the first of two source weeks with the same number',()=>{
 const src=raw('dupweek');src.weeks[0].days[0].exercises[0].slot='1';const slotOf=x=>x.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 const stored=importProgramme(src).definition;delete slotOf(stored).setTargets;delete slotOf(stored).target;delete slotOf(stored).sourcePrescription
 // Control: one source week recovers the authored effort.
 expect(slotOf(improveProgrammeDefinition(stored,{sourceRaw:src}).definition).setTargets).toEqual([{rpe:8},{rpe:8},{rpe:8}])
 const dup=structuredClone(src);dup.weeks.push(structuredClone(dup.weeks[0]));dup.weeks[0].days[0].exercises[0].sets[0].rpe=3
 expect(JSON.stringify(improveProgrammeDefinition(stored,{sourceRaw:dup}).definition)).not.toContain('"rpe":3')
 expect(()=>importProgramme(dup)).toThrow()
 const out=refreshProgrammeDefinitions({programmes:{definitions:[stored],cycles:[]}},[{raw:dup,filename:'d.json'}],{repair:true}).state.programmes.definitions[0]
 expect(JSON.stringify(out)).not.toContain('"rpe":3')
})
