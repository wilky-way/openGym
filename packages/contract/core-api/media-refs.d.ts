export declare const HASH_RE: RegExp;
export declare const MEDIA_MIMES: {
    'image/jpeg': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'image/png': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'image/webp': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'image/gif': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'video/mp4': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'video/quicktime': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
    'video/webm': {
        kind: string;
        category: string;
        ext: string;
        playExt: string;
    };
};
export declare const CODECS: string[];
/**
 * A well-formed MediaRef, rebuilt from its known fields only, or null. null means "no media" to
 * every reader: a bad hash, a mime outside the allowlist or one that does not match `kind`, a
 * size outside 1 B..200 MB, a dimension outside 1..16384, a length outside 0..3600 s, or a codec
 * nobody knows. A malformed poster is dropped on its own; the main file still stands.
 */
export declare function normalizeMediaRef(ref: any): {
    kind: any;
    hash: any;
    mime: any;
    size: any;
    width: any;
    height: any;
} | null;
/** The media of a custom exercise as it may be shown, or null. */
export declare const mediaOf: (ex: any) => {
    kind: any;
    hash: any;
    mime: any;
    size: any;
    width: any;
    height: any;
} | null;
/**
 * How many photos and videos one logged workout keeps. Every ref travels in the whole-document
 * push that each of the account's devices downloads (about 300 bytes each, plus its poster's
 * files on every device that shows it), so the list is bounded like everything else in the
 * state: six is a progress photo from a few angles plus a couple of form-check clips, one or two
 * rows of thumbnails on a phone. A workout with more has to drop one first.
 */
export declare const WORKOUT_MEDIA_MAX = 6;
/**
 * The photos and videos of a logged workout as they may be shown: each passes normalizeMediaRef,
 * a file listed twice shows once, and never more than `max` — WORKOUT_MEDIA_MAX unless the
 * caller asks otherwise (a hand-edited or foreign copy can hold anything). Oldest first, the
 * order they were added in. A reading, never a rewrite: the list on the record keeps whatever
 * this leaves out (lib/workout-media.js edits it as it stands).
 */
export declare function workoutMediaOf(w: any, max?: number): {
    kind: any;
    hash: any;
    mime: any;
    size: any;
    width: any;
    height: any;
}[];
/**
 * Every MediaRef-like object a state holds, as it stands (not normalised): each custom
 * exercise's `media` and each entry of each logged workout's `media` list. The one walk behind
 * referencedHashes, referencedFiles and the owed count, so they can never disagree about where
 * media live. The session in progress is not walked: it never syncs (the server drops `active`),
 * media are only ever attached to a saved workout, and the history editor's copy of one leaves
 * them on the saved record (lib/session-edit.js).
 */
export declare function stateMediaRefs(state: any): any[];
/**
 * Every blob hash a state refers to, the same answer as api/media.js referencedHashes (the shared
 * fixture api/test/fixtures/media-refs.json pins both): customEx[].media and every entry of
 * workouts[].media. Deliberately looser than normalizeMediaRef and workoutMediaOf: each hash and
 * poster hash counts on its own as long as it is well-formed, and a workout's list counts past
 * its cap, because this set decides what is KEPT, and keeping too much is the safe side.
 */
export declare function referencedHashes(state: any): Set<any>;
/**
 * The same hashes in the order the sync wants them, posters first: a poster is what every list
 * shows, so it is the file another device most wants soon, and it is small. Each hash comes with
 * what the state says about it — { hash, mime, size, poster } — which is what a download is
 * checked against. The first ref that names a hash decides; two exercises with the same file
 * describe it the same way unless someone edited one by hand (an exercise's picture added to a
 * workout too is one file).
 */
export declare function referencedFiles(state: any): any[];
/**
 * A link as it may be stored and opened: http(s) only, no user name or password in it, at most
 * 2048 characters — or null. A bare "youtube.com/watch?v=…" gets https:// in front, the way people
 * paste links (#246). Anything else with a scheme of its own (javascript:, data:, mailto:, a
 * custom app scheme) is refused rather than guessed at. It runs at save and again at render,
 * because a plan file or a backup can bring any string in.
 */
export declare function cleanUrl(raw: any): string | null;
/** 'video' for a link to a video site, 'link' for anything else, null for no usable link. */
export declare function linkKind(url: any): "link" | "video" | null;
/** m:ss for a length in seconds ("0:07", "1:05"). */
export declare function fmtClip(sec: any): string;
