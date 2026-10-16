import { describe, expect, test } from 'bun:test'
import { progressionServer, applyBody, fixture } from './progression-helpers'
import { buildSessionEntries } from '@opengym/core/session-start'
import { targetLabel } from '@opengym/core/programme-targets'
import { createExerciseIndex } from '@opengym/core/exercises'
import { dataServer, dataHeaders } from './data-helpers'
import { request } from 'node:http'
import { syntheticSlot } from '../../core/test/fixtures/synthetic-programme'
import { rpeRule } from '../../core/test/fixtures/synthetic-p3'
import { readFileSync, writeFileSync } from 'node:fs'
const path='/api/progression/'
describe('progression HTTP transcripts',()=> {
  test('validate and preview are pure and apply is a stamped conditional write',async()=> {
    const h=progressionServer(), before=h.stored()!, s=fixture(), definition=s.programmes.definitions[0]
    expect(await h.call('POST',path+'validate',{definition})).toEqual({status:200,body:{ok:true,issues:[]}})
    const preview=await h.call('POST',path+'preview',{source:{definition},cycleId:'c',weeks:[2]})
    expect(preview.status).toBe(200);expect(preview.body.weeks[0].slots[0].sets.map((s:any)=>s.load)).toEqual([80,90])
    expect(h.stored()).toBe(before)
    const dry=await h.call('POST',path+'apply',{...applyBody,dryRun:true})
    expect(dry.status).toBe(200);expect(dry.body.stateRev).toBe(4);expect(dry.body.changed.length).toBeGreaterThan(0);expect(h.stored()).toBe(before)
    const applied=await h.call('POST',path+'apply',applyBody), committedText=h.stored()!, saved=JSON.parse(committedText)
    expect(applied.status).toBe(200);expect(applied.body.stateRev).toBe(saved._rev);expect(saved._rev).toBe(5)
    expect(saved.workouts).toEqual(s.workouts);expect(saved.programmes.cycles[0].tmSeed).toEqual({bench:100})
    expect(saved.routines[0]).toEqual(s.routines[0]);expect(saved.routines[1].ex[0]).toMatchObject({weight:80,pyramidWeight:[80,90],pyramid:[5,5],sets:2,_f:{weight:expect.any(Number)}})
    expect(saved.routines[1]._f.ex).toBeGreaterThan(0)
    const repeat=await h.call('POST',path+'apply',{...applyBody,expectedRev:saved._rev,expectedWid:saved._wid})
    expect(repeat.status).toBe(200);expect(repeat.body.changed).toEqual([]);expect(h.stored()).toBe(committedText)
    const transcript=[{request:{action:'validate',body:{definition}},status:200,body:{ok:true,issues:[]}},{request:{action:'preview',body:{source:{definition},cycleId:'c',weeks:[2]}},...preview},{request:{action:'apply',body:{...applyBody,dryRun:true}},...dry},{request:{action:'apply',body:applyBody},status:applied.status,body:{...applied.body,wid:'<fresh-wid>'}}]
    const transcriptPath=new URL('./transcripts/progression.json',import.meta.url)
    if(process.env.P5_RECORD_TRANSCRIPTS==='1') writeFileSync(transcriptPath,JSON.stringify(transcript,null,2)+'\n')
    expect(transcript).toEqual(JSON.parse(readFileSync(transcriptPath,'utf8')))

  })
  test('preview appends hypothetical history, respects past-week cutoffs, and never persists it',async()=> {
    const h=progressionServer(),s:any=fixture(),d=s.programmes.cycles[0].snapshot
    d.progressionRules=[{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
    for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.weight=100;slot.progression.rules=['linear']}
    const logged=(n:number,date:string,w:number)=>({id:`l${n}`,d:date,start:n,unit:'lb',entries:[{id:'0025',occurrenceId:`o${n}`,target:{slotId:'bench',sets:2,reps:5},sets:[{done:true,w,r:5},{done:true,w,r:5}]}]})
    s.workouts=[logged(1,'2026-01-04',100)];h.plant(s);const before=h.stored()
    const preview=await h.call('POST',path+'preview',{source:{definition:d},cycleId:'c',weeks:[2],hypotheticalLogs:[logged(2,'2026-01-05',105)]})
    expect(preview.status).toBe(200);expect(preview.body.weeks[0].slots[0].sets[0].load).toBe(110);expect(h.stored()).toBe(before)
    const historical=await h.call('POST',path+'preview',{source:{definition:d},cycleId:'c',weeks:[1],asOf:'2026-01-14',hypotheticalLogs:[logged(2,'2026-01-13',200)]})
    expect(historical.body.weeks[0].slots[0].sets[0].load).toBe(105)
  })
  test('TM display cache converts definition units while frozen seeds remain unchanged',async()=> {
    const h=progressionServer(),s:any=fixture();s.programmes.cycles[0].snapshot.unit='kg'
    s.programmes.cycles[0].snapshot.tmSeeds.bench={value:100,unit:'kg'};h.plant(s)
    const applied=await h.call('POST',path+'apply',applyBody)
    expect(applied.status).toBe(200);const saved=JSON.parse(h.stored()!)
    expect(saved.programmes.cycles[0].tm.bench).toBeCloseTo(220.46226218,7)
    expect(saved.programmes.cycles[0].tmSeed).toEqual({bench:100});expect(saved.workouts).toEqual(s.workouts)
  })
  test('applied prescriptions show full percentages and clear stale scalar rep floors',async()=> {
    const h=progressionServer(),s:any=fixture();s.routines[1].ex[0].repsMin=9;h.plant(s)
    expect((await h.call('POST',path+'apply',applyBody)).status).toBe(200)
    const saved=JSON.parse(h.stored()!),entry=buildSessionEntries(saved,saved.routines[1],createExerciseIndex(saved.customEx))[0]!
    expect(entry.sets.map((s:any)=>s.w)).toEqual([80,90])
    expect(entry.sets[0].repTarget).toBeUndefined();expect(entry.sets[0].target.pct).toBe(80)
    expect(targetLabel(entry.sets[0].target)).toContain('80%');expect(saved.routines[1].ex[0].repsMin).toBeNull()
  })
  test('engine deload runs once and zero volume emits no rows while rule-free slots retain legacy behavior',async()=> {
    for(const count of [0,4]) {
      const h=progressionServer(),s:any=fixture(),d=s.programmes.cycles[0].snapshot,slot=syntheticSlot({...d,weeks:[d.weeks[1]]})
      if(count===0) {
        d.progressionRules.push({id:'volume',kind:'volume-ramp',scope:{slots:[{week:2,day:'d1',session:'main',slot:'bench'}]},startSets:0,addPerWeek:0,maxSets:0,weeks:[2],distribute:'round-robin-by-slot-order',holdIfMissedReps:false})
        slot.progression.rules.push('volume')
      } else {
        slot.sets=4;d.progressionRules[0].weeks['2'].push(...structuredClone(d.progressionRules[0].weeks['2']))
        s.routines[1].ex[0].sets=4;s.routines[1].ex[0].pyramid=[5,5,5,5]
        d.progressionRules.push({id:'deload',kind:'scheduled-deload',weeks:[2],setsFactor:0.5,loadFactor:0.5,progressionDuring:'off'})
        slot.progression.rules.push('deload')
      }
      const routine=s.routines[1];routine.programme.series='c:d1';routine.deload={setsFactor:0.5,loadFactor:0.5}
      routine.ex.push({id:'0025',slotId:'authored',sets:2,reps:5,weight:100});h.plant(s)
      const response=await h.call('POST',path+'apply',applyBody)
      expect(response).toMatchObject({status:200});expect(response.body.changed.every((c:any)=>Object.hasOwn(c,'after'))).toBe(true)
      const saved=JSON.parse(h.stored()!),entries=buildSessionEntries(saved,saved.routines[1],createExerciseIndex(saved.customEx))
      expect(entries[0]!.sets.map((r:any)=>r.w)).toEqual(count===0 ? [] : [40,45])
      expect(entries[0]!.deload).toBeUndefined()
      if(count===0) {
        const compact=structuredClone(saved.routines[1]);delete compact.ex[0].pyramid;delete compact.ex[0].pyramidWeight
        expect(buildSessionEntries(saved,compact,createExerciseIndex(saved.customEx))[0]!.sets).toEqual([])
      }
      expect(entries[1]!.sets.map((r:any)=>r.w)).toEqual([50]);expect(saved.routines[1].ex[1]).toEqual(routine.ex[1])
      expect(saved.routines[1].ex[0].reps).toBe(5);expect(saved.workouts).toEqual(s.workouts)
    }
  })
  test('evaluated zero assistance and athlete-picks loads remain authoritative at session start',async()=> {
    for(const assisted of [false,true]) {
      const h=progressionServer(),s:any=fixture(),d=s.programmes.cycles[0].snapshot,id=assisted ? 'assist' : '0025'
      s.customEx=assisted ? [{id,name:'Synthetic assistance',eq:'leverage machine',assisted:true}] : []
      d.progressionRules=assisted ? [{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}] : [{...rpeRule(),weeks:{'*':[{reps:5,rir:0},{reps:5,rir:0}]}}]
      for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.id=id;slot.weight=assisted ? 5 : 200;slot.progression.rules=[d.progressionRules[0].id]}
      for(const r of s.routines) {r.ex[0].id=id;r.ex[0].weight=assisted ? 5 : 200}
      s.programmes.cycles[0].occurrences[1].pinnedOn='2026-01-12'
      s.workouts=[{id:'prior',d:'2026-01-04',start:10,unit:'lb',entries:[{id,occurrenceId:'o1',target:{slotId:'bench',sets:2,reps:5},sets:[{done:true,w:assisted ? 5 : 200,r:assisted ? 5 : 20},{done:true,w:assisted ? 5 : 200,r:assisted ? 5 : 20}]}]}]
      h.plant(s);expect(await h.call('POST',path+'apply',applyBody)).toMatchObject({status:200})
      const saved=JSON.parse(h.stored()!),rows=buildSessionEntries(saved,saved.routines[1],createExerciseIndex(saved.customEx))[0]!.sets
      expect(rows.length).toBeGreaterThan(0)
      for(const row of rows) {if(assisted) expect(row.w).toBe(0);else expect(Object.hasOwn(row,'w')).toBe(false)}
      expect(saved.workouts).toEqual(s.workouts)
    }
  })
  test('source id uses installed definitions and opaque IDs reject decoded traversal',async()=> {
    const h=progressionServer()
    expect((await h.call('POST',path+'preview',{source:{definitionId:'synthetic'},cycleId:'c',weeks:[2]})).status).toBe(200)
    expect((await h.call('POST',path+'preview',{source:{definitionId:'../bad'},weeks:[2]})).status).toBe(400)
    expect((await h.call('POST',path+'apply',{...applyBody,cycleId:'../c'})).status).toBe(400)
    expect((await h.call('POST',path+'preview',{source:{definitionId:'missing'},weeks:[2]})).body.code).toBe('NOT_FOUND')
  })
  test('rejects inactive, past, live presence, confirmation, and mismatched revisions without writes',async()=> {
    const h=progressionServer(), before=h.stored()
    const calls=[{...applyBody,expectedRev:3},{...applyBody,expectedWid:'other'},{...applyBody,weeks:[0]},{...applyBody,confirmNoActiveSession:false}]
    for(const body of calls) {expect((await h.call('POST',path+'apply',body)).status).toBeGreaterThanOrEqual(400);expect(h.stored()).toBe(before)}
    h.live.active=true
    expect(await h.call('POST',path+'apply',applyBody)).toEqual({status:423,body:{error:'training now',code:'TRAINING_NOW'}})
    h.live.active=false
    const s=fixture();s.programmes.cycles[0].weekIndex=2;h.plant(s)
    expect((await h.call('POST',path+'apply',{...applyBody,weeks:[1]})).body.code).toBe('PAST_WEEK')
    s.programmes.cycles[0].status='paused';h.plant(s)
    expect((await h.call('POST',path+'apply',applyBody)).body.code).toBe('CYCLE_NOT_ACTIVE')
    expect(h.stored()).toBe(JSON.stringify(s))
  })
  test('never edits today or completed occurrences even when current week requested',async()=> {
    const h=progressionServer(), s=fixture();s.programmes.cycles[0].tm={bench:100};h.plant(s)
    const today=await h.call('POST',path+'apply',{...applyBody,weeks:[1]})
    expect(today.body.changed).toEqual([]);expect(h.stored()).toBe(JSON.stringify(s))
    s.programmes.cycles[0].occurrences[1].status='done';h.plant(s)
    expect((await h.call('POST',path+'apply',applyBody)).body.changed).toEqual([]);expect(h.stored()).toBe(JSON.stringify(s))
  })
  test('engine, slot, and definition errors are 422 with issues and no write',async()=> {
    const h=progressionServer()
    for(const [code,mutate] of [
      ['INVALID_RULES',(s:any)=>s.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.rules=['missing']],
      ['INVALID_DEFINITION',(s:any)=>s.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].sets=-1],
      ['INVALID_LOAD',(s:any)=>{s.programmes.cycles[0].tmSeed.bench=Number.MAX_VALUE;s.programmes.cycles[0].snapshot.progressionRules[0].weeks['2'][0].pct=1.5}],
      ['UNSUPPORTED_REPS',(s:any)=>s.programmes.cycles[0].snapshot.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].reps='3-5'],
    ] as const) {
      const s=fixture();mutate(s);h.plant(s);const before=h.stored()
      const response=await h.call('POST',path+'apply',applyBody)
      expect(response.status).toBe(422);expect(response.body.code).toBe(code);expect(response.body.issues.length).toBeGreaterThan(0);expect(h.stored()).toBe(before)
      const preview=await h.call('POST',path+'preview',{source:{definition:s.programmes.cycles[0].snapshot},cycleId:'c',weeks:[2]})
      expect(preview.status).toBe(422);expect(preview.body.code).toBe(code);expect(preview.body.weeks).toBeUndefined()
    }
  })
  test('excludes invalid-dated logs with warnings without changing the saved history',async()=> {
    const h=progressionServer(),s=fixture();s.workouts[0].d='2026-02-30';h.plant(s)
    const preview=await h.call('POST',path+'preview',{source:{definitionId:'synthetic'},cycleId:'c',weeks:[2],hypotheticalLogs:[]})
    expect(preview.status).toBe(200);expect(preview.body.warnings).toContainEqual({code:'log.invalid-date',message:'Excluded log 0: expected a valid YYYY-MM-DD date.'})
    const applied=await h.call('POST',path+'apply',applyBody)
    expect(applied.status).toBe(200);expect(applied.body.warnings[0].code).toBe('log.invalid-date');expect(JSON.parse(h.stored()!).workouts).toEqual(s.workouts)
    expect((await h.call('POST',path+'preview',{source:{definitionId:'synthetic'},weeks:[2],asOf:'2026-02-30'})).status).toBe(400)
  })
  test('forwards the custom exercise index to validation and preview',async()=> {
    const h=progressionServer(),s=fixture();s.customEx=[{id:'compound',name:'Synthetic compound',eq:'barbell',primaries:['chest','triceps']}] as any
    const d=s.programmes.cycles[0].snapshot
    for(const w of d.weeks) {
      const slot=syntheticSlot({...d,weeks:[w]});slot.id='compound';slot.progression.rules.push('chest','triceps')
    }
    for(const muscle of ['chest','triceps']) d.progressionRules.push({id:muscle,kind:'volume-ramp',scope:{muscles:[muscle]},startSets:2,addPerWeek:1,maxSets:4,weeks:[1,2],distribute:'round-robin-by-slot-order',holdIfMissedReps:false})
    h.plant(s)
    expect((await h.call('POST',path+'validate',{definition:d})).body.issues.some((i:any)=>i.code==='rule.two-volume-ramps')).toBe(true)
    expect((await h.call('POST',path+'preview',{source:{definition:d},cycleId:'c',weeks:[2]})).body.code).toBe('INVALID_RULES')
  })
  test('inventory warnings require explicit apply confirmation and are returned throughout',async()=> {
    const h=progressionServer(),s:any=fixture();s.customEx=[{id:'bar',name:'Synthetic custom bar',eq:'barbell'}];s.plates={lb:{45:1,5:1}}
    const d=s.programmes.cycles[0].snapshot
    for(const w of d.weeks) syntheticSlot({...d,weeks:[w]}).id='bar'
    for(const r of s.routines) r.ex[0].id='bar'
    d.progressionRules[0].rounding.usePlates=true;h.plant(s)
    const before=h.stored(),preview=await h.call('POST',path+'preview',{source:{definition:d},cycleId:'c',weeks:[2]})
    expect(preview.status).toBe(200);expect(preview.body.warnings.some((w:any)=>w.code==='rounding.large-adjustment')).toBe(true)
    expect(preview.body.weeks[0].slots[0].sets[1].load).toBe(55)
    expect(preview.body.weeks[0].slots[0].sets[1].why.at(-1).text).toContain('Warning:')
    const refused=await h.call('POST',path+'apply',applyBody)
    expect(refused.status).toBe(422);expect(refused.body.warnings).toEqual(preview.body.warnings);expect(h.stored()).toBe(before)
    const accepted=await h.call('POST',path+'apply',{...applyBody,confirmInventoryAdjustment:true})
    expect(accepted.status).toBe(200);expect(accepted.body.warnings).toEqual(preview.body.warnings);expect(JSON.parse(h.stored()!).routines[1].ex[0].pyramidWeight).toEqual([55,55])
  })
  test('real S05 activity presence blocks apply until expiry and clears on session end',async()=> {
    const h=dataServer(['u1'],{}, {today:()=> '2026-01-05'});h.plant(fixture());const before=h.stored()
    expect((await h.call('POST','/api/activity',{active:true,name:'Synthetic training'})).status).toBe(200)
    expect((await h.call('POST',path+'apply',applyBody)).body.code).toBe('TRAINING_NOW');expect(h.stored()).toBe(before)
    h.clock.t+=70000
    expect((await h.call('POST',path+'apply',{...applyBody,dryRun:true})).status).toBe(200)
    await h.call('POST','/api/activity',{active:true})
    await h.call('POST','/api/activity',{active:false})
    expect((await h.call('POST',path+'apply',{...applyBody,dryRun:true})).status).toBe(200)
    expect(h.stored()).toBe(before)
  })
  test('P2 assisted prescriptions reduce assistance, while undefined assisted rules cannot apply',async()=> {
    const h=progressionServer(),s:any=fixture(),d=s.programmes.cycles[0].snapshot
    s.customEx=[{id:'assist',name:'Synthetic assisted pull-up',eq:'leverage machine',assisted:true}]
    d.progressionRules=[{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
    for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.id='assist';slot.weight=100;slot.progression.rules=['linear']}
    for(const r of s.routines) r.ex[0].id='assist'
    s.programmes.cycles[0].occurrences[1].pinnedOn='2026-01-12'
    s.workouts=[{id:'assisted-log',d:'2026-01-04',start:10,unit:'lb',entries:[{id:'assist',occurrenceId:'o1',target:{slotId:'bench',sets:2,reps:5},sets:[{done:true,w:100,r:5},{done:true,w:100,r:5}]}]}]
    h.plant(s)
    const preview=await h.call('POST',path+'preview',{source:{definition:d},cycleId:'c',weeks:[2]})
    expect(preview.status).toBe(200);expect(preview.body.weeks[0].slots[0].sets[0].load).toBe(95)
    expect((await h.call('POST',path+'apply',applyBody)).status).toBe(200);expect(JSON.parse(h.stored()!).routines[1].ex[0].weight).toBe(95)
    const pct=fixture();for(const w of pct.programmes.cycles[0].snapshot.weeks) syntheticSlot({...pct.programmes.cycles[0].snapshot,weeks:[w]}).id='assist';pct.customEx=s.customEx;h.plant(pct)
    const refused=await h.call('POST',path+'apply',applyBody)
    expect(refused.status).toBe(422);expect(refused.body.code).toBe('UNSUPPORTED_ASSISTED');expect(h.stored()).toBe(JSON.stringify(pct))
  })
  test('a concurrent phone PUT on the wire wins over a pending apply without a merge',async()=> {
    const h=progressionServer(),phone=fixture();phone.workouts.push({id:'wire-phone',d:'2026-01-05',start:2,entries:[]})
    const bytes=JSON.stringify(applyBody),half=Math.floor(bytes.length/2)
    let finish!:()=>void
    const pending=new Promise<{status:number;body:any}>((resolve,reject)=> {
      const req=request(h.api+path+'apply',{method:'POST',headers:{...dataHeaders('u1'),'Content-Length':String(Buffer.byteLength(bytes))},agent:false},res=> {
        let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{try {resolve({status:res.statusCode!,body:JSON.parse(text)})} catch(error){reject(error)}})
      });req.on('error',reject);req.write(bytes.slice(0,half));finish=()=>req.end(bytes.slice(half))
    })
    try {expect((await h.call('PUT','/api/data',{state:phone,baseRev:4,baseWid:'read1'})).status).toBe(200)} finally {finish()}
    expect(await pending).toMatchObject({status:409,body:{code:'REV_CONFLICT'}})
    const saved=JSON.parse(h.stored()!);expect(saved.workouts).toEqual(phone.workouts);expect(saved.routines).toEqual(phone.routines)
    expect(saved._rev).toBe(6) // Unstamped phone PUT follows S04's legacy +2 revision rule.
  })
  test('phone PUT after the read loses apply with 409 and preserves the phone write',async()=> {
    const h=progressionServer(),write=h.data.compareAndWrite.bind(h.data),phone=fixture();phone.workouts.push({id:'phone',d:'2026-01-05',start:2,entries:[]})
    h.data.compareAndWrite=(uid,body)=> {write(uid,{state:phone,baseRev:4,baseWid:'read1'});return write(uid,body)}
    const result=await h.call('POST',path+'apply',applyBody)
    expect(result.status).toBe(409);expect(result.body.code).toBe('REV_CONFLICT')
    const stored=JSON.parse(h.stored()!);expect(stored.workouts.at(-1).id).toBe('phone');expect(stored.routines).toEqual(phone.routines)
  })
  test('auth, CSRF, and malformed request failures leave storage untouched',async()=> {
    const h=progressionServer(),before=h.stored()
    expect((await h.call('POST',path+'apply',applyBody,{'Content-Type':'application/json'})).status).toBe(401)
    expect((await h.call('POST',path+'apply',applyBody,{Cookie:'gymsid=bad',Origin:'https://other','Content-Type':'application/json'})).status).toBe(403)
    expect((await h.call('POST',path+'apply',{...applyBody,weeks:[]})).status).toBe(422)
    expect((await h.call('POST',path+'preview',{source:{definitionId:'synthetic'},weeks:[99]})).status).toBe(422)
    expect(h.stored()).toBe(before)
  })
})
