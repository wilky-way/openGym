import type { GoldenScenario } from './helpers'
import { dataScenarios } from './data'
import { stampingScenarios } from './stamping'
import { programmeScenarios } from './programmes'
import { routeScenarios } from './routes'

export * from './helpers'
export { ROUTE_IDENTITY_FIELDS, PNG_SHA } from './routes'
export { recordScenario, replayOnFreshOracle } from './run'

export const GOLDEN_SCENARIOS: GoldenScenario[] = [...dataScenarios, ...stampingScenarios, ...programmeScenarios, ...routeScenarios]

/**
 * INVs with no server-observable surface, each with the reason and the unit that owns it. The gate fails if an
 * INV is neither exercised by a scenario nor listed here, so no invariant can silently drop out.
 */
export const DEFERRED_INVS: Record<number, string> = {
  19: 'client merge (sync-merge): tie-break is a pure function; K10 client sync',
  22: 'client merge: which keys a change marks as added back; K10 client sync',
  23: 'client causal clock lift; K10 client sync',
  24: 'client per-field entry merge; K10 client sync',
  25: 'client undo markers; K10 client sync',
  26: 'client stamped maps merge; K10 client sync',
  27: 'client settings/plan-day merge; K10 client sync',
  28: 'client routine order merge; K10 client sync',
  29: 'client weigh-in/measurement merge; K10 client sync',
  30: 'client exWeights recompute; K10 client sync',
  31: 'deleted media: INV-31 union is waived by GM ruling; K10 owns the deletion waiver',
  32: 'client unit conversion; K10 client sync',
  33: 'client reset copy merge; K10 client sync',
  34: 'client mergeStates purity; K10 client sync',
  35: 'client accent sanitising; K10 client sync',
  50: 'source identity of programme-sync.js on both sides (a file check, not a wire behaviour); K04 programme client copy',
  51: 'client push base revision per tab; W07 sync engine',
  55: 'client adopt-or-merge on a rewound or foreign-wid document; the server half (409 on foreign wid) is data-wid-identity; W07 sync engine',
  53: 'client forced replace: the server half (baseRev-less PUT overwrites) is data-rev-conditional INV-3; W07 sync engine',
  54: 'client single PUT in flight; W07 sync engine (server cannot observe)',
  56: 'client adopt/keep state machine; W07 sync engine',
  57: 'client rejects non-JSON 2xx from a proxy; W07 sync engine (a proxy response is not produced by the server)',
  58: 'client sign-in question hold; W07 sync engine',
  59: 'client sign-in prefer merge; W07 sync engine',
  60: 'client sign-out stash; W07 sync engine',
  61: 'client storage-full marker; W07 sync engine',
  62: 'client tab join; W07 sync engine',
  63: 'client legacy v1.3.9 fingerprint lift; server half (unstamped push stamped) is stamping INV-36; K10 client sync',
  64: 'client backup restore add-back and stampReplace; server half (replace PUT overwrites, unstamped stamps) is INV-3/36; K10 client sync'
}
