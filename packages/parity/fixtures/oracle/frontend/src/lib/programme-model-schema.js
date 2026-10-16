// Single source for the exported JSON Schema and the structural validator.
// Cross-field constraints (catalogue identity, array lengths, expansion limits)
// remain in validateProgrammeDefinition: JSON Schema cannot express them all.
const text = {type:'string', maxLength:10000}
const nonempty = {...text, minLength:1}
const positive = {type:'number', exclusiveMinimum:0}
const integer = {type:'integer', minimum:1}
const nullable = schema => ({anyOf:[schema,{type:'null'}]})
const rep = {anyOf:[integer,{const:'max'},{type:'string',minLength:1}]}
const array = (items, extra={}) => ({type:'array',items,...extra})
const object = (properties, required=[]) => ({type:'object',properties,required})
const target = { ...object({rir:{type:'number',minimum:0,maximum:10},rpe:{type:'number',minimum:0,maximum:10},pct:positive}), additionalProperties:false }
const progression = object({
  kind:{enum:['linear','double','reps-sum','percentage','authored','manual','none']},
  instructions:nonempty, parameters:{type:'object'}, provenance:text,
},['kind','instructions'])
const generatedRule = {...object({
  count:array({type:'integer',minimum:1,maximum:100},{minItems:1,maxItems:100}),
  pct:array(positive,{minItems:1,maxItems:100}),
  rir:array({type:'number',minimum:0,maximum:10},{minItems:2,maxItems:2}),
  rpe:array({type:'number',minimum:1,maximum:10},{minItems:2,maxItems:2}),
  drop_pct:positive, until_rpe:{type:'number',exclusiveMinimum:0,maximum:10},
  total_reps:positive, from:{const:'top_set'}, open_count:{const:true},
}),additionalProperties:false}
const slot = object({
  id:nullable(text), open:{type:'boolean'}, label:nullable(text), category:nullable(text), slotId:nullable(text),
  role:nullable({enum:['main','supplement','accessory','gpp']}), sets:{type:'integer',minimum:1,maximum:100},
  reps:rep, repsMin:nullable(rep), pyramid:array(rep,{minItems:1,maxItems:10}),
  mode:text, sec:positive, target:nullable(target), setTargets:array(nullable(target)),
  setRepsMin:array(nullable(rep)), weight:nullable({anyOf:[{type:'number',minimum:0},text]}),
  pyramidWeight:array(nullable({anyOf:[{type:'number',minimum:0},text]})),
  tm:object({key:nullable(text),percentages:array(positive),reference:nullable(text)},['percentages']),
  progression:nullable(progression), instructions:nullable(text), loadGuidance:nullable(text),
  generatedRules:array(generatedRule,{maxItems:100}), authoredInstructions:nullable(text), noteKind:nullable(text),
  restSec:{type:'number',minimum:0}, note:nullable(text),
},['sets'])
const session = object({sessionTemplateId:nullable(text),routineSnapshot:object({name:nullable(text),ex:array({$ref:'#/$defs/slot'},{maxItems:100})},['ex'])},['routineSnapshot'])
const day = object({key:nonempty,ordinal:integer,sessions:array({$ref:'#/$defs/session'},{minItems:1,maxItems:8})},['key','sessions'])
const week = object({
  index:integer,mode:nullable({enum:['train','deload','test','inserted']}),weekId:nullable(text),label:nullable(text),
  rir:{type:'number',minimum:0,maximum:10},
  deload:object({authored:{type:'boolean'},setsFactor:positive,loadFactor:positive,from:text}),
  days:array({$ref:'#/$defs/day'},{minItems:1,maxItems:14}),
},['index','days'])
export const programmeModelSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  title:'openGym ProgrammeDefinition',
  description:'Structural validity; use programmeConformance for Complete and Ready. Unknown extension fields are retained.',
  ...object({
    id:nonempty,name:nonempty,unit:{enum:['kg','lb']},end:nullable({enum:['next','repeat','stop']}),
    goal:nullable(text),level:nullable(text),daysPerWeek:integer,lengthWeeks:integer,
    equipment:array(nonempty,{uniqueItems:true}),licence:nullable(text),
    source:{type:'object',additionalProperties:{anyOf:[text,{type:'boolean'},{type:'null'}]}},
    endPlan:nullable(object({kind:{enum:['deload','test','repeat','next','stop']},instructions:nonempty},['kind','instructions'])),
    instructions:nullable(text),needsReview:array(text),rulesSupported:{type:'boolean'},
    weeks:array({$ref:'#/$defs/week'},{minItems:1,maxItems:64}),
  },['id','name','unit','weeks']),
  $defs:{slot,session,day,week,target,progression},
  'x-opengym-semantic-constraints':[
    'Unique week indexes and day keys within each week.',
    'Resolved catalogue/custom exercise ID or open=true with no ID.',
    'Explicit reps, pyramid or timed duration; numeric strings must be positive integers.',
    'Per-set arrays match pyramid length or set count; percentage arrays match pyramid length.',
    'Rep range minimum does not exceed maximum; loads are finite and nonnegative.',
    'At most 10000 expanded sets; metadata depth at most 20; importNeedsPrescription must be false.',
  ],
}

/** Small interpreter for the schema keywords above, usable in browser and Node. */
export function programmeSchemaIssues(value) {
  const issues=[]
  function visit(v,s,path) {
    if (s.$ref) return visit(v,programmeModelSchema.$defs[s.$ref.split('/').at(-1)],path)
    if (s.anyOf) {
      const start=issues.length
      for (const child of s.anyOf) {visit(v,child,path);if(issues.length===start)return;issues.length=start}
      issues.push({path,message:'Value does not match an allowed type.'});return
    }
    const wrong = s.type && !(s.type==='object'? v!==null && typeof v==='object' && !Array.isArray(v):s.type==='array'?Array.isArray(v):s.type==='integer'?Number.isInteger(v):s.type==='number'?typeof v==='number' && Number.isFinite(v):s.type==='null'?v===null:typeof v===s.type)
    if(wrong) {issues.push({path,message:`Expected ${s.type}.`});return}
    const check=(ok,message)=>{if(!ok)issues.push({path,message})}
    if ('const' in s) check(v===s.const,'Value does not match the required constant.')
    if (s.enum) check(s.enum.includes(v),'Value is not in the allowed list.')
    if (typeof v==='number') {
      if(s.minimum!=null)check(v>=s.minimum,'Value is below the minimum.')
      if(s.maximum!=null)check(v<=s.maximum,'Value exceeds the maximum.')
      if(s.exclusiveMinimum!=null)check(v>s.exclusiveMinimum,'Value must be greater than the minimum.')
    }
    if(typeof v==='string') {
      if(s.minLength!=null)check(v.length>=s.minLength,'Text is empty.')
      if(s.maxLength!=null)check(v.length<=s.maxLength,'Text is too long.')
    }
    if(Array.isArray(v)) {
      if(s.minItems!=null)check(v.length>=s.minItems,'The list is empty or too short.')
      if(s.maxItems!=null)check(v.length<=s.maxItems,'The list is too long.')
      if(s.uniqueItems)check(new Set(v.map(x=>JSON.stringify(x))).size===v.length,'The list contains duplicates.')
      if(s.items)v.forEach((x,i)=>visit(x,s.items,`${path}/${i}`))
    } else if(v && typeof v==='object') {
      for(const key of s.required||[])if(!(key in v))issues.push({path:`${path}/${key}`,message:'A required field is missing.'})
      for(const [key,x] of Object.entries(v)) {
        if(s.properties?.[key])visit(x,s.properties[key],`${path}/${key}`)
        else if(s.additionalProperties===false)issues.push({path:`${path}/${key}`,message:'Unknown field.'})
        else if(s.additionalProperties && typeof s.additionalProperties==='object')visit(x,s.additionalProperties,`${path}/${key}`)
      }
    }
  }
  visit(value,programmeModelSchema,'')
  return issues
}
