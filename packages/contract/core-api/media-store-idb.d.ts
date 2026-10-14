export declare function idbBackend({ idb }?: {
    idb?: IDBFactory | undefined;
}): {
    name: string;
    persistent: boolean;
    open(): Promise<boolean>;
    all(): Promise<any[]>;
    getBlob(hash: any): Promise<Blob | null>;
    put(rec: any, blob: any): Promise<void>;
    patch(hash: any, fields: any): Promise<void>;
    remove(hash: any): Promise<void>;
    clear(): Promise<void>;
};
