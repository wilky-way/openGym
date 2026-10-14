import { appBase } from './app-base.js';
import { apiFetch } from './api-connection.js';
export { configureApiConnection } from './api-connection.js';
export declare const IS_APPLE: boolean;
export declare const IS_ANDROID: boolean;
export declare const BIO: string;
export declare const VAULT: string;
export declare const bio: () => any;
export declare const vault: () => any;
export declare const webauthnOK: () => boolean;
export declare function setRemoteAuth(base: any, token: any): void;
export { appBase };
export declare function api(path: any, opts: any): Promise<any>;
export declare function beacon(path: any, body: any): boolean;
/**
 * GET a file as a Blob (lib/media-sync.js fetchToStore, which checks its hash before keeping it).
 * An answer that announces more than `expectSize` (+1 KB) is refused before a byte is read, and
 * one that turns out longer is cut off: a login page or a proxy's error is never read into
 * memory. There is no total time limit — a video on a slow line takes what it takes — only an
 * idle one: no bytes for `idleMs` and the download counts as offline (code 'timeout').
 * Errors carry { status, code } like api()'s: the server's code on a refusal (media-missing).
 */
export declare function apiBlob(path: any, { expectSize, idleMs, fetchImpl }?: {
    fetchImpl?: typeof apiFetch | undefined;
    idleMs?: number | undefined;
    expectSize?: unknown;
}): Promise<any>;
/**
 * PUT a file (XMLHttpRequest, because only it reports upload progress). `mime` is the type the
 * MediaRef records, sent explicitly — a Blob read back from a phone's file carries whatever the
 * local server guessed. Resolves with the server's JSON answer. Rejects with { status, code }:
 * the server's own code on a refusal, plus `retryAfter` on a 429; 'proxy-too-large' for a 413
 * that is not the API's JSON (nginx's client_max_body_size, Cloudflare's 100 MB); 'timeout' after
 * `idleMs` without progress; no status at all when the network failed.
 */
export declare function apiUpload(path: any, blob: any, mime: any, { onProgress, idleMs, XHR }?: {
    XHR?: {
        new (): XMLHttpRequest;
        prototype: XMLHttpRequest;
        readonly UNSENT: 0;
        readonly OPENED: 1;
        readonly HEADERS_RECEIVED: 2;
        readonly LOADING: 3;
        readonly DONE: 4;
    } | undefined;
    idleMs?: number | undefined;
    onProgress?: unknown;
}): Promise<any>;
export declare function looksLocal(hostname: any): boolean;
export declare function pairRedeem(serverBase: any, code: any, { probeMs }?: {
    probeMs?: number | undefined;
}): Promise<any>;
export declare function passkeyError(e: any, fallback: any): any;
export declare function passkeyRegister(name: any, code: any): Promise<any>;
export declare function passkeyAssertion({ signal }?: {    signal?: unknown;
}): Promise<{
    cid: any;
    credential: {
        id: any;
        rawId: string;
        type: any;
        clientExtensionResults: any;
        authenticatorAttachment: any;
        response: {
            clientDataJSON: string;
        };
    };
}>;
export declare function passkeyLogin(): Promise<any>;
export declare function createPasskey(options: any): Promise<{
    id: any;
    rawId: string;
    type: any;
    clientExtensionResults: any;
    authenticatorAttachment: any;
    response: {
        clientDataJSON: string;
    };
}>;
export declare function passwordLogin(name: any, password: any): Promise<any>;
export declare function passwordRegister(name: any, password: any, code: any, email: any): Promise<any>;
export declare function passwordResetRedeem(name: any, code: any, next: any): Promise<any>;
