import type { SyncProgrammes } from './sync-types';
export type { SyncProgrammes } from './sync-types';
export declare function offloadInputs(a: SyncProgrammes | null | undefined, b: SyncProgrammes | null | undefined): [SyncProgrammes | null | undefined, SyncProgrammes | null | undefined];
export declare function resetOffload<T extends SyncProgrammes>(p: T, resetAt: number): T;
export declare function offloadStamp(programmes: SyncProgrammes | null | undefined): number;
