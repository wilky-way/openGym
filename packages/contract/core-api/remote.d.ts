export declare function normalizeServerUrl(raw: any): string | null;
export { looksLocal } from './api.js';
export declare function forgetRemote(): void;
export declare function renewToken(remote: any, token: any): void;
export declare function connect(rawUrl: any, code: any): Promise<any>;
