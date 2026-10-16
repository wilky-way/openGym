// Forward-only, numbered SQLite migrations (STORAGE-CONTRACT §6). The DDL is the frozen contract file,
// embedded at build time. 0002_projection_OPTIONAL.sql belongs to S12 and is deliberately not applied here.
import init from '../../../contract/storage/migrations/0001_init.sql' with { type: 'text' }

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
]
