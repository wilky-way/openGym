import {todayISO} from '@opengym/core/format'
import {DEF,clone} from '../src/store/useStore'
import {importProgramme,saveImportedProgramme} from '@opengym/core/programme-import'
import {activate} from '@opengym/core/programme'
import {buildSessionEntries} from '@opengym/core/session-start'
export function nativeSource() {
 return {schema:'opengym-library/1',id:'invented-mobile-native',name:'Invented native goals',unit:'kg',rules:{},source:{workbook_sha256:'2'.repeat(64),private:true},weeks:[{n:'1',days:[{n:1,kind:'lift',exercises:[{id:'0030',name:'barbell close-grip bench press',source_id:'mobile:w1:d1:s1',source:{workbook_sha256:'2'.repeat(64),sheet:'WEEK 1',prescription_cell:'F7'},parsed:true,rules_supported:true,sets:[{kind:'work',count:1,reps:[7,11],rpe:[6,8],pct:[61,69],pct_basis:'1RM',pct_role:'guide',effort_priority:'rpe',source_template_id:'mobile:t1'}]}]}]}]}
}
export function nativeFixture() {
 const source=nativeSource(),today=todayISO()
 const S=clone(DEF);S.sound=false;S.effort='rpe';S.workoutView='list'
 const preview=importProgramme(source);saveImportedProgramme(S,preview);const definition=S.programmes.definitions[0]
 const cycle=activate(S,definition,{today,cycleId:'native-mobile'})
 S.active={id:'native-mobile-active',d:today,start:Date.now(),routineId:S.routines[0].id,routineIds:[S.routines[0].id],name:'Invented native workout',cur:0,workoutView:'list',entries:buildSessionEntries(S,S.routines[0])}
 return {S,definition,cycle,source}
}
