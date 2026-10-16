import { mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync, existsSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { dockerArgs } from './check-docker-args'
import { publicTree } from './check-docker-payload'

// Intentionally separate from gate: Docker probes require a Stack Manager lease.
const args = process.argv.slice(2), root = resolve(import.meta.dir, '..')
const options = dockerArgs(args), dist = resolve(options.dist)
const { contextOnly, probe } = options
if (!contextOnly && !options.lease) throw new Error('Docker builds/probes require --lease-granted after a Stack Manager grant')
if (!existsSync(join(dist, 'index.html'))) throw new Error('--web-dist must name a public build with index.html (W23); no fallback to legacy/frontend')
const apiTag = 'opengym-rw-api:s10-scratch', webTag = 'opengym-rw-web:s10-scratch'
const apiName = 'opengym-rw-s10-api', webName = 'opengym-rw-s10-web', network = 'opengym-rw-s10'
const temp = mkdtempSync(join(tmpdir(), 'opengym-docker-s10-')), context = join(temp, 'context')
const acquired = { api: false, web: false, network: false, apiImage: false, webImage: false }
async function run(argv: string[], capture = false): Promise<string> {
  const child = Bun.spawn(argv, { cwd: root, stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
  const output = capture ? await new Response(child.stdout).text() : ''
  if (await child.exited) throw new Error('failed: ' + argv.join(' '))
  return output.trim()
}
function copy(from: string, to: string) {
  mkdirSync(resolve(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true, dereference: false, filter: path => !/(?:\/tests?\/|\.test\.|\.map$)/.test(path) })
}
function probeHttp(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false }, response => {
      let body = ''; response.on('data', bytes => body += bytes); response.on('end', () => done({ status: response.statusCode!, body }))
    }); req.setTimeout(3000, () => req.destroy(new Error('probe timeout'))); req.on('error', fail); req.end()
  })
}
try {
  publicTree(dist)
  mkdirSync(context)
  for (const name of ['package.json', 'bun.lock', '.dockerignore']) copy(join(root, name), join(context, name))
  // Workspace manifests must exactly match the frozen lock, even for packages not compiled.
  for (const pkg of readdirSync(join(root, 'packages'))) {
    copy(join(root, 'packages', pkg, 'package.json'), join(context, 'packages', pkg, 'package.json'))
    if (!['server', 'core', 'contract'].includes(pkg)) continue
    if (pkg === 'contract') {
      for (const name of readdirSync(join(root, 'packages', pkg))) {
        if (['test', 'tests', 'node_modules', 'PORTING-WAIVERS.md', 'package.json', 'tsconfig.json', 'vitest.config.ts'].includes(name)) continue
        copy(join(root, 'packages', pkg, name), join(context, 'packages', pkg, name))
      }
    } else copy(join(root, 'packages', pkg, 'src'), join(context, 'packages', pkg, 'src'))
  }
  copy(join(root, 'api', 'Dockerfile'), join(context, 'api', 'Dockerfile'))
  for (const name of ['Dockerfile', 'nginx.conf.template', '05-check-base-path.sh']) copy(join(root, 'web', name), join(context, 'web', name))
  copy(dist, join(context, 'dist'))
  copy(join(root, 'catalogue', 'media'), join(context, 'catalogue', 'media'))
  for (const tree of ['packages', 'api', 'web', 'dist', 'catalogue']) publicTree(join(context, tree))
  console.log('S10 public build contexts: PASS (no legacy, tests, credentials, private files or symlinks)')
  if (!contextOnly) {
    // Refuse existing scratch resources; never overwrite another operator's ownership.
    for (const tag of [apiTag, webTag]) {
      const child = Bun.spawn(['docker', 'image', 'inspect', tag], { stdout: 'ignore', stderr: 'ignore' })
      if (await child.exited === 0) throw new Error('scratch image already exists: ' + tag)
    }
    await run(['docker', 'build', '-t', apiTag, '-f', join(context, 'api', 'Dockerfile'), context])
    acquired.apiImage = true
    await run(['docker', 'build', '-t', webTag, '-f', join(context, 'web', 'Dockerfile'), context])
    acquired.webImage = true
    if (probe) {
      await run(['docker', 'network', 'create', network]); acquired.network = true
      for (const name of ['api-data', 'web-data']) { mkdirSync(join(temp, name)); chmodSync(join(temp, name), 0o777) }
      await run(['docker', 'run', '--rm', '-d', '--name', apiName, '--network', network, '-p', '127.0.0.1:8197:3000', '-v', join(temp, 'api-data') + ':/data', apiTag]); acquired.api = true
      await run(['docker', 'run', '--rm', '-d', '--name', webName, '--network', network, '-p', '127.0.0.1:8198:80', '-v', join(temp, 'web-data') + ':/scratch', '-e', 'BACKEND=' + apiName, webTag]); acquired.web = true
      for (const [port, path] of [[8197, '/api/health'], [8198, '/'], [8198, '/api/health']] as const) {
        let result: { status: number; body: string } | undefined
        for (let attempt = 0; attempt < 30; attempt++) {
          try { result = await probeHttp(port, path); if (result.status === 200) break } catch {}
          await Bun.sleep(500)
        }
        if (result?.status !== 200) throw new Error('health probe failed: ' + port + path)
        if (path === '/api/health' && JSON.parse(result.body).ok !== true) throw new Error('unexpected API identity')
        console.log('S10 probe: 200 ' + port + path)
      }
      // Probe exactly the health commands shipped by both images.
      for (const name of [apiName, webName]) {
        const config = JSON.parse(await run(['docker', 'inspect', name], true))[0].Config
        await run(['docker', 'exec', name, 'sh', '-c', config.Healthcheck.Test[1]])
        if (![ 'bun', '101' ].includes(config.User)) throw new Error('runtime user is privileged')
      }
      // Final API carries only the executable. Web has only public dist + licensed catalogue assets.
      await run(['docker', 'exec', apiName, 'sh', '-c', 'test -x /app/opengym-server && test "$(ls -A /app | wc -l)" -eq 1'])
      await run(['docker', 'exec', webName, 'sh', '-c', '! find /usr/share/nginx/html -type f | grep -Ei "(/legacy/|/tests?/|/private/|/vapid[.]json([.][^/]*)?$|/secret([.][^/]*)?$|[.](pem|key)$|/[.]env[^/]*$|/db[.]json[^/]*$|/state-[^/]*[.]json([.][^/]*)?$|/opengym[.]db[^/]*$|[.]test[.]|[.]map$)"'])
      console.log('S10 image healthchecks, unprivileged users and runtime payloads: PASS')
    }
  }
} finally {
  const failures: string[] = []
  const cleanup = async (argv: string[]) => { try { await run(argv) } catch { failures.push(argv.join(' ')) } }
  if (acquired.api) await cleanup(['docker', 'rm', '-f', apiName])
  if (acquired.web) await cleanup(['docker', 'rm', '-f', webName])
  if (acquired.apiImage) await cleanup(['docker', 'rmi', apiTag])
  if (acquired.webImage) await cleanup(['docker', 'rmi', webTag])
  if (acquired.network) await cleanup(['docker', 'network', 'rm', network])
  rmSync(temp, { recursive: true, force: true })
  if (failures.length) throw new Error('cleanup needs operator attention: ' + failures.join('; '))
  console.log('S10 scratch containers/images/network/temp directories cleaned')
}
