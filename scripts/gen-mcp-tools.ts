// One canonical full-schema renderer for Markdown, JSON and HTTP route policies.
import { generateDocs } from '../packages/mcp/scripts/generate-docs'
if (import.meta.main) await generateDocs(process.argv.includes('--check'))
