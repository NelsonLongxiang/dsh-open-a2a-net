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
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'

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
    ctx.provide('sessionController', {
      resolveAgent: async (sessionId: SessionId) => ({ agent: await materialize(String(sessionId)) }),
    } as never)
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

  it('backs off after a failed wake and retries when the backoff elapses', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const materialize = vi.fn(async () => {
      throw new Error('replay interrupted')
    })
    ctx.provide('sessionController', {
      resolveAgent: async (sessionId: SessionId) => ({ agent: await materialize(String(sessionId)) }),
    } as never)
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

  it('parks a corrupt session log as needs-repair and never retries it', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1'])
    const { ctx, port } = await mountStack()
    const materialize = vi.fn(async () => {
      throw new Error('corrupt session log: seq gap in committed region')
    })
    ctx.provide('sessionController', {
      resolveAgent: async (sessionId: SessionId) => ({ agent: await materialize(String(sessionId)) }),
    } as never)
    apply(ctx, makeConfig({ dshHome: home }))
    let row: ReconcileRow | undefined
    await vi.waitFor(async () => {
      const state = await getState(port())
      const found = state.reconcile.rows.find(item => item.id === 'agent-1')
      expect(found?.needsRepair ?? false).toBe(true)
      row = found
    }, { timeout: 5_000 })
    const calls = materialize.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(1)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(materialize.mock.calls.length).toBe(calls)
    expect(row!).toMatchObject({ id: 'agent-1', needsRepair: true, attempts: 1 })
    await ctx.fiber.dispose()
  })

  it('a missing materializer records and moves on: the prewarm drains to done and the reconciler carries both rows', async () => {
    const home = tmpHome()
    writeIntents(home, ['agent-1', 'session-2-0000-0000-0000-000000000000'])
    const { ctx, port } = await mountStack()
    // sessionController present but without the resolveAgent face: materializeOnce
    // answers undefined — the input that used to end the boot prewarm's
    // queue mid-drain with the state stuck at 'draining' forever.
    ctx.provide('sessionController', {} as never)
    apply(ctx, makeConfig({ dshHome: home, wakeJoinedOnBoot: true, wakeBootStaggerMs: 5 }))
    await vi.waitFor(async () => {
      const state = await getState(port())
      expect(state.prewarm.state).toBe('done')
      expect(state.prewarm.failed).toHaveLength(2)
    }, { timeout: 5_000 })
    // The reconciler's rows snapshot refreshes on its next tick — poll for
    // both rows instead of reading once.
    await vi.waitFor(async () => {
      const state = await getState(port())
      const failedIds = state.reconcile.rows.map(row => row.id).sort()
      expect(failedIds).toEqual(['agent-1', 'session-2-0000-0000-0000-000000000000'])
    }, { timeout: 5_000 })
    const state = await getState(port())
    expect(state.reconcile.rows.every(row => row.error === 'materializer-unavailable')).toBe(true)
    await ctx.fiber.dispose()
  })
})
