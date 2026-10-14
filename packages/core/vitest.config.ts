import { defineConfig } from 'vitest/config'
import { testInclude } from '../../scripts/test-discovery'
import { indexTrace } from './test/regression-index-trace-plugin'
export default defineConfig({plugins: [indexTrace()], test: { allowOnly: false, include: testInclude, maxWorkers: 4, pool: 'forks' } })
