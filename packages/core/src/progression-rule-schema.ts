import type { ProgrammeSchema } from './programme-model-schema'
// Additive authoring schemas. Legacy instruction-only progression remains open.
const num = (minimum: number, maximum: number, integer = false): ProgrammeSchema => ({type:integer?'integer':'number',minimum,maximum})
const positive = (maximum: number): ProgrammeSchema => ({type:'number',exclusiveMinimum:0,maximum})
const text: ProgrammeSchema = {type:'string',minLength:1,maxLength:10000}
const ruleId: ProgrammeSchema = {type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,63}$'}
const enumeration = (...values: string[]): ProgrammeSchema => ({enum:values})
const arr = (items: ProgrammeSchema, maxItems = 100, minItems = 1): ProgrammeSchema => ({type:'array',items,minItems,maxItems})
const closed = (properties: Record<string, ProgrammeSchema>, required = Object.keys(properties)): ProgrammeSchema => ({type:'object',properties,required,additionalProperties:false})
const ref = (name: string): ProgrammeSchema => ({$ref:`#/$defs/${name}`})
const unit = enumeration('kg','lb')
const effort: ProgrammeSchema = {oneOf:[closed({rir:num(0,10)}),closed({rpe:num(1,10)})]}
const rounding = closed({increment:positive(100),mode:enumeration('nearest','down','up'),usePlates:{type:'boolean'}})
const slotRef = closed({week:num(1,Number.MAX_SAFE_INTEGER,true),day:text,session:text,slot:text})
const estimateWindow = {oneOf:[closed({sessions:num(1,20,true)}),closed({days:num(1,180,true)})]}
const rep = num(1,100,true)
const pct = positive(1.5)
const factor = positive(1)
const percentageSet = closed({pct,reps:{anyOf:[rep,{const:'amrap'}]},repsMin:rep},['pct','reps'])
const rpeSet: ProgrammeSchema = {oneOf:[closed({reps:rep,rir:num(0,10)}),closed({reps:rep,rpe:num(1,10)})]}
const weekMap = (items: ProgrammeSchema, wildcard = false): ProgrammeSchema => ({type:'object',minProperties:1,propertyNames:{pattern:wildcard?'^(\\*|[1-9][0-9]*)$':'^[1-9][0-9]*$'},additionalProperties:arr(items)})
const rule = (kind: string, fields: Record<string, ProgrammeSchema>, optional: string[] = []): ProgrammeSchema => closed({id:ruleId,kind:{const:kind},...fields},['id','kind',...Object.keys(fields).filter(k=>!optional.includes(k))])
export const progressionRuleSchemas: Record<string, ProgrammeSchema> = {
  percentage:rule('percentage',{ref:closed({lift:text,basis:enumeration('tm','1rm')}),weeks:weekMap(percentageSet),rounding:ref('rounding')}),
  'rpe-load':rule('rpe-load',{lift:text,weeks:weekMap(rpeSet,true),e1rm:closed({window:estimateWindow,pick:enumeration('best','latest','median'),formula:enumeration('profile','weighted','epley','brzycki','lombardi','oconner','mayhew','wathan','lander'),useLoggedEffort:{type:'boolean'}}),rounding:ref('rounding'),whenNoData:{oneOf:[closed({kind:{const:'athlete-picks'}}),closed({kind:{const:'percent-of-tm'},pct})]}}),
  double:rule('double',{repsLow:rep,repsHigh:rep,condition:enumeration('all-sets','first-set','total-reps'),totalThreshold:num(1,10000,true),increment:positive(100),unit,afterIncrease:{const:'reset-to-low'},rounding:ref('rounding')},['totalThreshold']),
  linear:rule('linear',{increment:positive(100),unit,every:{oneOf:[closed({sessions:num(1,Number.MAX_SAFE_INTEGER,true)}),closed({weeks:num(1,Number.MAX_SAFE_INTEGER,true)})]},success:enumeration('all-sets-all-reps','last-set-reps'),rounding:ref('rounding')}),
  'amrap-tm':rule('amrap-tm',{lift:text,source:closed({slot:ref('progressionSlotRef'),set:num(0,99,true)}),bands:arr(closed({minRepsOver:num(0,30,true),tmDelta:num(-50,50)}),10),unit,at:enumeration('end-of-week','end-of-cycle-lap')}),
  stall:rule('stall',{after:num(1,10,true),action:{oneOf:[closed({kind:{const:'repeat'}}),closed({kind:{const:'reset'},pct:{type:'number',minimum:0.5,exclusiveMaximum:1}}),closed({kind:{const:'deload'},setsFactor:factor,loadFactor:factor,weeks:num(1,64,true)})]},appliesTo:enumeration('load','tm')}),
  'scheduled-deload':rule('scheduled-deload',{weeks:{...arr(num(1,Number.MAX_SAFE_INTEGER,true),64),uniqueItems:true},setsFactor:factor,loadFactor:factor,effort,progressionDuring:{const:'off'}},['effort']),
  'volume-ramp':rule('volume-ramp',{scope:{oneOf:[closed({muscles:{...arr(text,18),uniqueItems:true}}),closed({slots:arr(ref('progressionSlotRef'))})]},startSets:num(0,60,true),addPerWeek:num(0,10,true),maxSets:num(0,60,true),weeks:{...arr(num(1,Number.MAX_SAFE_INTEGER,true),64),uniqueItems:true},distribute:enumeration('round-robin-by-slot-order','proportional'),holdIfMissedReps:{type:'boolean'}}),
}
export const progressionRuleDefs = {
  rounding,progressionSlotRef:slotRef,
  ...Object.fromEntries(Object.entries(progressionRuleSchemas).map(([kind,schema])=>[`rule-${kind}`,schema])),
  progressionRule:{oneOf:Object.keys(progressionRuleSchemas).map(kind=>ref(`rule-${kind}`))},
  tmSeed:{oneOf:[closed({value:positive(Number.MAX_VALUE),unit}),closed({fromE1rm:closed({pct})})]},
}
export const progressionDefinitionFields = {
  progressionRules:arr(ref('progressionRule'),100,0),
  tmSeeds:{type:'object',propertyNames:text,additionalProperties:ref('tmSeed')},
}
export const progressionSlotFields = {rules:{...arr(ruleId,100,0),uniqueItems:true},onStall:ruleId}
