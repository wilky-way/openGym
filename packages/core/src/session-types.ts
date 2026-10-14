/** Typed views of legacy session data; unknown extension fields keep their original order. */
import type { WorkoutSet } from '../../contract/domain/state-doc'
export type Row = WorkoutSet & { side?: string; target?: Record<string, unknown>; repTarget?: { min: number; max: number } }
export interface Config {
  id?: string; sets?: number; reps?: number | 'max'; repsMin?: number; repsMax?: number;
  weight?: number; mode?: string; sec?: number; min?: number; speed?: number;
  prog?: string; inc?: number; bodyweight?: boolean; assisted?: boolean; side?: unknown;
  warmupSets?: unknown; restSec?: number; warmupRestSec?: number; note?: string;
  intensifier?: { type?: string; [key: string]: unknown };
  sg?: string | number; open?: boolean; dbLoad?: string | null;
  pyramid?: (number | 'max')[]; pyramidWeight?: number[]; setRepsMin?: (number | null)[];
  rowReps?: number[]; backoffStep?: number; slotId?: string; slotScope?: string;
  [key: string]: unknown;
}
export interface ProgrammeLink {
  cycleId?: string; instanceId?: string; weekIndex?: number; ordinal?: number;
  series?: string; fromWeekIndex?: number; [key: string]: unknown;
}
export interface Deload {
  authored?: boolean; loadFactor?: number; setsFactor?: number;
  [key: string]: unknown;
}
export interface Routine {
  id: string; name?: string; ex: Config[]; prog?: string;
  programme?: ProgrammeLink; deload?: Deload; excludeFromProgression?: boolean;
  [key: string]: unknown;
}
export interface Plan {
  policy?: string; kind: string; weight?: number; reps?: number; sec?: number;
  sets?: number; rowReps?: number[]; why?: string[]; [key: string]: unknown;
}
export interface Entry {
  id?: string; sets?: Row[]; target?: Config | null; planned?: Config | null;
  plan?: Plan | null; rid?: string; sg?: string | number; series?: string;
  occurrenceId?: string; weekIndex?: number; deload?: Deload; noProg?: boolean;
  note?: string; notePin?: boolean; carried?: boolean; topW?: number | null;
  muscleSnapshot?: Record<string, unknown>; [key: string]: unknown;
}
export interface Session {
  id?: string; d?: string; start?: number; end?: number; name?: string; bw?: number | null;
  entries?: Entry[]; routineIds?: string[] | string | null; routineId?: string | null;
  noProg?: boolean; note?: string; programmeInstance?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface State {
  routines?: Routine[]; workouts?: Session[]; unit?: string; startFrom?: string;
  programmes?: { cycles?: { id?: string; status?: string; startsOn?: string; [key: string]: unknown }[]; [key: string]: unknown };
  week?: Record<string, string[] | string | null>; dayPlan?: Record<string, string>;
  rotation?: { sequence?: string[]; [key: string]: unknown };
  queue?: { ids?: string[]; [key: string]: unknown }; [key: string]: unknown;
}
export interface ReadSession {
  series?: string; mode?: string; weight: number; d?: string; start?: number;
  weekIndex?: number; planned?: Config; [key: string]: unknown;
}
