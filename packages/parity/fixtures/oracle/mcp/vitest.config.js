import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    globals: false,
    environment: 'node',
    // Bun's vitest module runner resolves zod correctly in VM workers.
    pool: process.versions.bun ? 'vmThreads' : 'forks',
    isolate: true,
    reporters: ['default']
  }
})
