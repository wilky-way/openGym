import { expect, it } from 'vitest'
import { programmeInstructions } from '../src/programme-instructions'
import { getProgramme } from '../src/programme-agent'
import type { ProgrammeState, ProgrammeDefinition } from '../src/programme-engine-types'
const state=(effort: string):ProgrammeState=>({routines:[],effort})
it('renders numeric provenance in the profile scale while keeping authored prose opaque',()=>{
 const cfg={generatedRules:[{count:[2,3],rpe:[7,8],until_rpe:8}],authoredInstructions:'Authored note: 2 RIR, do not rewrite.',instructions:'stale display'}
 const before=structuredClone(cfg)
 expect(programmeInstructions(state('rir'),cfg)).toBe('Perform 2–3 sets; repeat until RIR 2; RIR 2–3 (as authored; choose the per-set target).\n\nAuthored note: 2 RIR, do not rewrite.')
 expect(programmeInstructions(state('none'),cfg)).toContain('repeat until @8')
 expect(cfg).toEqual(before)
})
it('retains opaque instructions without generated rules and handles empty configs',()=>{
 const cfg={instructions:'2 RIR and RPE 8 are source prose.'}
 expect(programmeInstructions(state('rpe'),cfg)).toBe(cfg.instructions)
 expect(programmeInstructions(state('rir'),null)).toBe('')
 expect(programmeInstructions(state('rpe'),{generatedRules:[],authoredInstructions:'Keep this.'})).toBe('Keep this.')
})
it('agent programme views use the generated-rule seam and never infer note provenance from RP ids',()=>{
 const def: ProgrammeDefinition={id:'rp-synthetic',name:'Synthetic',unit:'lb',weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[{id:'0025',sets:1,reps:5,note:'2 RIR is opaque',generatedRules:[{rpe:[7,8]}],authoredInstructions:'Keep authored 1 RIR.'}]}}]}]}]}
 const S=state('rir');S.programmes={version:1,fork:'opengym/1',definitions:[def],cycles:[]}
 const before=JSON.stringify(S),shown=getProgramme(S,{programmeId:def.id}).displayDefinition!.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
 expect(shown.instructions).toBe('RIR 2–3 (as authored; choose the per-set target).\n\nKeep authored 1 RIR.')
 expect(shown.note).toBe('2 RIR is opaque');expect(JSON.stringify(S)).toBe(before)
})
