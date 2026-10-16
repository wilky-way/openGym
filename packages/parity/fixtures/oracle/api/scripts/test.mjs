// node:test isolates module singletons and process globals by file. Give each
// file the same process boundary under Bun, with bounded concurrency, rather
// than relying on shared-process resets for environment variables and built-ins.
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Use the invoking Bun when a package-script shell rewrites PATH.
// npm test can also orchestrate Bun workers from Node.
const runtime = process.env.npm_execpath?.endsWith('/bun')
  ? process.env.npm_execpath : process.versions.bun ? process.execPath : 'bun';
const files = readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.js')).sort();
let next = 0, pass = 0, fail = 0, errors = 0, failedFiles = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const result = await new Promise(resolve => {
      const child = spawn(runtime, ['test', '--timeout', '60000', `./test/${file}`], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', d => { output += d; });
      child.stderr.on('data', d => { output += d; });
      child.on('error', e => { output += `\n${e.stack}\n`; });
      child.on('close', code => resolve({ code, output }));
    });
    process.stdout.write(result.output);
    const count = word => +(result.output.match(new RegExp(`^\\s+(\\d+) ${word}$`, 'm'))?.[1] || 0);
    const passed = count('pass'), failed = count('fail'), errored = count('error');
    pass += passed; fail += failed; errors += errored;
    if (result.code !== 0 || !passed || failed || errored) failedFiles++;
  }
}
await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
console.log(`\nAPI total: ${pass} pass, ${fail} fail, ${errors} errors across ${files.length} files (${failedFiles} failed files)`);
process.exitCode = failedFiles || !files.length ? 1 : 0;
