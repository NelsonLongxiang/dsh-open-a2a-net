// @vitest-environment node
/**
 * 3084, 2026-11-12: a team settings write took the superagent host down with "cannot get required service "timer" in
 * inactive context" — a loader callback ran after the plugin's fiber went inactive, and the old check (uid !== null)
 * let it through. contextLive also needs the fiber's store.
 */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { contextLive } from '../../src/context-live.ts'

describe('contextLive', () => {
  it('is false for a fiber whose injected service went away, though its uid stays', async () => {
    class Foo extends Service { constructor(ctx: Context) { super(ctx, 'foo') } }
    const root = new Context()
    const provider = root.plugin(Foo)
    let seen: Context | undefined
    root.plugin({ inject: ['foo'], apply: (ctx: Context) => { seen = ctx } })
    await new Promise(r => setTimeout(r, 0))
    expect(seen).toBeDefined()
    expect(contextLive(seen as never)).toBe(true)
    await provider.dispose()
    await new Promise(r => setTimeout(r, 0))
    expect(seen!.fiber.uid).not.toBeNull()
    expect(contextLive(seen as never)).toBe(false)
    expect(() => (seen as unknown as { foo: unknown }).foo).toThrow(/inactive context/)
  })
  it('is false once the fiber is disposed', async () => {
    const root = new Context()
    let seen: Context | undefined
    const fiber = root.plugin({ apply: (ctx: Context) => { seen = ctx } })
    await new Promise(r => setTimeout(r, 0))
    expect(contextLive(seen as never)).toBe(true)
    await fiber.dispose()
    expect(contextLive(seen as never)).toBe(false)
  })
})
