import type { ExerciseIndex } from '../core-api/exercises'
import * as m0 from '@opengym/core/session-merge'
import * as m1 from '@opengym/core/media-prefetch'
import * as m2 from '@opengym/core/programme-import'
import * as m3 from '@opengym/core/backoff'
import * as m4 from '@opengym/core/muscles'
import * as m5 from '@opengym/core/workout-date'
import * as m6 from '@opengym/core/progression'
import * as m7 from '@opengym/core/workout-card'
import * as m8 from '@opengym/core/finish-compare'
import * as m9 from '@opengym/core/import-hevy'
import * as m10 from '@opengym/core/plan-share'
import * as m11 from '@opengym/core/session-start'
import * as m12 from '@opengym/core/units'
import * as m13 from '@opengym/core/programme-rollover'
import * as m14 from '@opengym/core/recovery'
import * as m15 from '@opengym/core/demoSeed'
import * as m16 from '@opengym/core/workout-text'
import * as m17 from '@opengym/core/incline'
import * as m18 from '@opengym/core/sync-merge'
import * as m19 from '@opengym/core/routines'
import * as m20 from '@opengym/core/exercise-history'
import * as m21 from '@opengym/core/programme-today'
import * as m22 from '@opengym/core/programme-refresh'
import * as m23 from '@opengym/core/history'
import * as m24 from '@opengym/core/strength-exercises'
import * as m25 from '@opengym/core/programme-agent'
import * as m26 from '@opengym/core/import-csv'
import * as m27 from '@opengym/core/onerm'
import * as m28 from '@opengym/core/dumbbells'
import * as m29 from '@opengym/core/exercises'
import * as m30 from '@opengym/core/starter'
import * as m31 from '@opengym/core/session-routines'
import * as m32 from '@opengym/core/backfill'
import * as m33 from '@opengym/core/programme-conformance'
import * as m34 from '@opengym/core/programme'
import * as m35 from '@opengym/core/effort'
import * as m36 from '@opengym/core/session-repeat'
import * as m37 from '@opengym/core/structuralBalance'
import * as m38 from '@opengym/core/programme-open-slots'
import * as m39 from '@opengym/core/programme-lifecycle'
import * as m40 from '@opengym/core/plates'
import * as m41 from '@opengym/core/session-edit'
import * as m42 from '@opengym/core/finish-workout'
import * as m43 from '@opengym/core/programme-quality'
import * as m44 from '@opengym/core/bar'
import * as m45 from '@opengym/core/programme-tm'
import * as m46 from '@opengym/core/fit-export'

// Compile each swept callable at its original arity plus the caller-owned index.
export function indexSweepConsumers(index: ExerciseIndex) {
  m0.buildCombinedEntries(undefined as unknown as Parameters<typeof m0.buildCombinedEntries>[0], undefined as unknown as Parameters<typeof m0.buildCombinedEntries>[1], index)
  m1.planMediaUrls(undefined as unknown as Parameters<typeof m1.planMediaUrls>[0], undefined as unknown as Parameters<typeof m1.planMediaUrls>[1], index)
  m1.startMediaPrefetch(undefined as unknown as Parameters<typeof m1.startMediaPrefetch>[0], undefined as unknown as Parameters<typeof m1.startMediaPrefetch>[1], index)
  m2.validateProgrammeDefinition(undefined as unknown as Parameters<typeof m2.validateProgrammeDefinition>[0], undefined as unknown as Parameters<typeof m2.validateProgrammeDefinition>[1], index)
  m2.importProgramme(undefined as unknown as Parameters<typeof m2.importProgramme>[0], undefined as unknown as Parameters<typeof m2.importProgramme>[1], index)
  m2.saveImportedProgramme(undefined as unknown as Parameters<typeof m2.saveImportedProgramme>[0], undefined as unknown as Parameters<typeof m2.saveImportedProgramme>[1], undefined as unknown as Parameters<typeof m2.saveImportedProgramme>[2], index)
  m3.backoffStepOf(undefined as unknown as Parameters<typeof m3.backoffStepOf>[0], undefined as unknown as Parameters<typeof m3.backoffStepOf>[1], index)
  m4.loadOf(undefined as unknown as Parameters<typeof m4.loadOf>[0], index)
  m4.loadOfWorkouts(undefined as unknown as Parameters<typeof m4.loadOfWorkouts>[0], undefined as unknown as Parameters<typeof m4.loadOfWorkouts>[1], index)
  m4.loadOfRoutine(undefined as unknown as Parameters<typeof m4.loadOfRoutine>[0], undefined as unknown as Parameters<typeof m4.loadOfRoutine>[1], index)
  m4.loadOfWeeklyPlan(undefined as unknown as Parameters<typeof m4.loadOfWeeklyPlan>[0], index)
  m4.loadOfActive(undefined as unknown as Parameters<typeof m4.loadOfActive>[0], index)
  m5.rebuildPrHistory(undefined as unknown as Parameters<typeof m5.rebuildPrHistory>[0], undefined as unknown as Parameters<typeof m5.rebuildPrHistory>[1], undefined as unknown as Parameters<typeof m5.rebuildPrHistory>[2], index)
  m5.moveWorkout(undefined as unknown as Parameters<typeof m5.moveWorkout>[0], undefined as unknown as Parameters<typeof m5.moveWorkout>[1], undefined as unknown as Parameters<typeof m5.moveWorkout>[2], undefined as unknown as Parameters<typeof m5.moveWorkout>[3], undefined as unknown as Parameters<typeof m5.moveWorkout>[4], index)
  m6.weightIncrement(undefined as unknown as Parameters<typeof m6.weightIncrement>[0], undefined as unknown as Parameters<typeof m6.weightIncrement>[1], index)
  m6.policyFor(undefined as unknown as Parameters<typeof m6.policyFor>[0], undefined as unknown as Parameters<typeof m6.policyFor>[1], undefined as unknown as Parameters<typeof m6.policyFor>[2], index)
  m6.plannedOf(undefined as unknown as Parameters<typeof m6.plannedOf>[0], index)
  m6.planChanged(undefined as unknown as Parameters<typeof m6.planChanged>[0], undefined as unknown as Parameters<typeof m6.planChanged>[1], index)
  m6.readSession(undefined as unknown as Parameters<typeof m6.readSession>[0], undefined as unknown as Parameters<typeof m6.readSession>[1], index)
  m6.sessionsFor(undefined as unknown as Parameters<typeof m6.sessionsFor>[0], undefined as unknown as Parameters<typeof m6.sessionsFor>[1], undefined as unknown as Parameters<typeof m6.sessionsFor>[2], undefined as unknown as Parameters<typeof m6.sessionsFor>[3], index)
  m6.nextPrescription(undefined as unknown as Parameters<typeof m6.nextPrescription>[0], undefined as unknown as Parameters<typeof m6.nextPrescription>[1], undefined as unknown as Parameters<typeof m6.nextPrescription>[2], index)
  m7.workoutCardModel(undefined as unknown as Parameters<typeof m7.workoutCardModel>[0], undefined as unknown as Parameters<typeof m7.workoutCardModel>[1], index)
  m8.finishCompare(undefined as unknown as Parameters<typeof m8.finishCompare>[0], undefined as unknown as Parameters<typeof m8.finishCompare>[1], index)
  m8.finishCardio(undefined as unknown as Parameters<typeof m8.finishCardio>[0], index)
  m9.matchHevyTemplate(undefined as unknown as Parameters<typeof m9.matchHevyTemplate>[0], index)
  m9.buildHevyExerciseMap(undefined as unknown as Parameters<typeof m9.buildHevyExerciseMap>[0], index)
  m9.parseHevyWorkouts(undefined as unknown as Parameters<typeof m9.parseHevyWorkouts>[0], undefined as unknown as Parameters<typeof m9.parseHevyWorkouts>[1], undefined as unknown as Parameters<typeof m9.parseHevyWorkouts>[2], index)
  m9.parseHevyRoutines(undefined as unknown as Parameters<typeof m9.parseHevyRoutines>[0], undefined as unknown as Parameters<typeof m9.parseHevyRoutines>[1], undefined as unknown as Parameters<typeof m9.parseHevyRoutines>[2], index)
  m9.importHevyData(undefined as unknown as Parameters<typeof m9.importHevyData>[0], undefined as unknown as Parameters<typeof m9.importHevyData>[1], index)
  m10.buildPlanBundle(undefined as unknown as Parameters<typeof m10.buildPlanBundle>[0], undefined as unknown as Parameters<typeof m10.buildPlanBundle>[1], index)
  m10.parsePlan(undefined as unknown as Parameters<typeof m10.parsePlan>[0], undefined as unknown as Parameters<typeof m10.parsePlan>[1], index)
  m10.mergePlan(undefined as unknown as Parameters<typeof m10.mergePlan>[0], undefined as unknown as Parameters<typeof m10.mergePlan>[1], undefined as unknown as Parameters<typeof m10.mergePlan>[2], index)
  m10.planPrintHTML(undefined as unknown as Parameters<typeof m10.planPrintHTML>[0], undefined as unknown as Parameters<typeof m10.planPrintHTML>[1], undefined as unknown as Parameters<typeof m10.planPrintHTML>[2], index)
  m10.printPlan(undefined as unknown as Parameters<typeof m10.printPlan>[0], undefined as unknown as Parameters<typeof m10.printPlan>[1], undefined as unknown as Parameters<typeof m10.printPlan>[2], index)
  m11.programmeDeloadConfig(undefined as unknown as Parameters<typeof m11.programmeDeloadConfig>[0], undefined as unknown as Parameters<typeof m11.programmeDeloadConfig>[1], undefined as unknown as Parameters<typeof m11.programmeDeloadConfig>[2], index)
  m11.buildPlannedEntry(undefined as unknown as Parameters<typeof m11.buildPlannedEntry>[0], undefined as unknown as Parameters<typeof m11.buildPlannedEntry>[1], undefined as unknown as Parameters<typeof m11.buildPlannedEntry>[2], undefined as unknown as Parameters<typeof m11.buildPlannedEntry>[3], index)
  m11.buildSessionEntries(undefined as unknown as Parameters<typeof m11.buildSessionEntries>[0], undefined as unknown as Parameters<typeof m11.buildSessionEntries>[1], index)
  m12.convertStateUnit(undefined as unknown as Parameters<typeof m12.convertStateUnit>[0], undefined as unknown as Parameters<typeof m12.convertStateUnit>[1], index)
  m13.rolloverProposals(undefined as unknown as Parameters<typeof m13.rolloverProposals>[0], undefined as unknown as Parameters<typeof m13.rolloverProposals>[1], index)
  m13.acceptRollover(undefined as unknown as Parameters<typeof m13.acceptRollover>[0], undefined as unknown as Parameters<typeof m13.acceptRollover>[1], undefined as unknown as Parameters<typeof m13.acceptRollover>[2], undefined as unknown as Parameters<typeof m13.acceptRollover>[3], index)
  m13.finishProgrammeBlock(undefined as unknown as Parameters<typeof m13.finishProgrammeBlock>[0], undefined as unknown as Parameters<typeof m13.finishProgrammeBlock>[1], undefined as unknown as Parameters<typeof m13.finishProgrammeBlock>[2], undefined as unknown as Parameters<typeof m13.finishProgrammeBlock>[3], index)
  m14.anchorsByWorkout(undefined as unknown as Parameters<typeof m14.anchorsByWorkout>[0], undefined as unknown as Parameters<typeof m14.anchorsByWorkout>[1], index)
  m14.resolveSetRir(undefined as unknown as Parameters<typeof m14.resolveSetRir>[0], undefined as unknown as Parameters<typeof m14.resolveSetRir>[1], undefined as unknown as Parameters<typeof m14.resolveSetRir>[2], undefined as unknown as Parameters<typeof m14.resolveSetRir>[3], undefined as unknown as Parameters<typeof m14.resolveSetRir>[4], undefined as unknown as Parameters<typeof m14.resolveSetRir>[5], index)
  m14.fatigueOf(undefined as unknown as Parameters<typeof m14.fatigueOf>[0], undefined as unknown as Parameters<typeof m14.fatigueOf>[1], undefined as unknown as Parameters<typeof m14.fatigueOf>[2], index)
  m14.strengthOf(undefined as unknown as Parameters<typeof m14.strengthOf>[0], undefined as unknown as Parameters<typeof m14.strengthOf>[1], undefined as unknown as Parameters<typeof m14.strengthOf>[2], index)
  m14.fatiguedMuscles(undefined as unknown as Parameters<typeof m14.fatiguedMuscles>[0], undefined as unknown as Parameters<typeof m14.fatiguedMuscles>[1], undefined as unknown as Parameters<typeof m14.fatiguedMuscles>[2], index)
  m14.detrainedMuscles(undefined as unknown as Parameters<typeof m14.detrainedMuscles>[0], undefined as unknown as Parameters<typeof m14.detrainedMuscles>[1], undefined as unknown as Parameters<typeof m14.detrainedMuscles>[2], index)
  m15.buildDemoState(index)
  m16.workoutText(undefined as unknown as Parameters<typeof m16.workoutText>[0], undefined as unknown as Parameters<typeof m16.workoutText>[1], index)
  m17.inclineFits(undefined as unknown as Parameters<typeof m17.inclineFits>[0], index)
  m18.inUnitOf(undefined as unknown as Parameters<typeof m18.inUnitOf>[0], undefined as unknown as Parameters<typeof m18.inUnitOf>[1], index)
  m18.sinceReset(undefined as unknown as Parameters<typeof m18.sinceReset>[0], undefined as unknown as Parameters<typeof m18.sinceReset>[1], undefined as unknown as Parameters<typeof m18.sinceReset>[2], index)
  m18.mergeStates(undefined as unknown as Parameters<typeof m18.mergeStates>[0], undefined as unknown as Parameters<typeof m18.mergeStates>[1], undefined as unknown as Parameters<typeof m18.mergeStates>[2], index)
  m19.replaceSlotExercise(undefined as unknown as Parameters<typeof m19.replaceSlotExercise>[0], undefined as unknown as Parameters<typeof m19.replaceSlotExercise>[1], undefined as unknown as Parameters<typeof m19.replaceSlotExercise>[2], undefined as unknown as Parameters<typeof m19.replaceSlotExercise>[3], index)
  m19.routineChangesFromEntry(undefined as unknown as Parameters<typeof m19.routineChangesFromEntry>[0], undefined as unknown as Parameters<typeof m19.routineChangesFromEntry>[1], undefined as unknown as Parameters<typeof m19.routineChangesFromEntry>[2], index)
  m19.updateRoutineFromEntry(undefined as unknown as Parameters<typeof m19.updateRoutineFromEntry>[0], undefined as unknown as Parameters<typeof m19.updateRoutineFromEntry>[1], undefined as unknown as Parameters<typeof m19.updateRoutineFromEntry>[2], index)
  m20.exerciseHistory(undefined as unknown as Parameters<typeof m20.exerciseHistory>[0], undefined as unknown as Parameters<typeof m20.exerciseHistory>[1], undefined as unknown as Parameters<typeof m20.exerciseHistory>[2], index)
  m20.bestSetFor(undefined as unknown as Parameters<typeof m20.bestSetFor>[0], undefined as unknown as Parameters<typeof m20.bestSetFor>[1], undefined as unknown as Parameters<typeof m20.bestSetFor>[2], undefined as unknown as Parameters<typeof m20.bestSetFor>[3], index)
  m21.repeatProgrammeWeek(undefined as unknown as Parameters<typeof m21.repeatProgrammeWeek>[0], undefined as unknown as Parameters<typeof m21.repeatProgrammeWeek>[1], undefined as unknown as Parameters<typeof m21.repeatProgrammeWeek>[2], undefined as unknown as Parameters<typeof m21.repeatProgrammeWeek>[3], index)
  m22.refreshProgrammeDefinitions(undefined as unknown as Parameters<typeof m22.refreshProgrammeDefinitions>[0], undefined as unknown as Parameters<typeof m22.refreshProgrammeDefinitions>[1], undefined as unknown as Parameters<typeof m22.refreshProgrammeDefinitions>[2], index)
  m23.modeOf(undefined as unknown as Parameters<typeof m23.modeOf>[0], index)
  m23.isTimed(undefined as unknown as Parameters<typeof m23.isTimed>[0], index)
  m23.isBw(undefined as unknown as Parameters<typeof m23.isBw>[0], index)
  m23.setsFromRows(undefined as unknown as Parameters<typeof m23.setsFromRows>[0], undefined as unknown as Parameters<typeof m23.setsFromRows>[1], index)
  m23.setLabel(undefined as unknown as Parameters<typeof m23.setLabel>[0], undefined as unknown as Parameters<typeof m23.setLabel>[1], undefined as unknown as Parameters<typeof m23.setLabel>[2], undefined as unknown as Parameters<typeof m23.setLabel>[3], index)
  m23.defaultConfig(undefined as unknown as Parameters<typeof m23.defaultConfig>[0], undefined as unknown as Parameters<typeof m23.defaultConfig>[1], index)
  m23.setsRepsOf(undefined as unknown as Parameters<typeof m23.setsRepsOf>[0], index)
  m23.exLine(undefined as unknown as Parameters<typeof m23.exLine>[0], undefined as unknown as Parameters<typeof m23.exLine>[1], undefined as unknown as Parameters<typeof m23.exLine>[2], index)
  m23.bestWeightFor(undefined as unknown as Parameters<typeof m23.bestWeightFor>[0], undefined as unknown as Parameters<typeof m23.bestWeightFor>[1], undefined as unknown as Parameters<typeof m23.bestWeightFor>[2], index)
  m23.buildSets(undefined as unknown as Parameters<typeof m23.buildSets>[0], undefined as unknown as Parameters<typeof m23.buildSets>[1], undefined as unknown as Parameters<typeof m23.buildSets>[2], index)
  m23.barFloor(undefined as unknown as Parameters<typeof m23.barFloor>[0], undefined as unknown as Parameters<typeof m23.barFloor>[1], index)
  m23.applyIntensifierPlan(undefined as unknown as Parameters<typeof m23.applyIntensifierPlan>[0], undefined as unknown as Parameters<typeof m23.applyIntensifierPlan>[1], undefined as unknown as Parameters<typeof m23.applyIntensifierPlan>[2], index)
  m23.applyFailurePlan(undefined as unknown as Parameters<typeof m23.applyFailurePlan>[0], undefined as unknown as Parameters<typeof m23.applyFailurePlan>[1], index)
  m23.workoutVolume(undefined as unknown as Parameters<typeof m23.workoutVolume>[0], index)
  m23.metricEntriesForExercise(undefined as unknown as Parameters<typeof m23.metricEntriesForExercise>[0], undefined as unknown as Parameters<typeof m23.metricEntriesForExercise>[1], index)
  m23.bestWeightForEntry(undefined as unknown as Parameters<typeof m23.bestWeightForEntry>[0], index)
  m24.primaryMuscleOf(undefined as unknown as Parameters<typeof m24.primaryMuscleOf>[0], index)
  m24.strengthExerciseRows(undefined as unknown as Parameters<typeof m24.strengthExerciseRows>[0], undefined as unknown as Parameters<typeof m24.strengthExerciseRows>[1], index)
  m24.strengthExerciseRowsForMuscle(undefined as unknown as Parameters<typeof m24.strengthExerciseRowsForMuscle>[0], undefined as unknown as Parameters<typeof m24.strengthExerciseRowsForMuscle>[1], undefined as unknown as Parameters<typeof m24.strengthExerciseRowsForMuscle>[2], index)
  m25.applyProgrammeAgentAction(undefined as unknown as Parameters<typeof m25.applyProgrammeAgentAction>[0], undefined as unknown as Parameters<typeof m25.applyProgrammeAgentAction>[1], undefined as unknown as Parameters<typeof m25.applyProgrammeAgentAction>[2], undefined as unknown as Parameters<typeof m25.applyProgrammeAgentAction>[3], index)
  m26.matchExercise(undefined as unknown as Parameters<typeof m26.matchExercise>[0], index)
  m26.matchHevyTitle(undefined as unknown as Parameters<typeof m26.matchHevyTitle>[0], index)
  m26.parseWorkoutCSV(undefined as unknown as Parameters<typeof m26.parseWorkoutCSV>[0], undefined as unknown as Parameters<typeof m26.parseWorkoutCSV>[1], index)
  m26.parseImport(undefined as unknown as Parameters<typeof m26.parseImport>[0], undefined as unknown as Parameters<typeof m26.parseImport>[1], index)
  m26.mergeImport(undefined as unknown as Parameters<typeof m26.mergeImport>[0], undefined as unknown as Parameters<typeof m26.mergeImport>[1], index)
  m27.bestSetOf(undefined as unknown as Parameters<typeof m27.bestSetOf>[0], undefined as unknown as Parameters<typeof m27.bestSetOf>[1], index)
  m27.e1rmSeries(undefined as unknown as Parameters<typeof m27.e1rmSeries>[0], undefined as unknown as Parameters<typeof m27.e1rmSeries>[1], undefined as unknown as Parameters<typeof m27.e1rmSeries>[2], undefined as unknown as Parameters<typeof m27.e1rmSeries>[3], index)
  m27.best1RM(undefined as unknown as Parameters<typeof m27.best1RM>[0], undefined as unknown as Parameters<typeof m27.best1RM>[1], undefined as unknown as Parameters<typeof m27.best1RM>[2], undefined as unknown as Parameters<typeof m27.best1RM>[3], index)
  m27.is1RMRecord(undefined as unknown as Parameters<typeof m27.is1RMRecord>[0], undefined as unknown as Parameters<typeof m27.is1RMRecord>[1], undefined as unknown as Parameters<typeof m27.is1RMRecord>[2], undefined as unknown as Parameters<typeof m27.is1RMRecord>[3], index)
  m28.isBellEx(undefined as unknown as Parameters<typeof m28.isBellEx>[0], index)
  m28.dbLoadFor(undefined as unknown as Parameters<typeof m28.dbLoadFor>[0], undefined as unknown as Parameters<typeof m28.dbLoadFor>[1], index)
  m28.isOneArm(undefined as unknown as Parameters<typeof m28.isOneArm>[0], index)
  m28.bellsIn(undefined as unknown as Parameters<typeof m28.bellsIn>[0], index)
  m28.withMeaning(undefined as unknown as Parameters<typeof m28.withMeaning>[0], undefined as unknown as Parameters<typeof m28.withMeaning>[1], undefined as unknown as Parameters<typeof m28.withMeaning>[2], index)
  m28.volumeFactor(undefined as unknown as Parameters<typeof m28.volumeFactor>[0], index)
  m28.meaningFactor(undefined as unknown as Parameters<typeof m28.meaningFactor>[0], undefined as unknown as Parameters<typeof m28.meaningFactor>[1], undefined as unknown as Parameters<typeof m28.meaningFactor>[2], index)
  m28.entryAs(undefined as unknown as Parameters<typeof m28.entryAs>[0], undefined as unknown as Parameters<typeof m28.entryAs>[1], index)
  m28.workoutAs(undefined as unknown as Parameters<typeof m28.workoutAs>[0], undefined as unknown as Parameters<typeof m28.workoutAs>[1], undefined as unknown as Parameters<typeof m28.workoutAs>[2], index)
  m28.historyAs(undefined as unknown as Parameters<typeof m28.historyAs>[0], undefined as unknown as Parameters<typeof m28.historyAs>[1], undefined as unknown as Parameters<typeof m28.historyAs>[2], index)
  m28.ownedWeightsFor(undefined as unknown as Parameters<typeof m28.ownedWeightsFor>[0], undefined as unknown as Parameters<typeof m28.ownedWeightsFor>[1], index)
  m29.canonicalExId(undefined as unknown as Parameters<typeof m29.canonicalExId>[0], index)
  m29.isCustomEx(undefined as unknown as Parameters<typeof m29.isCustomEx>[0], index)
  m29.isCardio(undefined as unknown as Parameters<typeof m29.isCardio>[0], index)
  m29.isBodyweightEq(undefined as unknown as Parameters<typeof m29.isBodyweightEq>[0], index)
  m29.isLoadedEq(undefined as unknown as Parameters<typeof m29.isLoadedEq>[0], index)
  m29.defaultIncrement(undefined as unknown as Parameters<typeof m29.defaultIncrement>[0], undefined as unknown as Parameters<typeof m29.defaultIncrement>[1], index)
  m29.isAssisted(undefined as unknown as Parameters<typeof m29.isAssisted>[0], index)
  m29.betterWeight(undefined as unknown as Parameters<typeof m29.betterWeight>[0], undefined as unknown as Parameters<typeof m29.betterWeight>[1], undefined as unknown as Parameters<typeof m29.betterWeight>[2], index)
  m29.beatsWeight(undefined as unknown as Parameters<typeof m29.beatsWeight>[0], undefined as unknown as Parameters<typeof m29.beatsWeight>[1], undefined as unknown as Parameters<typeof m29.beatsWeight>[2], index)
  m29.exOr(undefined as unknown as Parameters<typeof m29.exOr>[0], index)
  m30.substituteFor(undefined as unknown as Parameters<typeof m30.substituteFor>[0], undefined as unknown as Parameters<typeof m30.substituteFor>[1], undefined as unknown as Parameters<typeof m30.substituteFor>[2], index)
  m30.buildStarterPlan(undefined as unknown as Parameters<typeof m30.buildStarterPlan>[0], undefined as unknown as Parameters<typeof m30.buildStarterPlan>[1], index)
  m31.routineFromSession(undefined as unknown as Parameters<typeof m31.routineFromSession>[0], undefined as unknown as Parameters<typeof m31.routineFromSession>[1], undefined as unknown as Parameters<typeof m31.routineFromSession>[2], index)
  m31.saveSessionAsRoutine(undefined as unknown as Parameters<typeof m31.saveSessionAsRoutine>[0], undefined as unknown as Parameters<typeof m31.saveSessionAsRoutine>[1], undefined as unknown as Parameters<typeof m31.saveSessionAsRoutine>[2], index)
  m32.markAllSetsDone(undefined as unknown as Parameters<typeof m32.markAllSetsDone>[0], index)
  m33.programmeConformance(undefined as unknown as Parameters<typeof m33.programmeConformance>[0], undefined as unknown as Parameters<typeof m33.programmeConformance>[1], index)
  m34.materializeWeek(undefined as unknown as Parameters<typeof m34.materializeWeek>[0], undefined as unknown as Parameters<typeof m34.materializeWeek>[1], undefined as unknown as Parameters<typeof m34.materializeWeek>[2], undefined as unknown as Parameters<typeof m34.materializeWeek>[3], index)
  m34.activate(undefined as unknown as Parameters<typeof m34.activate>[0], undefined as unknown as Parameters<typeof m34.activate>[1], undefined as unknown as Parameters<typeof m34.activate>[2], index)
  m34.adopt(undefined as unknown as Parameters<typeof m34.adopt>[0], undefined as unknown as Parameters<typeof m34.adopt>[1], undefined as unknown as Parameters<typeof m34.adopt>[2], undefined as unknown as Parameters<typeof m34.adopt>[3], index)
  m34.insertDeload(undefined as unknown as Parameters<typeof m34.insertDeload>[0], undefined as unknown as Parameters<typeof m34.insertDeload>[1], undefined as unknown as Parameters<typeof m34.insertDeload>[2], index)
  m35.hasEstimableEffort(undefined as unknown as Parameters<typeof m35.hasEstimableEffort>[0], index)
  m36.repeatSessionEntries(undefined as unknown as Parameters<typeof m36.repeatSessionEntries>[0], undefined as unknown as Parameters<typeof m36.repeatSessionEntries>[1], undefined as unknown as Parameters<typeof m36.repeatSessionEntries>[2], index)
  m37.resolveCurrent(undefined as unknown as Parameters<typeof m37.resolveCurrent>[0], undefined as unknown as Parameters<typeof m37.resolveCurrent>[1], undefined as unknown as Parameters<typeof m37.resolveCurrent>[2], undefined as unknown as Parameters<typeof m37.resolveCurrent>[3], index)
  m37.resolveCurrentReps(undefined as unknown as Parameters<typeof m37.resolveCurrentReps>[0], undefined as unknown as Parameters<typeof m37.resolveCurrentReps>[1], index)
  m37.computeBalance(undefined as unknown as Parameters<typeof m37.computeBalance>[0], undefined as unknown as Parameters<typeof m37.computeBalance>[1], index)
  m38.chooseOpenSlot(undefined as unknown as Parameters<typeof m38.chooseOpenSlot>[0], undefined as unknown as Parameters<typeof m38.chooseOpenSlot>[1], undefined as unknown as Parameters<typeof m38.chooseOpenSlot>[2], undefined as unknown as Parameters<typeof m38.chooseOpenSlot>[3], undefined as unknown as Parameters<typeof m38.chooseOpenSlot>[4], index)
  m39.startProgramme(undefined as unknown as Parameters<typeof m39.startProgramme>[0], undefined as unknown as Parameters<typeof m39.startProgramme>[1], undefined as unknown as Parameters<typeof m39.startProgramme>[2], index)
  m39.switchProgramme(undefined as unknown as Parameters<typeof m39.switchProgramme>[0], undefined as unknown as Parameters<typeof m39.switchProgramme>[1], undefined as unknown as Parameters<typeof m39.switchProgramme>[2], undefined as unknown as Parameters<typeof m39.switchProgramme>[3], index)
  m40.loadKindFor(undefined as unknown as Parameters<typeof m40.loadKindFor>[0], undefined as unknown as Parameters<typeof m40.loadKindFor>[1], index)
  m40.baseWeightFor(undefined as unknown as Parameters<typeof m40.baseWeightFor>[0], undefined as unknown as Parameters<typeof m40.baseWeightFor>[1], index)
  m40.dropGrid(undefined as unknown as Parameters<typeof m40.dropGrid>[0], undefined as unknown as Parameters<typeof m40.dropGrid>[1], index)
  m41.saveWorkoutEdit(undefined as unknown as Parameters<typeof m41.saveWorkoutEdit>[0], undefined as unknown as Parameters<typeof m41.saveWorkoutEdit>[1], index)
  m41.editChangesNothing(undefined as unknown as Parameters<typeof m41.editChangesNothing>[0], index)
  m41.deleteEditedWorkout(undefined as unknown as Parameters<typeof m41.deleteEditedWorkout>[0], index)
  m42.buildCompletedWorkout(undefined as unknown as Parameters<typeof m42.buildCompletedWorkout>[0], undefined as unknown as Parameters<typeof m42.buildCompletedWorkout>[1], index)
  m43.improveProgrammeDefinition(undefined as unknown as Parameters<typeof m43.improveProgrammeDefinition>[0], undefined as unknown as Parameters<typeof m43.improveProgrammeDefinition>[1], index)
  m44.usesBar(undefined as unknown as Parameters<typeof m44.usesBar>[0], index)
  m44.barWeightFor(undefined as unknown as Parameters<typeof m44.barWeightFor>[0], undefined as unknown as Parameters<typeof m44.barWeightFor>[1], index)
  m45.programmeTMConfig(undefined as unknown as Parameters<typeof m45.programmeTMConfig>[0], undefined as unknown as Parameters<typeof m45.programmeTMConfig>[1], undefined as unknown as Parameters<typeof m45.programmeTMConfig>[2], index)
  m46.workoutFitMessages(undefined as unknown as Parameters<typeof m46.workoutFitMessages>[0], undefined as unknown as Parameters<typeof m46.workoutFitMessages>[1], index)
  m46.workoutFit(undefined as unknown as Parameters<typeof m46.workoutFit>[0], undefined as unknown as Parameters<typeof m46.workoutFit>[1], index)
}
