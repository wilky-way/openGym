import { files } from './files'
import { relative } from 'node:path'
export const testInclude = ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']
export function discoverTests(root: string): string[] {
  return files(root).filter(file => testInclude.some(pattern => new Bun.Glob(pattern).match(relative(root, file)))).sort()
}
