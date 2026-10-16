import type { StateDoc } from '../../contract/domain/state-doc'
import { normalizeMeasurementsState, enabledMeasurementFields, measurementSeries, latestMeasurement } from '../src/measurements'

// This fixture is compiled by the gate. Real store/view consumers pass the frozen doc directly.
export function consumeMeasurements(doc: StateDoc) {
  const fields = enabledMeasurementFields(doc)
  const series = measurementSeries(doc, 'waist', 7, Date.UTC(2026, 7, 15))
  const latest = latestMeasurement(doc, 'waist')
  const normalized = normalizeMeasurementsState(doc)
  const enabled: string[] = normalized.measurementEnabled
  const unit: StateDoc['unit'] = normalized.unit
  return { fields, series, latest, normalized, enabled, unit }
}
