export declare const MB: number;
export declare const DEFAULT_LIMITS: Readonly<{
    imageMB: 2;
    rawPhotoMB: 40;
    gifMB: 8;
    videoMB: 40;
    videoSec: 60;
    quotaMB: 200;
}>;
export declare const IMAGE_MAX_EDGE = 1600;
export declare const POSTER_EDGE = 480;
export declare const LOOP_MAX_SEC = 15;
export declare const MAX_PHOTO_MP = 52;
export declare const LOCAL_CACHE_MAX_MB = 300;
export declare const LOCAL_GC_GRACE_MS = 3600000;
export declare const BG_UPLOAD_METERED_MAX_MB = 5;
/** The limits in force: the server's `config.media` over the defaults, one number at a time. */
export declare function limitsFrom(config: any): {
    imageMB: 2;
    rawPhotoMB: 40;
    gifMB: 8;
    videoMB: 40;
    videoSec: 60;
    quotaMB: 200;
};
/** "2", "0.5", "40" — a size in MB to one decimal, with the language's own decimal mark ("0,5"
 *  in German and French). `fixed` keeps the one decimal on a whole number ("2.0"), for a line
 *  that lists sizes. */
export declare const fmtMB: (mb: any, { fixed }?: {
    fixed?: boolean | undefined;
}) => string;
