import type { ExerciseIndex } from './exercises';
/**
 * Whether the editor holds nothing Save could keep: not one set ticked done. Save drops an
 * exercise without one (buildCompletedWorkout), so this draft would save as a workout with no
 * exercises in it — an empty row in the history that counts as a training day.
 */
export declare const editLeftEmpty: (active: any) => boolean;
/**
 * Opens the editor on a saved workout: a copy of it becomes S.active. `ref` is the workout or its
 * id. Throws while another session is running, or when the workout is gone.
 */
export declare function editCompletedSession(state: any, ref: any): any;
/**
 * Saves the editor into history and closes it. Returns the saved record.
 *
 * The record is the one history holds now, not the one the editor opened: another device may have
 * moved it or corrected its note meanwhile, and what the editor does not edit stays as that left
 * it — the note and the name too, unless the editor changed them itself. The sets are the
 * editor's — the edit saved last wins, as it does between devices. A record deleted meanwhile
 * (the deletion already reached this device) is not brought back behind the person's back: Save
 * throws, and the draft stays open to keep editing or drop.
 */
export declare function saveWorkoutEdit(state: any, now?: number, index?: ExerciseIndex): any;
/**
 * Whether closing the editor would lose nothing: Save would write the record exactly as history
 * holds it. Closing then just closes — asking "Save workout changes?" about a workout nobody
 * touched (QA 1.3.9) made every look at a past session end in a question. A record deleted
 * meanwhile, or a draft left empty, is a change: those still ask.
 */
export declare function editChangesNothing(state: any, index?: ExerciseIndex): any;
/** The saved record the editor is open on, as history holds it now — or null (none open, or it
 *  was deleted meanwhile). */
export declare function editedRecord(state: any): any;
/**
 * Deletes the workout the editor is open on and closes the editor: what an edit that took out
 * every set gets instead of Save (editLeftEmpty). The record is found the way Save finds it, and
 * goes the way History's Delete takes it out; a kept working weight that came from it is lowered
 * the way Save lowers one an edit took away. A record another device deleted meanwhile is already
 * gone, and the editor just closes. Returns whether a record was removed.
 */
export declare function deleteEditedWorkout(state: any, index?: ExerciseIndex): boolean;
