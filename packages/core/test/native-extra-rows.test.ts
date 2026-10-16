import {it,expect} from 'vitest'
import {relativeFixture} from './native-relative-fixture'
import {nativeExtraRow,prepareNativeCompletion,evaluateNativeRelativeLoad,validateNativeRelativeRows} from '../src/native-relative-load'
import {buildCompletedWorkout} from '../src/finish-workout'
import {repeatSessionEntries} from '../src/session-repeat'
import {convertStateUnit} from '../src/units'
import type {NativePrescription} from '../../contract/domain/native-prescription'
const complete=(S:any,e:any,i:number,w:number)=>{const row=e.sets[i];Object.assign(row,{r:5,w});prepareNativeCompletion(S,e,row,true);row.done=true;row.at=i+2}
const ready=()=>{const f=relativeFixture();for(let i=0;i<3;i++)complete(f.S,f.entry,i,i===0?100:85);return f}
it('Finish conserves completed/partial/empty extras, source identity, times, notes and opaque metadata with no row aliases',()=>{
 const {S,entry}=ready();S.active.note='session note';entry.note='entry note'
 entry.sets.push(nativeExtraRow({r:7,w:71,note:'extra note',opaque:{keep:1}},'extra-1'));complete(S,entry,3,71)
 entry.sets.push(nativeExtraRow({r:4,w:12},'partial'),nativeExtraRow({},'empty'))
 const before=structuredClone(S.active),log:any=buildCompletedWorkout(S.active,{end:600})
 expect(log).toMatchObject({id:before.id,start:1,end:600,note:'session note',entries:[{note:'entry note'}]})
 expect(log.entries[0].sets).toEqual(before.entries[0].sets);expect(log.entries[0].sets).toHaveLength(6)
 log.entries[0].sets[3].opaque.keep=2;expect(entry.sets[3]!.opaque).toEqual({keep:1});expect(S.active).toEqual(before)
 expect((entry.target.nativePrescription as NativePrescription).sets).toHaveLength(3)
})
it('Copy authored and extra create disjoint ordinary rows; undo retains actuals without native receipts',()=>{
 const {S,entry}=ready(),source=entry.sets[1]!,receipt=structuredClone(source.nativeLoadEvaluation)
 const extra=nativeExtraRow({...source,max:true,repTarget:{min:5,max:5},opaque:{keep:true}},'copy-1')
 const copy=nativeExtraRow(extra,'copy-2');entry.sets.push(extra,copy)
 expect(extra).toMatchObject({w:85,r:5,done:false,nativeExtraIdentity:{kind:'athlete-extra',id:'copy-1'},opaque:{keep:true}})
 for(const key of ['nativeTarget','nativeRowIdentity','nativeLoadEvaluation','nativeActualLoad','nativeLoadReason','max','repTarget'])expect(extra[key]).toBeUndefined()
 expect(copy.nativeExtraIdentity).not.toEqual(extra.nativeExtraIdentity)
 prepareNativeCompletion(S,entry,extra,true);extra.done=true;prepareNativeCompletion(S,entry,extra,false);extra.done=false
 expect(extra).toMatchObject({w:85,r:5});expect(extra.nativeActualLoad).toBeUndefined();expect(source.nativeLoadEvaluation).toEqual(receipt)
})
for(const fault of ['missing-authored-id','wrong-authored-id','duplicate-authored','missing-target','unmarked-extra','empty-id','wrong-kind','unknown-key','null-marker','duplicate-extra','extra-with-authored-id','extra-with-target','extra-with-evaluation','extra-with-stamp'])it(`Finish and Repeat refuse ${fault} atomically`,()=>{
 const {S,entry}=ready();const extra=nativeExtraRow({w:70,r:5,done:true},'extra');extra.done=true;entry.sets.push(extra)
 if(fault==='missing-authored-id')delete entry.sets[0]!.nativeRowIdentity
 if(fault==='wrong-authored-id')entry.sets[0]!.nativeRowIdentity!.source.cell='other'
 if(fault==='duplicate-authored')entry.sets.push(structuredClone(entry.sets[0]!))
 if(fault==='missing-target')delete entry.sets[0]!.nativeTarget
 if(fault==='unmarked-extra')delete extra.nativeExtraIdentity
 if(fault==='empty-id')extra.nativeExtraIdentity!.id=' '
 if(fault==='wrong-kind')(extra.nativeExtraIdentity as any).kind='authored'
 if(fault==='unknown-key')(extra.nativeExtraIdentity as any).rowOrdinal=1
 if(fault==='null-marker')(extra as any).nativeExtraIdentity=null
 if(fault==='duplicate-extra')entry.sets.push(structuredClone(extra))
 if(fault==='extra-with-authored-id')extra.nativeRowIdentity=structuredClone(entry.sets[0]!.nativeRowIdentity)
 if(fault==='extra-with-target')extra.nativeTarget=structuredClone(entry.sets[0]!.nativeTarget)
 if(fault==='extra-with-evaluation')extra.nativeLoadEvaluation=structuredClone(entry.sets[1]!.nativeLoadEvaluation)
 if(fault==='extra-with-stamp')extra.nativeActualLoad={value:70,unit:'kg'}
 const before=structuredClone(S);expect(()=>buildCompletedWorkout(S.active)).toThrow(/identity/);expect(()=>repeatSessionEntries(S,S.active)).toThrow(/identity/);expect(S).toEqual(before)
})
it('an extra can never substitute for the missing actual authored anchor',()=>{
 const {S,entry}=relativeFixture(),anchor=entry.sets.shift()!;const extra=nativeExtraRow({...anchor,w:200,r:5},'extra');extra.done=true;entry.sets.unshift(extra)
 const row=entry.sets[1]!;row.w=77;const before=structuredClone(entry)
 expect(evaluateNativeRelativeLoad(S,entry,row).status).toBe('pending');expect(()=>prepareNativeCompletion(S,entry,row,true)).toThrow(/anchor/);expect(entry).toEqual(before)
})
it('Repeat restores authored count, keeps completed extras in place with fresh identities and ordinary actuals, and preserves history preimage',()=>{
 const {S,entry}=ready();const extra=nativeExtraRow({w:71,r:7,note:'bonus',opaque:{keep:true}},'logged');extra.done=true;extra.at=4;extra.rpe=8;extra.clusters=[{r:2,restSec:15}]
 entry.sets.splice(1,0,extra);entry.sets.push(nativeExtraRow({},'empty'));entry.sets.splice(0,1)
 const log:any=buildCompletedWorkout(S.active,{end:500}),before=structuredClone(log),repeated=repeatSessionEntries(S,log).entries[0]!,rows=repeated.sets!
 expect(rows).toHaveLength(4);expect(rows.map(r=>r.nativeRowIdentity?.rowOrdinal)).toEqual([undefined,1,2,3])
 const bonus=rows[0]!;expect(bonus).toMatchObject({done:false,w:71,r:7,note:'bonus',opaque:{keep:true}});expect(bonus.nativeExtraIdentity?.id).not.toBe('logged')
 for(const key of ['at','rpe','clusters','nativeActualLoad','nativeLoadEvaluation','nativeTarget','nativeRowIdentity'])expect(bonus[key]).toBeUndefined()
 for(const row of rows.slice(1))expect(row.w).toBeUndefined()
 expect(repeated.target!.nativePrescription).toEqual(entry.target.nativePrescription);expect(evaluateNativeRelativeLoad(S,repeated,rows[2]!).status).toBe('pending');expect(log).toEqual(before)
 validateNativeRelativeRows(repeated)
})
it('converted history preserves authored frozen units and converts ordinary extra actuals without manufacturing stamps',()=>{
 const {S,entry}=ready();entry.sets.push(nativeExtraRow({r:7,w:71},'extra'));complete(S,entry,3,71)
 const frozen=structuredClone(entry.sets[1]!.nativeLoadEvaluation),converted:any=convertStateUnit(S,'lb'),e=converted.active.entries[0]
 expect(e.sets[1].nativeLoadEvaluation).toEqual(frozen);expect(e.sets[3]).toMatchObject({w:156.5,nativeExtraIdentity:{kind:'athlete-extra',id:'extra'}})
 expect(e.sets[3].nativeActualLoad).toBeUndefined();expect(buildCompletedWorkout(converted.active).entries[0]!.sets).toHaveLength(4)
})
