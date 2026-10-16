export declare function writePrivateJSON(file: string, value: unknown): Promise<void>
export declare function readPrivateJSON(file: string, options?: {timeoutMs?: number; retryMs?: number; onRetry?(): void}): Promise<unknown>
