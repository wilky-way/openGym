export declare function configureApiConnection({ baseUrl, token, fetch: transport }?: {
    baseUrl?: string | undefined;
    fetch?: null | undefined;
    token?: null | undefined;
}): void;
export declare const apiConnection: () => {
    baseUrl: any;
    token: null;
    fetch: null;
};
export declare const apiFetch: (...args: any[]) => Promise<Response>;
