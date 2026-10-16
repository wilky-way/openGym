import { defineConfig } from 'vitest/config'
import { testInclude } from '../../scripts/test-discovery'
import { k08IndexTrace } from './test/k08-index-trace-plugin'
export default defineConfig({plugins: [k08IndexTrace()], test: { allowOnly: false, include: testInclude, maxWorkers: 4, pool: 'forks' } })
