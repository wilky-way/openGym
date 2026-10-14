// Exercise every index-taking lifecycle call with actual outputs rather than stubs.
// Leaf regressions are covered in programme-engine-index.test.ts.
const canonical = 'inert: source import resolves only ids already in its full catalogue, so final membership validation cannot differ; refresh stores only definitions whose same-index import/assessment already validated identical ids against the same cloned catalogue. Public validation of a stale index is not inert and has fail-closed output tests.'
const conversion = 'inert: materializeWeek passes only unit and routines to convertStateUnit. Routine convTarget converts numerical loads without exercise metadata; neither barWeights nor workouts/active are supplied.'
export const indexEdges = [
 {name:'materialize → convertStateUnit',module:'programme',callee:'convertStateUnit',ordinal:0,total:1,argument:2,proof:conversion},
 {name:'activate → materializeWeek',module:'programme',callee:'materializeWeek',ordinal:0,total:2,argument:4,proof:conversion},
 {name:'adopt → activate',module:'programme',callee:'activate',ordinal:0,total:1,argument:3,proof:conversion},
 {name:'insertDeload → materializeWeek',module:'programme',callee:'materializeWeek',ordinal:1,total:2,argument:4,proof:conversion},
 {name:'repeat authored → activate',module:'programme-today',callee:'activate',ordinal:0,total:1,argument:3,proof:conversion},
 {name:'repeat inserted → materializeWeek',module:'programme-today',callee:'materializeWeek',ordinal:0,total:1,argument:4,proof:conversion},
 {name:'import source final → validateProgrammeDefinition',module:'programme-import',callee:'validateProgrammeDefinition',ordinal:2,total:4,argument:2,proof:canonical},
 {name:'lifecycle activateStarted → activate',module:'programme-lifecycle',callee:'activate',ordinal:0,total:1,argument:3,proof:conversion},
 {name:'start → activateStarted',module:'programme-lifecycle',callee:'activateStarted',ordinal:0,total:2,argument:4,proof:conversion},
 {name:'switch → activateStarted',module:'programme-lifecycle',callee:'activateStarted',ordinal:1,total:2,argument:4,proof:conversion},
 {name:'agent → activate',module:'programme-agent',callee:'activate',ordinal:0,total:1,argument:3,proof:conversion},
 {name:'refresh store → saveImportedProgramme',module:'programme-refresh',callee:'saveImportedProgramme',ordinal:0,total:1,argument:3,proof:canonical},
] as const
// Only these twelve membership/conversion edges are inert. The eleven identity/validation-sensitive edges have custom alias-shadow output-failing regressions.
