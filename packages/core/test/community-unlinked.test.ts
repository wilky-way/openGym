import {expect,it} from 'vitest'
import {syntheticProgramme,syntheticSlot} from './fixtures/synthetic-programme'
import {activate} from '../src/programme'
import {copyRoutine} from '../src/routines'
import {endProgramme} from '../src/programme-lifecycle'
import {reconcileProgrammeOwnership} from '../src/programme-sync'
import {buildSessionEntries} from '../src/session-start'
import {programmeCommunityConfig} from '../src/community-session'
function fixture(){
 const d=syntheticProgramme(),a=syntheticSlot(d);a.weight=100;a.pyramid=[5,5];a.extension={keep:true};a.progression.rules=['lp'];a.progression.parameters={continuityKey:'bench'}
 d.progressionRules=[{id:'lp',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
 const state:any={unit:'lb',routines:[],workouts:[]},cycle=activate(state,d,{cycleId:'c',today:'2026-01-05'})
 state.workouts=[{id:'w',d:'2026-01-05',unit:'lb',entries:[{id:'0025',occurrenceId:cycle.occurrences[0]!.instanceId,target:{slotId:'bench',sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}]}]
 return {state,cycle,routine:state.routines[0]}
}
it.each(['copy','end','finished-reconcile','archived-reconcile'] as const)('actual %s lifecycle permits ordinary Start without borrowing old programme history',kind=>{
 const {state,cycle,routine}=fixture();expect(buildSessionEntries(state,routine)[0]!.sets.map(s=>s.w)).toEqual([105,105])
 let ordinary=routine
 if(kind==='copy'){ordinary=copyRoutine(routine);state.routines.push(ordinary)}
 else if(kind==='end')endProgramme(state,cycle.id,{today:'2026-01-06'})
 else{cycle.status=kind==='finished-reconcile'?'finished':'archived';reconcileProgrammeOwnership(state)}
 if(kind!=='copy')ordinary=state.routines[0]
 expect(ordinary.programme).toBeUndefined();expect(ordinary.ex[0].progression.parameters.continuityKey).toBe('bench')
 const before=structuredClone(state);expect(programmeCommunityConfig(state,ordinary.ex[0],ordinary)).toBe(ordinary.ex[0])
 expect(buildSessionEntries(state,ordinary)[0]!.sets.map(s=>s.w)).toEqual([100,100]);expect(ordinary.ex[0].extension).toEqual({keep:true});expect(state).toEqual(before)
 if(kind==='copy')expect(buildSessionEntries(state,routine)[0]!.sets.map(s=>s.w)).toEqual([105,105])
})
it('unlinked configs stay unchanged while corrupt still-linked routines remain blocked',()=>{
 const {state,routine}=fixture(),cfg=routine.ex[0],plain={id:'0025',sets:1,reps:8,weight:70,extension:{keep:true}}
 expect(programmeCommunityConfig(state,cfg)).toBe(cfg);expect(programmeCommunityConfig(state,plain,routine)).toBe(plain)
 state.programmes.cycles=[];expect(()=>buildSessionEntries(state,routine)).toThrow('frozen programme cycle')
 routine.programme={};expect(()=>buildSessionEntries(state,routine)).toThrow('frozen programme cycle')
})
