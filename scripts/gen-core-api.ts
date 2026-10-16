import { parse } from '@babel/parser'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { files, run } from './files'
const indexAPIs = JSON.parse(readFileSync(new URL('./exercise-index-api.json', import.meta.url), 'utf8')) as Record<string, string[]>
const sources = files('packages/parity/fixtures/oracle/frontend/src/lib').filter(p => p.endsWith('.js') && !p.includes('.test.'))
await run(['bun','x','--no-install','tsc','--allowJs','--declaration','--emitDeclarationOnly','--noCheck','--target','ES2023','--module','ESNext','--moduleResolution','Bundler','--outDir','.gate/declarations','--rootDir','packages/parity/fixtures/oracle/frontend/src',...sources])
const corrections: Record<string, [string,string][]> = {
  // The actual legacy/core timer reads idx/sec; a null default is not its input domain.
  'supersetFlow.d.ts': [['setRest?: null', 'setRest?: { idx: number; sec: number } | null']],
  'backoff.d.ts': [['backoffAt(top: any, k: any, step: any)','backoffAt(top: number, k: number, step: number)'],['backoffWeights(top: any, n: any, step: any)','backoffWeights(top: number, n: number, step: number)']],
  'backfill.d.ts': [['replaceId?: null | undefined;', 'replaceId?: string | null | undefined;']],
  'workout-date.d.ts': [['moved?: null', 'moved?: Workout | null']],
  'rep-range.d.ts': [['normalizeRepRange(reps: any, repsMin: any','normalizeRepRange(reps: unknown, repsMin: unknown']],
  // Legacy call sites, not JS declaration inference, define optionality (F1fix).
  'history.d.ts': [
    ['lastEntryFor(S: any, exId: any, rid: any)', 'lastEntryFor(S: any, exId: any, rid?: any)'],
    ['entryExcluded(w: any, entry: any)', 'entryExcluded(w: any, entry: any, index?: ExerciseIndex)'],
    ['modeOf(cfg: any)', 'modeOf(cfg: any, index?: ExerciseIndex)'],
    ['isBw: (cfg: any) => boolean', 'isBw: (cfg: any, index?: ExerciseIndex) => boolean'],
    ['rerampWarmups(rows: any, step?: number, floor?: number)', 'rerampWarmups(rows: any, step?: number | number[], floor?: number)'],
    ['setLabel(id: any, s: any, cfg: any, speedUnit: any)', 'setLabel(id: any, s: any, cfg?: any, speedUnit?: any)'],
    ['exLine(cfg: any, unit: any, speedUnit: any)', 'exLine(cfg: any, unit: any, speedUnit?: any)'],
    ['bestWeightFor(S: any, exId: any, as: any)', 'bestWeightFor(S: any, exId: any, as?: any)'],
    ['cascadeWeight(rows: any, from: any, value: any, side: any,', 'cascadeWeight(rows: any, from: any, value: any, side?: any,'],
  ],
  'dumbbells.d.ts': [['ownedWeightsFor(S: any, cfg: any)', 'ownedWeightsFor(S: any, cfg: any, index?: ExerciseIndex)']],
  'onerm.d.ts': [
    ['best1RM(S: any, exId: any, formula: any, as: any)', 'best1RM(S: any, exId: any, formula?: any, as?: any)'],
    ['bestSetOf(entry: any, formula?: string): null;', 'bestSetOf(entry: any, formula?: string): { est: number; w: number; r: number } | null;'],
    ['best1RM(S: any, exId: any, formula?: any, as?: any): null;', 'best1RM(S: any, exId: any, formula?: any, as?: any): { est: number; w: number; r: number; d: string; t: number } | null;'],
  ],
  'programme.d.ts': [
    ['occurrences: never[];', "occurrences: ProgrammeCycle['occurrences'];"],
    ['occurrences: never[];', "occurrences: ProgrammeCycle['occurrences'];"],
  ],
  'programme-today.d.ts': [
    ['occurrences: never[];', "occurrences: ProgrammeCycle['occurrences'];"],
    ['inserted: never[];', "inserted: ProgrammeCycle['inserted'];"],
  ],
  'programme-rollover.d.ts': [['occurrences: never[];', "occurrences: ProgrammeCycle['occurrences'];"]],
  'programme-refresh.d.ts': [
    ['added: never[];', 'added: any[];'], ['updated: never[];', 'updated: any[];'],
    ['protected: never[];', 'protected: any[];'], ['skipped: never[];', 'skipped: any[];'],
    ['needsReview: never[];', 'needsReview: { id: any; reason?: any; unknown?: any; unprescribed?: any }[];'],
    ['conformance: never[];', 'conformance: { id: any; protected: boolean; before: any; after: any; issues: any }[];'],
    ['repairs: never[];', 'repairs: { id: any; changes: any }[];'],
  ],
  'exercise-history.d.ts': [['bestSetFor(S: any, exId: any, mode: any, as: any)', 'bestSetFor(S: any, exId: any, mode?: any, as?: any)']],
  'finish-workout.d.ts': [['prs?: never[] | undefined;', 'prs?: string[] | undefined;']],
  'programme-calendar.d.ts': [['queue?: null', 'queue?: Queue | null']],
  'programme-targets.d.ts': [['programmeNote(S: any, cfg: any)', 'programmeNote(S: any, cfg: any, context?: { definition?: any; programme?: any })']],
  'progression.d.ts': [
    ['applyPrescription(sets: any, p: any, step?: number, floor?: number)', 'applyPrescription(sets: any, p: any, step?: number | number[], floor?: number)'],
    ['readSession(entry: any, fallback: any)', 'readSession(entry: any, fallback?: any, index?: ExerciseIndex)'],
    ['nextPrescription(S: any, cfg: any, routine: any)', 'nextPrescription(S: any, cfg: any, routine?: any, index?: ExerciseIndex)'],
    ['weightIncrement(cfg: any, unit: any)', 'weightIncrement(cfg: any, unit: any, index?: ExerciseIndex)'],
    ['policyFor(cfg: any, routine: any, mode: any)', 'policyFor(cfg: any, routine: any, mode: any, index?: ExerciseIndex)'],
    ['plannedOf(cfg: any)', 'plannedOf(cfg: any, index?: ExerciseIndex)'],
    ['planChanged(planned: any, cfg: any)', 'planChanged(planned: any, cfg: any, index?: ExerciseIndex)'],
    ['sessionsFor(S: any, exId: any, fallback: any, rid: any)', 'sessionsFor(S: any, exId: any, fallback: any, rid: any, index?: ExerciseIndex)'],
    ['owned?: null | undefined;', 'owned?: number[] | null | undefined;'],
    ['    reps: any;', '    reps?: any;'],
    ['    repsMin: any;', '    repsMin?: any;'],
  ],
  'plates.d.ts': [
    ['loadKindFor(S: any, cfgOrId: any)', 'loadKindFor(S: any, cfgOrId: any, index?: ExerciseIndex)'],
    ['baseWeightFor(S: any, exOrId: any)', 'baseWeightFor(S: any, exOrId: any, index?: ExerciseIndex)'],
    ['dropGrid(S: any, cfg: any)', 'dropGrid(S: any, cfg: any, index?: ExerciseIndex)'],
  ],
  'programme-tm.d.ts': [['programmeTMConfig(S: any, cfg: any, routine: any)', 'programmeTMConfig(S: any, cfg: any, routine: any, index?: ExerciseIndex)']],
  'workout-text.d.ts': [['    speedUnit: any;', '    speedUnit?: any;']],
  'import-csv.d.ts': [['customEx?: never[] | undefined;', 'customEx?: unknown[] | undefined;']],
  'exercises.d.ts': [
    ['EXIDX: {};', 'EXIDX: ExerciseIndex;'],
    ['CATALOGUE: any[];', 'CATALOGUE: Exercise[];'],
    ['canonicalExId: (id: any) => any', 'canonicalExId: (id: any, index?: ExerciseIndex) => any'],
    ['registerCustom(list: any): void', 'registerCustom(list?: unknown): ExerciseIndex'],
    ['isCustomEx: (ex: any) => boolean', 'isCustomEx: (ex: any, index?: ExerciseIndex) => boolean'],
    ['isCardio: (idOrEx: any) => boolean', 'isCardio: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean'],
    ['isBodyweightEq: (idOrEx: any) => boolean', 'isBodyweightEq: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean'],
    ['isLoadedEq: (idOrEx: any) => boolean', 'isLoadedEq: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean'],
    ['defaultIncrement(exId: any, unit: any)', 'defaultIncrement(exId: string, unit?: string, index?: ExerciseIndex)'],
    ['isAssisted(idOrEx: any): any', 'isAssisted(idOrEx?: string | Exercise | null, index?: ExerciseIndex): boolean'],
    ['betterWeight: (idOrEx: any, a: any, b: any) => number', 'betterWeight: (idOrEx: any, a: any, b: any, index?: ExerciseIndex) => number'],
    ['beatsWeight: (idOrEx: any, w: any, prev: any) => boolean', 'beatsWeight: (idOrEx: any, w: any, prev: any, index?: ExerciseIndex) => boolean'],
    ['exOr: (id: any) => any', 'exOr: (id: string, index?: ExerciseIndex) => Exercise'],
  ],
  'starter.d.ts': [
    ['substituteFor: (ex: any, equipment: any, taken: any)', 'substituteFor: (ex: any, equipment: any, taken: any, index?: ExerciseIndex)'],
    ['buildStarterPlan: (id: any, equipment: any)', 'buildStarterPlan: (id?: unknown, equipment?: readonly string[] | null, index?: ExerciseIndex)'],
  ],
  'bar.d.ts': [
    ['plateSplit(total: any, bar: any)', 'plateSplit(total: number | null | undefined, bar: number | null | undefined)'],
    ['defaultBarWeight: (eq: any, unit: any) => any', 'defaultBarWeight: (eq: string, unit: "kg" | "lb") => number | null'],
  ],
}
type Ast = {type?: string; end?: number; key?: {name?: string}; properties?: Ast[]; members?: Ast[]; typeAnnotation?: Ast; [key: string]: unknown}
function correctOptions(source: string) {
  const edits: [number,string][] = []
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {value.forEach(visit);return}
    const n = value as Ast, type = n.typeAnnotation?.typeAnnotation
    if (n.type === 'ObjectPattern' && type?.type === 'TSTypeLiteral') {
      const known = new Set(type.members?.map(p => p.key?.name))
      const missing = n.properties?.filter(p=>p.type==='ObjectProperty').map(p=>p.key?.name).filter((p):p is string=>!!p&&!known.has(p)) ?? []
      if (missing.length && type.end) edits.push([type.end-1,missing.map(p=>`    ${p}?: unknown;\n`).join('')])
    }
    for (const [key,v] of Object.entries(n)) if (!['loc','comments'].includes(key)) visit(v)
  }
  visit(parse(source,{sourceType:'module',allowUndeclaredExports:true,plugins:[['typescript',{dts:true}]]}))
  for (const [pos,text] of edits.sort((a,b)=>b[0]-a[0])) source=source.slice(0,pos)+text+source.slice(pos)
  return source
}
// GM F1fix sweep: additive index forwarding for every exported callable that reaches
// the legacy exercise lookup graph. Re-exports inherit their source declaration.
function forwardExerciseIndex(source: string, names: string[]) {
  const ast = parse(source, {sourceType:'module', allowUndeclaredExports:true, plugins:[['typescript',{dts:true}]]})
  const edits: [number, number, string][] = []
  for (const statement of ast.program.body) {
    const declaration = (statement as unknown as { declaration?: unknown }).declaration as any
    if (!declaration) continue
    const candidates = declaration.type === 'VariableDeclaration'
      ? declaration.declarations.map((d: any) => ({name:d.id.name, fn:d.id.typeAnnotation?.typeAnnotation}))
      : [{name:declaration.id?.name, fn:declaration}]
    for (const {name, fn} of candidates) {
      if (!names.includes(name) || !['TSDeclareFunction','TSFunctionType'].includes(fn?.type)) continue
      const params = fn.params
      const existing = params.find((p: any, i: number) => p.name === 'index' && p.optional && i === params.length - 1)
      if (existing) {
        const type = existing.typeAnnotation.typeAnnotation
        edits.push([type.start, type.end, 'ExerciseIndex'])
        continue
      }
      if (params.some((p: any) => p.type === 'RestElement')) throw new Error(`Cannot append an index after rest: ${name}`)
      const close = source.lastIndexOf(')', fn.returnType.start)
      const parameterName = params.some((p: any) => p.name === 'index') ? 'exerciseIndex' : 'index'
      edits.push([close,close,`${params.length ? ', ' : ''}${parameterName}?: ExerciseIndex`])
    }
  }
  for (const [start,end,text] of edits.sort((a,b)=>b[0]-a[0])) source=source.slice(0,start)+text+source.slice(end)
  return source
}
// TS 7's native declaration emitter can vary synthetic optional-member order.
// Compare the parsed type tree with order-insensitive unions/type-object members.
function semanticDeclaration(source: string): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== 'object') return value
    const n = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(n).sort()) if (!['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments','tokens'].includes(key)) out[key] = canonical(n[key])
    for (const key of n.type === 'TSUnionType' ? ['types'] : n.type === 'TSTypeLiteral' ? ['members'] : n.type === 'TSInterfaceBody' ? ['body'] : []) {
      const list = out[key] as unknown[]
      list.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    return out
  }
  return JSON.stringify(canonical(parse(source,{sourceType:'module',allowUndeclaredExports:true,plugins:[['typescript',{dts:true}]]})))
}
const output = 'packages/contract/core-api'
mkdirSync(output,{recursive:true})
for (const file of readdirSync('.gate/declarations/lib').filter(f=>f.endsWith('.d.ts'))) {
  let source = readFileSync(join('.gate/declarations/lib',file),'utf8')
  for (const [from,to] of corrections[file] ?? []) {
    if (!source.includes(from)) throw new Error(`Stale declaration correction: ${file}: ${from}`)
    source=source.replace(from,to)
  }
  if (file === 'bar.d.ts') {
    for (const name of ['DEFAULT_BAR_KG', 'DEFAULT_BAR_LB']) {
      const pattern = new RegExp(`export declare const ${name}: \\{[^]*?\\};`)
      if (!pattern.test(source)) throw new Error(`Stale declaration correction: ${file}: ${name}`)
      source = source.replace(pattern, `export declare const ${name}: Record<string, number>;`)
    }
  }
  source=correctOptions(source)
  // W29 added a typed repeat max to the port; the frozen JS oracle knows only today.
  if(file==='programme-rollover.d.ts') {
    if(!source.includes('today?: unknown;'))throw new Error('Stale declaration correction: repeatMax')
    source=source.replace('today?: unknown;',"today?: string; repeatMax?: import('../../core/src/programme-rollover').RepeatMax;")
  }
  source=forwardExerciseIndex(source,indexAPIs[file] ?? [])
  if (['programme.d.ts','programme-today.d.ts','programme-rollover.d.ts'].includes(file)) source = "import type { ProgrammeCycle } from '../domain/state-doc';\n" + source
  if (file === 'workout-date.d.ts') source = "import type { Workout } from '../domain/state-doc';\n" + source
  if (file === 'programme-calendar.d.ts') source = "import type { Queue } from '../domain/state-doc';\n" + source
  if (file === 'exercises.d.ts') source += `
/** R2: caller-owned index; EXIDX is the catalogue-only default (K03). */
export interface Exercise {
  id?: string; n?: string; bp?: string; tg?: string; eq?: string; mg?: string;
  sm?: string[] | string; st?: string[]; cat?: string; img?: string; gif?: string;
  fv?: string; mv?: string; desc?: string; custom?: boolean; assisted?: boolean;
  primaries?: string[]; secondaries?: string[]; muscleWeights?: Record<string, number>;
  target?: { assisted?: boolean } | null; [key: string]: unknown;
}
declare const CUSTOM_IDS: unique symbol;
export type ExerciseIndex = Readonly<Record<string, Exercise>> & { readonly [CUSTOM_IDS]?: ReadonlySet<unknown> };
export declare function createExerciseIndex(customEx?: unknown): ExerciseIndex;
`
  if (indexAPIs[file] && file !== 'exercises.d.ts') source = "import type { ExerciseIndex } from './exercises';\n" + source
  if (process.argv.includes('--check')) {
    if (semanticDeclaration(readFileSync(join(output,file),'utf8'))!==semanticDeclaration(source)) throw new Error(`core-api drift: ${file}`)
  } else if (semanticDeclaration(readFileSync(join(output,file),'utf8')) !== semanticDeclaration(source)) writeFileSync(join(output,file),source)
}
// New port-only offload API (K10 @ 7ca193d8); no counterpart in the frozen oracle.
const additions: Record<string, string> = {
  'sync-types.d.ts': `export type JsonMap = Record<string, unknown>;
export type ClockMap = Record<string, number>;
export type UndoMap = Record<string, number[]>;
export interface SyncEntry extends JsonMap {
  id?: string; d?: string; start?: number; end?: number | string; _ts?: number;
  _f?: ClockMap; _u?: UndoMap; t?: number; w?: number;
  entries?: SyncEntry[]; media?: JsonMap[];
}
/** Joined by max at; equal at chooses the lexicographically greater versionId. */
export interface ManifestEntry { versionId: string; at: number }
export interface SyncProgrammes extends SyncEntry {
  definitions?: SyncEntry[]; cycles?: SyncEntry[];
  offloaded?: Record<string, ManifestEntry>;
  /** A present definition referenced by an active/paused legacy-normalized cycle gets
   * {versionId: offloaded[id].versionId, at: offloaded[id].at + 1} if its install
   * marker is absent or no newer than the offload. Persists after terminal release
   * until an explicit later offload; reset drops markers at or before resetAt. */
  installed?: Record<string, ManifestEntry>;
}
`,
  'programme-offload.d.ts': `import type { SyncProgrammes } from './sync-types';
export type { SyncProgrammes } from './sync-types';
export declare function offloadInputs(a: SyncProgrammes | null | undefined, b: SyncProgrammes | null | undefined): [SyncProgrammes | null | undefined, SyncProgrammes | null | undefined];
export declare function resetOffload<T extends SyncProgrammes>(p: T, resetAt: number): T;
export declare function offloadStamp(programmes: SyncProgrammes | null | undefined): number;
`,
}
for (const [file, source] of Object.entries(additions)) {
  if (process.argv.includes('--check')) {
    if (semanticDeclaration(readFileSync(join(output, file), 'utf8')) !== semanticDeclaration(source)) throw new Error(`core-api drift: ${file}`)
  } else writeFileSync(join(output, file), source)
}
console.log(`gen:core-api${process.argv.includes('--check')?' --check':''}: ${sources.length} legacy modules`)

// Native port APIs have no frozen JS oracle. Generate declarations from their TS source,
// including the shared session views they expose, instead of maintaining parallel signatures.
const nativeFiles=['native-prescription','native-session','native-relative-load','session-types']
await run(['bun','x','--no-install','tsc','--declaration','--emitDeclarationOnly','--noCheck','--target','ES2023','--module','ESNext','--moduleResolution','Bundler','--outDir','.gate/native-api','--rootDir','packages',...nativeFiles.map(name=>`packages/core/src/${name}.ts`)])
for(const name of nativeFiles) {
  const source=readFileSync(`.gate/native-api/core/src/${name}.d.ts`,'utf8').replaceAll('../../contract/domain/','../domain/')
  const path=join(output,`${name}.d.ts`)
  if(process.argv.includes('--check')) {
    if(semanticDeclaration(readFileSync(path,'utf8'))!==semanticDeclaration(source))throw new Error(`core-api drift: ${name}`)
  } else writeFileSync(path,source)
}
