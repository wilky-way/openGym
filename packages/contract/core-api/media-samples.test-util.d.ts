export declare const bytes: (...parts: any[]) => Uint8Array<ArrayBuffer>;
export declare const latin1: (s: any) => Uint8Array<ArrayBuffer>;
export declare const fill: (n: any, v?: number) => Uint8Array<any>;
export declare const jpeg: (w?: number, h?: number) => Uint8Array<ArrayBuffer>;
export declare const png: (w?: number, h?: number) => Uint8Array<ArrayBuffer>;
export declare const webpVp8: (w?: number, h?: number) => Uint8Array<ArrayBuffer>;
export declare const webpVp8l: (w?: number, h?: number) => Uint8Array<ArrayBuffer>;
export declare const webpVp8x: (w?: number, h?: number) => Uint8Array<ArrayBuffer>;
export declare const gce: (delayCs: any) => Uint8Array<ArrayBuffer>;
export declare const frame: (w: any, h: any) => Uint8Array<ArrayBuffer>;
export declare const appExt: (id: any, data?: Uint8Array<any>) => Uint8Array<ArrayBuffer>;
export declare const comment: (text: any) => Uint8Array<ArrayBuffer>;
export declare const plainText: () => Uint8Array<ArrayBuffer>;
/** A GIF: `delays` (in 1/100 s) makes one frame each; extra blocks go in the order given. */
export declare function gif({ w, h, delays, blocks, trailer }?: {
    blocks?: null | undefined;
    delays?: number[] | undefined;
    h?: number | undefined;
    trailer?: boolean | undefined;
    w?: number | undefined;
}): Uint8Array<ArrayBuffer>;
export declare function box(type: any, ...parts: any[]): Uint8Array<ArrayBuffer>;
export declare const ftyp: (brand?: string) => Uint8Array<ArrayBuffer>;
export declare const mvhd: (seconds?: number, timescale?: number) => Uint8Array<ArrayBuffer>;
export declare function tkhd(w: any, h: any, { rotate }?: {
    rotate?: boolean | undefined;
}): Uint8Array<ArrayBuffer>;
export declare const hdlr: (type: any) => Uint8Array<ArrayBuffer>;
/**
 * A trak whose samples sit at `offsets` (one chunk each) with `sizes`. The offsets are absolute
 * file positions, so mp4() computes them after laying out ftyp and moov.
 */
export declare function trak({ handler, fourcc, w, h, rotate, offsets, sizes, extra }: {
    extra?: never[] | undefined;
    fourcc?: string | undefined;
    h?: number | undefined;
    handler?: string | undefined;
    offsets?: never[] | undefined;
    rotate?: boolean | undefined;
    sizes?: never[] | undefined;
    w?: number | undefined;
}): Uint8Array<ArrayBuffer>;
/**
 * An MP4 (brand isom) or MOV (brand 'qt  '): ftyp, moov, then mdat holding one sample per track
 * in `tracks` ([{ handler, fourcc, w, h, payload: Uint8Array }]). `moovExtra` goes into moov
 * after the traks (udta, meta), `top` after mdat (uuid, meta). Returns { file, sampleAt } where
 * sampleAt[i] is the offset of track i's sample in the file.
 */
export declare function mp4({ brand, seconds, tracks, moovExtra, top, rotate }?: {
    brand?: string | undefined;
    moovExtra?: never[] | undefined;
    rotate?: boolean | undefined;
    seconds?: number | undefined;
    top?: never[] | undefined;
    tracks?: {
        handler: string;
        fourcc: string;
        w: number;
        h: number;
        payload: Uint8Array<any>;
    }[] | undefined;
}): {
    file: Uint8Array<ArrayBuffer>;
    sampleAt: number[];
};
export declare function webm({ docType, w, h, codec, durationMs }?: {
    codec?: string | undefined;
    docType?: string | undefined;
    durationMs?: number | undefined;
    h?: number | undefined;
    w?: number | undefined;
}): Uint8Array<ArrayBuffer>;
