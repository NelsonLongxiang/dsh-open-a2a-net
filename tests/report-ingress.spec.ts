/**
 * a2a_report ingress: the ONE thing an unjoined session may do. The join
 * gate exemption is deliberate (one-way reporting grants no presence);
 * reports land in the state face's reports ring (newest first), rate
 * limited per session, message-capped.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }
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
    wakeReconcile: false,
    wakeReconcileIntervalMs: 60_000,
    wakeReconcileBackoffBaseMs: 5_000,
    wakeReconcileMaxBackoffMs: 600_000,
    teamJoinAllowlist: [],
    teamScopeRouting: false,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: '',
    cardTtlMs: 172_800_000,
    ...overrides,
  }
}

interface ReportFace {
  reports: Array<{ at: number; level: string; message: string; session: string; task?: string }>
}

async function mountHost(): Promise<{ ctx: Context; port: () => number; report: ToolDefinition | undefined }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  apply(ctx, makeConfig({ dshHome: '' }))
  return {
    ctx,
    port: () => (ctx as unknown as { webServer: WebServer }).webServer.port,
    report: ctx.tools.get('a2a_report'),
  }
}

async function getReports(port: number): Promise<ReportFace['reports']> {
  const body = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as ReportFace
  return body.reports
}

describe('a2a_report unjoined-node ingress', () => {
  it('an unjoined session can report — the join gate exemption is the point', async () => {
    const { ctx, port, report } = await mountHost()
    // The calling session is NOT a joined node and the fake has no
    // initiator — the join gate would refuse any other a2a tool outright.
    const exec = { agent: { id: SessionId('ghost-session-0000-0000-0000-000000000000') } }
    const result = await report?.execute({ message: '我离册了，请收养', level: 'warning' }, exec) as { ok: boolean; reportId?: string }
    expect(result?.ok).toBe(true)
    expect(result?.reportId).toMatch(/^report-/)
    const reports = await getReports(port())
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ level: 'warning', message: '我离册了，请收养', session: 'ghost-session-0000-0000-0000-000000000000' })
    await ctx.fiber.dispose()
  })

  it('rate limits to one report per 30s per session and caps the message at 2000 chars', async () => {
    const { ctx, report } = await mountHost()
    const exec = { agent: { id: SessionId('ghost-2') } }
    const first = await report?.execute({ message: 'first' }, exec) as { ok: boolean }
    expect(first?.ok).toBe(true)
    const second = await report?.execute({ message: 'second', level: 'error' }, exec) as { ok: boolean; error?: string }
    expect(second?.ok).toBe(false)
    expect(second?.error).toContain('rate limited')
    const oversized = await report?.execute({ message: 'x'.repeat(2001) }, { agent: { id: SessionId('ghost-3') } }) as { ok: boolean; error?: string }
    expect(oversized?.ok).toBe(false)
    expect(oversized?.error).toContain('2000-char cap')
    const empty = await report?.execute({ message: '  ' }, { agent: { id: SessionId('ghost-4') } }) as { ok: boolean; error?: string }
    expect(empty?.ok).toBe(false)
    await ctx.fiber.dispose()
  })

  it('serves reports newest first on the state face, carrying the task reference', async () => {
    const { ctx, port, report } = await mountHost()
    await report?.execute({ message: 'older', task: 'task-a' }, { agent: { id: SessionId('ghost-5') } })
    await report?.execute({ message: 'newer', level: 'error' }, { agent: { id: SessionId('ghost-6') } })
    const reports = await getReports(port())
    expect(reports).toHaveLength(2)
    expect(reports[0]?.message).toBe('newer')
    expect(reports[1]).toMatchObject({ message: 'older', task: 'task-a' })
    await ctx.fiber.dispose()
  })
})
