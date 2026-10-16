import type { Exercise, ExerciseIndex } from '@opengym/core/exercises'
export type { ExerciseIndex }
// Legacy records retain unknown fields; these are only the fields read by K11.
export interface LoadRecord {
  w?: number | string | null; r?: number | string | null; done?: boolean;
  unit?: string; u?: string; weightUnit?: string; weight_unit?: string; loadUnit?: string;
  rir?: number | string | null; rpe?: number | string | null;
  [key: string]: unknown;
}
export interface AnalyticsSet extends LoadRecord {
  sides?: { L?: LoadRecord; R?: LoadRecord }; phase?: string; drops?: LoadRecord[];
}
export interface AnalyticsEntry extends Omit<Exercise, 'target'> {
  id: string; sets?: AnalyticsSet[]; bodyweight?: boolean;
  target?: LoadRecord & { bodyweight?: boolean; assisted?: boolean };
  muscleSnapshot?: Exercise;
}
export interface AnalyticsWorkout extends LoadRecord {
  start?: number; d?: string; entries?: AnalyticsEntry[];
  bw?: number; bodyweight?: number; bwUnit?: string; bodyweightUnit?: string;
}
export interface RecoveryOptions extends LoadRecord {
  bodyweightKg?: number; bodyweight?: number; bodyweightUnit?: string; profileUnit?: string;
}
export interface AnalyticsState {
  workouts?: AnalyticsWorkout[]; bodyweight?: { d?: string; w: number }[];
  unit?: string; body?: string; balanceOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}
