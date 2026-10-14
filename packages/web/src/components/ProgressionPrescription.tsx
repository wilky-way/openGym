import { t } from '../lib/i18n'
import type { PrescribedSlot, Why } from '@opengym/contract/domain/progression'
import { targetLabel } from '@opengym/core/programme-targets'
import type { PrescriptionDisplay } from '../lib/progression-display'
import './ProgressionPrescription.css'

function WhyLine({why}: {why: Why}) {
  return <li><strong>{why.ruleId} · {why.kind}</strong>: {why.text}
    <dl>{Object.entries(why.inputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
  </li>
}

export function SlotPrescription({slot, name, scale, readOnly = false}: {slot: PrescribedSlot; name?: string; scale: string; readOnly?: boolean}) {
  return <section className="progression-prescription" aria-label={t('Prescribed {0}', name || t('exercise'))}>
    <strong>{name ? `${name} · ` : ''}{t('Prescribed: {0} working sets', slot.sets.length)}</strong>
    {slot.sets.length === 0 && <p>{t('No working sets prescribed.')}</p>}
    <ol className="prescribed-sets">{slot.sets.map((set, i) => {
      const label = targetLabel({...set.target, ...(set.target?.pct != null ? {pct: set.target.pct * 100} : {})}, undefined, scale)
      return <li key={i}>
      {set.reps === 'amrap' ? (set.repsMin != null ? t('AMRAP (at least {0})', set.repsMin) : t('AMRAP'))
        : t('{0} reps', `${set.repsMin != null && set.repsMin !== set.reps ? `${set.repsMin}–` : ''}${set.reps}`)}
      {' · '}{set.load == null ? t('Choose load') : `${set.load} ${set.unit}`}
      {label && ` · ${label}`}
    </li>})}</ol>
    <details className="prescription-why"><summary>{t('Why')}</summary>
      <ul>{slot.why.map((why, i) => <WhyLine key={i} why={why}/>)}</ul>
      {slot.sets.map((set, i) => set.why.length > 0 && <div key={i}><strong>{t('Set {0}', i + 1)}</strong>
        <ul>{set.why.map((why, j) => <WhyLine key={j} why={why}/>)}</ul></div>)}
    </details>
    {!readOnly && <p className="sect-f">{t('You can change any logged load, reps or sets. Your log wins.')}</p>}
  </section>
}

/** Entirely presentational: native details expands without a store update, API call or sheet. */
export default function ProgressionPrescription({display, scale, day, session, week, showSession = false}: {
  display: PrescriptionDisplay | null; scale: string; day?: string; session?: string; week?: number; showSession?: boolean
}) {
  if (!display) return null
  const matches = (ref: {week: number; day: string; session: string}) => (week == null || ref.week === week) &&
    (day == null || ref.day === day) && (session == null || ref.session === session)
  const slots = display.slots.filter(({prescription}) => matches(prescription.ref))
  const errors = display.result.slotErrors?.filter(e => matches(e.slot)) ?? []
  const warnings = display.result.warnings.filter(w => !w.ref || matches(w.ref))
  return <div className="progression-display">
    {display.result.error && <p role="status">{t('Prescription unavailable: {0}', display.result.error.code)}</p>}
    {errors.map((e, i) => <p role="status" key={i}>{t('Prescription unavailable for {0}: {1}', e.slot.slot, e.code)}</p>)}
    {warnings.map((w, i) => <p className="sect-f" key={i}>{w.code}: {w.message}</p>)}
    {slots.map(({prescription, name, sessionName}) => <div className="prescription-session" key={JSON.stringify(prescription.ref)}>
      {showSession && <p className="ss">{prescription.ref.day.toUpperCase()} · {sessionName}</p>}
      <SlotPrescription slot={prescription} name={name} scale={scale}/>
    </div>)}
  </div>
}
