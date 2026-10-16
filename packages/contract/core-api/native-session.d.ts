import type { Config, State, Routine, Row } from './session-types';
import { type ExerciseIndex } from './exercises';
/** No legacy history/default/endpoint fill is allowed to supply a native actual entry. */
export declare function buildNativeEntry(S: State, cfg: Config, routine: Routine | null | undefined, index?: ExerciseIndex): {
    target: Config;
    planned: Config;
    plan: {
        policy: string;
        kind: string;
    };
    sets: Row[];
    series?: string | undefined;
    occurrenceId?: string | undefined;
    weekIndex?: number | undefined;
};
