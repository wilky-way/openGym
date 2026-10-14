export declare const SG_NAME_MAX = 40;
/** { name, rest } of the group of `unit` (indices into `list`); `onTarget` for session entries. */
export declare function supersetMeta(list: any, unit: any, { onTarget }?: {
    onTarget?: boolean | undefined;
}): {
    name: string;
    rest: number;
};
/** Writes name and rest onto every member of group `sg` in a routine's `ex`; empty clears. */
export declare function setSupersetMeta(ex: any, sg: any, { name, rest }?: {
    name?: string | undefined;
    rest?: number | undefined;
}): any;
/** A member that joined or left a group: it takes the group's meta, or drops what it carried. */
export declare function syncSupersetMeta(ex: any): any;
