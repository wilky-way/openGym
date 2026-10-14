export declare const CHIME_PEAK = 0.9;
export declare const REST_SOUNDS: {
    chime: {
        notes: number[][];
        peak: number;
        hold: number;
        timbre: string;
    };
    classic: {
        notes: number[][];
    };
    bell: {
        notes: number[][];
        peak: number;
        hold: number;
        timbre: string;
    };
    beep: {
        notes: number[][];
        peak: number;
        hold: number;
        timbre: string;
    };
    whistle: {
        notes: number[][];
        peak: number;
        hold: number;
    };
    soft: {
        notes: number[][];
        peak: number;
        hold: number;
    };
};
export declare const REST_SOUND_IDS: string[];
/**
 * The end-of-rest sound a profile plays. `S.restSound` names it; `S.classicChime` is how the
 * choice was stored before there were more than two, and an app from before #306 still writes
 * only that. So `classicChime: true` always means the classic beeps (this app clears it for any
 * other pick, so true can only be an older app's later choice), and a stored `restSound` of
 * 'classic' without it means that older app switched back to the chime.
 */
export declare function restSoundOf(S: any): any;
