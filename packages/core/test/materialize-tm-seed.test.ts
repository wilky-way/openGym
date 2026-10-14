import { describe, expect, it } from 'vitest'
import { materializeTmSeed } from '../src/materialize-tm-seed'
import { createExerciseIndex } from '../src/exercises'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
const log=(w:number,d='2026-01-04',start=10,id='0025',unit='lb')=>({id:'synthetic',d,start,unit,entries:[{id,sets:[{w,r:1,done:true}]}]})
function draft() {
  const definition=syntheticProgramme();definition.tmSeeds={bench:{fromE1rm:{pct:0.9}}};syntheticSlot(definition).tm={key:'bench',percentages:[0.8,0.9],reference:'tm'}
  return {state:{unit:'lb',workouts:[log(100)]},definition,options:{today:'2026-01-05',now:100,tm:{}}}
}
describe('activation-only immutable TM seeds',()=> {
  it('freezes prior e1RM and ignores all post-activation and incomplete history',()=> {
    const x=draft();x.state.workouts.push(log(1000,'2026-01-06',20),log(1500,'2026-01-05',100),log(2000,'2026-01-05',101),{...log(900),end:null} as any,{...log(800),active:true} as any,log(700,'2026-02-30'))
    ;(x.state.workouts[0]!.entries[0] as any).target=null
    const before=JSON.stringify(x),seed=materializeTmSeed(x)
    expect(seed).toEqual({bench:90});expect(Object.isFrozen(seed)).toBe(true);expect(JSON.stringify(x)).toBe(before)
    x.state.workouts.push(log(5000,'2026-01-10',200));expect(materializeTmSeed(x)).toEqual(seed)
  })
  it('explicit athlete TM takes priority and typed seeds convert once into definition units',()=> {
    const x=draft();x.options.tm={bench:120} as any;expect(materializeTmSeed(x)).toEqual({bench:120})
    x.options.tm={};x.definition.unit='kg';x.definition.tmSeeds={bench:{value:100,unit:'lb'}}
    expect(materializeTmSeed(x).bench).toBeCloseTo(100/2.2046226218,7)
  })
  it('uses the injected assisted custom index, excludes assistance, and normalizes history units',()=> {
    const x=draft(),index=createExerciseIndex([{id:'custom',name:'Synthetic assistance',eq:'leverage machine',assisted:true}])
    syntheticSlot(x.definition).id='custom';x.state.workouts=[log(200,'2026-01-04',10,'custom')]
    expect(materializeTmSeed({...x,index})).toEqual({})
    expect(materializeTmSeed(x)).toEqual({bench:180})
    syntheticSlot(x.definition).id='0025';x.definition.unit='kg';x.state.workouts=[log(100)]
    expect(materializeTmSeed(x).bench).toBe(40.86) // Core e1RM uses its existing 0.1-unit display precision.
  })
  it('converts numeric-string and unilateral authoritative loads before estimating',()=> {
    for(const set of [{w:'100',r:1,done:true},{side:'both',sides:{L:{w:'100',r:1,done:true},R:{w:100,r:1,done:true}},done:true}]) {
      const x=draft();x.definition.unit='kg';x.state.workouts[0]!.entries[0]!.sets=[set] as any
      const before=JSON.stringify(x.state);expect(materializeTmSeed(x).bench).toBe(40.86);expect(JSON.stringify(x.state)).toBe(before)
    }
  })
  it('resolves seed lifts through attached rules when no legacy TM object is authored',()=> {
    const x=draft();delete syntheticSlot(x.definition).tm;syntheticSlot(x.definition).progression.rules=['pct']
    x.definition.progressionRules=[{id:'pct',kind:'percentage',ref:{lift:'bench',basis:'tm'},rounding:{increment:5,mode:'nearest',usePlates:false},weeks:{'1':[{pct:0.8,reps:5},{pct:0.9,reps:5}]}}]
    expect(materializeTmSeed(x)).toEqual({bench:90})
  })
  it('missing prior estimates leave the lift unavailable and activation cutoff is mandatory',()=> {
    const x=draft();x.state.workouts=[];expect(materializeTmSeed(x)).toEqual({})
    expect(()=>materializeTmSeed({...x,options:{today:'bad',now:100}})).toThrow('today and now')
    expect(()=>materializeTmSeed({...x,options:{...x.options,tm:{bench:-1}}})).toThrow('Invalid TM seed')
  })
  it('handles prototype-named lift keys with own properties and freezes every numeric value',()=> {
    const x=draft();x.definition.tmSeeds=JSON.parse('{"__proto__":{"value":100,"unit":"lb"},"constructor":{"value":50,"unit":"lb"}}')
    syntheticSlot(x.definition).tm=null
    const seed=materializeTmSeed(x)
    expect(Object.hasOwn(seed,'__proto__')).toBe(true);expect(seed.__proto__).toBe(100);expect(seed.constructor).toBe(50)
  })
})
