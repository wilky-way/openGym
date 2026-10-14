/** Legacy export inputs: known fields are typed; unknown document keys pass through. */
export interface ExportConfig {
  id?: string; sets?: number; mode?: string; min?: number; speed?: number; sec?: number;
  reps?: number | 'max'; weight?: number; bodyweight?: boolean; side?: unknown; prog?: string;
  inc?: number; backoff?: boolean; lastToFailure?: boolean; deloadFactor?: number;
  dbLoad?: string | null; repsMin?: number; repsMax?: number; setsMax?: number; restSec?: number;
  warmupRestSec?: number; sg?: string | number; note?: string; warmupSets?: unknown;
  pyramid?: unknown[]; pyramidRest?: number[]; pyramidWeight?: number[];
  intensifier?: unknown;
  [key: string]: unknown;
}
export interface ExportCustom {
  id: string; n?: string; bp?: string; desc?: string; eq?: string; tg?: string;
  url?: unknown; primaries?: unknown[]; secondaries?: unknown[]; muscleGroups?: string[];
  sm?: unknown[]; custom?: boolean; [key: string]: unknown;
}
export interface ExportRoutine {
  id: string; name?: string; emoji?: string; prog?: string; excludeFromProgression?: boolean;
  ex: ExportConfig[]; [key: string]: unknown;
}
export interface ExportPlan {
  unit?: string; weightUnit?: string; name?: string; routines: ExportRoutine[];
  week: Record<string, string | string[] | null>; customEx?: ExportCustom[];
  [key: string]: unknown;
}
export interface ExportSet {
  w?: number; r?: number; sec?: number; min?: number; speed?: number; at?: number;
  done?: boolean; phase?: string; type?: string; drops?: ExportSet[];
  sides?: { L: ExportSet; R: ExportSet }; [key: string]: unknown;
}
export interface ExportEntry {
  id: string; sets?: ExportSet[]; target?: Partial<ExportConfig> | null; note?: string;
  [key: string]: unknown;
}
export interface ExportWorkout {
  id?: string; name?: string; d?: string; start?: number | string; end?: number | string;
  vol?: number; bw?: number | null; prs?: string[]; entries?: ExportEntry[]; note?: string;
  [key: string]: unknown;
}
export interface WorkoutExportOptions {
  unit: string; nameOf: (entry: ExportEntry) => string; speedUnit?: string;
}
