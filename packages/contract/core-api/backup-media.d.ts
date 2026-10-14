export declare const BACKUP_JSON = "opengym-backup.json";
/** The media refs and links of an imported state — each custom exercise's picture and link, each
 *  logged workout's photos and videos — kept only where they pass the same checks as anywhere
 *  else (a workout's list also deduplicated, but not capped: workoutMediaOf caps what shows);
 *  the rest of the state is left as it is. Mutates and returns it. */
export declare function sanitizeCustomMedia(state: any): any;
/**
 * The zip for "Export with photos & videos": { blob, included, missing }. Each file comes from the
 * local store, or — signed in — is fetched into it first (`fetchOne`, lib/media-sync.js
 * fetchToStore). `missing` counts those that could not be had; the export goes ahead without them.
 */
export declare function exportBackupZip(S: any, { media, fetchOne, now }?: {
    fetchOne?: null | undefined;
    media?: {} | undefined;
    now?: unknown;
}): Promise<{
    blob: Blob;
    included: number;
    missing: number;
}>;
/**
 * What to tell someone whose pick did not import, in their language. The thrown messages are for
 * a developer ('not-zip', a JSON.parse complaint) and used to be toasted as they were.
 */
export declare function backupImportError(e: any): any;
/**
 * Reads a picked backup, .json or .zip (told apart by its first bytes, not its name):
 * { state, files: [{ hash, entry }], zip }. `files` are the zip's media entries the state refers
 * to, not yet checked or stored — storeBackupMedia does that, once the import is confirmed.
 * Throws on anything that is not an openGym backup.
 */
export declare function readBackupFile(file: any): Promise<{
    state: any;
    files: {
        hash: string;
        entry: {
            name: string;
            size: number;
            blob: any;
        };
    }[];
    zip: boolean;
}>;
/**
 * Checks and keeps a backup's media files: each must sniff as a stored type, stay under that
 * kind's cap, and hash to its name. Kept as pending — the server has not seen them from this
 * device. Resolves { stored, skipped }.
 */
export declare function storeBackupMedia(files: any, { media, limits }?: {
    limits?: Readonly<{
        imageMB: 2;
        rawPhotoMB: 40;
        gifMB: 8;
        videoMB: 40;
        videoSec: 60;
        quotaMB: 200;
    }> | undefined;
    media?: {} | undefined;
}): Promise<{
    stored: number;
    skipped: number;
}>;
