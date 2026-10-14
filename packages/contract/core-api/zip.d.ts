export declare class ZipError extends Error {
    code: any;
    constructor(code: any, message: any);
}
/** CRC-32 (the zip one) of a Uint8Array, continuing from `crc` for data read in pieces. */
export declare function crc32(bytes: any, crc?: number): number;
export declare const MAX_ENTRIES = 2000;
export declare const MAX_TOTAL: number;
/**
 * A store-only zip of `entries` ([{ name, blob }]) as one Blob. Names are written as UTF-8 (flag
 * bit 11), so a name any archiver shows as written. Refuses more entries or data than readZip
 * accepts, and anything needing ZIP64.
 */
export declare function zipStore(entries: any, { now }?: {
    now?: Date | undefined;
}): Promise<Blob>;
/** Whether a file starts like a zip (PK\x03\x04). */
export declare function looksLikeZip(file: any): Promise<boolean>;
/**
 * The entries of a store-only zip as [{ name, size, blob }], each blob a slice of `file` (a File
 * or Blob) — nothing is read beyond the headers. Throws ZipError with code 'not-zip',
 * 'compressed' (repacked by an archiver), 'encrypted', 'too-many', 'bad-name' or 'too-large'.
 */
export declare function readZip(file: any): Promise<{
    name: string;
    size: number;
    blob: any;
}[]>;
