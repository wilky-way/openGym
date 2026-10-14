import type { ExerciseIndex } from './exercises';
export declare function primaryMuscleOf(entry: any, index?: ExerciseIndex): {
    slug: string;
    weight: any;
} | null;
/**
 * Strength rows for every exercise with an estimate: best estimated 1RM (work sets only,
 * warm-ups excluded), the estimate's date, the exercise's primary muscle, the exercise's
 * OWN decay (from its last done work set), and the expected current 1RM (estimate x decay).
 * Sorted by expected current 1RM, strongest first. Exercises without a usable estimate are
 * omitted - a made-up number is worse than no number.
 */
export declare function strengthExerciseRows(S: any, now: any, index?: ExerciseIndex): {
    id: any;
    name: any;
    est: any;
    estDate: any;
    primary: string | null;
    decay: number;
    current: number;
}[];
/**
 * Strength rows for exercises with positive resolved muscle credit for `slug`; catalogue
 * metadata takes precedence over saved snapshots when available. Each row keeps the exercise's
 * OWN decay and expected current 1RM - the tapped muscle filters the list, not the row's metrics.
 */
export declare function strengthExerciseRowsForMuscle(S: any, now: any, slug: any, index?: ExerciseIndex): any[];
