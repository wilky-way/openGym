import { describe, it, expect } from 'vitest'
import { dockerArgs } from '../check-docker-args'

describe('S10 Docker CLI inputs', () => {
  it('uses the W23 default regardless of other flags', () => {
    expect(dockerArgs([]).dist).toBe('packages/web/dist')
    expect(dockerArgs(['--check-context']).dist).toBe('packages/web/dist')
    expect(dockerArgs(['--lease-granted', '--probe']).dist).toBe('packages/web/dist')
    expect(dockerArgs(['--web-dist', 'synthetic-dist']).dist).toBe('synthetic-dist')
  })
  it('rejects a missing or flag-like directory', () => {
    expect(() => dockerArgs(['--web-dist'])).toThrow('--web-dist requires a directory')
    expect(() => dockerArgs(['--web-dist', '--probe'])).toThrow('--web-dist requires a directory')
  })
})
