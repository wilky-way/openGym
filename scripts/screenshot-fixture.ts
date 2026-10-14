import { activate } from '../packages/core/src/programme'

// Entirely invented. No user export, seed library, or commercial template is read.
const date = new Date()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const today = iso(date)
const definition = {
  id:'synthetic-strength', name:'Everyday Strength', unit:'kg', goal:'Strength', level:'Intermediate',
  daysPerWeek:3, lengthWeeks:4, equipment:['barbell'], licence:'Original synthetic example',
  source:{kind:'library',ref:'Synthetic screenshot fixture',private:false}, endPlan:{kind:'stop',instructions:'Review your log before choosing the next block.'},
  weeks:Array.from({length:4},(_,i)=>({index:i+1,mode:'train',days:[1,2,3].map(n=>({key:'day'+n,ordinal:n,sessions:[{
    sessionTemplateId:'main'+n,routineSnapshot:{name:['Bench & Pull','Lower Body','Full Body'][n-1],prog:'off',ex:[{
      id:'0025',slotId:'bench',role:'main',sets:3,reps:8,weight:40,prog:'off',target:{rir:2},
      progression:{kind:'manual',instructions:'Choose a comfortable load and keep two reps in reserve.'},
    }]},
  }]}))})),
}
const state:any={unit:'kg',theme:'dark',accent:'lime',effort:'rir',restSec:90,workouts:[],routines:[],week:{},dayPlan:{},bodyweight:[],customEx:[],active:null,
  hints:{},programmes:{version:1,fork:'opengym/1',definitions:[definition],cycles:[]}}
activate(state,definition as any,{cycleId:'synthetic-cycle',today})
for(let i=0;i<6;i++){
  const when=new Date(date);when.setDate(when.getDate()-2-i*3)
  state.workouts.push({id:'synthetic-log-'+i,name:['Bench & Pull','Lower Body','Full Body'][i%3],d:iso(when),start:when.getTime(),end:when.getTime()+45*60000,unit:'kg',bw:75,vol:(40+i*2.5)*24,
    entries:[{id:'0025',sets:[1,2,3].map(()=>({w:40+i*2.5,r:8,rir:2,done:true})),note:'Synthetic training log'}]})
}
console.log(JSON.stringify(state))
