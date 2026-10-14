import type { ExerciseIndex } from './exercises';
export declare const MEDIA_CACHE = "opengym-media-v1";
export declare const PREFETCH_DELAY_MS = 8000;
/** Every same-origin img/gif URL for the exercises in the plan and the active session. */
export declare function planMediaUrls(S: any, base?: string, index?: ExerciseIndex): any[];
/**
 * Whether this page runs as the app installed on the home screen, not in a browser tab: the
 * display mode the manifest asks for (`standalone`), or iOS Safari's own flag, which a home-screen
 * app there has had since before it knew display modes. `win.matchMedia` is called on `win` —
 * a detached matchMedia throws in a browser.
 */
export declare function installedApp(win?: typeof globalThis, nav?: Navigator): boolean;
/** Whether the connection is one to spend a few megabytes on without asking. */
export declare function prefetchAllowed(nav?: Navigator): boolean;
/**
 * Fetch whatever of `urls` the cache does not hold yet, through the worker. Two at a time,
 * and it stops as soon as the connection stops qualifying or the server keeps refusing.
 */
export declare function prefetchMedia(urls: any, { cache, fetchImpl, allowed }?: {
    allowed?: typeof prefetchAllowed | undefined;
    fetchImpl?: typeof fetch | undefined;
    cache?: unknown;
}): Promise<{
    wanted: any;
    missing: any;
    fetched: number;
}>;
/**
 * Keep the plan's media offline for as long as the page is open, while it runs as the installed
 * app. `store` is the zustand store (getState/subscribe). Returns a function that stops it.
 */
export declare function startMediaPrefetch(store: any, { delay, win, nav, cachesApi }?: {
    cachesApi?: CacheStorage | undefined;
    delay?: number | undefined;
    nav?: any;
    win?: typeof globalThis | undefined;
}, index?: ExerciseIndex): () => void;
