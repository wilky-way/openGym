import {importProgramme,saveImportedProgramme} from '../src/programme-import'
import {activate} from '../src/programme'
import {buildSessionEntries} from '../src/session-start'
import {nativeRowIdentity} from '../src/native-prescription'
export const relativeDefinition=():any=>{
 const raw={schema:'opengym-library/1',id:'invented-relative',name:'Invented relative loads',unit:'kg',rules:{},source:{workbook_sha256:'5'.repeat(64),private:true},weeks:[{n:1,days:[{n:1,kind:'lift',exercises:[{id:'0030',name:'barbell close-grip bench press',source_id:'invented:relative:slot',source:{workbook_sha256:'5'.repeat(64),sheet:'Invented',prescription_cell:'A1'},parsed:true,rules_supported:true,sets:[{kind:'work',count:3,reps:5,source_template_id:'invented:repeated-template'}]}]}]}]}
 const d:any=importProgramme(raw).definition,p=relativeSlot(d).nativePrescription
 for(const row of p.sets.slice(1))row.relativeLoad={kind:'same-entry-reduction',anchor:nativeRowIdentity(p,1),reductionPercent:10}
 return d
}
export const relativeSlot=(d:any)=>d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
export function relativeFixture(unit='kg') {
 const S:any={unit,routines:[],workouts:[],customEx:[],exWeights:{'0030':{w:999}}},definition=relativeDefinition()
 saveImportedProgramme(S,importProgramme(definition));const cycle=activate(S,definition,{today:'2026-10-16',cycleId:'relative-cycle'})
 const entries=buildSessionEntries(S,S.routines[0]);S.active={id:'invented-active',d:'2026-10-16',start:1,entries}
 return {S,definition,cycle,entry:entries[0]!}
}
