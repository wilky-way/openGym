/** A refusal the editor turns into a sentence: code 'type' | 'too-large' (mb) | 'too-long'
 *  (sec) | 'photo-too-big' | 'unreadable'. */
export declare class MediaError extends Error {
    code: any;
    constructor(code: any, extra?: {});
}
/**
 * A decoded picture to draw from: { source, width, height, close() }. createImageBitmap first,
 * which applies the photo's own orientation; an <img> otherwise (older Safari). Throws
 * MediaError('unreadable') when neither can read it — a HEIC on a browser without HEIC support.
 */
export declare function decodeImage(blob: any, mime: any, { doc }?: {
    doc?: Document | undefined;
}): Promise<{
    source: ImageBitmap;
    width: number;
    height: number;
    close: () => void;
} | {
    source: HTMLImageElement;
    width: number;
    height: number;
    close: () => void;
}>;
/**
 * `pic` drawn at most `edge` px on its long side and encoded: { blob, mime, width, height }.
 * WebP when toBlob really returns WebP — checked on the bytes, since Safari silently hands back
 * a PNG for a WebP request, and a PNG would slip past the size cap and keep the alpha channel
 * nobody asked for — else JPEG drawn on white. The canvas is emptied afterwards: a phone keeps
 * canvas memory until it is.
 */
export declare function encodeImage(pic: any, edge: any, quality: any, { doc }?: {
    doc?: Document | undefined;
}): Promise<{
    blob: any;
    mime: string;
    width: number;
    height: number;
}>;
/**
 * Opens a video once in a detached, muted <video>: { width, height, duration, poster } — or
 * null when this browser cannot play it. duration is NaN when even a seek to the end does not
 * tell (a recording that never wrote its length). The poster is a frame half a second in (or
 * half-way through a shorter clip), drawn after a muted play/pause, since iOS may otherwise draw
 * black. Everything it made is taken down again before it returns.
 */
export declare function probeVideo(blob: any, mime: any, { doc, timeoutMs, encode }?: {
    doc?: Document | undefined;
    encode?: typeof encodeImage | undefined;
    timeoutMs?: number | undefined;
}): Promise<{
    width: number;
    height: number;
    duration: number;
    poster: {
        blob: any;
        mime: string;
        width: number;
        height: number;
    } | null;
} | null>;
/**
 * A picked File → { media, blobs: [{ hash, blob, mime }], warnings }. `media` is a MediaRef that
 * passes normalizeMediaRef; `blobs` are the main file and its poster, to go into the local store
 * as pending. Throws MediaError. `deps` swaps the browser parts (decoding, encoding, the probe)
 * for the tests.
 */
export declare function ingestMediaFile(file: any, limits?: Readonly<{
    imageMB: 2;
    rawPhotoMB: 40;
    gifMB: 8;
    videoMB: 40;
    videoSec: 60;
    quotaMB: 200;
}>, deps?: {}): Promise<{
    media: {
        kind: any;
        hash: any;
        mime: any;
        size: any;
        width: any;
        height: any;
    };
    blobs: any[];
    warnings: any;
}>;
