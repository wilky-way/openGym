import type { ProgrammeSchema } from './programme-model-schema'
const text={type:'string',minLength:1,maxLength:1000},number={type:'number'},positive={type:'number',exclusiveMinimum:0},integer={type:'integer',minimum:1}
const object=(properties:Record<string,ProgrammeSchema>,required:string[])=>({type:'object',properties,required,additionalProperties:false})
export const nativePrescriptionSchema:ProgrammeSchema=object({
  version:{const:1},variantKey:text,
  source:object({slotId:text,workbookSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},sheet:text,cell:text},['slotId','workbookSha256','sheet','cell']),
  restSeconds:positive,
  sets:{type:'array',minItems:1,maxItems:100,items:object({
    sourceTemplateId:text,
    relativeLoad:object({kind:{const:'same-entry-reduction'},reductionPercent:{type:'number',exclusiveMinimum:0,exclusiveMaximum:100},
      anchor:object({variantKey:text,source:object({slotId:text,workbookSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},sheet:text,cell:text},['slotId','workbookSha256','sheet','cell']),sourceTemplateId:text,rowOrdinal:{type:'integer',minimum:1,maximum:100}},['variantKey','source','sourceTemplateId','rowOrdinal']),
    },['kind','reductionPercent','anchor']),
    reps:object({kind:{enum:['fixed','range','amrap']},min:integer,max:integer},['kind','min']),
    effort:object({scale:{enum:['rpe','rir']},min:{...number,minimum:0,maximum:10},max:{...number,minimum:0,maximum:10},maxExclusive:{type:'boolean'}},['scale']),
    percentage:object({min:positive,max:positive,role:{enum:['prescribed','guide']},basis:{enum:['1rm','tm','e1rm']},key:text},['min','max','role','basis','key']),
  },['sourceTemplateId','reps'])},
},['version','variantKey','source','sets'])
