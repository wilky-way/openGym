export declare const TIMBRES: {
    bright: number[];
    bell: number[];
};
export declare function beep(enabled: any, freq: any, dur: any, when: any): void;
export { CHIME_PEAK, REST_SOUNDS, REST_SOUND_IDS, restSoundOf } from './rest-sounds.js';
export declare function chime(enabled: any, kind: any): void;
export declare function unlock(enabled: any): void;
export declare const playOnSilentSupported: () => boolean;
export declare const appleTouchDevice: () => boolean;
export declare function setPlayOnSilent(on: any): void;
export declare function setVibrate(on: any): void;
export declare const vibrateSupported: () => boolean;
export declare function vibrate(p: any): void;
export declare function alertBuzz(pattern: any): void;
