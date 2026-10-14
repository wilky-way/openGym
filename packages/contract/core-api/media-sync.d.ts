/**
 * One sync. `deps` are what it talks to — the app store (getState/subscribe), the local media
 * store, the transports — all injectable, which is how media-sync.test.js runs it.
 */
export declare function createMediaSync(deps?: {}): {
    syncMedia: (opts?: {}) => any;
    settle: () => Promise<void>;
    fetchToStore: (hash: any, expect?: {}, { force }?: {
        force?: boolean | undefined;
    }) => any;
    mayFetch: (hash: any) => boolean;
    localMediaGc: () => Promise<boolean>;
    startCustomMediaPrefetch: ({ delay }?: {
        delay?: number | undefined;
    }) => () => void;
    start: (appStore: any) => () => void;
    _setStore: (s: any) => void;
};
export declare const startMediaSync: (appStore: any) => any;
export declare const syncMedia: (opts: any) => any;
export declare const fetchToStore: (hash: any, expect: any, opts: any) => any;
export declare const mayFetch: (hash: any) => any;
export declare const localMediaGc: () => any;
export declare const settleMediaSync: () => any;
/** Tests only. */
export declare const _setSharedMediaSync: (s: any) => void;
