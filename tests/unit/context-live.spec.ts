// @vitest-environment node
/**
 * Test host, 2026-11-12: a late loader callback in an inactive plugin context threw "cannot get required service …
 * in inactive context" and took the host down. inactiveContextError recognises exactly that error, as real cordis
 * raises it, so the callback can give up instead.
 */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { inactiveContextError } from '../../src/context-live.ts'

describe('inactiveContextError', () => {
  it('matches the error cordis raises for a service read in a fiber that went inactive (its uid kept)', async () => {
    class Foo extends Service { constructor(ctx: Context) { super(ctx, 'foo') } }
    const root = new Context()
    const provider = root.plugin(Foo)
    let seen: Context | undefined
    root.plugin({ inject: ['foo'], apply: (ctx: Context) => { seen = ctx } })
    await new Promise(r => setTimeout(r, 0))
    await provider.dispose()
    await new Promise(r => setTimeout(r, 0))
    expect(seen!.fiber.uid).not.toBeNull()
    let caught: unknown
    try { void (seen as unknown as { foo: unknown }).foo } catch (error) { caught = error }
    expect(inactiveContextError(caught)).toBe(true)
  })
  it('does not match other errors', () => {
    expect(inactiveContextError(new Error('cannot get property "x" without inject'))).toBe(false)
    expect(inactiveContextError('in inactive context')).toBe(false)
    expect(inactiveContextError(undefined)).toBe(false)
  })
})
