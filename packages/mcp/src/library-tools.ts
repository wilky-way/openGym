import { z } from 'zod'
import type { LibrarySummary } from '../../contract/http/api'
import { DraftStore, authoringDirectory, type Draft } from './draft-store'
import { libraryId, validation } from './authoring-tools'
import { parseInput } from './draft-ops'
import { diffDefinitions, conformanceDelta } from './program-diff'
import { withRemoteState, getState, currentClient, redactToolCredentials, withToolRedaction } from './state'
import { error, type Environment, type Fetcher } from './http-client'
import type { Tool } from './tool-types'

const key = z.string().min(1).max(128), rev = z.number().int().positive()
const ref = z.string().min(1).max(512)
export function createLibraryTools(options: { env?: Environment; fetcher?: Fetcher } = {}): Tool[] {
  const env = () => options.env ?? process.env
  const store = <T,>(run: (s: DraftStore) => T): T => { const s = new DraftStore(authoringDirectory(env())); try { return run(s) } finally { s.close() } }
  const tool = (name: string, description: string, schema: z.ZodRawShape, run: (p: any) => Promise<any>): Tool => ({ name, description, schema, withRedaction: run => withToolRedaction(run, options), handler: (p = {}) => withToolRedaction(() => run(parseInput(z.object(schema).strict(), p)), options) })
  const remote = <T,>(run: () => Promise<T>) => withRemoteState(run, options)
  const request = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    try { return await currentClient()!.request<T>(method, path, body) }
    catch (failure) {
      const e = failure as { status?: number; apiCode?: string }
      if (e.status === 404) throw error('NOT_FOUND', 'Programme or library version not found.')
      const codes: Record<string, [string, string]> = {
        'version-conflict': ['PARENT_CONFLICT', 'The library parent version changed. Read and diff it before publishing.'],
        'active-definition': ['ACTIVE_DEFINITION', 'Clone an active or paused definition before publishing.'],
        'private-downgrade': ['PRIVATE_DOWNGRADE', 'A private definition cannot be made public.'],
        'not-ready': ['NOT_READY', 'Only Ready drafts can be published.'],
      }
      const mapped = e.apiCode && Object.hasOwn(codes, e.apiCode) ? codes[e.apiCode] : undefined
      if (mapped) throw error(...mapped)
      throw failure
    }
  }
  const list = () => request<{ items: LibrarySummary[]; etag: string }>('GET', '/api/programmes/library')
  const resolve = async (reference: string): Promise<{ definition: Record<string, any>; customEx: any[] }> => {
    const match = /^(draft|def):([^@]+)(?:@(.+))?$/.exec(reference)
    if (!match) throw error('EINVAL', 'Use draft:<id>[@rev] or def:<id>[@version].')
    const [, kind, id, version] = match
    if (kind === 'draft') return store(s => {
      parseInput(key, id)
      if (version !== undefined && !/^[1-9]\d*$/.test(version)) throw error('EINVAL', 'A draft revision must be a positive integer.')
      const draft = version === undefined ? s.get(id!) : s.expect(id!, parseInput(rev, Number(version)))
      return { definition: draft.definition, customEx: draft.customEx ?? [] }
    })
    parseInput(libraryId, id)
    const state = getState(), catalogue = await list()
    if (!catalogue.items.some(item => item.id === id)) {
      const definition = state?.programmes?.definitions?.find((d: any) => d.id === id)
      if (!definition) throw error('NOT_FOUND', 'Programme not found.')
      if (version !== undefined && definition.authoring?.versionId !== version) throw error('NOT_FOUND', 'Programme version not found.')
      return { definition, customEx: state?.customEx ?? [] }
    }
    const entry = await request<any>('GET', '/api/programmes/library/' + encodeURIComponent(id!) + (version === undefined ? '' : '?version=' + encodeURIComponent(version)))
    return { definition: entry.definition, customEx: state?.customEx ?? [] }
  }
  return [
    tool('list_programmes', 'List authenticated library summaries, versions, privacy and active use without full definitions. Large results are capped; continue with nextOffset.', { offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }, p => remote(async () => {
      const library = redactToolCredentials(await list()), offset = p.offset ?? 0, items = []; let bytes = 0, shortened = false
      for (const entry of library.items.slice(offset, offset + (p.limit ?? 100))) {
        const item = { ...entry }
        for (const field of ['name', 'sourceKind', 'goal'] as const) if (typeof item[field] === 'string' && item[field]!.length > 512) { item[field] = item[field]!.slice(0, 512); shortened = true }
        const size = Buffer.byteLength(JSON.stringify(item)); if (bytes + size > 32 * 1024) break; items.push(item); bytes += size
      }
      const more = offset + items.length < library.items.length
      return { items, etag: library.etag, ...(more || shortened || offset > 0 ? { totalItems: library.items.length, truncated: more || shortened, nextOffset: more ? offset + items.length : null } : {}) }
    })),
    tool('diff_programs', 'Compare draft/definition references by stable week, day, session and slot identities, including ordering and conformance changes. Full details require full:true.', { from: ref, to: ref, full: z.boolean().optional() }, async p => {
      const run = async () => {
        const a = await resolve(p.from), b = await resolve(p.to)
        const entries = redactToolCredentials(diffDefinitions(a.definition, b.definition)), from = validation(a.definition, a.customEx, true), to = validation(b.definition, b.customEx, true)
        const conformance = redactToolCredentials(conformanceDelta(from, to, a.definition, b.definition))
        if (p.full) return { entries, conformance }
        // Compute deltas from every issue before bounding the response.
        const capIssues = (issues: any[]) => {
          const kept = []; let bytes = 0
          for (const issue of issues.slice(0, 200)) { const size = Buffer.byteLength(JSON.stringify(issue)); if (bytes + size > 6 * 1024) break; kept.push(issue); bytes += size }
          return kept
        }
        for (const result of [conformance.from, conformance.to]) {
          const issues = capIssues(result.issues)
          if (issues.length < result.issues.length) Object.assign(result, { issuesTruncated: true, totalIssues: result.issues.length })
          result.issues = issues
        }
        for (const kind of ['resolved', 'introduced']) {
          const issues = capIssues(conformance[kind])
          if (issues.length < conformance[kind].length) Object.assign(conformance, { [kind + 'Truncated']: true, [kind + 'Count']: conformance[kind].length })
          conformance[kind] = issues
        }
        const summary = []; let bytes = 0
        for (const entry of entries.slice(0, 200)) { const size = Buffer.byteLength(JSON.stringify(entry)); if (bytes + size > 16 * 1024) break; summary.push(entry); bytes += size }
        return { entries: summary, conformance, ...(summary.length < entries.length ? { truncated: true, totalEntries: entries.length } : {}) }
      }
      return [p.from, p.to].some(v => v.startsWith('def:')) ? remote(run) : run()
    }),
    tool('publish_program_draft', 'Explicitly publish a Ready personal draft to the library only. Dry run defaults true; writing requires dry_run:false, confirm:true, both authoring/write gates, draft revision and current library parent version. Existing library ids also require replace:true.', {
      draft_id: key, expected_rev: rev, expected_parent_version_id: key.nullable(), replace: z.boolean().optional(), dry_run: z.boolean().optional(), confirm: z.boolean().optional(),
    }, async p => {
      const dryRun = p.dry_run !== false
      if (!dryRun) {
        if (p.confirm !== true) throw error('EINVAL', 'Publishing requires confirm:true and dry_run:false.')
        if (env().OPENGYM_ENABLE_PROGRAMME_AUTHORING !== '1' || env().OPENGYM_ENABLE_PROGRAMME_WRITES !== '1') throw error('WRITES_DISABLED', 'Enable OPENGYM_ENABLE_PROGRAMME_AUTHORING=1 and OPENGYM_ENABLE_PROGRAMME_WRITES=1 to publish.')
      }
      const draft: Draft = store(s => s.expect(p.draft_id, p.expected_rev))
      const id = parseInput(libraryId, draft.definition.id)
      return remote(async () => {
        const state = getState(), library = await list(), head = library.items.find(item => item.id === id)
        if ((head?.versionId ?? null) !== p.expected_parent_version_id) throw error('PARENT_CONFLICT', 'The library parent version changed. Read and diff it before publishing.')
        if (head && p.replace !== true) throw error('PARENT_CONFLICT', 'Publishing an existing library id requires replace:true.')
        if (head?.inUse || (state?.programmes?.cycles ?? []).some((c: any) => ['active', 'paused'].includes(c.status) && (c.programmeId === id || c.snapshot?.id === id))) throw error('ACTIVE_DEFINITION', 'Clone an active or paused definition before publishing.')
        // Host drafts stay personal; a damaged/local-edited record cannot downgrade privacy.
        if (draft.definition.source?.private !== true) throw error('PRIVATE_DOWNGRADE', 'Personal drafts must remain private when published.')
        const conformance = validation(draft.definition, state?.customEx ?? [])
        if (conformance.level !== 'Ready') throw Object.assign(error('NOT_READY', 'Only Ready drafts can be published.'), { conformance })
        const preview = { dry_run: dryRun, published: false, draft_id: draft.draftId, rev: draft.rev, definitionId: id, expected_parent_version_id: p.expected_parent_version_id, level: conformance.level, private: true }
        // Recheck local CAS after HTTP preflight; publish the checked immutable snapshot.
        store(s => s.expect(p.draft_id, p.expected_rev))
        if (dryRun) return preview
        const entry = await request<any>('PUT', '/api/programmes/library/' + encodeURIComponent(id), { definition: draft.definition, expectedVersionId: p.expected_parent_version_id, minLevel: 'Ready' })
        return { ...preview, dry_run: false, published: true, versionId: entry.versionId, n: entry.n, level: entry.level }
      })
    }),
  ]
}
