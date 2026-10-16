import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('every root-level module server.js needs is on the Dockerfile COPY line', () => {
  // Compiled dependency closure replaces individual JS COPY entries (including deleted media).
  const api = readFileSync(resolve(import.meta.dir, '../../../api/Dockerfile'), 'utf8')
  expect(api).toContain('bun install --frozen-lockfile')
  expect(api).toContain('bun build --compile')
  expect(api).toContain('packages/server/src/cli/serve.ts')
  expect(api).toContain('COPY --from=build --chown=bun:bun /app/opengym-server ./opengym-server')
  expect(api).toMatch(/\nUSER bun\n/)
  expect(api).toContain('FROM oven/bun:1.4.1')
  expect(api).toContain('/api/health')
  expect(api).toContain('DEVICE_TOKENS=1')
  expect(api.match(/^FROM oven\/bun:1\.4\.1@sha256:[a-f0-9]{64}(?: AS build)?$/gm)).toHaveLength(2)
  const runtime = api.split(/^FROM /m).at(-1)!
  expect(runtime.match(/^COPY .*$/gm)).toHaveLength(1)
  const web = readFileSync(resolve(import.meta.dir, '../../../web/Dockerfile'), 'utf8')
  expect(web).toContain('ARG WEB_DIST=dist\nCOPY ${WEB_DIST}/ /usr/share/nginx/html/') // I03 Compose selects the native public artifact; context smoke keeps the dist default
  expect(web).toContain('COPY catalogue/media/')
  expect(web).toContain('USER 101')
  expect(web).toMatch(/^FROM nginxinc\/nginx-unprivileged:alpine@sha256:[a-f0-9]{64}$/m)
  expect(web).not.toContain('MEDIA_UPLOAD_MAX')
  for (const env of ['NGINX_PORT', 'BACKEND', 'PORT', 'RESOLVER', 'CF_CONNECTING_IP', 'BASE_PATH']) expect(web).toMatch(new RegExp('ENV ' + env + '='))
  expect(readFileSync(resolve(import.meta.dir, '../../../web/nginx.conf.template'), 'utf8')).toContain('client_header_timeout 60s;')
})

test('nginx applies one 5 MiB body cap to every location including deleted media routes', () => {
  const template = readFileSync(resolve(import.meta.dir, '../../../web/nginx.conf.template'), 'utf8')
  expect(template.match(/client_max_body_size[^;]*;/g)).toEqual(['client_max_body_size 5m;'])
  // A location-only cap leaves other routes at nginx's 1 MiB default.
  const serverDirectives = template.slice(template.indexOf('server {'), template.indexOf('    location '))
  expect(serverDirectives).toContain('client_max_body_size 5m;')
  expect(template).not.toContain('/api/media/')
  expect(template).not.toContain('MEDIA_UPLOAD_MAX')
})
