import { expect, it } from 'vitest'
import fc from 'fast-check'
import * as targets from '../src/programme-targets.js'
import * as meta from '../src/superset-meta.js'
import * as reps from '../src/rep-range.js'
import * as ui from '../src/programme-ui.js'
import * as prescription from '../src/programme-prescription.js'
// @ts-expect-error -- Frozen JavaScript oracle is intentionally imported only in differential tests.
import * as oldTargets from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-targets.js'
// @ts-expect-error -- Frozen JavaScript oracle has no snapshot-path declarations.
import * as oldMeta from '../../../packages/parity/fixtures/oracle/frontend/src/lib/superset-meta.js'
// @ts-expect-error -- Frozen JavaScript oracle has no snapshot-path declarations.
import * as oldReps from '../../../packages/parity/fixtures/oracle/frontend/src/lib/rep-range.js'
// @ts-expect-error -- Frozen JavaScript oracle has no snapshot-path declarations.
import * as oldUi from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-ui.js'
// @ts-expect-error -- Frozen JavaScript oracle has no snapshot-path declarations.
import * as oldPrescription from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-prescription.js'
const runs = Number(process.env.PARITY_RUNS || 1000)
function equal(a:unknown,b:unknown) {expect(a).toStrictEqual(b);expect(JSON.stringify(a)).toBe(JSON.stringify(b))}
function capture(fn:()=>unknown) {try{return {value:fn()}}catch(e){return {error:e instanceof Error?e.message:String(e)}}}
const scalar = fc.oneof(fc.integer({min:-100,max:100}), fc.constantFrom(undefined,null,'8','max',NaN))
it('rep ranges preserve legacy coercion, alignment and key order',()=>{
  fc.assert(fc.property(scalar,scalar,fc.integer({min:-2,max:4}), (hi,lo,stride)=>{
    equal(reps.normalizeRepRange(hi,lo,stride),oldReps.normalizeRepRange(hi,lo,stride))
  }),{seed:20261013,numRuns:runs})
}, 60000)
it('authored effort targets and labels keep legacy scale and planner-provenance rules',()=>{
  const target = fc.record({rir:fc.option(fc.double({min:0,max:10,noNaN:true}),{nil:undefined}),
    rpe:fc.option(fc.double({min:0,max:10,noNaN:true}),{nil:undefined}),pct:fc.option(fc.integer({min:1,max:120}),{nil:undefined})})
  fc.assert(fc.property(target,fc.constantFrom('none','rir','rpe'),fc.integer({min:0,max:10}), (t,kind,index)=>{
    const before=JSON.stringify(t)
    equal(targets.targetForScale(t,kind),oldTargets.targetForScale(t,kind))
    equal(targets.targetLabel(t,undefined,kind),oldTargets.targetLabel(t,undefined,kind))
    equal(targets.effortRangeLabel('rpe',t.rpe,t.rpe==null?null:Math.min(10,t.rpe+1),kind),oldTargets.effortRangeLabel('rpe',t.rpe,t.rpe==null?null:Math.min(10,t.rpe+1),kind))
    const cfg={target:t,setTargets:[{rir:0},{rpe:8}],tm:{key:'lift',percentages:[75,80]}}
    equal(targets.setTargetAt(cfg,index),oldTargets.setTargetAt(cfg,index))
    const S={effort:kind,queue:{label:'Synthetic · 2 RIR (assumed)',programmeCycleId:'c'},programmes:{cycles:[{id:'c'}]}}
    for(const noteKind of ['planner',undefined,'authored']) {
      const note={note:'Opaque RPE 8; 2 RIR and 0.5 RIR',noteKind}
      equal(targets.programmeNote(S,note),oldTargets.programmeNote(S,note))
    }
    equal(targets.programmeQueueLabel(S),oldTargets.programmeQueueLabel(S))
    expect(JSON.stringify(t)).toBe(before)
  }),{seed:20261014,numRuns:runs})
  fc.assert(fc.property(fc.jsonValue({maxDepth:2}),t=>equal(capture(()=>targets.validateSetTarget(t)),capture(()=>oldTargets.validateSetTarget(t)))),{seed:20261015,numRuns:runs})
}, 60000)
it('superset metadata reads and mutating joins preserve object bytes',()=>{
  const member=fc.record({sg:fc.constantFrom('a','b','',undefined),sgName:fc.string({maxLength:60}),sgRest:fc.integer({min:-5,max:180}),other:fc.jsonValue({maxDepth:2})})
  fc.assert(fc.property(fc.array(member,{maxLength:10}),fc.string({maxLength:60}),fc.integer({min:-10,max:180}), (members,name,rest)=>{
    const indices=members.map((_,i)=>i)
    equal(meta.supersetMeta(members,indices),oldMeta.supersetMeta(members,indices))
    const entries=members.map(target=>({target}))
    equal(meta.supersetMeta(entries,indices,{onTarget:true}),oldMeta.supersetMeta(entries,indices,{onTarget:true}))
    const a=structuredClone(members),b=structuredClone(members)
    equal(meta.setSupersetMeta(a,'a',{name,rest}),oldMeta.setSupersetMeta(b,'a',{name,rest}));equal(a,b)
    equal(meta.syncSupersetMeta(a),oldMeta.syncSupersetMeta(b));equal(a,b)
  }),{seed:20261016,numRuns:runs})
}, 60000)
it('prescription resizing retains authored metadata and mutations exactly',()=>{
  const cfg=fc.record({sets:fc.integer({min:0,max:8}),reps:fc.constantFrom(5,10,'max' as const),repsMin:fc.integer({min:0,max:12}),
    setTargets:fc.array(fc.record({rpe:fc.integer({min:0,max:10})}),{maxLength:5}),
    setRepsMin:fc.array(fc.option(fc.integer({min:1,max:20}),{nil:null}),{maxLength:5}),
    pyramid:fc.array(fc.integer({min:1,max:15}),{maxLength:5}),tm:fc.record({key:fc.constant('lift'),percentages:fc.array(fc.integer({min:1,max:120}),{maxLength:5})}),
    authoredInstructions:fc.string(),noteKind:fc.constant('planner')})
  fc.assert(fc.property(cfg,fc.integer({min:0,max:8}),fc.boolean(), (previous,count,pyramid)=>{
    const next={sets:count,reps:8,...(pyramid?{pyramid:[5,3]}:{})}
    const a=structuredClone(next),b=structuredClone(next)
    equal(prescription.retainProgrammePrescription(previous,a),oldPrescription.retainProgrammePrescription(previous,b));equal(a,b)
    equal(prescription.retainProgrammePrescription(null,a),oldPrescription.retainProgrammePrescription(null,b))
  }),{seed:20261017,numRuns:runs})
}, 60000)
it('programme log selection and deload counts preserve legacy ordering',()=>{
  const log=fc.record({id:fc.string(),d:fc.constantFrom('2026-10-11','2026-10-12','2026-10-13'),start:fc.integer({min:0,max:1000}),
    routineId:fc.constantFrom('r','other'),entries:fc.array(fc.record({occurrenceId:fc.constantFrom('o','other','')}),{maxLength:3})})
  fc.assert(fc.property(fc.array(log,{maxLength:10}),fc.array(fc.integer({min:0,max:10}),{maxLength:10}),fc.double({min:0,max:1,noNaN:true}), (workouts,sets,factor)=>{
    const occurrence={instanceId:'o',status:'done',routineId:'r',date:'2026-10-12'}
    equal(ui.loggedProgrammeWorkout(workouts,occurrence),oldUi.loggedProgrammeWorkout(workouts,occurrence))
    const week={mode:'deload',deload:{setsFactor:factor},days:[{sessions:[{routineSnapshot:{ex:sets.map(sets=>({sets}))}}]}]}
    equal(ui.programmeWeekSets(week),oldUi.programmeWeekSets(week))
  }),{seed:20261018,numRuns:runs})
}, 60000)
