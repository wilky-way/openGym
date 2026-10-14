/**
 * { mime, kind, category, input? } from the first bytes, or null. `input: true` marks a type
 * that is read here but never stored or uploaded as it is (HEIC/AVIF — the server refuses them).
 * Everything else is refused: SVG and XML, HTML, PDF, ZIP, BMP, TIFF, ICO, M4A, Matroska.
 */
export declare function sniffKind(bytes: any): {
    mime: string;
    kind: string;
    category: string;
    input?: undefined;
} | {
    mime: string;
    kind: string;
    category: string;
    input: boolean;
} | null;
/**
 * { width, height } of a JPEG (its SOFn frame header), PNG (IHDR), WebP (VP8, VP8L or VP8X) or
 * GIF (logical screen), or null. Read before any decode: a 100-megapixel photo would take a phone
 * a few hundred MB just to open, so it is refused on these numbers instead.
 */
export declare function imageDims(bytes: any): {
    width: any;
    height: any;
} | null;
/**
 * { width, height, frames, durMs } of a GIF, or null for one that does not parse. A frame
 * delay of 0 counts as 10 ms, so a GIF of zero-delay frames still has a length.
 */
export declare function inspectGif(bytes: any): {
    width: number;
    height: number;
    frames: number;
    durMs: number;
} | null;
/**
 * A copy of a GIF with its comment (0xFE), plain-text (0x01) and non-loop application blocks
 * (XMP, ICC and the like) left out. Graphic control blocks, frames and the loop block stay, so
 * it animates exactly as before. A graphic control block that belonged to a dropped plain-text
 * block goes with it, so its delay cannot land on the next frame. Throws on a GIF that does not
 * parse; one that simply stops after a whole block gets its trailer.
 */
export declare function cleanGif(bytes: any): Uint8Array<any>;
/**
 * { brand, durationSec, width, height, codec, handlers } of an MP4/MOV, or null for anything
 * that is not a well-formed one: ftyp not first, no moov, a box overrunning its parent.
 * durationSec is null when the file does not say; width/height are what is seen (a 90° matrix
 * swaps them); codec is the video track's first sample entry reduced to
 * avc1 | hvc1 | av01 | vp09 | vp8 | other; handlers lists every trak's handler type.
 */
export declare function inspectMp4(bytes: any): {
    brand: string;
    durationSec: number | null;
    width: number;
    height: number;
    codec: any;
    handlers: null[];
} | null;
/**
 * Zeroes, IN PLACE, what in an MP4/MOV can say where and by whom it was filmed, and returns the
 * same array. (a) Every udta, meta and uuid box — at the top level, anywhere under moov, and
 * directly under a fragment's moof and traf — becomes a 'free' box of the same size with a zeroed
 * body: QuickTime's location, the phone's make and model and a camera's EXIF live there.
 * (b) Every sample of a track that is neither picture nor sound (timed metadata, an action
 * camera's GPS and sensor tracks, a subtitle track) is zeroed where it sits in mdat; the track
 * itself stays. No size changes, so stco/co64 stay right and the video and sound bytes are
 * untouched. Throws on a file that does not parse or whose sample tables point outside it — such
 * a file is refused rather than kept with its metadata — and on a fragmented file (moof) that has
 * such a track: its samples sit in fragments the sample table does not list, and the scrub does
 * not walk trun, so it refuses rather than keep them.
 */
export declare function scrubMp4(bytes: any): any;
/**
 * { width, height, codec, durationSec } of a WebM from its header elements (Segment → Info and
 * Tracks), read from at most the first MB, or null. A recording that never wrote its length
 * (MediaRecorder) gives durationSec null.
 */
export declare function inspectWebm(bytes: any): {
    width: number;
    height: number;
    codec: null;
    durationSec: null;
} | null;
