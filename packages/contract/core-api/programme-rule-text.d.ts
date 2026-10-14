/** Translate authored training rules, without executing them or mutating inputs.
 * complete describes translation coverage, not automatic progression support.
 * An exercise with no authored rule requires no translation and is complete,
 * unless its source explicitly says parsing failed or a rule is missing.
 */
export declare function programmeRuleText(exercise?: {}, rawProgram?: {}): {
    instructions: string;
    progressionInstructions?: string | undefined;
    complete: boolean;
    reasons: any[];
};
