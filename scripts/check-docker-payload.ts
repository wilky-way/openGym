import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every tree copied into an image must be public, including stray server data. */
export function publicTree(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isSymbolicLink() || entry.name.startsWith('.') ||
      /^(legacy|tests?|private|data|node_modules)$/i.test(entry.name) ||
      /(?:\.test\.|\.map$|\.(?:pem|key)$|^(?:secret|vapid\.json)(?:$|\.)|^db\.json|^state-.*\.json(?:$|\.)|^opengym\.db)/i.test(entry.name)) {
      throw new Error('non-public build input: ' + file)
    }
    if (entry.isDirectory()) publicTree(file)
  }
}
