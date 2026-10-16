import {it, expect} from 'vitest'
import {mkdtemp, writeFile, readFile, stat, readdir, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {writePrivateJSON, readPrivateJSON} from '../e2e/private-json.mjs'

it('publishes complete private records and leaves the latest concurrent cleanup snapshot last', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i03-pids-')), file = join(root, 'pids.json')
  try {
    const old = [{label: 'synthetic', pid: 1, stopped: false}], final = [{...old[0], stopped: true}]
    await writePrivateJSON(file, old)
    const before = (await stat(file)).ino
    const first = writePrivateJSON(file, old), cleanup = writePrivateJSON(file, final)
    await Promise.all([first, cleanup])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(final)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(file)).ino).not.toBe(before) // publication replaces the complete inode, never truncates it
    expect(await readdir(root)).toEqual(['pids.json'])
  } finally { await rm(root, {recursive: true, force: true}) }
})
it('waits for an actual incomplete read to be replaced, without a guessed settle delay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i03-pids-')), file = join(root, 'pids.json')
  try {
    await writeFile(file, '[', {mode: 0o600})
    let observed!: () => void
    const incomplete = new Promise<void>(resolve => {observed = resolve})
    const records = readPrivateJSON(file, {onRetry: observed, timeoutMs: 1000})
    await incomplete
    await writePrivateJSON(file, [{label: 'owned synthetic', pid: 1}])
    expect(await records).toEqual([{label: 'owned synthetic', pid: 1}])
    await writeFile(file, '[')
    await expect(readPrivateJSON(file, {timeoutMs: 20, retryMs: 2})).rejects.toBeInstanceOf(SyntaxError)
  } finally { await rm(root, {recursive: true, force: true}) }
})
