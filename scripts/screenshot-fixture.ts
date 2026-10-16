import { activate } from '../packages/core/src/programme'
import { createExerciseIndex } from '../packages/core/src/exercises'
import { workoutVolume } from '../packages/core/src/history'
import { importProgramme, saveImportedProgramme } from '../packages/core/src/programme-import'
import { nativeRowIdentity } from '../packages/core/src/native-prescription'
import { createHash } from 'node:crypto'

// Invented from scratch: never reads an export, user library, or commercial template.
const date = new Date()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const ago = (days: number) => { const d = new Date(date); d.setDate(d.getDate() - days); d.setHours(18,0,0,0); return d }
const today = iso(date)
const slot = (id: string, slotId: string, weight: number) => ({
  id, slotId, role:'main', sets:3, reps:8, weight, prog:'off', target:{rir:2},
  progression:{kind:'manual',instructions:'Keep two reps in reserve.',rules:['double']},
})
const templates = [
  {name:'Upper Strength', ex:[slot('0025','bench',40),slot('0293','row',16)]},
  {name:'Lower Strength', ex:[slot('0043','squat',60),slot('0032','deadlift',70)]},
  {name:'Full Body', ex:[slot('0025','bench',40),slot('0043','squat',60),slot('0293','row',16)]},
]
const definition = {
  id:'synthetic-strength', name:'Upper/Lower Strength', unit:'kg', goal:'Strength', level:'Intermediate',
  daysPerWeek:3, lengthWeeks:4, equipment:['barbell','dumbbell'], licence:'Original synthetic example',
  source:{kind:'library',ref:'Synthetic screenshot fixture',private:false},
  endPlan:{kind:'stop',instructions:'Review your log before choosing the next block.'},
  progressionRules:[{id:'double',kind:'double',repsLow:8,repsHigh:12,condition:'all-sets',increment:2.5,unit:'kg',afterIncrease:'reset-to-low',rounding:{increment:2.5,mode:'nearest',usePlates:false}}],
  weeks:Array.from({length:4},(_,i)=>({index:i+1,mode:'train',days:[1,2,3].map(n=>({key:'d'+n,ordinal:n,sessions:[{
    sessionTemplateId:'main'+n,routineSnapshot:{...structuredClone(templates[n-1]),prog:'off'},
  }]}))})),
}
const alternative = {...structuredClone(definition),id:'synthetic-double',name:'Double Progression Block'}
const state:any={unit:'kg',theme:'light',accent:'lime',effort:'rir',restSec:90,workoutView:'focus',sound:true,
  workouts:[],routines:[],week:{},dayPlan:{},bodyweight:[],measurements:[],customEx:[],active:null,
  balanceTemplate:'thibaudeauPowerlifting',targetW:74,body:'male',checkIn:true,gymCards:[{id:'demo-card',label:'Demo Training Club',value:'SYNTHETIC-DEMO-NOT-A-MEMBERSHIP',fmt:'qr_code'}],
  measurementEnabled:['waist','chest','upperArmLeft','bodyFat'],customMeasurements:[],
  hints:{},programmes:{version:1,fork:'opengym/1',definitions:[definition,alternative],cycles:[]}}
activate(state,definition as any,{cycleId:'synthetic-cycle',today})
// Ascending dates and increasing loads make trends easy to inspect.
for(let i=0;i<18;i++){
  const when=ago(2+(17-i)*3), template=templates[i%3]!
  const entries=template.ex.map(e=>({id:e.id,target:e.target,sets:[1,2,3].map(()=>({w:e.weight+i*0.5,r:8+(i%3),rir:2,done:true})),note:'Synthetic training log'}))
  const workout:any={id:'synthetic-log-'+i,name:template.name,d:iso(when),start:when.getTime(),end:when.getTime()+45*60000,unit:'kg',bw:75,entries}
  workout.vol=workoutVolume(workout,createExerciseIndex([]))
  state.workouts.push(workout)
}
for(let i=0;i<12;i++){
  const when=ago((11-i)*5)
  state.bodyweight.push({d:iso(when),t:when.getTime(),w:76-i*.12})
  state.measurements.push({d:iso(when),t:when.getTime(),waist:84-i*.15,chest:98+i*.1,upperArmLeft:33+i*.05,bodyFat:19-i*.1,other:[]})
}
// Optional original examples for the current native-prescription and max-editor tour.
// The provenance digest identifies this invented text, not a workbook or source packet.
const mode = process.argv[2]
if (mode && !['--native', '--max'].includes(mode)) throw new Error('Use --native or --max, or omit the argument for the original tour.')
if (mode) {
  state.routines=[]; state.week={}; state.dayPlan={}; state.active=null
  state.programmes={version:1,fork:'opengym/1',definitions:[],cycles:[]}
  state.weighIn=false; state.sound=false; state.gifSize='full'; state.workoutView='list'
  const demo:any={id:mode==='--native'?'synthetic-native':'synthetic-max',
    name:mode==='--native'?'Native back-off example':'Training max example',unit:'kg',goal:'Strength',level:'Intermediate',
    daysPerWeek:1,lengthWeeks:1,equipment:['barbell'],licence:'Original synthetic example',
    source:{kind:'own',ref:'Invented screenshot example',private:false},
    endPlan:{kind:'stop',instructions:'Review this invented example before choosing another block.'},
    weeks:[{index:1,mode:'train',days:[{key:'d1',ordinal:1,sessions:[{sessionTemplateId:'main',routineSnapshot:{name:'Bench session',ex:[]}}]}]}]}
  const exercises=demo.weeks[0].days[0].sessions[0].routineSnapshot.ex
  if (mode==='--native') {
    const label='Barbell close-grip bench press'
    const prescription:any={version:1,variantKey:`source-variant:0030:${encodeURIComponent(label.toLowerCase())}:`,
      source:{slotId:'synthetic-native-bench',workbookSha256:createHash('sha256').update('Original screenshot example: three sets of five; back-off rows ten percent below the first completed set.').digest('hex'),sheet:'Invented example',cell:'A1'},
      sets:Array.from({length:3},(_,i)=>({sourceTemplateId:`synthetic-row-${i+1}`,reps:{kind:'fixed',min:5,max:5}}))}
    for (const row of prescription.sets.slice(1)) row.relativeLoad={kind:'same-entry-reduction',anchor:nativeRowIdentity(prescription,1),reductionPercent:10}
    demo.rulesSupported=true
    exercises.push({id:'0030',label,slotId:'synthetic-native-bench',sets:3,prog:'off',nativePrescription:prescription})
  } else {
    demo.maxBasis='tm'; demo.tmSeeds={bench:{value:100,unit:'kg'}}
    demo.progressionRules=[{id:'synthetic-percent',kind:'percentage',ref:{lift:'bench',basis:'tm'},
      rounding:{increment:2.5,mode:'nearest',usePlates:false},weeks:{'1':[{pct:.8,reps:5},{pct:.9,reps:5}]}}]
    exercises.push({id:'0025',slotId:'bench',role:'main',sets:2,reps:5,weight:80,prog:'off',target:{rir:2},
      progression:{kind:'manual',instructions:'Follow the exact percentage targets.',rules:['synthetic-percent']}})
  }
  const preview=importProgramme(demo)
  saveImportedProgramme(state,preview)
  activate(state,preview.definition as any,{cycleId:'synthetic-current-cycle',today})
}
console.log(JSON.stringify(state))
