/** A backend that forgets everything with the page — the tests', and the fallback's. */
export declare function memoryBackend(): {
    name: string;
    persistent: boolean;
    open(): Promise<boolean>;
    all(): Promise<any[]>;
    getBlob(hash: any): Promise<any>;
    put(rec: any, blob: any): Promise<void>;
    patch(hash: any, fields: any): Promise<void>;
    remove(hash: any): Promise<void>;
    clear(): Promise<void>;
};
export declare function playType(mime: any, canPlayType?: typeof defaultCanPlay): any;
declare function defaultCanPlay(type: any): CanPlayTypeResult;
export declare function createMediaStore(backend: any, { fallback, now, objectURL, revokeDelayMs, canPlayType }?: {
    canPlayType?: typeof defaultCanPlay | undefined;
    fallback?: typeof memoryBackend | undefined;
    now?: (() => number) | undefined;
    objectURL?: {
        new (url: string | URL, base?: string | URL): URL;
        prototype: URL;
        canParse(url: string | URL, base?: string | URL): boolean;
        createObjectURL(obj: Blob | MediaSource): string;
        parse(url: string | URL, base?: string | URL): URL | null;
        revokeObjectURL(url: string): void;
    } | undefined;
    revokeDelayMs?: number | undefined;
}): {
    ready: () => any;
    /** Marks files as a draft's (an editor that is open) until the returned function is called.
     *  The local clean-up keeps what is held however long ago it was put: its one-hour grace is
     *  for a draft abandoned, not for one still being written. In memory only — a draft does not
     *  outlive its tab. */
    hold(hashes: any): () => void;
    isHeld: (hash: any) => boolean;
    readonly persistent: boolean;
    readonly backendName: any;
    subscribe(fn: any): () => boolean;
    has(hash: any): Promise<boolean>;
    /** The record with its blob, or null. */
    get(hash: any): Promise<{
        blob: any;
        mime: any;
        size: any;
        pending: boolean;
        rejected: boolean;
    } | null>;
    /** Keeps `blob` under `hash`. The same hash is the same bytes, so a second put only updates
     *  the record — `pending` as the caller says: false when the server has just sent it. */
    put(hash: any, blob: any, { mime, pending }?: {
        pending?: boolean | undefined;
        mime?: unknown;
}): Promise<void>;
    /** A URL to show the file by, or null when it is not here. Release it when done. */
    url(hash: any): Promise<any>;
    release(hash: any): void;
    markSynced(hash: any): Promise<void>;
    markRejected(hash: any): Promise<void>;
    remove(hash: any): Promise<void>;
    /** Deletes every record not in `keep`, except those put at or after `keepPutAfter` — a file
     *  picked meanwhile in an editor that is still open, or by another tab. */
    retainOnly(keep: any, { keepPutAfter }?: {
        keepPutAfter?: number | undefined;
    }): Promise<number>;
    clearAll(): Promise<void>;
    list(): Promise<any[]>;
    usage(): Promise<{
        bytes: number;
        count: number;
    }>;
    pendingHashes(): Promise<Set<any>>;
    /** The pending hashes as the index holds them right now — empty before it has loaded. For
     *  the sign-out check (lib/media-owed.js), which cannot wait. */
    pendingNow(): Set<any>;
    /** The rejected hashes, for Settings to say what the server would not take. */
    rejectedNow(): Set<any>;
};
export declare function getMediaStore(): any;
/** Whether anything in this session has used the store (the sync at start, the editor, a
 *  thumbnail) and so made and opened it. */
export declare const mediaStoreInUse: () => boolean;
/** Tests only: swap the shared store (null makes a fresh one on next use). */
export declare function _setMediaStore(s: any): void;
/** The shared store under the name the rest of the app uses. A thin forwarder, so that importing
 *  it is free and a test can swap what it forwards to (_setMediaStore). */
export declare const mediaStore: {};
export {};
