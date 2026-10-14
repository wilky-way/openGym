import { defineConfig } from 'vitest/config'
import { testInclude } from '../../scripts/test-discovery'
export default defineConfig({
  test: { allowOnly: false,
    include: testInclude,
    maxWorkers: 4,
    pool: 'forks',
    // Bun fork workers need Vite to transform Zod's ESM entry instead of externalizing it.
    server: { deps: { inline: ['zod'] } },
  },
})
