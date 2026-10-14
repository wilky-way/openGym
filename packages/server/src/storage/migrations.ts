// Forward-only, numbered SQLite migrations (STORAGE-CONTRACT §6). The DDL is the frozen contract file,
// Embedded at build time. Optional projection tables are deliberately not applied here.
import init from '../../../contract/storage/migrations/0001_init.sql' with { type: 'text' }

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
]
