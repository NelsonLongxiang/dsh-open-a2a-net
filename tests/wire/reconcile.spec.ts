/**
 * F8 desired-state reconciliation: the due set is re-derived every tick
 * from the join intents (post-boot drift is covered), failures back off
 * with reasons surfaced on the state face, corrupt logs park as
 * needs-repair, and a missing materializer records and moves on instead
 * of stalling the pass — the shape that killed the boot prewarm mid-queue.
 *
 * Poll discipline: vi.waitFor retries while its callback THROWS, so every
 * predicate asserts with expect() instead of returning a boolean.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'

/** Fake agents registry: one recoverable root agent or none. */
class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): Agent {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

interface ReconcileRow {
  id: string
  error: string
  attempts: number
  nextRetryAt: number
  needsRepair: boolean
}

interface StateFace {
  sessions: Array<{ id: string; joined: boolean; live?: boolean }>
  prewarm: { state: string; failed: Array<{ id: string; error: string }> }
  reconcile: { state: string; woken: number; rows: ReconcileRow[] }
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-reconcile-'))
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-1',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'test node',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    wakeReconcile: true,
    wakeReconcileIntervalMs: 50,
    wakeReconcileBackoffBaseMs: 5_000,
    wakeReconcileMaxBackoffMs: 600_000,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: '',
    cardTtlMs: 172_800_000,
    ...overrides,
  }
}

async function getState(port: number): Promise<StateFace> {
  return await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json()
}

function writeIntents(home: string, ids: string[]): void {
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ids }))
}

/** Mount the plugin stack minus apply: the per-test arrangers stay in charge. */
async function mountStack(): Promise<{ ctx: Context; port: () => number }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  ctx.provide('sessionPersistence', {
    list: async () => [{ id: SessionId('agent-1') }, { id: SessionId('session-2-0000-0000-0000-000000000000') }],
  } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
  return {
    ctx,
    port: () => (ctx as unknown as { webServer: WebServer }).webServer.port,
  }
}

describe('F8 desired-state reconciliation', () => {
  it('wakes a joined intent that went cold after boot and reports the outcome on the state face', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const woken = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    const materialize = vi.fn(async () => {
      agents.agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('sessionController', { resolveAgent: async (id: string) => ({ agent: await materialize(id) }) } as never)
    apply(ctx, makeConfig({ dshHome: home }))
    await vi.waitFor(async () => {
      expect(materialize).toHaveBeenCalledWith('agent-1')
    })
    await vi.waitFor(async () => {
      const state = await getState(port())
      expect(state.reconcile.state).toBe('idle')
      expect(state.reconcile.woken).toBeGreaterThanOrEqual(1)
    }, { timeout: 5_000 })
    const state = await getState(port())
    expect(state.sessions.find(row => row.id === 'agent-1')).toMatchObject({ joined: true, live: true })
    await ctx.fiber.dispose()
    const calls = materialize.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 150))
    // Disposal stops the loop: no further ticks keep waking sessions.
    expect(materialize.mock.calls.length).toBe(calls)
  })

  it('#756: a wake face that throws synchronously (an in-place reset holds the session) is a failed wake, not a dead host', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const woken = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    let resetting = true
    // The reset's lifecycle guard throws before any promise exists (the production stack in #756).
    const resolveAgent = vi.fn((_id: string) => {
      if (resetting) throw new Error('该会话正在重置，请稍后重试')
      agents.agent = woken
      ctx.emit('agent/created', { agent: woken })
      return Promise.resolve({ agent: woken })
    })
    ctx.provide('sessionController', { resolveAgent } as never)
    apply(ctx, makeConfig({ dshHome: home, wakeReconcileBackoffBaseMs: 200 }))
    let row: ReconcileRow | undefined
    await vi.waitFor(async () => {
      const state = await getState(port())
      row = state.reconcile.rows.find(item => item.id === 'agent-1')
      expect(row?.attempts ?? 0).toBeGreaterThanOrEqual(1)
    }, { timeout: 5_000 })
    expect(row!.error).toContain('该会话正在重置')
    // The host still answers, and once the reset releases the session the next attempt wakes it.
    resetting = false
    await vi.waitFor(async () => {
      const state = await getState(port())
      expect(state.reconcile.woken).toBeGreaterThanOrEqual(1)
      expect(state.reconcile.rows.find(item => item.id === 'agent-1')).toBeUndefined()
    }, { timeout: 5_000 })
    await ctx.fiber.dispose()
  })

  it('#756: whatever a reconcile pass throws on its own costs that pass, not the host — the loop keeps its cadence', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const woken = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    // A controller that is mid-swap for a while: even reading its face throws, inside the pass itself.
    let broken = 3
    const controller = {}
    Object.defineProperty(controller, 'resolveAgent', {
      get() {
        if (broken > 0) { broken -= 1; throw new Error('controller is being replaced') }
        return async () => { agents.agent = woken; ctx.emit('agent/created', { agent: woken }); return { agent: woken } }
      },
    })
    ctx.provide('sessionController', controller as never)
    apply(ctx, makeConfig({ dshHome: home }))
    await vi.waitFor(async () => {
      const state = await getState(port())
      expect(state.reconcile.woken).toBeGreaterThanOrEqual(1)
    }, { timeout: 5_000 })
    expect(broken).toBe(0)
    await ctx.fiber.dispose()
  })

  it('backs off after a failed wake and retries when the backoff elapses', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const materialize = vi.fn(async () => {
      throw new Error('replay interrupted')
    })
    ctx.provide('sessionController', { resolveAgent: async (id: string) => ({ agent: await materialize(id) }) } as never)
    apply(ctx, makeConfig({ dshHome: home, wakeReconcileBackoffBaseMs: 400 }))
    // First failure recorded with a reason and a future retry instant; the
    // 400ms base keeps attempts at 1 long enough to observe the pause.
    let first: ReconcileRow | undefined
    await vi.waitFor(async () => {
      const state = await getState(port())
      const row = state.reconcile.rows.find(item => item.id === 'agent-1')
      expect(row?.attempts ?? 0).toBe(1)
      first = row
    }, { timeout: 5_000 })
    expect(first!.error).toContain('replay interrupted')
    expect(first!.needsRepair).toBe(false)
    expect(first!.nextRetryAt).toBeGreaterThan(Date.now() - 20)
    // The backoff elapses and the reconciler retries — the one-shot
    // prewarm never gave a failed id a second look.
    await vi.waitFor(async () => {
      const state = await getState(port())
      const attempts = state.reconcile.rows.find(item => item.id === 'agent-1')?.attempts ?? 0
      expect(attempts).toBeGreaterThanOrEqual(2)
    }, { timeout: 5_000 })
    await ctx.fiber.dispose()
  })

  it('keeps needs-repair rows flagged but re-arms them at the cap cadence (a repaired log can return)', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const materialize = vi.fn(async () => {
      throw new Error('corrupt session log: seq gap in committed region')
    })
    ctx.provide('sessionController', { resolveAgent: async (id: string) => ({ agent: await materialize(id) }) } as never)
    apply(ctx, makeConfig({ dshHome: home, wakeReconcileBackoffBaseMs: 200, wakeReconcileMaxBackoffMs: 200 }))
    let row: ReconcileRow | undefined
    await vi.waitFor(async () => {
      const state = await getState(port())
      const found = state.reconcile.rows.find(item => item.id === 'agent-1')
      expect(found?.needsRepair ?? false).toBe(true)
      row = found
    }, { timeout: 5_000 })
    // Re-armable: the retry instant is finite, not a forever park.
    expect(row!.nextRetryAt).toBeLessThan(Number.MAX_SAFE_INTEGER)
    // The corrupt row re-probes at the cap cadence — the flag stays up
    // while the log stays corrupt, but the old never-retry park left a
    // repaired session cold forever with no way back.
    await vi.waitFor(async () => {
      const state = await getState(port())
      const attempts = state.reconcile.rows.find(item => item.id === 'agent-1')?.attempts ?? 0
      expect(attempts).toBeGreaterThanOrEqual(2)
    }, { timeout: 5_000 })
    const after = (await getState(port())).reconcile.rows.find(item => item.id === 'agent-1')!
    expect(after.needsRepair).toBe(true)
    await ctx.fiber.dispose()
  })

  it('a wake face without resolveAgent is no face at all: prewarm skips honestly and the reconciler stays off', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1', 'session-2-0000-0000-0000-000000000000'])
    const { ctx, port } = await mountStack()
    // sessionController present but without the resolveAgent face: the wake
    // paths read that as "no wake face composed" — prewarm reports the skip
    // on the state route instead of draining into stuck 'draining', and the
    // reconciler holds its off cadence waiting for the face to appear.
    ctx.provide('sessionController', {} as never)
    apply(ctx, makeConfig({ dshHome: home, wakeJoinedOnBoot: true, wakeBootStaggerMs: 5 }))
    await vi.waitFor(async () => {
      const state = await getState(port())
      expect(state.prewarm.state).toBe('skipped:no-wake-face')
    }, { timeout: 5_000 })
    // The reconciler holds its off cadence: no rows are recorded while the
    // face is missing — they would be noise, since no wake can succeed.
    await new Promise(resolve => setTimeout(resolve, 300))
    const state = await getState(port())
    expect(state.reconcile.state).toBe('off')
    expect(state.reconcile.rows).toEqual([])
    await ctx.fiber.dispose()
  })
})
