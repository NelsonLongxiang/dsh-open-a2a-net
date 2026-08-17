/**
 * Real-load-path guard for @jf/dsh-open-a2a-net. The plugin is a NAMESPACE
 * plugin with `inject` — a stray `export default apply` would make the
 * cordis Loader's `unwrapExports` (`exports.default ?? exports`) collapse
 * the module to the bare `apply` function, DROPPING `inject` (postmortem
 * 0001). The plugin would then read `ctx.tools` without having injected it
 * and throw the moment it loads.
 */
import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as a2a from '../src/index.ts'

describe('dsh-a2a real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in a2a).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(a2a) as Record<string, unknown>
    expect(unwrapped).toBe(a2a)
    expect(unwrapped.name).toBe('a2a')
    expect(unwrapped.inject).toEqual(['tools', 'timer'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })
})
