/**
 * Presentation-only view of a progression result. The engine remains the source of truth for
 * both the outcome and its explanation; this helper only makes the policy behind that result
 * explicit in the workout guidance.
 */
export declare function progressionGuidance(plan: any): {
    policyLabel: any;
    why: any;
} | null;
