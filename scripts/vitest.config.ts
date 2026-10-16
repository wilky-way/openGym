import { defineConfig } from 'vitest/config'
export default defineConfig({test:{ allowOnly: false,include:['scripts/test/**/*.test.ts'],maxWorkers:4}})
