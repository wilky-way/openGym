// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { programmeOwner, programmeTarget, updateProgramme, type ProgrammeTarget } from '../lib/programme-ui-services'
import { useRef, useState, type ChangeEvent } from 'react'
import { useUI } from '../store/useUI'
import { useStore } from '../store/useStore'
import { Button, Switch } from './ui'
import { CATALOGUE } from '@opengym/core/exercises'
import { t } from '../lib/i18n'
import { importProgramme, saveImportedProgramme } from '@opengym/core/programme-import'
export default function ProgrammeImport() {
  useStore(s=>s.user)
  const owner=programmeOwner
  const scope=programmeOwner()
  const reading=useRef(0)
  const S=useStore((s) =>s.S), ref=useRef<HTMLInputElement>(null), [input,setInput]=useState<{raw: unknown; filename: string; scope: string; generation: number; target: ProgrammeTarget} | null>(null),[mappings,setMappings]=useState<Record<string,string>>({}),[prescriptions,setPrescriptions]=useState<Record<string,Record<string,number>>>({}),[error,setError]=useState(''),[replace,setReplace]=useState(false)
  let preview: {definition?: any; error?: string; skipped?: boolean; warnings: string[]; unknown: {key: string; name?: string}[]; unprescribed: {key: string; name?: string}[]} = {warnings:[],unknown:[],unprescribed:[]}
  try {if(input?.scope===scope)preview=importProgramme(input.raw,{filename:input.filename,mappings,prescriptions,customEx:S.customEx},createExerciseIndex(S.customEx))}catch(err: any){preview={error:err.message,warnings:[],unknown:[],unprescribed:[]}}
  const pick=async (event: ChangeEvent<HTMLInputElement>) =>{
    const file=event.target.files?.[0];if(!file)return
    const request=++reading.current, account=owner(), target=programmeTarget(account)
    setInput(null);setError('');setMappings({});setPrescriptions({});setReplace(false)
    try {if(file.size>5*1024*1024)throw new Error('Program files must be smaller than 5 MB.');const raw=JSON.parse(await file.text());if(request===reading.current && account===owner())setInput({raw,filename:file.name,scope:account,generation:request,target});else if(request===reading.current && account!==owner())useUI.getState().toast(t('Account changed. Choose the file again.'))}catch(err: any){if(request===reading.current && account===owner()){setInput(null);setError(t(err instanceof SyntaxError?'Could not read that file':err.message))}}
    event.target.value=''
  }
  const save=()=>{try{if(!input || input.scope!==owner() || input.generation!==reading.current)throw new Error('The account or server changed. Choose the file again.');if(!updateProgramme((s: any) =>saveImportedProgramme(s,preview,{replace},createExerciseIndex(s.customEx)),programmeTarget(input.scope,draft=>input.target(draft) && input.generation===reading.current)))return;reading.current++;setInput(null);setError('')}catch(err: any){setError(t(err.message));useUI.getState().toast(t(err.message))}}
  return <section className="card">
    <Button onClick={()=>ref.current?.click()}>{t('Import program file')}</Button><input ref={ref} type="file" accept=".json,application/json" onChange={pick} hidden aria-label={t('Program file')}/>
    {preview?.error && <p role="alert">{t(preview.error)}</p>}
    {preview?.skipped && <p>{t('The flagged-program index is skipped. Choose a program file.')}</p>}
    {preview?.definition && <><h3>{t('Import preview')} · {preview.definition.name}</h3><p>{t('{0} weeks',preview.definition.weeks.length)} · {preview.definition.needsReview?.length?t('Needs review'):t('Ready')}{preview.definition.source?.private && ' · '+t('Private import')}</p>
      {preview.warnings.map((w: any) =><p className="sect-f" key={w}>{t(w)}</p>)}
      {preview.unknown.map((e: any) =><label key={e.key}>{t('Unknown exercise: {0}',e.name)}<select aria-label={t('Map exercise: {0}',e.name)} value={mappings[e.key] || ''} onChange={(event) =>setMappings({...mappings,[e.key]:event.target.value})}><option value="">{t('Choose exercise')}</option>{[...CATALOGUE,...S.customEx].map((ex: any) =><option key={ex.id} value={ex.id}>{ex.n} · {ex.eq}</option>)}</select></label>)}
      {preview.unprescribed.map((e: any) =><div key={e.key}><p>{t('Enter sets and reps: {0}',e.name)}</p>{['sets','reps','weight'].map((field: any) =><label key={field}>{t(field)}<input type="number" min={field==='weight'?0:1} step={field==='weight'?'any':1} value={prescriptions[e.key]?.[field] || ''} onChange={(event) =>setPrescriptions({...prescriptions,[e.key]:{...prescriptions[e.key],[field]:Number(event.target.value)}})}/></label>)}</div>)}
      {S.programmes.definitions.some((d: any) =>d.id===preview.definition.id) && <label className="row">{t('Replace saved definition')}<Switch checked={replace} onChange={setReplace}/></label>}
      {preview.definition.needsReview?.map((reason: any) =><p role="status" key={reason}>{t(reason)}</p>)}
      {preview.definition.instructions && <p className="programme-instructions">{preview.definition.instructions}</p>}
      <p className="sect-f">{t('Save program')} → {t('Start this program')}</p>
      <Button variant="primary" disabled={!!preview.unknown.length || !!preview.unprescribed.length || S.programmes.definitions.some((d: any) =>d.id===preview.definition.id) && !replace} onClick={save}>{t('Save program')}</Button><Button onClick={()=>{reading.current++;setInput(null)}}>{t('Cancel')}</Button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
