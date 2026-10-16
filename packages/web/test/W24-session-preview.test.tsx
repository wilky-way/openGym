// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { KEY, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { configureProgrammeUi, programmeUi } from '../src/lib/programme-ui-services'
import { workoutSheetPlatform } from './workout-sheet-environment'
import { sessionPreviewSheet, programmePreviewContent } from '../src/components/SessionPreview'
import Programs, { ProgrammeRoutines } from '../src/views/Programs'
import Plan from '../src/views/Plan'
import { insertDeload } from '@opengym/core/programme'
import { p7Fixture } from './p7-fixture'

let roots: Root[] = []
function mount(element: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root); act(() => root.render(element)); return host }
function Sheets() { const sheets = useUI(s => s.sheets); return <>{sheets.map(s => <div key={s.id}>{s.render(() => useUI.getState().closeSheet(s.id))}</div>)}</> }
function plant(S: any) { act(() => {useStore.setState({S,user:null});useStore.getState().update(() => {});useUI.setState({sheets:[]})}) }
function open(cycleId = 'c', day = 'd1', session: string | undefined = 'main') { act(() => sessionPreviewSheet(S => {const c=S.programmes.cycles.find((c:any)=>c.id===cycleId);return programmePreviewContent(S,c?.snapshot,c,{index:1},day,session)}));return mount(<Sheets/>) }
function click(host: HTMLElement, text: string) {const button = [...host.querySelectorAll('button')].find(b=>b.textContent === text)!; expect(button).toBeTruthy();act(()=>button.click())}
const memory = () => JSON.stringify(useStore.getState().S)
const bytes = () => workoutSheetPlatform.kv.get(KEY)
beforeEach(() => {vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));configureProgrammeUi({platform:workoutSheetPlatform,initialProgramId:()=> 'c',startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn()})})
afterEach(() => {act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML=''})

it('renders a plain programme in order with authored ranges, per-set effort/rest and warm-ups; no Start or writes', () => {
  const S=p7Fixture(false), r=S.routines[0];r.ex=[{id:'0025',sets:2,reps:8,repsMin:6,weight:100,warmupSets:2,restSec:90,pyramid:[8,6],pyramidRest:[60,120],setRepsMin:[6,4],target:{rir:2},setTargets:[{rpe:9},{rir:3}]},{id:'0001',sets:1,reps:12}];plant(S)
  const before=memory(), stored=bytes(), host=open()
  expect(host.textContent).toContain('2 × 6–8');expect(host.textContent).toContain('Warm-up 1');expect(host.textContent).toContain('Warm-up 2')
  expect(host.textContent).toContain('Set 1 · 6–8 reps · 100 lb · 1 RIR · Rest 60s');expect(host.textContent).toContain('Set 2 · 4–6 reps · 100 lb · 3 RIR · Rest 120s')
  expect(host.querySelectorAll('.session-preview-exercise')).toHaveLength(2);expect(host.querySelectorAll('input')).toHaveLength(0);expect([...host.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['Close'])
  expect(memory()).toBe(before);expect(bytes()).toBe(stored);click(host,'Close');expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it('reuses the P7 prescribed load and complete expandable Why in the profile scale, byte-identically', () => {
  const S=p7Fixture();S.effort='rpe';plant(S);const before=memory(), stored=bytes(),host=open()
  expect(host.textContent).toContain('80 lb');expect(host.textContent).toContain('90 lb');expect(host.textContent).toContain('RPE 8')
  expect(host.textContent).not.toContain('Your log wins');expect(host.querySelectorAll('.prescription-why')).toHaveLength(1)
  act(()=>{host.querySelectorAll('details').forEach(d=>{d.open=true;d.dispatchEvent(new Event('toggle'))})})
  expect(host.textContent).toContain('pct');expect(host.textContent).toContain('100');expect(memory()).toBe(before);expect(bytes()).toBe(stored)
  click(host,'Close');expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it('shows superset members in exercise order with name and round rest, and distinguishes AMRAP and final-to-failure', () => {
  const S=p7Fixture(false);S.routines[0].ex=[{id:'0025',sets:2,reps:8,pyramid:[8,'max'],setRepsMin:[6,5],sg:'a',sgName:'Push/pull',sgRest:120},{id:'0001',sets:2,reps:10,lastToFailure:true,sg:'a'},{id:'0025',sets:1,reps:'amrap',repsMin:4}];plant(S);const host=open()
  expect(host.textContent).toContain('Superset Push/pull · Back-to-back · 120s rest after each round');expect(host.textContent).toContain('AMRAP (at least 5)');expect(host.textContent).toContain('Set 2 · AMRAP reps');expect(host.textContent).toContain('AMRAP (at least 4)')
  expect([...host.querySelectorAll('.session-preview-exercise .tt')].map(e=>e.textContent)).toEqual(['barbell bench press','3/4 sit-up','barbell bench press'])
})
it.each(['routine','cycle','account','profile','document','session'])('invalidates a captured preview after a %s target change, with no stale content or writes', change => {
  plant(p7Fixture());const host=open()
  act(()=>{const S=structuredClone(useStore.getState().S);if(change==='routine')S.routines[0].name='Replacement';if(change==='cycle')S.programmes.cycles=[];if(change==='profile')S.activeEquipId='other';if(change==='session')S.active={id:'new',start:123,entries:[]};useStore.setState({S,...(change==='account'?{user:{id:'other'} as any}:{}),...(change==='document'?{documentInstance:(useStore.getState().documentInstance ?? 0)+1}:{})})})
  const before=memory(),stored=bytes();expect(host.textContent).toContain('Preview changed');expect(host.textContent).not.toContain('80 lb');click(host,'Close');expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it('allows unrelated settings changes while the captured programme stays the same', () => {plant(p7Fixture());const host=open();act(()=>useStore.setState({S:{...useStore.getState().S,sound:true}}));expect(host.textContent).toContain('80 lb');expect(host.textContent).not.toContain('Preview changed')})
it('opens the Programs cycle row as a preview even for skipped occurrences', () => {const S=p7Fixture();S.programmes.cycles[0].occurrences[0].status='skipped';plant(S);const host=mount(<><Programs/><Sheets/></>);act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click());expect(host.querySelector('[aria-label="Session preview"]')).toBeTruthy();expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('80 lb');expect([...host.querySelectorAll('[aria-label="Session preview"] button')].map(b=>b.textContent)).toEqual(['Close'])})
it('opens an unactivated programme day and each named session, preserving session order and exact selection', () => {
  const S=p7Fixture(false),definition=structuredClone(S.programmes.cycles[0].snapshot);definition.id='plain';definition.weeks[0].days[0].sessions.push({sessionTemplateId:'later',routineSnapshot:{name:'Evening',ex:[{id:'0001',sets:1,reps:12}]}});S.programmes={definitions:[definition],cycles:[]};S.routines=[];plant(S)
  configureProgrammeUi({...{platform:workoutSheetPlatform,startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn()},initialProgramId:()=> 'plain'})
  const host=mount(<><Programs/><Sheets/></>);act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click());expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Synthetic session');expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Evening');click(host,'Close')
  act(()=> (host.querySelector('[aria-label="Preview Evening"]') as HTMLButtonElement).click());expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Evening');expect(host.querySelector('[aria-label="Session preview"]')?.textContent).not.toContain('Synthetic session')
})
it('opens the programme routine week row read-only and retains a separate Edit action', () => {plant(p7Fixture());const nav=vi.fn(),host=mount(<><ProgrammeRoutines S={useStore.getState().S} nav={nav}/><Sheets/></>);act(()=> (host.querySelector('.program-preview-link') as HTMLButtonElement).click());expect(host.textContent).toContain('Read-only preview');expect(nav).not.toHaveBeenCalled();expect(host.textContent).toContain('Edit')})
it('previews a fixed plan day without opening the assignment picker or writing the document', () => {const S=p7Fixture(false);S.programmes={definitions:[],cycles:[]};delete S.routines[0].programme;S.week={1:[S.routines[0].id]};S.scheduleMode='week';S.queue=null;S.rotation=null;plant(S);const before=memory(),stored=bytes();const host=mount(<MemoryRouter><Plan/><Sheets/></MemoryRouter>);act(()=> (host.querySelector('[aria-label="Preview Monday"]') as HTMLButtonElement).click());expect(host.textContent).toContain('Read-only preview');expect(memory()).toBe(before);expect(bytes()).toBe(stored);click(host,'Close');expect(bytes()).toBe(stored)})
it('renders a P7 AMRAP minimum and zero working sets without manufacturing reps or rows', () => {const S=p7Fixture();S.programmes.cycles[0].snapshot.progressionRules[0].weeks['1']=[{pct:.8,reps:'amrap',repsMin:5},{pct:.9,reps:5}];S.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].reps='amrap';plant(S);const host=open();expect(host.textContent).toContain('AMRAP (at least 5)');click(host,'Close');const next=p7Fixture();const snap=next.programmes.cycles[0].snapshot;snap.progressionRules=[{id:'ramp',kind:'volume-ramp',scope:{slots:[{week:1,day:'d1',session:'main',slot:'bench'}]},startSets:0,addPerWeek:0,maxSets:0,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false}];snap.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.rules=['ramp'];snap.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].progression.rules=[];next.routines[0].ex[0].progression.rules=['ramp'];next.routines[0].ex[0].warmupSets=2;plant(next);const zero=open();expect(zero.textContent).toContain('No working sets prescribed');expect(zero.querySelectorAll('.prescribed-sets li')).toHaveLength(0);expect(zero.textContent).not.toContain('Warm-up')})
it('keeps a preview stale after a session changes away and back before React renders', () => {plant(p7Fixture());const host=open();const initial=useStore.getState().S;act(()=>{useStore.setState({S:{...initial,active:{id:'new',start:1,entries:[]}}});useStore.setState({S:initial})});expect(host.textContent).toContain('Preview changed');expect(host.textContent).not.toContain('80 lb')})
it('uses the first pyramid working load for warm-ups and treats zero rest as the default', () => {const S=p7Fixture(false);S.routines[0].ex=[{id:'0025',sets:2,reps:8,weight:40,pyramid:[8,6],pyramidWeight:[100,80],pyramidRest:[0,120],warmupSets:2,restSec:0}];plant(S);const host=open();expect(host.textContent).toContain('Warm-up 1 · 8 reps · 50 lb');expect(host.textContent).toContain('Warm-up 2 · 8 reps · 75 lb');expect(host.textContent).toContain('Set 1 · 8 reps · 100 lb · Rest 90s');expect(host.textContent).toContain('Set 2 · 6 reps · 80 lb · Rest 120s')})
it('opens the full Programs preview under Strict Mode', () => {plant(p7Fixture());const host=mount(<React.StrictMode><Programs/><Sheets/></React.StrictMode>);act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click());expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('80 lb')})
it('does not retarget a captured programme routine click to a new account with matching ids', () => {plant(p7Fixture());const host=mount(<ProgrammeRoutines S={useStore.getState().S} nav={vi.fn()}/>),clickOld=(host.querySelector('.program-preview-link') as HTMLButtonElement).click.bind(host.querySelector('.program-preview-link'));act(()=>useStore.setState({user:{id:'other'} as any}));act(clickOld);expect(useUI.getState().sheets).toHaveLength(0)})
it('includes P7 loads in a plan rotation preview and invalidates changes to its cycle', () => {plant(p7Fixture());const host=mount(<MemoryRouter><Plan/><Sheets/></MemoryRouter>);const preview=host.querySelector('[aria-label^="Preview Synthetic display block"]') as HTMLButtonElement;act(()=>preview.click());expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('80 lb');act(()=>{const S=structuredClone(useStore.getState().S);S.programmes.cycles[0].tmSeed={bench:200};useStore.setState({S})});expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('Preview changed')})
it('selects an inserted week by full weekId and refuses ambiguous occurrences', () => {const S=p7Fixture(false),week=insertDeload(S,'c',{key:'probe'}),c=S.programmes.cycles[0];const content=programmePreviewContent(S,c.snapshot,c,week,'d1','main')!;expect(content.routines[0].id).toBe('c-deload-probe-d1');const before=JSON.stringify(S);c.occurrences.push({...c.occurrences.find((o:any)=>o.weekId===week.weekId),instanceId:'duplicate'});expect(programmePreviewContent(S,c.snapshot,c,week,'d1','main')).toBeNull();expect(before).not.toBe(JSON.stringify(S))})
it('converts an unactivated snapshot load from programme lb to profile kg without changing its bytes', () => {const S=p7Fixture(false);S.unit='kg';const definition=structuredClone(S.programmes.cycles[0].snapshot);S.programmes={definitions:[definition],cycles:[]};S.routines=[];plant(S);const before=memory(),stored=bytes();act(()=>sessionPreviewSheet(live=>programmePreviewContent(live,live.programmes.definitions[0],undefined,{index:1},'d1','main')));const host=mount(<Sheets/>);expect(host.textContent).toContain('18.25 kg');expect(host.textContent).not.toContain('40 kg');expect(memory()).toBe(before);expect(bytes()).toBe(stored)})
it('resolves legacy per-set TM percentages using the existing pure calculation', () => {const S=p7Fixture(false);S.routines[0].ex[0]={...S.routines[0].ex[0],pyramid:[5,5],tm:{key:'bench',percentages:[80,90]},weight:40};plant(S);const before=memory(),stored=bytes(),host=open();expect(host.textContent).toContain('80 lb');expect(host.textContent).toContain('90 lb');expect(host.textContent).not.toContain('40 lb');expect(memory()).toBe(before);expect(bytes()).toBe(stored)})
it('invalidates a cached prescription when completed history changes', () => {plant(p7Fixture());const host=open();act(()=>useStore.setState({S:{...useStore.getState().S,workouts:[{id:'history-change',d:'2026-10-11',entries:[]}]}}));expect(host.textContent).toContain('Preview changed');expect(host.textContent).not.toContain('80 lb')})
it('uses the exercise loading step to build warm-up rows', () => {const S=p7Fixture(false);S.routines[0].ex=[{id:'0025',sets:2,reps:8,weight:110,inc:10,warmupSets:2}];plant(S);const host=open();expect(host.textContent).toContain('Warm-up 1 · 8 reps · 50 lb');expect(host.textContent).toContain('Warm-up 2 · 8 reps · 80 lb')})
it.each(['editingWorkoutId','programme'])('invalidates a preview when stable active-session %s context changes', field => {const S=p7Fixture();S.active={id:'same',start:1,entries:[],editingWorkoutId:'old',programme:{instanceId:'old'}};plant(S);const host=open();act(()=>{const next=structuredClone(useStore.getState().S);if(field==='editingWorkoutId')next.active.editingWorkoutId='new';else next.active.programme.instanceId='new';useStore.setState({S:next})});expect(host.textContent).toContain('Preview changed');expect(host.textContent).not.toContain('80 lb')})

it('keeps the Programs preview read-only and opens the existing pending session sheet with its guarded Start', () => {
  plant(p7Fixture()); const start=vi.fn(); configureProgrammeUi({...programmeUi(),startFlow:start})
  const before=memory(),stored=bytes(),host=mount(<><Programs/><Sheets/></>)
  act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Session preview"]')?.textContent).toContain('80 lb')
  expect(memory()).toBe(before);expect(bytes()).toBe(stored);expect(start).not.toHaveBeenCalled()
  click(host,'Open session')
  expect(host.querySelector('[aria-label="Session preview"]')).toBeNull()
  expect(useUI.getState().sheets).toHaveLength(1);expect(host.textContent).toContain('Projected session')
  expect(memory()).toBe(before);expect(bytes()).toBe(stored);expect(start).not.toHaveBeenCalled()
  click(host,'Start');expect(start).toHaveBeenCalledExactlyOnceWith([useStore.getState().S.routines[0].id])
  expect(useUI.getState().sheets).toHaveLength(0);expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it.each(['paused','archived','finished','done','skipped'])('keeps a %s session preview without the active-session handoff', status => {
  const S=p7Fixture(); if(status==='done')S.workouts=[{id:'done',d:'2026-10-12',entries:[],programmeInstance:{cycleId:'c',instanceId:S.programmes.cycles[0].occurrences[0].instanceId}}];else if(status==='skipped')S.programmes.cycles[0].occurrences[0].status='skipped';else S.programmes.cycles[0].status=status
  plant(S);const before=memory(),stored=bytes(),host=mount(<><Programs/><Sheets/></>);act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Session preview"]')).toBeTruthy();expect([...host.querySelectorAll('[aria-label="Session preview"] button')].map(b=>b.textContent)).toEqual(['Close'])
  expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it.each(['account','document','cycle','session'])('refuses a captured Open session click after %s changes away and back before rendering', change => {
  plant(p7Fixture());const host=mount(<><Programs/><Sheets/></>);act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click())
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Open session')!;expect(button).toBeTruthy()
  const initial=useStore.getState(),before=memory(),stored=bytes()
  act(()=>{
    if(change==='account') {useStore.setState({user:{id:'other'} as any});useStore.setState({user:initial.user})}
    if(change==='document') {useStore.setState({documentInstance:(initial.documentInstance ?? 0)+1});useStore.setState({documentInstance:initial.documentInstance})}
    if(change==='cycle') {const S=structuredClone(initial.S);S.programmes.cycles[0].status='paused';useStore.setState({S});useStore.setState({S:initial.S})}
    if(change==='session') {useStore.setState({S:{...initial.S,active:{id:'other',start:1,entries:[]} as any}});useStore.setState({S:initial.S})}
    button.click()
  })
  expect(useUI.getState().sheets).toHaveLength(1);expect(host.textContent).toContain('Preview changed')
  expect(host.textContent).not.toContain('Projected session');expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Start')).toBe(false)
  expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})
it('retains the existing Start owner guard after handing off from the preview', () => {
  plant(p7Fixture());const start=vi.fn();configureProgrammeUi({...programmeUi(),startFlow:start});const host=mount(<><Programs/><Sheets/></>)
  act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click());click(host,'Open session')
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Start')!,initial=useStore.getState(),before=memory(),stored=bytes();expect(button).toBeTruthy()
  act(()=>{useStore.setState({user:{id:'other'} as any});useStore.setState({user:initial.user});button.click()})
  expect(start).not.toHaveBeenCalled();expect(memory()).toBe(before);expect(bytes()).toBe(stored);expect(useUI.getState().toastMsg).toContain('Account changed')
})


it.each(['close','handoff','dismiss'])('expires an escaped Open session callback after %s without reopening or duplicating action sheets', action => {
  plant(p7Fixture());const start=vi.fn();configureProgrammeUi({...programmeUi(),startFlow:start});const host=mount(<><Programs/><Sheets/></>)
  act(()=> (host.querySelector('.program-cell') as HTMLButtonElement).click())
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Open session')!
  const props=(button as any)[Object.keys(button).find(k=>k.startsWith('__reactProps'))!],saved=props.onClick
  const before=memory(),stored=bytes()
  if(action==='close')click(host,'Close');else if(action==='handoff')click(host,'Open session');else act(()=>useUI.getState().closeSheet(useUI.getState().sheets[0]!.id))
  const sheets=useUI.getState().sheets.map(s=>s.id)
  act(()=>{saved();saved()})
  expect(useUI.getState().sheets.map(s=>s.id)).toEqual(sheets);expect(sheets).toHaveLength(action==='handoff'?1:0)
  expect(start).not.toHaveBeenCalled();expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})


it.each(['paused','archived','finished','done','skipped'])('checks live eligibility when an escaped Programs row runs after the target becomes %s', status => {
  plant(p7Fixture());const start=vi.fn();configureProgrammeUi({...programmeUi(),startFlow:start});const host=mount(<><Programs/><Sheets/></>)
  const row=host.querySelector('.program-cell') as HTMLButtonElement,props=(row as any)[Object.keys(row).find(k=>k.startsWith('__reactProps'))!],saved=props.onClick
  const changed=structuredClone(useStore.getState().S),c=changed.programmes.cycles[0]!
  if(status==='done')changed.workouts=[{id:'done',d:'2026-10-12',entries:[],programmeInstance:{cycleId:c.id,instanceId:c.occurrences[0]!.instanceId}} as any];else if(status==='skipped')c.occurrences[0]!.status='skipped';else c.status=status as any
  const before=JSON.stringify(changed),stored=bytes()
  act(()=>{useStore.setState({S:changed});saved()})
  expect(host.querySelector('[aria-label="Session preview"]')).toBeTruthy();expect([...host.querySelectorAll('[aria-label="Session preview"] button')].map(b=>b.textContent)).toEqual(['Close'])
  expect(start).not.toHaveBeenCalled();expect(memory()).toBe(before);expect(bytes()).toBe(stored)
})

it('bodyweight warm-ups do not display a manufactured 0 lb load', () => {
 const S = p7Fixture(false); S.routines[0].ex = [{id:'0001', sets:2, reps:8, warmupSets:2}]; plant(S)
 const host = open(); expect(host.textContent).not.toContain('0 lb')
})
it('superset members show round rest without per-set rest instructions', () => {
 const S = p7Fixture(false); S.routines[0].ex = [{id:'0025', sets:2, reps:8, sg:'g', weight:40, restSec:70}, {id:'0001', sets:2, reps:8, sg:'g', restSec:80}]
 S.routines[0].supersets = {g:{name:'Pair', rest:90}}; plant(S)
 const host = open(); expect(host.textContent).toContain('Back-to-back'); expect(host.textContent).not.toContain('Rest 70s'); expect(host.textContent).not.toContain('Rest 80s')
})
