export declare function programmeSlotIds(ex: any, namespace?: string): any;
export declare const programmeSessionKey: (cycle: any, o: any) => any;
export declare function programmeSnapshotSession(cycle: any, o: any): any;
export declare function canScopeProgrammeSessions(S: any, routineId: any): boolean;
/** Derive intent once, then match stable slots in the same session of unresolved later stages. */
export declare function editProgrammeSessions(S: any, routineId: any, edit: any, later?: boolean): void;
