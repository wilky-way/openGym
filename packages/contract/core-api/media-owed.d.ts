/** Starts following the local store — the store calls it at start-up, so the first sign-out
 *  check already knows what is waiting. */
export declare function loadPending(): void;
export declare function pendingRefCount(S: any): number;
/** lib/media-sync.js, once started: { settle() } — one more forced run, bounded in time. */
export declare function registerMediaRunner(r: any): void;
/** Waits for the upload in flight, then makes one more forced attempt (up to 60 s), and leaves
 *  the pending set read from an opened store. Resolves, never rejects: what did not go stays
 *  owed. Without a running sync (the tests, a build that never started it) only the reading. */
export declare function settleMedia(S: any): Promise<void>;
export declare function publishMediaStatus(patch: any): void;
export declare const getMediaStatus: () => {
    usage: null;
    pending: number;
    deferred: number;
    rejected: number;
    unavailable: number;
    at: number;
};
export declare function subscribeMediaStatus(fn: any): () => boolean;
/** Tests only. */
export declare function _resetMediaOwed(): void;
