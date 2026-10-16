import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { Button, Switch } from './ui.jsx'
import { CATALOGUE } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { importProgramme, saveImportedProgramme } from '../lib/programme-import.js'
export default function ProgrammeImport() {
  const S=useStore(s=>s.S), ref=useRef(), [input,setInput]=useState(null),[mappings,setMappings]=useState({}),[prescriptions,setPrescriptions]=useState({}),[error,setError]=useState(''),[replace,setReplace]=useState(false)
  let preview
  try {if(input)preview=importProgramme(input.raw,{filename:input.filename,mappings,prescriptions,customEx:S.customEx})}catch(err){preview={error:err.message}}
  const pick=async event=>{
    const file=event.target.files?.[0];if(!file)return
    setError('');setMappings({});setPrescriptions({});setReplace(false)
    try {if(file.size>5*1024*1024)throw new Error('Program files must be smaller than 5 MB.');setInput({raw:JSON.parse(await file.text()),filename:file.name})}catch(err){setInput(null);setError(t(err instanceof SyntaxError?'Could not read that file':err.message))}
    event.target.value=''
  }
  const save=()=>{try{useStore.getState().update(s=>saveImportedProgramme(s,preview,{replace}));setInput(null);setError('')}catch(err){setError(t(err.message))}}
  return <section className="card">
    <Button onClick={()=>ref.current.click()}>{t('Import program file')}</Button><input ref={ref} type="file" accept=".json,application/json" onChange={pick} hidden aria-label={t('Program file')}/>
    {preview?.error && <p role="alert">{t(preview.error)}</p>}
    {preview?.skipped && <p>{t('The flagged-program index is skipped. Choose a program file.')}</p>}
    {preview?.definition && <><h3>{t('Import preview')} · {preview.definition.name}</h3><p>{t('{0} weeks',preview.definition.weeks.length)} · {preview.definition.needsReview?.length?t('Needs review'):t('Ready')}{preview.definition.source?.private && ' · '+t('Private import')}</p>
      {preview.warnings.map(w=><p className="sect-f" key={w}>{t(w)}</p>)}
      {preview.unknown.map(e=><label key={e.key}>{t('Unknown exercise: {0}',e.name)}<select aria-label={t('Map exercise: {0}',e.name)} value={mappings[e.key] || ''} onChange={event=>setMappings({...mappings,[e.key]:event.target.value})}><option value="">{t('Choose exercise')}</option>{[...CATALOGUE,...S.customEx].map(ex=><option key={ex.id} value={ex.id}>{ex.n} · {ex.eq}</option>)}</select></label>)}
      {preview.unprescribed.map(e=><div key={e.key}><p>{t('Enter sets and reps: {0}',e.name)}</p>{['sets','reps','weight'].map(field=><label key={field}>{t(field)}<input type="number" min={field==='weight'?0:1} step={field==='weight'?'any':1} value={prescriptions[e.key]?.[field] || ''} onChange={event=>setPrescriptions({...prescriptions,[e.key]:{...prescriptions[e.key],[field]:Number(event.target.value)}})}/></label>)}</div>)}
      {S.programmes.definitions.some(d=>d.id===preview.definition.id) && <label className="row">{t('Replace saved definition')}<Switch checked={replace} onChange={setReplace}/></label>}
      {preview.definition.needsReview?.map(reason=><p role="status" key={reason}>{t(reason)}</p>)}
      {preview.definition.instructions && <p className="programme-instructions">{preview.definition.instructions}</p>}
      <p className="sect-f">{t('Save program')} → {t('Start this program')}</p>
      <Button variant="primary" disabled={!!preview.unknown.length || !!preview.unprescribed.length || S.programmes.definitions.some(d=>d.id===preview.definition.id) && !replace} onClick={save}>{t('Save program')}</Button><Button onClick={()=>setInput(null)}>{t('Cancel')}</Button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
