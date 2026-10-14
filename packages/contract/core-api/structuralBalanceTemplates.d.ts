export declare const EVALUATION_MODES: Readonly<{
    LOAD_RATIO: "load-ratio";
    BODYWEIGHT_RATIO: "bodyweight-ratio";
    REP_COUNT: "rep-count";
}>;
export declare const BALANCE_STATUSES: Readonly<{
    BALANCED: "balanced";
    BORDERLINE: "borderline";
    WEAK: "weak";
    NO_DATA: "no-data";
}>;
export declare const BORDERLINE_BAND_PCT = 5;
export declare const TEMPLATES: {
    poliquin: {
        id: string;
        label: string;
        roles: ({
            id: string;
            label: string;
            evaluationMode: "load-ratio";
            exerciseIds: string[];
            targetPct: number;
            anchorRoleId?: undefined;
        } | {
            id: string;
            label: string;
            evaluationMode: "load-ratio";
            anchorRoleId: string;
            exerciseIds: string[];
            targetPct: number;
        })[];
    };
    thibaudeauPowerlifting: {
        id: string;
        label: string;
        roles: ({
            anchorRoleId?: undefined;
            id: string;
            label: string;
            evaluationMode: "load-ratio";
            exerciseIds: string[];
            targetPct: number;
        } | {
            id: string;
            label: string;
            evaluationMode: "load-ratio";
            anchorRoleId: string;
            exerciseIds: string[];
            targetPct: number;
        })[];
    };
    atg: {
        id: string;
        label: string;
        roles: ({
            id: string;
            label: string;
            evaluationMode: "bodyweight-ratio";
            exerciseIds: string[];
            targetPct: number;
            targetPctFemale: number;
            reps: number;
            repsTarget?: undefined;
            repsTargetFemale?: undefined;
        } | {
            targetPct?: undefined;
            targetPctFemale?: undefined;
            reps?: undefined;
            id: string;
            label: string;
            evaluationMode: "rep-count";
            exerciseIds: string[];
            repsTarget: number;
            repsTargetFemale?: undefined;
        } | {
            targetPct?: undefined;
            targetPctFemale?: undefined;
            reps?: undefined;
            id: string;
            label: string;
            evaluationMode: "rep-count";
            exerciseIds: string[];
            repsTarget: number;
            repsTargetFemale: number;
        })[];
    };
};
export declare const TEMPLATE_LIST: ({
    id: string;
    label: string;
    roles: ({
        id: string;
        label: string;
        evaluationMode: "load-ratio";
        exerciseIds: string[];
        targetPct: number;
        anchorRoleId?: undefined;
    } | {
        id: string;
        label: string;
        evaluationMode: "load-ratio";
        anchorRoleId: string;
        exerciseIds: string[];
        targetPct: number;
    })[];
} | {
    id: string;
    label: string;
    roles: ({
        anchorRoleId?: undefined;
        id: string;
        label: string;
        evaluationMode: "load-ratio";
        exerciseIds: string[];
        targetPct: number;
    } | {
        id: string;
        label: string;
        evaluationMode: "load-ratio";
        anchorRoleId: string;
        exerciseIds: string[];
        targetPct: number;
    })[];
} | {
    id: string;
    label: string;
    roles: ({
        id: string;
        label: string;
        evaluationMode: "bodyweight-ratio";
        exerciseIds: string[];
        targetPct: number;
        targetPctFemale: number;
        reps: number;
        repsTarget?: undefined;
        repsTargetFemale?: undefined;
    } | {
        targetPct?: undefined;
        targetPctFemale?: undefined;
        reps?: undefined;
        id: string;
        label: string;
        evaluationMode: "rep-count";
        exerciseIds: string[];
        repsTarget: number;
        repsTargetFemale?: undefined;
    } | {
        targetPct?: undefined;
        targetPctFemale?: undefined;
        reps?: undefined;
        id: string;
        label: string;
        evaluationMode: "rep-count";
        exerciseIds: string[];
        repsTarget: number;
        repsTargetFemale: number;
    })[];
})[];
export declare const DEFAULT_TEMPLATE_ID = "poliquin";
