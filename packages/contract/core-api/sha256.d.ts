/** An incremental SHA-256: update(bytes) as often as needed, then hex(). */
export declare function createSha256(): {
    update(bytes: any): /*elided*/ any;
    hex(): string;
};
/** sha256 of bytes in pure JS. */
export declare function sha256HexJs(bytes: any): string;
/**
 * Lowercase hex SHA-256 of a Uint8Array, an ArrayBuffer or a Blob. `subtle` is injectable for
 * the tests; null forces the fallback.
 */
export declare function sha256Hex(input: any, { subtle }?: {
    subtle?: SubtleCrypto | undefined;
}): Promise<string>;
